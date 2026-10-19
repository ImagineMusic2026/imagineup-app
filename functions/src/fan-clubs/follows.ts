import {
  FieldPath,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';

import type {
  FanClubPost,
  FollowedFanClub,
  FollowedFanClubs,
  FollowFanClubResult,
  Page,
  UnfollowFanClubResult,
} from '../api/contract';
import { artistRecord, isPublished, type ArtistRecord } from '../centrals/model';
import { artistRef, joinCentrals, membershipRef, type JoinRead } from '../centrals/service';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import { blockedOf } from '../moderation/model';
import { blockListRef } from '../moderation/store';
import { encodePageCursor } from '../page-cursor';
import {
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import { chunk, FEED_IN_BLOCK } from '../posts/model';
import {
  FAN_CLUB_FEED_FOLLOWS,
  FAN_CLUB_FOLLOWS_MAX,
  fanClubBoxes,
  fanClubNotFound,
  fanClubPostRecord,
  fanClubRecord,
  fanClubRefused,
  followSignals,
  millisOf,
  type FanClubPostRecord,
  type FanClubRecord,
} from './model';
import { publicPostView, type PostsQuery } from './posts';
import { ownerOf } from './service';
import {
  artistPrivateRef,
  fanClubCreditRef,
  fanClubFollowRef,
  fanClubFollowsOf,
  fanClubPostsOf,
  fanClubRef,
} from './store';

// Os seguidores do fã-clube (docs/arquitetura-api.md, seção 34, decisões 26 a
// 34 e 39; a etapa 4 de 34.14): seguir, que faz entrar na central oficial
// quando falta (o `joinCentrals` com a via `page` e o crédito da entrada
// trazida), deixar de seguir, "Fã-clubes que sigo" e a seção "Dos seus
// fã-clubes" da Início. Seguir é livre para todos, o número de seguidores é
// público, e o gestor vê só o número: nenhuma rota devolve quem segue. Sair da
// central, bloquear o gestor e a suspensão apagam o vínculo nos módulos deles
// (pelo store).

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

const iso = (ms: number | null): string => new Date(ms ?? 0).toISOString();

const artistOf = (snap: DocumentSnapshot | undefined): ArtistRecord | null =>
  snap?.exists ? artistRecord(snap.id, (snap.data() ?? {}) as Record<string, unknown>) : null;

/** O fã-clube que aparece para os fãs, sem olhar o artista: ativo, com dono e nome. */
const isShownClub = (club: FanClubRecord | null): club is FanClubRecord & { ownerUid: string } =>
  club !== null && club.status === 'active' && club.ownerUid !== null && club.name !== null;

// --- Seguir e deixar de seguir ------------------------------------------------------------

export type FollowOutcome = { body: FollowFanClubResult; plan: AwardPlan };

/**
 * Seguir (`PUT /me/fan-club-follows/:clubId`, 34.5), na transação do
 * runIdempotent: num `getAll`, o fã-clube, o vínculo de seguir, a lista de
 * bloqueios e o `referrals/{uid}` de quem pede; com o artista do fã-clube,
 * num segundo `getAll`, o artista, o `artistPrivate`, o vínculo com a central
 * e o marcador do crédito (`fanClubCredits/{artistId}`). Recusas, nesta ordem:
 * o fã-clube que não está ativo, de artista fora do ar ou sem o fã-clube
 * aberto, ou de gestor que quem pede bloqueou (404 `fan_club_not_found`); o
 * próprio (`own_fan_club`); já seguindo (a resposta sem gravar e sem contar
 * no teto); os 50 seguidos, pelo `count()` dos vínculos do fã na transação
 * (`follow_limit`); o teto `fanclub_follow`. Fora da central, o
 * `joinCentrals` com a via `page` (o `central_join` de sempre, uma vez na
 * vida, o teto `central_entry` e a comemoração) e o crédito do seguir (sem o
 * marcador, `via: 'follow'`; o `joinCentrals` só o grava com o `firstJoin`).
 * Grava o vínculo com os três sinais (decisão 39) e conta o teto. Seguir rende
 * 0 ponto (decisão 31).
 */
export async function followFanClub(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; profile: DocumentSnapshot; clubId: string },
): Promise<FollowOutcome> {
  const { fan, award, profile, clubId } = options;
  const followRef = fanClubFollowRef(db, fan.uid, clubId);
  const [clubSnap, follow, blockList, referral] = await tx.getAll(
    fanClubRef(db, clubId),
    followRef,
    blockListRef(db, fan.uid),
    db.collection('referrals').doc(fan.uid),
  );
  const club = clubSnap!.exists ? fanClubRecord(clubSnap!.id, clubSnap!.data() ?? {}) : null;
  if (!isShownClub(club) || club.artistId === '') throw fanClubNotFound();
  const [artistSnap, privateDoc, membership, marker] = await tx.getAll(
    artistRef(db, club.artistId),
    artistPrivateRef(db, club.artistId),
    membershipRef(db, fan.uid, club.artistId),
    fanClubCreditRef(db, fan.uid, club.artistId),
  );
  const artist = artistOf(artistSnap);
  if (!isPublished(artist) || !fanClubBoxes(privateDoc!.data()).enabled) throw fanClubNotFound();
  if (blockedOf(blockList!.get('blocked')).includes(club.ownerUid)) throw fanClubNotFound();
  if (club.ownerUid === fan.uid) throw fanClubRefused('own_fan_club');
  if (follow!.exists) {
    const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
    return { body: { clubId, following: true, joined: false, pointsAwarded: 0 }, plan };
  }
  const following = await tx.get(fanClubFollowsOf(db, fan.uid).count());
  if (following.data().count >= FAN_CLUB_FOLLOWS_MAX) throw fanClubRefused('follow_limit');
  enforceDailyCap(fan, award, 'club_follow');

  let plan: AwardPlan;
  let joined = false;
  if (membership!.exists) {
    plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  } else {
    const read: JoinRead = { artists: new Map([[artist.id, artist]]), members: new Set() };
    const outcome = await joinCentrals(tx, db, read, {
      fan,
      award,
      artistIds: [artist.id],
      via: 'page',
      followCredit: marker!.exists ? null : { clubId, artistId: artist.id, via: 'follow' },
    });
    plan = outcome.plan;
    joined = outcome.joined.length > 0;
  }
  const signals = followSignals({
    profileCreatedAt: fan.profileCreatedAt,
    username: profile.get('username'),
    inviterUid: referral!.exists ? referral!.get('inviterUid') : null,
    ownerUid: club.ownerUid,
    now: award.now,
  });
  tx.create(followRef, {
    uid: fan.uid,
    clubId,
    artistId: artist.id,
    followedAt: tsOf(award.now),
    ...signals,
    schemaVersion: 1,
  });
  countDailyAction(plan, fan, award, 'club_follow');
  return { body: { clubId, following: true, joined, pointsAwarded: plan.pointsAwarded }, plan };
}

/**
 * Deixar de seguir (`DELETE /me/fan-club-follows/:clubId`, desfazer: o
 * suspenso também), na transação do runIdempotent: o vínculo sai, se existe,
 * em qualquer status do fã-clube. Nunca recusa; não mexe na central, nos
 * pontos nem no crédito.
 */
export async function unfollowFanClub(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; clubId: string },
): Promise<{ body: UnfollowFanClubResult; plan: AwardPlan }> {
  const { fan, award, clubId } = options;
  const ref = fanClubFollowRef(db, fan.uid, clubId);
  const follow = await tx.get(ref);
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  if (follow.exists) tx.delete(ref);
  return { body: { clubId, following: false }, plan };
}

/** Seguir fora da API (o seed dos emuladores), com o ator dado (o de sistema não conta no teto). */
export function runFollowFanClub(
  db: Firestore,
  uid: string,
  clubId: string,
  options: RunOptions,
): Promise<FollowOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award, profile) =>
    followFanClub(tx, db, { fan, award, profile, clubId }),
  );
}

// --- As leituras -------------------------------------------------------------------------

/**
 * Quais artistas estão no ar e com o fã-clube aberto (a caixa "Aceita
 * fã-clubes"), num `getAll` dos artistas e dos `artistPrivate`: cada artista é
 * lido uma vez só, para todos os fã-clubes dele.
 */
async function openArtists(db: Firestore, artistIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(artistIds)];
  if (ids.length === 0) return new Set();
  const snaps = await db.getAll(
    ...ids.map((id) => artistRef(db, id)),
    ...ids.map((id) => artistPrivateRef(db, id)),
  );
  return new Set(
    ids.filter(
      (id, index) =>
        isPublished(artistOf(snaps[index])) &&
        fanClubBoxes(snaps[ids.length + index]!.data() as Record<string, unknown>).enabled,
    ),
  );
}

/** Os vínculos de seguir mais novos do fã: o índice automático do `followedAt`. */
const newestFollows = (db: Firestore, uid: string, limit: number) =>
  fanClubFollowsOf(db, uid).orderBy('followedAt', 'desc').limit(limit).get();

/**
 * Os fã-clubes dos vínculos e a lista de bloqueios de quem pede, num `getAll`:
 * cada fã-clube lido (null sem ele) e os gestores bloqueados.
 */
async function readFollowedClubs(
  db: Firestore,
  uid: string,
  clubIds: readonly string[],
): Promise<{ clubs: (FanClubRecord | null)[]; blocked: Set<string> }> {
  const [blockList, ...snaps] = await db.getAll(
    blockListRef(db, uid),
    ...clubIds.map((id) => fanClubRef(db, id)),
  );
  return {
    clubs: snaps.map((snap) => (snap.exists ? fanClubRecord(snap.id, snap.data() ?? {}) : null)),
    blocked: new Set(blockedOf(blockList!.get('blocked'))),
  };
}

/**
 * "Fã-clubes que sigo" (`GET /me/fan-club-follows`, 34.3): até 50 vínculos, do
 * mais novo ao mais antigo; os fã-clubes e a lista de bloqueios num `getAll`;
 * e o artista e o `artistPrivate` de cada artista dos que aparecem, uma vez
 * cada. Cada item com o `available` (o fã-clube ativo, de artista no ar e com
 * o fã-clube aberto, e o gestor não bloqueado). O indisponível vai com o nome
 * quando ele ainda existe (o pausado, o encerrado, o de artista fora do ar), e
 * sem nome na lápide e com o gestor bloqueado (o bloqueio esconde o fã-clube,
 * decisão 19); nunca com o gestor. Os indisponíveis contam nos 50: é aqui que
 * o fã libera vagas (o `follow_limit`).
 */
export async function readFollowedFanClubs(db: Firestore, uid: string): Promise<FollowedFanClubs> {
  const list = await newestFollows(db, uid, FAN_CLUB_FOLLOWS_MAX);
  if (list.empty) return { items: [] };
  const { clubs, blocked } = await readFollowedClubs(
    db,
    uid,
    list.docs.map((doc) => doc.id),
  );
  const ownerBlocked = (club: FanClubRecord | null) =>
    club?.ownerUid != null && blocked.has(club.ownerUid);
  const shown = clubs.map((club) => (isShownClub(club) && !ownerBlocked(club) ? club : null));
  const open = await openArtists(
    db,
    shown.flatMap((club) => (club ? [club.artistId] : [])),
  );
  return {
    items: list.docs.map((doc, index): FollowedFanClub => {
      const club = clubs[index] ?? null;
      const visible = shown[index] ?? null;
      const available = visible !== null && open.has(visible.artistId);
      const followedArtist = doc.get('artistId');
      return {
        id: doc.id,
        name: club !== null && !ownerBlocked(club) ? club.name : null,
        artistId: club?.artistId || (typeof followedArtist === 'string' ? followedArtist : ''),
        artistName: club?.artistName ?? '',
        owner: available ? ownerOf(visible) : null,
        followedAt: iso(millisOf(doc.get('followedAt'))),
        available,
      };
    }),
  };
}

/** As publicações no ar dos fã-clubes do `in`, da mais nova, com o cursor `[publishedAt, id]`. */
function publishedClubPosts(clubIds: readonly string[], query: PostsQuery, db: Firestore): Query {
  let ordered = fanClubPostsOf(db)
    .where('clubId', 'in', clubIds)
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');
  if (query.cursor) ordered = ordered.startAfter(tsOf(query.cursor.at), query.cursor.id);
  return ordered.limit(query.limit + 1);
}

/** A ordem da Início: a mais nova primeiro, e o id decrescente no empate (a do Firestore). */
function comparePublished(a: FanClubPostRecord, b: FanClubPostRecord): number {
  return (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * "Dos seus fã-clubes", a seção da Início (`GET /me/fan-club-feed`, 34.3): os
 * 20 vínculos mais novos (sem vínculo, a página vazia depois de uma leitura);
 * os fã-clubes e a lista de bloqueios num `getAll`; o artista e o
 * `artistPrivate` de cada artista, uma vez cada; e as publicações no ar dos
 * fã-clubes disponíveis (ativos, de artista no ar e com o fã-clube aberto, de
 * gestor não bloqueado), em blocos de 30 fã-clubes no `in` (o
 * `FEED_IN_BLOCK`, com o índice `clubId`, `status`, `publishedAt`), cada bloco
 * com os `limit + 1` primeiros, juntados na mesma ordem. 10 por página, com o
 * cursor `[publishedAt, id]`. O `/feed` oficial não muda (decisão 30).
 */
export async function readFanClubFeed(
  db: Firestore,
  uid: string,
  query: PostsQuery,
): Promise<Page<FanClubPost>> {
  const list = await newestFollows(db, uid, FAN_CLUB_FEED_FOLLOWS);
  if (list.empty) return { items: [], nextCursor: null };
  const { clubs, blocked } = await readFollowedClubs(
    db,
    uid,
    list.docs.map((doc) => doc.id),
  );
  const candidates = clubs.filter(
    (club): club is FanClubRecord & { ownerUid: string } =>
      isShownClub(club) && !blocked.has(club.ownerUid),
  );
  const open = await openArtists(
    db,
    candidates.map((club) => club.artistId),
  );
  const visible = new Map(
    candidates.filter((club) => open.has(club.artistId)).map((club) => [club.id, club]),
  );
  if (visible.size === 0) return { items: [], nextCursor: null };
  const blocks = await Promise.all(
    chunk([...visible.keys()], FEED_IN_BLOCK).map(async (ids) => {
      const snap = await publishedClubPosts(ids, query, db).get();
      return snap.docs.map((doc) => fanClubPostRecord(doc.id, doc.data()));
    }),
  );
  const all = blocks.flat().sort(comparePublished);
  const posts = all.slice(0, query.limit);
  const last = posts.at(-1);
  return {
    items: posts.map((post) => publicPostView(post, visible.get(post.clubId)!)),
    nextCursor:
      all.length > query.limit && last
        ? encodePageCursor({ at: last.publishedAt ?? last.submittedAt, id: last.id })
        : null,
  };
}
