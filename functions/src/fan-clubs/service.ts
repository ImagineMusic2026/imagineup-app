import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import type {
  FanClubApplicationView,
  FanClubArtist,
  FanClubArtists,
  MyFanClub,
  MyFanClubClub,
} from '../api/contract';
import { artistRecord, CENTRALS_MAX, isPublished, type ArtistRecord } from '../centrals/model';
import { artistRef, membershipRef, membershipsRef } from '../centrals/service';
import { writeFanContact } from '../fan-contact/store';
import { isAutomaticUsername } from '../fan-profile/model';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
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
  fanClubBoxes,
  fanClubRecord,
  fanClubRefused,
  fanClubRulesUrl,
  isFeaturedNow,
  type ApplicationInput,
  type ApplicationRecord,
  type FanClubRecord,
} from './model';
import {
  applicationPrivateRef,
  applicationRef,
  FEATURE_OFF,
  fanClubRef,
  fanClubsOfOwner,
  ownerCopiesOf,
} from './store';

// O lado do fã no fã-clube (docs/arquitetura-api.md, seção 34, 34.3 e 34.5):
// o `GET /me/fan-club` (leve, de 1 a 5 leituras), as centrais que aceitam
// fã-clube para a candidatura, candidatar e desistir, na transação do
// runIdempotent, e o passo da exclusão de conta (34.7). A ordem de uma rota
// que grava é a de sempre: as leituras do domínio, o planAwards, as gravações.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** `artistPrivate/{id}`: as caixas do fã-clube (decisão 9) moram aqui. */
const artistPrivateRef = (db: Firestore, artistId: string): DocumentReference =>
  db.collection('artistPrivate').doc(artistId);

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
 * dado dele. As publicações e as denúncias chegam na etapa 2 de 34.14. Pode
 * rodar de novo: a lápide já não tem dono e não aparece na consulta.
 */
export async function removeFanClubData(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<void> {
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
        closedAt: club.get('closedAt') ?? at,
        updatedAt: at,
      });
    });
  }
}
