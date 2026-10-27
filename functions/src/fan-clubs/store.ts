import {
  FieldPath,
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Transaction,
} from 'firebase-admin/firestore';

import { artistRecord, fanShardOf, isPublished, type ArtistRecord } from '../centrals/model';
import {
  applicationRecord,
  FAN_CLUB_FOLLOWS_MAX,
  fanClubCommentReportId,
  fanClubReactionId,
  fanClubReactionOf,
  fanClubRecord,
  isLiveFanClub,
  reservationTargetOf,
  type ApplicationRecord,
  type FanClubCountField,
  type FanClubCredit,
  type FanClubReactionKey,
  type FanClubRecord,
  type MentionTarget,
} from './model';

// Onde o fã-clube mora no Firestore (docs/arquitetura-api.md, 34.4) e os
// passos que outros módulos chamam sem passar pelo service: a pausa pela
// suspensão (a Moderação), as cópias do perfil do gestor (a tarefa
// `syncFanProfile`), a consulta do `has-content` (o `removeArtist`), desde a
// etapa 3 de 34.14, as gravações da atribuição (o marcador do crédito e os
// shards dos números, que as centrais e o convite gravam) e, desde a etapa 4,
// as leituras dos seguimentos que sair da central, o bloqueio e a suspensão
// apagam. Desde a Fase 2 (seção 37), os comentários, as reações, os dias da
// taxa de engajamento nos shards e as leituras das marcações (as reservas do
// @ e as centrais delas); desde a etapa 3 de 37.13, a denúncia de comentário,
// a fila da equipe e o registro do ocultar do gestor. Só importa o model (e o puro das centrais),
// para nenhum desses módulos puxar a API, os pontos ou a equipe por aqui.

export const fanClubsOf = (db: Firestore): CollectionReference => db.collection('fanClubs');

export const fanClubRef = (db: Firestore, clubId: string): DocumentReference =>
  fanClubsOf(db).doc(clubId);

/**
 * `fanClubs/{clubId}/prizes/{grantId}`: o registro do Recompensar, uma linha
 * por concessão (decisão 50), sem o código do pedido nem o cupom. Fica na
 * lápide e na exclusão de conta do gestor (34.7).
 */
export const fanClubPrizesOf = (db: Firestore, clubId: string): CollectionReference =>
  fanClubRef(db, clubId).collection('prizes');

export const fanClubPrizeRef = (
  db: Firestore,
  clubId: string,
  grantId: string,
): DocumentReference => fanClubPrizesOf(db, clubId).doc(grantId);

/** `fanClubApplications/{uid}`: a candidatura, uma por fã (decisão 12). */
export const applicationRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('fanClubApplications').doc(uid);

/** `fanClubApplicationPrivate/{uid}`: as redes e o texto de divulgação (decisão 14). */
export const applicationPrivateRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('fanClubApplicationPrivate').doc(uid);

/** `artistPrivate/{id}`: as caixas do fã-clube (decisão 9) moram aqui. */
export const artistPrivateRef = (db: Firestore, artistId: string): DocumentReference =>
  db.collection('artistPrivate').doc(artistId);

/**
 * `usernames/{@}`: a reserva do @, do fã (`uid`) ou da central (`artistId`),
 * o único mapa de @ para dono (seção 37, 37.7). Só lida aqui: quem grava é a
 * troca do @ e a criação da central.
 */
export const usernamesOf = (db: Firestore): CollectionReference => db.collection('usernames');

export const usernameRef = (db: Firestore, handle: string): DocumentReference =>
  usernamesOf(db).doc(handle);

/** `artists/{id}`: a central que uma marcação aponta, conferida no ar (37.7). */
const mentionedArtistRef = (db: Firestore, artistId: string): DocumentReference =>
  db.collection('artists').doc(artistId);

/**
 * Os alvos dos @ a partir das reservas já lidas (na ordem dos @), na
 * transação de quem chama (37.7): a do fã resolve na hora (qualquer conta,
 * R3); a da central pede a central no ar, lida num `getAll` só das centrais,
 * antes de qualquer gravação. O @ sem reserva e a central fora do ar ficam de
 * fora (texto). Só lê.
 */
export async function mentionTargetsOf(
  tx: Transaction,
  db: Firestore,
  handles: readonly string[],
  reservations: readonly (DocumentSnapshot | undefined)[],
): Promise<Map<string, MentionTarget>> {
  const targets = new Map<string, MentionTarget>();
  const centrals: { handle: string; id: string }[] = [];
  handles.forEach((handle, index) => {
    const snap = reservations[index];
    const target = reservationTargetOf(snap?.exists ? snap.data() : undefined);
    if (target?.kind === 'fan') targets.set(handle, target);
    else if (target) centrals.push({ handle, id: target.id });
  });
  if (centrals.length === 0) return targets;
  const snaps = await tx.getAll(...centrals.map((central) => mentionedArtistRef(db, central.id)));
  centrals.forEach((central, index) => {
    const snap = snaps[index]!;
    const artist = snap.exists ? artistRecord(snap.id, snap.data() ?? {}) : null;
    if (isPublished(artist)) targets.set(central.handle, { kind: 'artist', id: artist.id });
  });
  return targets;
}

/**
 * Os alvos dos @, lendo as reservas na transação (um `getAll` de
 * `usernames/{@}`) e, com elas, as centrais (`mentionTargetsOf`): até 10
 * leituras. Sem @, nenhuma leitura. Só lê.
 */
export async function readMentionTargets(
  tx: Transaction,
  db: Firestore,
  handles: readonly string[],
): Promise<Map<string, MentionTarget>> {
  if (handles.length === 0) return new Map();
  const reservations = await tx.getAll(...handles.map((handle) => usernameRef(db, handle)));
  return mentionTargetsOf(tx, db, handles, reservations);
}

/**
 * As centrais da busca do @ (37.7), fora de transação, num `getAll`: as que
 * existem, pelo id (quem chama confere o no ar). Sem central, nenhuma leitura.
 */
export async function readMentionedArtists(
  db: Firestore,
  artistIds: readonly string[],
): Promise<Map<string, ArtistRecord>> {
  if (artistIds.length === 0) return new Map();
  const snaps = await db.getAll(...artistIds.map((id) => mentionedArtistRef(db, id)));
  const artists = new Map<string, ArtistRecord>();
  for (const snap of snaps) {
    if (snap.exists) artists.set(snap.id, artistRecord(snap.id, snap.data() ?? {}));
  }
  return artists;
}

/**
 * `users/{uid}/fanClubFollows`: os vínculos de seguir de um fã (decisões 26 a
 * 34), um por fã-clube, com o id do fã-clube. Saem com o perfil, no
 * `recursiveDelete` da exclusão.
 */
export const fanClubFollowsOf = (db: Firestore, uid: string): CollectionReference =>
  db.collection('users').doc(uid).collection('fanClubFollows');

export const fanClubFollowRef = (db: Firestore, uid: string, clubId: string): DocumentReference =>
  fanClubFollowsOf(db, uid).doc(clubId);

/**
 * Quem segue o fã-clube agora, no grupo `fanClubFollows` (decisão 28), para o
 * `count()` da página, dos números do gestor e da cópia da noite; com o
 * `since`, só quem seguiu desde ele (os novos em 30 dias). A faixa leva o
 * `orderBy('followedAt', 'desc')` de propósito: sem ele, a consulta ordena
 * pelo `followedAt` crescente e pediria outro índice, e com ele usa o de
 * grupo `(clubId, followedAt decrescente)` que 34.6 já tem (o da lista dos
 * seguidores recentes). Todos os seguidores usam a isenção do `clubId` no
 * escopo do grupo. O emulador não cobra índice: o `fan-clubs/indexes.test.ts`
 * prende as duas formas.
 */
export function followersQuery(db: Firestore, clubId: string, since?: Timestamp): Query {
  const query = db.collectionGroup('fanClubFollows').where('clubId', '==', clubId);
  return since === undefined
    ? query
    : query.where('followedAt', '>=', since).orderBy('followedAt', 'desc');
}

/** `fanClubPosts/{postId}`: as publicações, fora de `posts/{id}` (decisão 17). */
export const fanClubPostsOf = (db: Firestore): CollectionReference => db.collection('fanClubPosts');

export const fanClubPostRef = (db: Firestore, postId: string): DocumentReference =>
  fanClubPostsOf(db).doc(postId);

/** `fanClubReports/{reporterUid}_{postId}`: a denúncia, fechada para todos (decisão 18). */
export const fanClubReportsOf = (db: Firestore): CollectionReference =>
  db.collection('fanClubReports');

/** `fanClubReportQueue/{postId}`: a fila das denúncias de uma publicação, com a rodada. */
export const fanClubReportQueueRef = (db: Firestore, postId: string): DocumentReference =>
  db.collection('fanClubReportQueue').doc(postId);

/**
 * `fanClubComments/{commentId}`: os comentários das publicações (seção 37,
 * decisão 9), na raiz e fora dos nomes do Mural (`postComments` tem regra de
 * grupo). O id é automático, novo a cada tentativa da transação.
 */
export const fanClubCommentsOf = (db: Firestore): CollectionReference =>
  db.collection('fanClubComments');

export const fanClubCommentRef = (db: Firestore, commentId: string): DocumentReference =>
  fanClubCommentsOf(db).doc(commentId);

/**
 * Os comentários de um fã que o ocultar em lote da Moderação leva (37.6): os
 * visíveis e os ocultos pelo gestor, que o autor ainda vê. Só igualdades (o
 * `in` do status), pela junção dos índices de um campo.
 */
export const fanClubCommentsToHide = (db: Firestore, uid: string): Query =>
  fanClubCommentsOf(db)
    .where('authorUid', '==', uid)
    .where('status', 'in', ['visible', 'manager_hidden']);

/**
 * `fanClubCommentReports/{reporterUid}_{commentId}`: a denúncia de comentário
 * (37.2), uma por fã e comentário por rodada, fechada para todos.
 */
export const fanClubCommentReportsOf = (db: Firestore): CollectionReference =>
  db.collection('fanClubCommentReports');

export const fanClubCommentReportRef = (
  db: Firestore,
  reporterUid: string,
  commentId: string,
): DocumentReference =>
  fanClubCommentReportsOf(db).doc(fanClubCommentReportId(reporterUid, commentId));

/**
 * `fanClubCommentQueue/{commentId}`: a fila da equipe dos comentários de
 * fã-clube (decisão 14 de 37.1), com o tipo e a rodada; a denúncia e o pedido
 * de revisão caem no mesmo item. Fora da `moderationQueue` e da
 * `fanClubReportQueue`.
 */
export const fanClubCommentQueueOf = (db: Firestore): CollectionReference =>
  db.collection('fanClubCommentQueue');

export const fanClubCommentQueueRef = (db: Firestore, commentId: string): DocumentReference =>
  fanClubCommentQueueOf(db).doc(commentId);

/**
 * `fanClubHideLog/{id}`: o registro do ocultar e do reexibir do gestor
 * (decisão 11 de 36.1), uma linha por ação, com o id automático e nunca o
 * texto. A seção Fã-clubes lê na ficha; o `staffAudit` é só da equipe.
 */
export const fanClubHideLogOf = (db: Firestore): CollectionReference =>
  db.collection('fanClubHideLog');

/**
 * `fanClubReactions/{uid}_{postId}`: a reação de um fã numa publicação (37.2),
 * na raiz, para a publicação apagada levar as dela por uma consulta. Nasce na
 * primeira reação e fica (tirar grava `reaction: null`).
 */
export const fanClubReactionsOf = (db: Firestore): CollectionReference =>
  db.collection('fanClubReactions');

export const fanClubReactionRef = (db: Firestore, uid: string, postId: string): DocumentReference =>
  fanClubReactionsOf(db).doc(fanClubReactionId(uid, postId));

/**
 * As reações de quem pede nas publicações da página (a `myReaction`), num
 * `getAll` fora de transação, como as curtidas do `postViews` do Mural (até
 * 10 leituras por página). Sem publicação, nenhuma leitura.
 */
export async function readReactionsOf(
  db: Firestore,
  uid: string,
  postIds: readonly string[],
): Promise<Map<string, FanClubReactionKey | null>> {
  if (postIds.length === 0) return new Map();
  const snaps = await db.getAll(...postIds.map((postId) => fanClubReactionRef(db, uid, postId)));
  return new Map(
    postIds.map((postId, index) => {
      const snap = snaps[index]!;
      return [postId, snap.exists ? fanClubReactionOf(snap.get('reaction')) : null];
    }),
  );
}

/**
 * `users/{uid}/uploads/fanClubPost`: a vaga de envio da foto da publicação
 * (34.6), com os dois nomes e o prazo. Só o servidor grava; a regra do Storage
 * lê. Sai com o perfil, no `recursiveDelete` da exclusão.
 */
export const fanClubUploadSlotRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('users').doc(uid).collection('uploads').doc('fanClubPost');

/**
 * `users/{uid}/fanClubCredits/{artistId}`: o marcador do crédito de entrada,
 * uma vez por conta e artista (decisão 23). Sai com o perfil, no
 * `recursiveDelete` da exclusão.
 */
export const fanClubCreditRef = (db: Firestore, uid: string, artistId: string): DocumentReference =>
  db.collection('users').doc(uid).collection('fanClubCredits').doc(artistId);

/** `fanClubStats/{clubId}/fanClubShards`: os números do fã-clube em 16 shards (decisão 24). */
export const fanClubShardsOf = (db: Firestore, clubId: string): CollectionReference =>
  db.collection('fanClubStats').doc(clubId).collection('fanClubShards');

export const fanClubShardRef = (db: Firestore, clubId: string, shard: number): DocumentReference =>
  fanClubShardsOf(db, clubId).doc(String(shard));

/**
 * Os números a somar numa transação, por fã-clube (o link do convite e o
 * crédito podem ser de fã-clubes diferentes): uma gravação por fã-clube no
 * fim, pelo `writeFanClubCounts`.
 */
export type FanClubCountsDelta = Map<string, Partial<Record<FanClubCountField, number>>>;

/** Soma 1 num número do fã-clube, no que a transação vai gravar. */
export function addFanClubCount(
  delta: FanClubCountsDelta,
  clubId: string,
  field: FanClubCountField,
): void {
  const counts = delta.get(clubId) ?? {};
  counts[field] = (counts[field] ?? 0) + 1;
  delta.set(clubId, counts);
}

/**
 * Grava os números somados num shard de cada fã-clube, sem ler: `increment`
 * com `merge` (o documento nasce com a primeira soma) e o `updatedAt`. O shard
 * é o sorteio da transação (`award.shard`, de novo a cada tentativa) reduzido
 * aos 16 (`fanShardOf`), como o `fanCount` das centrais. Sem soma, nada.
 */
export function writeFanClubCounts(
  tx: Transaction,
  db: Firestore,
  delta: FanClubCountsDelta,
  shard: number,
  at: Timestamp,
): void {
  for (const [clubId, counts] of delta) {
    const fields: DocumentData = { updatedAt: at };
    for (const [field, value] of Object.entries(counts)) {
      if (value) fields[field] = FieldValue.increment(value);
    }
    tx.set(fanClubShardRef(db, clubId, fanShardOf(shard)), fields, { merge: true });
  }
}

/** Os dias da taxa de engajamento nos shards (seção 37, 37.11): as reações novas e os comentários. */
export type FanClubDayField = 'reactions' | 'comments';

/**
 * Soma 1 no dia de São Paulo da taxa de engajamento (37.2 e 37.11), sem ler:
 * `days.{AAAA-MM-DD}.{campo}` com `increment` e `merge` no shard sorteado da
 * transação (o mesmo do `writeFanClubCounts`). O `merge` junta os mapas: os
 * dias velhos só saem pelo corte da cópia da noite.
 */
export function writeFanClubDay(
  tx: Transaction,
  db: Firestore,
  clubId: string,
  field: FanClubDayField,
  day: string,
  shard: number,
  at: Timestamp,
): void {
  tx.set(
    fanClubShardRef(db, clubId, fanShardOf(shard)),
    { days: { [day]: { [field]: FieldValue.increment(1) } }, updatedAt: at },
    { merge: true },
  );
}

/** Soma 1 num número só de um fã-clube (o link, a visita): o `writeFanClubCounts` de uma soma. */
export function writeFanClubCount(
  tx: Transaction,
  db: Firestore,
  clubId: string,
  field: FanClubCountField,
  shard: number,
  at: Timestamp,
): void {
  writeFanClubCounts(tx, db, new Map([[clubId, { [field]: 1 }]]), shard, at);
}

/** O marcador do crédito (decisão 23): quem trouxe, por onde e quando. */
export function writeFanClubCredit(
  tx: Transaction,
  db: Firestore,
  uid: string,
  credit: FanClubCredit,
  at: Timestamp,
): void {
  tx.create(fanClubCreditRef(db, uid, credit.artistId), {
    artistId: credit.artistId,
    clubId: credit.clubId,
    via: credit.via,
    at,
    schemaVersion: 1,
  });
}

/** As publicações de um autor, em qualquer status. Índice automático do `authorUid`. */
export const fanClubPostsOfAuthor = (db: Firestore, uid: string) =>
  fanClubPostsOf(db).where('authorUid', '==', uid);

/**
 * Os seguimentos do fã nos fã-clubes de um artista, na transação de quem
 * chama: sair da central deixa de seguir todos eles (decisão 27). Igualdade
 * num campo: o índice automático do `artistId`. Só leitura (quem chama apaga
 * depois de ler tudo).
 */
export async function readFollowsOfArtist(
  tx: Transaction,
  db: Firestore,
  uid: string,
  artistId: string,
): Promise<DocumentReference[]> {
  const snap = await tx.get(fanClubFollowsOf(db, uid).where('artistId', '==', artistId));
  return snap.docs.map((doc) => doc.ref);
}

/**
 * O seguimento do fã-clube de quem é bloqueado (decisão 32), na transação de
 * quem bloqueia: a candidatura do bloqueado e, com o `clubId` dela, o vínculo
 * de quem bloqueia com esse fã-clube. Uma leitura, mais uma com o `clubId`; o
 * vínculo que existe, ou null. Só leitura.
 */
export async function readFollowOfOwner(
  tx: Transaction,
  db: Firestore,
  uid: string,
  ownerUid: string,
): Promise<DocumentReference | null> {
  const application = await readApplicationOf(tx, db, ownerUid);
  if (application === null || application.clubId === null) return null;
  const follow = await tx.get(fanClubFollowRef(db, uid, application.clubId));
  return follow.exists ? follow.ref : null;
}

/**
 * Os seguimentos do fã, até os 50 que ele pode ter (decisão 34), na
 * transação de quem chama: a suspensão apaga todos (decisão 33). Sem ordem e
 * sem filtro: nenhum índice. Só leitura.
 */
export async function readFollowsOf(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<DocumentReference[]> {
  const snap = await tx.get(fanClubFollowsOf(db, uid).limit(FAN_CLUB_FOLLOWS_MAX));
  return snap.docs.map((doc) => doc.ref);
}

/** O destaque desligado: a pausa, o encerramento, a suspensão e a lápide (decisão 35). */
export const FEATURE_OFF = {
  featured: false,
  featuredAt: null,
  featuredUntil: null,
  featuredBy: null,
} as const;

/**
 * O selo de oficial desligado (34.23): o fã-clube que nasce, o encerramento e
 * a lápide. A pausa, pela equipe ou pela suspensão, mantém o selo, que volta
 * com o fã-clube reativado.
 */
export const OFFICIAL_OFF = {
  official: false,
  officialAt: null,
  officialBy: null,
} as const;

/**
 * Os fã-clubes ativos ou pausados de um artista, um basta: o `removeArtist`
 * recusa `has-content` com eles (34.14, etapa 1). Igualdade e `in`: a junção
 * dos índices de um campo atende.
 */
export const liveFanClubsOfArtist = (db: Firestore, artistId: string) =>
  fanClubsOf(db).where('artistId', '==', artistId).where('status', 'in', ['active', 'paused']);

/** A candidatura do fã lida na transação, ou null sem ela. */
async function readApplicationOf(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<ApplicationRecord | null> {
  const application = await tx.get(applicationRef(db, uid));
  return application.exists ? applicationRecord(uid, application.data() ?? {}) : null;
}

/** O fã-clube da candidatura aprovada, se ele ainda é do fã; null sem ele. */
async function readClubOfApplication(
  tx: Transaction,
  db: Firestore,
  application: ApplicationRecord | null,
): Promise<{ ref: DocumentReference; record: FanClubRecord } | null> {
  if (application?.status !== 'approved' || application.clubId === null) return null;
  const club = await tx.get(fanClubRef(db, application.clubId));
  if (!club.exists) return null;
  const record = fanClubRecord(club.id, club.data() ?? {});
  return record.ownerUid === application.uid ? { ref: club.ref, record } : null;
}

/**
 * O fã-clube da candidatura aprovada do fã, na transação de quem chama: a
 * candidatura e, com o `clubId`, o fã-clube, se ele ainda é do fã. Só
 * leituras (quem chama grava depois de ler tudo).
 */
export async function readOwnClubOf(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<{ ref: DocumentReference; record: FanClubRecord } | null> {
  return readClubOfApplication(tx, db, await readApplicationOf(tx, db, uid));
}

/**
 * O fã-clube ativo do fã, para a suspensão pausar (decisão 33). Null sem
 * fã-clube ativo dele.
 */
export async function readActiveClubOf(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<{ ref: DocumentReference; clubId: string } | null> {
  const own = await readOwnClubOf(tx, db, uid);
  if (own === null || own.record.status !== 'active') return null;
  return { ref: own.ref, clubId: own.record.id };
}

/**
 * O WhatsApp é exigido agora (decisão 14): com a candidatura pendente (ele é
 * obrigatório nela, e a aprovação não o confere) ou com o fã-clube ativo ou
 * pausado (é o canal dos prêmios). O `PUT /me/contact` recusa apagar com
 * `contact_required`. Uma leitura com a pendente, até duas com a aprovada; a
 * transação que aprova grava a candidatura lida aqui, e uma das duas repete.
 */
export async function contactRequired(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<boolean> {
  const application = await readApplicationOf(tx, db, uid);
  if (application?.status === 'pending') return true;
  const own = await readClubOfApplication(tx, db, application);
  return own !== null && isLiveFanClub(own.record.status);
}

/** A pausa pela suspensão do gestor (decisão 33): `paused`, o motivo, a data e o destaque fora. */
export function pauseForSuspension(tx: Transaction, ref: DocumentReference, at: Timestamp): void {
  tx.update(ref, {
    status: 'paused',
    statusReason: 'suspended',
    pausedAt: at,
    ...FEATURE_OFF,
    updatedAt: at,
  });
}

/** As cópias do perfil que o fã-clube e a candidatura guardam (o nome, o @ e a foto). */
export type OwnerCopies = { name: string | null; username: string | null; photoURL: string | null };

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

export function ownerCopiesOf(profile: DocumentData): OwnerCopies {
  return {
    name: textOrNull(profile.displayName),
    username: textOrNull(profile.username),
    photoURL: textOrNull(profile.photoURL),
  };
}

/** Os fã-clubes de um gestor, em qualquer status (a lápide já não tem dono). Índice automático. */
export const fanClubsOfOwner = (db: Firestore, uid: string) =>
  fanClubsOf(db).where('ownerUid', '==', uid);

/** Publicações por página (e por transação) nas cópias do autor (34.5). */
export const POST_COPIES_PAGE = 100;

/**
 * As cópias do perfil na candidatura, nos fã-clubes e nas publicações do fã
 * (34.5, a tarefa `syncFanProfile`): primeiro uma transação que lê o perfil,
 * a candidatura e os fã-clubes dele (o de agora e os encerrados, que o painel
 * ainda lista) e regrava o `fan*` da candidatura e o `owner*` de cada
 * fã-clube só quando diferem; depois o `author*` das publicações dele, em
 * páginas de 100, cada uma numa transação que relê o perfil. Sem o perfil (a
 * exclusão da conta no meio), não grava. Devolve quantos documentos regravou.
 */
export async function syncFanClubCopies(db: Firestore, uid: string): Promise<number> {
  const written = await syncOwnerCopies(db, uid);
  return written === null ? 0 : written + (await syncPostCopies(db, uid));
}

/** O `author*` das publicações do fã, em páginas pela ordem do id; o perfil apagado no meio para. */
async function syncPostCopies(db: Firestore, uid: string): Promise<number> {
  const query = fanClubPostsOfAuthor(db, uid)
    .orderBy(FieldPath.documentId())
    .limit(POST_COPIES_PAGE);
  let written = 0;
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const cursor: QueryDocumentSnapshot | null = last;
    const page = await db.runTransaction(async (tx) => {
      const profile = await tx.get(db.collection('users').doc(uid));
      if (!profile.exists) return null;
      const snap: QuerySnapshot = await tx.get(cursor ? query.startAfter(cursor) : query);
      const copies = ownerCopiesOf(profile.data() ?? {});
      let count = 0;
      for (const post of snap.docs) {
        const data = post.data();
        if (
          (data.authorName ?? null) === copies.name &&
          (data.authorUsername ?? null) === copies.username &&
          (data.authorPhotoURL ?? null) === copies.photoURL
        ) {
          continue;
        }
        tx.update(post.ref, {
          authorName: copies.name,
          authorUsername: copies.username,
          authorPhotoURL: copies.photoURL,
        });
        count += 1;
      }
      return { size: snap.size, last: snap.docs[snap.docs.length - 1] ?? null, count };
    });
    if (page === null) return written;
    written += page.count;
    last = page.last;
    if (page.size < POST_COPIES_PAGE) return written;
  }
}

/** A candidatura e os fã-clubes do fã, numa transação; null sem o perfil. */
async function syncOwnerCopies(db: Firestore, uid: string): Promise<number | null> {
  return db.runTransaction(async (tx) => {
    const [profile, application] = await tx.getAll(
      db.collection('users').doc(uid),
      applicationRef(db, uid),
    );
    if (!profile!.exists) return null;
    const clubs = await tx.get(fanClubsOfOwner(db, uid));
    const copies = ownerCopiesOf(profile!.data() ?? {});
    let written = 0;
    const app = application!.exists ? (application!.data() ?? {}) : null;
    if (
      app !== null &&
      ((app.fanName ?? null) !== copies.name ||
        (app.fanUsername ?? null) !== copies.username ||
        (app.fanPhotoURL ?? null) !== copies.photoURL)
    ) {
      tx.update(application!.ref, {
        fanName: copies.name,
        fanUsername: copies.username,
        fanPhotoURL: copies.photoURL,
      });
      written += 1;
    }
    for (const club of clubs.docs) {
      const data = club.data();
      if (
        (data.ownerName ?? null) === copies.name &&
        (data.ownerUsername ?? null) === copies.username &&
        (data.ownerPhotoURL ?? null) === copies.photoURL
      ) {
        continue;
      }
      tx.update(club.ref, {
        ownerName: copies.name,
        ownerUsername: copies.username,
        ownerPhotoURL: copies.photoURL,
      });
      written += 1;
    }
    return written;
  });
}
