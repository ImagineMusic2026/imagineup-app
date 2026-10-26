import {
  FieldPath,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import type {
  FanClubApplicationView,
  FanClubArtist,
  FanClubArtists,
  FanClubCard,
  FanClubNumbers,
  FanClubPage,
  FanClubPerson,
  MyFanClub,
  MyFanClubClub,
  Page,
} from '../api/contract';
import { artistRecord, CENTRALS_MAX, isPublished, type ArtistRecord } from '../centrals/model';
import { artistRef, membershipRef, membershipsRef } from '../centrals/service';
import { writeFanContact } from '../fan-contact/store';
import { isAutomaticUsername } from '../fan-profile/model';
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
import {
  applicationRecord,
  applicationTurn,
  FAN_CLUB_OPEN,
  FAN_CLUB_PRIZE_NOTICE,
  FAN_CLUB_RULES_VERSION,
  FEATURED_PER_ARTIST_MAX,
  FOLLOWERS_RECENT_MS,
  fanClubBoxes,
  fanClubNotFound,
  fanClubRecord,
  fanClubRefused,
  fanClubRulesUrl,
  isFeaturedNow,
  sumFanClubShards,
  type ApplicationInput,
  type ApplicationRecord,
  type FanClubRecord,
} from './model';
import { readVisibleClub, removeFanClubPostsOf, type PostsQuery } from './posts';
import { removeFanClubReportsOf } from './reports';
import {
  applicationPrivateRef,
  applicationRef,
  artistPrivateRef,
  FEATURE_OFF,
  fanClubFollowRef,
  fanClubRef,
  fanClubShardsOf,
  fanClubsOf,
  fanClubsOfOwner,
  followersQuery,
  OFFICIAL_OFF,
  ownerCopiesOf,
} from './store';

// O lado do fã no fã-clube (docs/arquitetura-api.md, seção 34, 34.3 e 34.5):
// o `GET /me/fan-club` (leve, de 1 a 5 leituras), as centrais que aceitam
// fã-clube para a candidatura, candidatar e desistir e o novo aceite do
// regulamento, na transação do runIdempotent, a página pública e a lista dos
// fã-clubes de um artista, os números do gestor (a etapa 3 de 34.14: a soma
// dos shards e os seguidores), e o passo da exclusão de conta (34.7). A ordem de
// uma rota que grava é a de sempre: as leituras do domínio, o planAwards, as
// gravações.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Lê documentos fora (`db.getAll`) ou dentro (`tx.getAll`) de uma transação. */
type GetAll = (refs: DocumentReference[]) => Promise<DocumentSnapshot[]>;

const recordOf = (snap: DocumentSnapshot | undefined): ArtistRecord | null =>
  snap?.exists ? artistRecord(snap.id, (snap.data() ?? {}) as Record<string, unknown>) : null;

// --- O GET /me/fan-club ------------------------------------------------------------

/** O que vem em toda resposta do `MyFanClub`: o programa, o regulamento e o aviso. */
function programOf(): Pick<MyFanClub, 'open' | 'rulesUrl' | 'rulesVersion' | 'notice'> {
  return {
    open: FAN_CLUB_OPEN,
    rulesUrl: fanClubRulesUrl(),
    rulesVersion: FAN_CLUB_RULES_VERSION,
    notice: FAN_CLUB_PRIZE_NOTICE,
  };
}

/**
 * A candidatura como o app mostra. O `canApply` diz se ela pode ir de novo
 * agora pelo que ela mesma diz (o programa aberto e o `applicationTurn`): o
 * @ escolhido e a central ficam para a hora de mandar.
 */
export function applicationView(
  record: ApplicationRecord,
  clubStatus: FanClubRecord['status'] | null,
  now: number,
): FanClubApplicationView {
  return {
    status: record.status,
    artistId: record.artistId,
    artistName: record.artistName,
    proposedName: record.proposedName,
    round: record.round,
    submittedAt: iso(record.submittedAt),
    rejectReason: record.status === 'rejected' ? record.rejectReason : null,
    canReapplyAt: iso(record.canReapplyAt),
    canApply: FAN_CLUB_OPEN && applicationTurn(record, clubStatus, now).ok,
    history: record.history.map((item) => ({ ...item, at: new Date(item.at).toISOString() })),
  };
}

/** O que decide se o fã-clube aparece para os fãs, lido junto (o artista, as caixas e o vínculo). */
type ClubContext = {
  artist: ArtistRecord | null;
  privateData: Record<string, unknown> | undefined;
  member: boolean;
};

/**
 * O fã-clube como o gestor vê no "Meu fã-clube". Indisponível, com o motivo:
 * encerrado (`closed`), pausado (`paused`), o artista fora do ar
 * (`artist_off`), o fã-clube fechado para o artista (`program_closed`, a
 * caixa "Aceita fã-clubes") ou o gestor fora da central (`not_member`).
 */
export function clubView(
  club: FanClubRecord,
  context: ClubContext | null,
  rulesVersion: string,
  now: number,
): MyFanClubClub {
  const boxes = fanClubBoxes(context?.privateData);
  let unavailableReason: MyFanClubClub['unavailableReason'] = null;
  if (club.status === 'closed' || context === null) unavailableReason = 'closed';
  else if (club.status === 'paused') unavailableReason = 'paused';
  else if (!isPublished(context.artist)) unavailableReason = 'artist_off';
  else if (!boxes.enabled) unavailableReason = 'program_closed';
  else if (!context.member) unavailableReason = 'not_member';
  return {
    id: club.id,
    name: club.name ?? '',
    artistId: club.artistId,
    artistName: club.artistName,
    status: club.status,
    postCount: club.postCount,
    pendingPosts: club.pendingPosts,
    photosAllowed: boxes.enabled && boxes.photosAllowed,
    featuredUntil: isFeaturedNow(club, now) ? club.featuredUntil : null,
    official: club.official,
    lastReward: club.lastReward ? { ...club.lastReward, at: iso(club.lastReward.at) } : null,
    available: unavailableReason === null,
    unavailableReason,
    rulesOutdated: rulesVersion !== FAN_CLUB_RULES_VERSION,
  };
}

/**
 * O `MyFanClub` pelo leitor dado: a candidatura; com o `clubId`, o fã-clube
 * dele; e, se ele não está encerrado, o artista, o `artistPrivate` e o vínculo
 * com a central, num `getAll`. De 1 a 5 leituras.
 */
async function myFanClubWith(
  getAll: GetAll,
  db: Firestore,
  uid: string,
  now: number,
): Promise<MyFanClub> {
  const [application] = await getAll([applicationRef(db, uid)]);
  if (!application!.exists) return { ...programOf(), application: null, club: null };
  const record = applicationRecord(uid, (application!.data() ?? {}) as Record<string, unknown>);
  if (record.clubId === null) {
    return { ...programOf(), application: applicationView(record, null, now), club: null };
  }
  const [clubSnap] = await getAll([fanClubRef(db, record.clubId)]);
  const club = clubSnap!.exists
    ? fanClubRecord(clubSnap!.id, (clubSnap!.data() ?? {}) as Record<string, unknown>)
    : null;
  if (club === null || club.ownerUid !== uid) {
    return { ...programOf(), application: applicationView(record, null, now), club: null };
  }
  let context: ClubContext | null = null;
  if (club.status !== 'closed') {
    const [artist, privateDoc, membership] = await getAll([
      artistRef(db, club.artistId),
      artistPrivateRef(db, club.artistId),
      membershipRef(db, uid, club.artistId),
    ]);
    context = {
      artist: recordOf(artist),
      privateData: privateDoc!.data() as Record<string, unknown> | undefined,
      member: membership!.exists,
    };
  }
  return {
    ...programOf(),
    application: applicationView(record, club.status, now),
    club: clubView(club, context, record.rulesVersion, now),
  };
}

/** `GET /me/fan-club`: sem chave e sem exigir o perfil (a conta só da equipe recebe o vazio). */
export function readMyFanClub(db: Firestore, uid: string, now: number): Promise<MyFanClub> {
  return myFanClubWith((refs) => db.getAll(...refs), db, uid, now);
}

/**
 * `GET /me/fan-club/artists`: as centrais do fã com o artista no ar e o
 * fã-clube aberto para ele (a caixa "Aceita fã-clubes", decisão 9), na ordem
 * do painel, para a candidatura. Uma consulta e um `getAll` dos artistas e dos
 * `artistPrivate`. Com o programa fechado (`FAN_CLUB_OPEN`), a lista vazia,
 * sem ler nada.
 */
export async function readFanClubArtists(db: Firestore, uid: string): Promise<FanClubArtists> {
  if (!FAN_CLUB_OPEN) return { items: [] };
  const list = await membershipsRef(db, uid).limit(CENTRALS_MAX).get();
  if (list.empty) return { items: [] };
  const ids = list.docs.map((doc) => doc.id);
  const snaps = await db.getAll(
    ...ids.map((id) => artistRef(db, id)),
    ...ids.map((id) => artistPrivateRef(db, id)),
  );
  const items = ids.flatMap((id, index) => {
    const artist = recordOf(snaps[index]);
    if (!isPublished(artist)) return [];
    const boxes = fanClubBoxes(snaps[ids.length + index]!.data() as Record<string, unknown>);
    if (!boxes.enabled) return [];
    const item: FanClubArtist = {
      artistId: artist.id,
      name: artist.name,
      shortName: artist.shortName,
      thumbUrl: artist.thumbUrl,
      photosAllowed: boxes.photosAllowed,
    };
    return [{ item, order: artist.order }];
  });
  items.sort((a, b) => a.order - b.order || a.item.name.localeCompare(b.item.name, 'pt-BR'));
  return { items: items.map(({ item }) => item) };
}

// --- Candidatar e desistir ------------------------------------------------------------

export type FanClubOutcome = { body: MyFanClub; plan: AwardPlan };

/**
 * Candidatar (`POST /me/fan-club/application`, 34.5), na transação do
 * runIdempotent, com o corpo já conferido (`parseApplication`): o programa
 * aberto (`applications_closed`); o @ escolhido (`username_required`); um
 * `getAll` do vínculo com a central, do artista, do `artistPrivate` e da
 * candidatura (`not_member`, depois `artist_closed`); com a candidatura
 * aprovada, o fã-clube dela; a candidatura de antes (`applicationTurn`); o
 * teto `fanclub_apply`; o `planAwards` sem entradas; e grava a candidatura
 * (`pending`, com as cópias do perfil, o `history` de antes e a rodada), o
 * privado (as redes e o texto de divulgação) e o contato do fã
 * (`users/{uid}/contact/main`, com `source: 'fanclub'`), juntos.
 */
export async function applyForFanClub(
  tx: Transaction,
  db: Firestore,
  options: {
    fan: FanContext;
    award: AwardContext;
    profile: DocumentSnapshot;
    input: ApplicationInput;
  },
): Promise<FanClubOutcome> {
  const { fan, award, profile, input } = options;
  if (!FAN_CLUB_OPEN) throw fanClubRefused('applications_closed');
  const username = profile.get('username');
  if (typeof username !== 'string' || isAutomaticUsername(username)) {
    throw fanClubRefused('username_required');
  }
  const appRef = applicationRef(db, fan.uid);
  const [membership, artistSnap, privateDoc, application] = await tx.getAll(
    membershipRef(db, fan.uid, input.artistId),
    artistRef(db, input.artistId),
    artistPrivateRef(db, input.artistId),
    appRef,
  );
  if (!membership!.exists) throw fanClubRefused('not_member');
  const artist = recordOf(artistSnap);
  if (!isPublished(artist) || !fanClubBoxes(privateDoc!.data()).enabled) {
    throw fanClubRefused('artist_closed');
  }
  const previous = application!.exists
    ? applicationRecord(fan.uid, (application!.data() ?? {}) as Record<string, unknown>)
    : null;
  let clubStatus: FanClubRecord['status'] | null = null;
  if (previous?.status === 'approved' && previous.clubId !== null) {
    const club = await tx.get(fanClubRef(db, previous.clubId));
    if (club.exists) clubStatus = fanClubRecord(club.id, club.data() ?? {}).status;
  }
  const turn = applicationTurn(previous, clubStatus, award.now);
  if (!turn.ok) throw fanClubRefused(turn.refusal, turn.details);
  enforceDailyCap(fan, award, 'club_apply');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);

  const at = tsOf(award.now);
  const copies = ownerCopiesOf(profile.data() ?? {});
  const record: ApplicationRecord = {
    uid: fan.uid,
    artistId: artist.id,
    artistName: artist.name,
    status: 'pending',
    round: turn.round,
    proposedName: input.name,
    rulesVersion: FAN_CLUB_RULES_VERSION,
    rulesAcceptedAt: award.now,
    adultDeclared: true,
    submittedAt: award.now,
    decidedAt: null,
    rejectReason: null,
    canReapplyAt: null,
    clubId: null,
    closedByStaff: false,
    history: previous?.history ?? [],
  };
  tx.set(appRef, {
    uid: record.uid,
    artistId: record.artistId,
    artistName: record.artistName,
    program: 'fanclub',
    status: record.status,
    round: record.round,
    proposedName: record.proposedName,
    rulesVersion: record.rulesVersion,
    rulesAcceptedAt: at,
    adultDeclared: true,
    submittedAt: at,
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    canReapplyAt: null,
    clubId: null,
    closedByStaff: false,
    history: record.history.map((item) => ({ ...item, at: tsOf(item.at) })),
    fanName: copies.name,
    fanUsername: copies.username,
    fanPhotoURL: copies.photoURL,
    schemaVersion: 1,
  });
  tx.set(applicationPrivateRef(db, fan.uid), {
    instagram: input.instagram,
    tiktok: input.tiktok,
    pitch: input.pitch,
    schemaVersion: 1,
  });
  // O WhatsApp vai para o contato do fã, e não para o privado (decisão 14).
  writeFanContact(tx, db, fan.uid, input.whatsapp, 'fanclub', at);
  countDailyAction(plan, fan, award, 'club_apply');
  return {
    body: { ...programOf(), application: applicationView(record, null, award.now), club: null },
    plan,
  };
}

/**
 * Desistir (`DELETE /me/fan-club/application`, desfazer: o suspenso também
 * desiste), na transação do runIdempotent: a pendente vira `withdrawn`, sem
 * mudar a rodada e sem `canReapplyAt`, com o `decidedAt` da desistência e o
 * `decidedBy` vazio (quem decidiu foi o fã), e o privado sai. Sem pendente, o
 * estado de agora, sem gravar.
 */
export async function withdrawApplication(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext },
): Promise<FanClubOutcome> {
  const { fan, award } = options;
  const appRef = applicationRef(db, fan.uid);
  const application = await tx.get(appRef);
  const record = application.exists
    ? applicationRecord(fan.uid, (application.data() ?? {}) as Record<string, unknown>)
    : null;
  if (record === null || record.status !== 'pending') {
    const body = await myFanClubWith((refs) => tx.getAll(...refs), db, fan.uid, award.now);
    return { body, plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award) };
  }
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  tx.update(appRef, { status: 'withdrawn', decidedAt: tsOf(award.now), decidedBy: null });
  tx.delete(applicationPrivateRef(db, fan.uid));
  const withdrawn: ApplicationRecord = { ...record, status: 'withdrawn', decidedAt: award.now };
  return {
    body: { ...programOf(), application: applicationView(withdrawn, null, award.now), club: null },
    plan,
  };
}

/**
 * O novo aceite do regulamento (`PUT /me/fan-club/rules`, 34.3), na transação
 * do runIdempotent, com a versão do corpo já igual à do servidor
 * (`parseRulesAcceptance`): o estado de agora (`myFanClubWith`, as leituras
 * antes de qualquer gravação); sem o fã-clube ativo ou pausado da candidatura
 * aprovada, `club_not_active`; com a versão de agora já aceita, a mesma
 * resposta sem gravar; senão, grava na candidatura a versão e o
 * `rulesAcceptedAt` novos, e o publicar deixa de esperar (`rules_outdated`).
 */
export async function acceptFanClubRules(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext },
): Promise<FanClubOutcome> {
  const { fan, award } = options;
  const body = await myFanClubWith((refs) => tx.getAll(...refs), db, fan.uid, award.now);
  if (
    body.application?.status !== 'approved' ||
    body.club === null ||
    body.club.status === 'closed'
  ) {
    throw fanClubRefused('club_not_active');
  }
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  if (!body.club.rulesOutdated) return { body, plan };
  tx.update(applicationRef(db, fan.uid), {
    rulesVersion: FAN_CLUB_RULES_VERSION,
    rulesAcceptedAt: tsOf(award.now),
  });
  return { body: { ...body, club: { ...body.club, rulesOutdated: false } }, plan };
}

// --- A página pública e a lista do artista --------------------------------------------

/** O gestor como os fãs veem: as cópias do perfil dele no fã-clube. */
export const ownerOf = (club: FanClubRecord): FanClubPerson => ({
  uid: club.ownerUid ?? '',
  name: club.ownerName,
  username: club.ownerUsername,
  photoURL: club.ownerPhotoURL,
});

/**
 * Quem segue o fã-clube agora, pelo `count()` no grupo `fanClubFollows`
 * (decisão 28, o `followersQuery`), fora de transação; com o `since`, só quem
 * seguiu desde ele (os novos em 30 dias). Sem o índice de grupo (só em
 * produção: o emulador não exige), a contagem falha com o código 9: vale 0,
 * com o erro no log, como o "N posts" da 1d (21.1). A cópia da noite usa a
 * mesma consulta sem engolir o erro (um 0 lá ficaria gravado).
 */
async function countFollowers(db: Firestore, clubId: string, since?: number): Promise<number> {
  try {
    const query = followersQuery(db, clubId, since === undefined ? undefined : tsOf(since));
    const snap = await query.count().get();
    return snap.data().count;
  } catch (error) {
    logger.error('fan-clubs: a contagem dos seguidores falhou', {
      clubId,
      since: since === undefined ? null : iso(since),
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * `GET /me/fan-club/numbers` (34.3): os números do fã-clube do gestor, só no
 * "Meu fã-clube". O fã-clube da candidatura aprovada, ainda dele, em qualquer
 * status (o encerrado também mostra o que fez); sem ele, 404
 * `fan_club_not_found`. Depois, em paralelo: a soma dos 16 shards (uma
 * consulta, `sumFanClubShards`) e os dois `count()` dos seguidores. Fora de
 * transação: a candidatura, o fã-clube, os shards e as contagens.
 */
export async function readMyFanClubNumbers(
  db: Firestore,
  uid: string,
  now: number,
): Promise<FanClubNumbers> {
  const application = await applicationRef(db, uid).get();
  const record = application.exists
    ? applicationRecord(uid, (application.data() ?? {}) as Record<string, unknown>)
    : null;
  if (record?.status !== 'approved' || record.clubId === null) throw fanClubNotFound();
  const clubId = record.clubId;
  const club = await fanClubRef(db, clubId).get();
  if (!club.exists || club.get('ownerUid') !== uid) throw fanClubNotFound();
  const [shards, followers, followers30d] = await Promise.all([
    fanClubShardsOf(db, clubId).get(),
    countFollowers(db, clubId),
    countFollowers(db, clubId, now - FOLLOWERS_RECENT_MS),
  ]);
  return { followers, followers30d, ...sumFanClubShards(shards.docs.map((doc) => doc.data())) };
}

/**
 * `GET /fan-clubs/:clubId` (34.3): o fã-clube que quem pede pode ver
 * (`readVisibleClub`: ativo, de artista no ar e com o fã-clube aberto, de
 * gestor que ele não bloqueou; senão 404), com o vínculo de quem pede com a
 * central (`isMember`) e com o fã-clube (`isFollowing`), lidos junto do
 * artista, e o `followerCount` exato, pelo `count()`. Nunca prêmio nem
 * pontos (decisão 48).
 */
export async function readFanClubPage(
  db: Firestore,
  uid: string,
  clubId: string,
  now: number,
): Promise<FanClubPage> {
  const [visible, followerCount] = await Promise.all([
    readVisibleClub(db, uid, clubId, (club) => [
      membershipRef(db, uid, club.artistId),
      fanClubFollowRef(db, uid, clubId),
    ]),
    countFollowers(db, clubId),
  ]);
  const { club, artist, extra } = visible;
  const [membership, follow] = extra;
  return {
    id: club.id,
    name: club.name ?? '',
    artist: {
      id: artist.id,
      name: artist.name,
      shortName: artist.shortName,
      thumbUrl: artist.thumbUrl,
    },
    owner: ownerOf(club),
    followerCount,
    postCount: club.postCount,
    featured: isFeaturedNow(club, now),
    official: club.official,
    isFollowing: follow?.exists === true,
    isOwner: club.ownerUid === uid,
    isMember: membership?.exists === true,
  };
}

/**
 * O cursor da faixa dos destacados, no campo do instante do cursor das listas
 * (21.2): o maior instante que o cursor aceita, que nenhuma contagem de
 * seguidores alcança. Com o id do último destacado mostrado; com o último da
 * faixa, a página seguinte começa a lista dos outros do topo.
 */
const FEATURED_BAND = 253_402_300_799_999;

/**
 * `GET /artists/:artistId/fan-clubs` (34.3): o artista no ar e com o fã-clube
 * aberto (senão, a página vazia, sem ler os fã-clubes) e a lista de bloqueios
 * de quem pede, num `getAll`. Primeiro a faixa dos destacados com o prazo em
 * dia (até 3, pelos seguidores e pelo id), cortada no `limit`; o cursor dela
 * leva o id do último mostrado (`FEATURED_BAND`), e a página seguinte relê os
 * destacados e continua depois dele. Depois, os ativos pelos seguidores da
 * cópia (`counts.followers`) e o id, sem os destacados de agora (estão na
 * faixa) e sem os de gestor bloqueado; o cursor guarda os seguidores e o id do
 * último lido. A página nunca passa do `limit` e pode vir menor, com o
 * cursor. Cada item com o `isFollowing`, num `getAll`.
 */
export async function readArtistFanClubs(
  db: Firestore,
  uid: string,
  artistId: string,
  query: PostsQuery,
  now: number,
): Promise<Page<FanClubCard>> {
  const [artistSnap, privateDoc, blockList] = await db.getAll(
    artistRef(db, artistId),
    artistPrivateRef(db, artistId),
    blockListRef(db, uid),
  );
  if (!isPublished(recordOf(artistSnap)) || !fanClubBoxes(privateDoc!.data()).enabled) {
    return { items: [], nextCursor: null };
  }
  const blocked = new Set(blockedOf(blockList!.get('blocked')));
  const shown = (club: FanClubRecord) =>
    club.ownerUid !== null && club.name !== null && !blocked.has(club.ownerUid);
  const active = fanClubsOf(db).where('artistId', '==', artistId).where('status', '==', 'active');

  const items: FanClubRecord[] = [];
  let nextCursor: string | null = null;
  let need = query.limit;
  let list = active.orderBy('counts.followers', 'desc').orderBy(FieldPath.documentId(), 'desc');
  const inBand = query.cursor === null || query.cursor.at === FEATURED_BAND;
  if (inBand) {
    const snap = await active.where('featured', '==', true).get();
    const featured = snap.docs
      .map((doc) => fanClubRecord(doc.id, doc.data()))
      .filter((club) => isFeaturedNow(club, now) && shown(club))
      .sort((a, b) => b.followers - a.followers || a.id.localeCompare(b.id))
      .slice(0, FEATURED_PER_ARTIST_MAX);
    const after = query.cursor?.id;
    const start = after ? featured.findIndex((club) => club.id === after) + 1 : 0;
    const band = featured.slice(start, start + query.limit);
    items.push(...band);
    need = query.limit - band.length;
    if (need === 0 && band.length > 0) {
      // A página cheia de destacados: a seguinte continua a faixa ou, no fim
      // dela, começa a lista dos outros do topo.
      nextCursor = encodePageCursor({ at: FEATURED_BAND, id: band.at(-1)!.id });
    }
  } else if (query.cursor) {
    list = list.startAfter(query.cursor.at, query.cursor.id);
  }
  if (need > 0) {
    const snap = await list.limit(need + 1).get();
    const read = snap.docs.slice(0, need).map((doc) => fanClubRecord(doc.id, doc.data()));
    items.push(...read.filter((club) => !isFeaturedNow(club, now) && shown(club)));
    const last = read.at(-1);
    if (snap.size > need && last) {
      nextCursor = encodePageCursor({ at: last.followers, id: last.id });
    }
  }
  const follows =
    items.length > 0
      ? await db.getAll(...items.map((club) => fanClubFollowRef(db, uid, club.id)))
      : [];
  return {
    items: items.map((club, index): FanClubCard => ({
      id: club.id,
      name: club.name ?? '',
      owner: ownerOf(club),
      followers: club.followers,
      featured: isFeaturedNow(club, now),
      official: club.official,
      postCount: club.postCount,
      isFollowing: follows[index]?.exists === true,
    })),
    nextCursor,
  };
}

/** Candidatar fora da API (o seed dos emuladores), com o ator dado (o de sistema não conta no teto). */
export function runApplyForFanClub(
  db: Firestore,
  uid: string,
  input: ApplicationInput,
  options: RunOptions,
): Promise<FanClubOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award, profile) =>
    applyForFanClub(tx, db, { fan, award, profile, input }),
  );
}

// --- A exclusão de conta (34.7) ---------------------------------------------------------

/**
 * O passo do fã-clube no `deleteUserData` (34.7), depois do engajamento do
 * mural e antes dos pedidos da loja: a candidatura e o privado saem; cada
 * fã-clube do gestor vira lápide (decisão 21), numa transação que relê o dono:
 * `closed`, `statusReason: 'account_deleted'`, `accountDeleted: true`, sem
 * dono, cópias e nome, com o destaque fora e o `closedAt` de antes (ou o de
 * agora). Ficam os `counts`, os shards e o registro dos prêmios, que não têm
 * dado dele. Desde a etapa 2 de 34.14, as publicações dele saem, com o item
 * aberto da fila de cada uma em `author_deleted` (`removeFanClubPostsOf`), e
 * as denúncias que ele fez saem, descontadas da rodada aberta
 * (`removeFanClubReportsOf`); os arquivos de `fanClubMedia/{uid}/` saem no
 * `purgeFanPhotos` do fim. Pode rodar de novo: a lápide já não tem dono e não
 * aparece na consulta, e o que saiu não volta nas consultas seguintes.
 */
export async function removeFanClubData(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<void> {
  await removeLeadership(db, uid, now);
  await removeFanClubPostsOf(db, uid, now);
  await removeFanClubReportsOf(db, uid, now);
}

/** A candidatura, o privado e a lápide de cada fã-clube do gestor (34.7, passos 1 e 2). */
async function removeLeadership(db: Firestore, uid: string, now: number): Promise<void> {
  await applicationPrivateRef(db, uid).delete();
  await applicationRef(db, uid).delete();
  const clubs = await fanClubsOfOwner(db, uid).get();
  const at = tsOf(now);
  for (const doc of clubs.docs) {
    await db.runTransaction(async (tx) => {
      const club = await tx.get(doc.ref);
      if (!club.exists || club.get('ownerUid') !== uid) return;
      tx.update(doc.ref, {
        status: 'closed',
        statusReason: 'account_deleted',
        accountDeleted: true,
        ownerUid: null,
        ownerName: null,
        ownerUsername: null,
        ownerPhotoURL: null,
        name: null,
        ...FEATURE_OFF,
        ...OFFICIAL_OFF,
        closedAt: club.get('closedAt') ?? at,
        updatedAt: at,
      });
    });
  }
}
