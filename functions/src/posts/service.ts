import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { postEventView } from '../agenda/model';
import { eventOf, eventRef } from '../agenda/store';
import type { AddCommentResult, Page, Post, PostComment } from '../api/contract';
import {
  CentralError,
  CENTRALS_MAX,
  exactMillis,
  isPublished,
  safeCount,
  type ArtistRecord,
} from '../centrals/model';
import { artistRef, membershipsRef } from '../centrals/service';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import { blockedOf, reasonKey, reasonsOf, withoutBlocked } from '../moderation/model';
import { blockListRef, blockListsRef, queueItemRef, reportsRef } from '../moderation/store';
import { encodePageCursor, type PageCursor } from '../page-cursor';
import {
  addEngagementCounts,
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
} from '../points/award';
import { type Actor, type PointsConfig } from '../points/model';
import {
  chunk,
  COMMENT_FALLBACK_NAME,
  COMMENT_PAGE_ROUNDS,
  commentRecord,
  commentView,
  FEED_IN_BLOCK,
  mergePostBlocks,
  OWN_COMMENTS_READ,
  POST_SHARD_COUNT,
  postShardOf,
  postView,
  PostError,
  shouldCopyCounts,
  sumShards,
  type CommentRecord,
  type LikeState,
  type PostRecord,
} from './model';
import {
  artistOf,
  commentRef,
  commentsRef,
  countShardRef,
  countShardsRef,
  postLikeRef,
  postLikesRef,
  postOf,
  postRef,
  postsRef,
  readVisiblePost,
} from './store';

// O mural no Firestore (bloco 6): as leituras das rotas, curtir e comentar
// (com os pontos pelo núcleo, os shards das contagens e os tetos do dia), a
// cópia das contagens para o post e a parte do mural na exclusão de conta. A
// ordem de uma rota que grava é a de sempre: chave e fã (runIdempotent),
// leituras do domínio, planAwards, gravações do domínio.
// docs/arquitetura-api.md, seção 21.

/** Código gRPC de índice que falta (FAILED_PRECONDITION). */
const FAILED_PRECONDITION = 9;

/** Documentos por página na exclusão de conta (21.12): abaixo de 500 gravações por transação. */
export const ENGAGEMENT_DELETE_PAGE = 100;

type Log = Pick<typeof logger, 'error'>;

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

/**
 * O instante em que a curtida ou o comentário entrou no shard (`countedAt`, o
 * commit), para comparar com o `countsAt` (21.6). Documento sem ele (gravado
 * à mão): o "agora" do pedido.
 */
function countedAtOf(snap: DocumentSnapshot, fallback: string): number | null {
  return exactMillis(snap.get('countedAt')) ?? exactMillis(snap.get(fallback));
}

function likeStateOf(snap: DocumentSnapshot | undefined): LikeState | null {
  if (!snap?.exists) return null;
  return { liked: snap.get('liked') === true, countedAt: countedAtOf(snap, 'updatedAt') };
}

/** +1 ou -1 num shard das contagens do post, sem ler: increment com merge. */
function bumpPostShard(
  tx: Transaction,
  db: Firestore,
  postId: string,
  shard: number,
  field: 'likes' | 'comments',
  delta: number,
  at: Timestamp,
): void {
  tx.set(
    countShardRef(db, postId, shard),
    { [field]: FieldValue.increment(delta), updatedAt: at },
    { merge: true },
  );
}

// --- Leituras das rotas (GET) ----------------------------------------------------

/** O que a montagem do `Post` precisa além do post e da central. */
type ViewContext = { now: number; sharePointsPerVisit: number };

/**
 * As curtidas do fã e os shows dos posts de show, num getAll, e o `Post` de
 * cada um, na ordem da lista.
 */
async function postViews(
  db: Firestore,
  uid: string,
  items: readonly { post: PostRecord; artist: ArtistRecord }[],
  ctx: ViewContext,
): Promise<Post[]> {
  if (items.length === 0) return [];
  const eventIds = [
    ...new Set(
      items
        .filter(({ post }) => post.kind === 'event' && post.eventId)
        .map(({ post }) => post.eventId!),
    ),
  ];
  const snaps = await db.getAll(
    ...items.map(({ post }) => postLikeRef(db, uid, post.id)),
    ...eventIds.map((id) => eventRef(db, id)),
  );
  const events = new Map(eventIds.map((id, index) => [id, eventOf(snaps[items.length + index])]));
  return items.map(({ post, artist }, index) =>
    postView(post, artist, {
      like: likeStateOf(snaps[index]),
      event: post.eventId ? postEventView(events.get(post.eventId) ?? null, ctx.now) : null,
      sharePointsPerVisit: ctx.sharePointsPerVisit,
    }),
  );
}

/** Os posts no ar, do mais novo ao mais antigo, com o cursor `[publishedAt, id]`. */
function publishedPosts(query: Query, cursor: PageCursor | null, limit: number): Query {
  let ordered = query
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');
  if (cursor) ordered = ordered.startAfter(tsOf(cursor.at), cursor.id);
  return ordered.limit(limit + 1);
}

function postCursor(post: PostRecord): string {
  return encodePageCursor({ at: post.publishedAt ?? 0, id: post.id });
}

/**
 * O mural (`GET /feed`): os posts no ar das centrais no ar que o fã segue
 * (21.1, decisão 5). Em blocos de 30 centrais (o teto do `in`), em paralelo,
 * cada um com os `limit + 1` primeiros, juntados na mesma ordem. Fã sem
 * central: a lista vazia.
 */
export async function readFeed(
  db: Firestore,
  uid: string,
  options: { limit: number; cursor: PageCursor | null } & ViewContext,
): Promise<Page<Post>> {
  const memberships = await membershipsRef(db, uid).limit(CENTRALS_MAX).get();
  if (memberships.empty) return { items: [], nextCursor: null };
  const artistSnaps = await db.getAll(...memberships.docs.map((doc) => artistRef(db, doc.id)));
  const artists = new Map<string, ArtistRecord>();
  for (const snap of artistSnaps) {
    const artist = artistOf(snap);
    if (isPublished(artist)) artists.set(artist.id, artist);
  }
  if (artists.size === 0) return { items: [], nextCursor: null };

  const blocks = await Promise.all(
    chunk([...artists.keys()], FEED_IN_BLOCK).map(async (ids) => {
      const snap = await publishedPosts(
        postsRef(db).where('artistId', 'in', ids),
        options.cursor,
        options.limit,
      ).get();
      return snap.docs.map((doc) => postOf(doc)!);
    }),
  );
  const { items, hasMore } = mergePostBlocks(blocks, options.limit);
  const visible = items.flatMap((post) => {
    const artist = artists.get(post.artistId);
    return artist ? [{ post, artist }] : [];
  });
  return {
    items: await postViews(db, uid, visible, options),
    nextCursor: hasMore && items.length > 0 ? postCursor(items.at(-1)!) : null,
  };
}

/**
 * Os posts de uma central (`GET /artists/:artistId/posts`, a grade da 1d).
 * Central que não existe ou fora do ar: 404. Não exige ser membro.
 */
export async function readArtistPosts(
  db: Firestore,
  uid: string,
  artistId: string,
  options: { limit: number; cursor: PageCursor | null } & ViewContext,
): Promise<Page<Post>> {
  const artist = artistOf(await artistRef(db, artistId).get());
  if (!isPublished(artist)) throw new CentralError('artist_not_found', { artistId });
  const snap = await publishedPosts(
    postsRef(db).where('artistId', '==', artistId),
    options.cursor,
    options.limit,
  ).get();
  const posts = snap.docs.slice(0, options.limit).map((doc) => postOf(doc)!);
  return {
    items: await postViews(
      db,
      uid,
      posts.map((post) => ({ post, artist })),
      options,
    ),
    nextCursor:
      snap.docs.length > options.limit && posts.length > 0 ? postCursor(posts.at(-1)!) : null,
  };
}

/** O post e a central dele, fora de transação; null quando o post não é visível. */
async function readVisiblePostDirect(
  db: Firestore,
  postId: string,
): Promise<{ post: PostRecord; artist: ArtistRecord } | null> {
  const post = postOf(await postRef(db, postId).get());
  if (!post || !post.artistId) return null;
  const artist = artistOf(await artistRef(db, post.artistId).get());
  return isPublished(artist) && post.status === 'published' && post.publishedAt !== null
    ? { post, artist }
    : null;
}

/**
 * O detalhe do post (`GET /posts/:postId`): o post, a central, a curtida do
 * fã, o show (post de show) e, para o `commentCount`, os comentários do
 * próprio fã mais novos que a cópia (21.6). Post invisível: 404.
 */
export async function readPostDetails(
  db: Firestore,
  uid: string,
  postId: string,
  ctx: ViewContext,
): Promise<Post> {
  const visible = await readVisiblePostDirect(db, postId);
  if (!visible) throw new PostError('post_not_found');
  const { post, artist } = visible;
  const [snaps, own] = await Promise.all([
    db.getAll(
      postLikeRef(db, uid, postId),
      ...(post.kind === 'event' && post.eventId ? [eventRef(db, post.eventId)] : []),
    ),
    commentsRef(db, postId)
      .where('authorUid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(OWN_COMMENTS_READ)
      .get(),
  ]);
  const ownCommentTimes = own.docs
    .filter((doc) => commentRecord(doc.id, doc.data()).status === 'visible')
    .map((doc) => countedAtOf(doc, 'createdAt') ?? 0);
  return postView(post, artist, {
    like: likeStateOf(snaps[0]),
    event: snaps[1] ? postEventView(eventOf(snaps[1]), ctx.now) : null,
    sharePointsPerVisit: ctx.sharePointsPerVisit,
    ownCommentTimes,
  });
}

/**
 * Os comentários visíveis de um post (`GET /posts/:postId/comments`), do mais
 * novo ao mais antigo, sem os de autores que o fã bloqueou. Faltando para
 * encher a página, busca de novo a partir do último lido, até 5 rodadas: a
 * página pode sair menor (até vazia) com `nextCursor`, e o app pede a
 * seguinte sozinho nesse caso (21.2).
 */
export async function readComments(
  db: Firestore,
  uid: string,
  postId: string,
  options: { limit: number; cursor: PageCursor | null },
): Promise<Page<PostComment>> {
  const [visible, blockList] = await Promise.all([
    readVisiblePostDirect(db, postId),
    blockListRef(db, uid).get(),
  ]);
  if (!visible) throw new PostError('post_not_found');
  const blocked = new Set(blockedOf(blockList.get('blocked')));

  const items: CommentRecord[] = [];
  let cursor = options.cursor;
  let lastRead: CommentRecord | null = null;
  let hasMore = false;
  for (let round = 0; round < COMMENT_PAGE_ROUNDS; round += 1) {
    const need = options.limit - items.length;
    let query = commentsRef(db, postId)
      .where('status', '==', 'visible')
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (cursor) query = query.startAfter(tsOf(cursor.at), cursor.id);
    const snap = await query.limit(need + 1).get();
    const read = snap.docs.slice(0, need).map((doc) => commentRecord(doc.id, doc.data()));
    if (read.length > 0) lastRead = read.at(-1)!;
    items.push(...withoutBlocked(read, blocked));
    hasMore = snap.docs.length > need;
    if (!hasMore || items.length >= options.limit || !lastRead) break;
    cursor = { at: lastRead.createdAt, id: lastRead.id };
  }
  return {
    items: items.map(commentView),
    nextCursor:
      hasMore && lastRead ? encodePageCursor({ at: lastRead.createdAt, id: lastRead.id }) : null,
  };
}

/**
 * O "N posts" da 1d: o `count()` dos posts no ar da central (21.1, decisão 7).
 * Sem o índice (só em produção: o emulador não exige), a contagem falha com o
 * código 9: vale 0, com o erro no log, como a soma do "PTS DA CENTRAL".
 */
export async function countArtistPosts(
  db: Firestore,
  artistId: string,
  log: Log = logger,
): Promise<number> {
  try {
    const snap = await postsRef(db)
      .where('artistId', '==', artistId)
      .where('status', '==', 'published')
      .count()
      .get();
    return safeCount(snap.data().count);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== FAILED_PRECONDITION) throw error;
    log.error('posts: contagem de posts da central sem índice', {
      artistId,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

// --- Curtir e descurtir ----------------------------------------------------------

export type LikeOutcome = { plan: AwardPlan };

/**
 * Curtir (`PUT /posts/:postId/like`): post invisível é 404; já curtido, nada
 * além da atividade; o teto do dia (300 trocas para curtido); `like:<postId>`
 * pelo núcleo, que paga no máximo uma vez na vida; a curtida nasce (ou volta a
 * `liked: true`, com o `firstLikedAt` da primeira), +1 num shard do post, o
 * fluxo `likes` e o contador do teto.
 */
export async function likePost(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; postId: string },
): Promise<LikeOutcome> {
  const { fan, award, postId } = options;
  const likeDoc = postLikeRef(db, fan.uid, postId);
  const { visible, extra } = await readVisiblePost(tx, db, postId, [likeDoc]);
  if (!visible) throw new PostError('post_not_found');
  const like = extra[0]!;
  if (like.exists && like.get('liked') === true) {
    return { plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award) };
  }
  enforceDailyCap(fan, award, 'like');
  const { artistId } = visible.post;
  const plan = await planAwards(
    tx,
    db,
    [
      {
        uid: fan.uid,
        fan,
        entries: [
          {
            kind: 'earn',
            source: 'like',
            eventId: postId,
            artistId,
            subject: { type: 'post', id: postId },
          },
        ],
      },
    ],
    award,
  );
  const at = tsOf(award.now);
  const countedAt = FieldValue.serverTimestamp();
  if (like.exists) {
    tx.update(likeDoc, { liked: true, updatedAt: at, countedAt });
  } else {
    tx.create(likeDoc, {
      uid: fan.uid,
      postId,
      artistId,
      liked: true,
      firstLikedAt: at,
      updatedAt: at,
      countedAt,
      schemaVersion: 1,
    });
  }
  bumpPostShard(tx, db, postId, postShardOf(award.shard), 'likes', 1, at);
  addEngagementCounts(plan, [{ kind: 'likes', artistIds: [artistId] }]);
  countDailyAction(plan, fan, award, 'like');
  return { plan };
}

/**
 * Descurtir (`DELETE /posts/:postId/like`): vale em qualquer status do post
 * (não lê o post). Com a curtida ativa, ela fica com `liked: false`, -1 num
 * shard e o fluxo `unlikes` na central da própria curtida. Não mexe em ponto.
 */
export async function unlikePost(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; postId: string },
): Promise<LikeOutcome> {
  const { fan, award, postId } = options;
  const likeDoc = postLikeRef(db, fan.uid, postId);
  const like = await tx.get(likeDoc);
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  if (!like.exists || like.get('liked') !== true) return { plan };
  const at = tsOf(award.now);
  tx.update(likeDoc, { liked: false, updatedAt: at, countedAt: FieldValue.serverTimestamp() });
  bumpPostShard(tx, db, postId, postShardOf(award.shard), 'likes', -1, at);
  const artistId = like.get('artistId');
  addEngagementCounts(plan, [
    { kind: 'unlikes', artistIds: typeof artistId === 'string' ? [artistId] : [] },
  ]);
  return { plan };
}

// --- Comentar ----------------------------------------------------------------------

export type CommentOutcome = { plan: AwardPlan; comment: AddCommentResult | null };

/**
 * Comentar (`POST /posts/:postId/comments`), com o texto já limpo pela rota:
 * post invisível é 404; o teto do dia (100 comentários); `comment:<id>` pelo
 * núcleo, dentro do limite diário de `comment`; o comentário nasce com o nome
 * e a foto do perfil lido na transação (nunca do corpo), +1 num shard, o
 * fluxo `comments` e o contador do teto. O seed passa um id fixo, lido junto
 * com o post: se ele já existe, sai sem efeito (`comment: null`).
 */
export async function commentOnPost(
  tx: Transaction,
  db: Firestore,
  options: {
    fan: FanContext;
    award: AwardContext;
    postId: string;
    text: string;
    commentId?: string;
  },
): Promise<CommentOutcome> {
  const { fan, award, postId, text } = options;
  const fixed = options.commentId ? commentRef(db, postId, options.commentId) : null;
  const { visible, extra } = await readVisiblePost(tx, db, postId, fixed ? [fixed] : []);
  if (!visible) throw new PostError('post_not_found');
  if (fixed && extra[0]?.exists) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      comment: null,
    };
  }
  enforceDailyCap(fan, award, 'comment');
  const ref = fixed ?? commentsRef(db, postId).doc();
  const { artistId } = visible.post;
  const plan = await planAwards(
    tx,
    db,
    [
      {
        uid: fan.uid,
        fan,
        entries: [
          {
            kind: 'earn',
            source: 'comment',
            eventId: ref.id,
            artistId,
            subject: { type: 'comment', id: ref.id },
          },
        ],
      },
    ],
    award,
  );
  const at = tsOf(award.now);
  const record: CommentRecord = {
    id: ref.id,
    postId,
    artistId,
    authorUid: fan.uid,
    authorName: fan.displayName || COMMENT_FALLBACK_NAME,
    authorPhotoURL: fan.photoURL || null,
    text,
    status: 'visible',
    createdAt: award.now,
  };
  tx.create(ref, {
    postId,
    artistId,
    authorUid: record.authorUid,
    authorName: record.authorName,
    authorPhotoURL: record.authorPhotoURL,
    text,
    status: 'visible',
    createdAt: at,
    countedAt: FieldValue.serverTimestamp(),
    hiddenAt: null,
    hiddenBy: null,
    schemaVersion: 1,
  });
  bumpPostShard(tx, db, postId, postShardOf(award.shard), 'comments', 1, at);
  addEngagementCounts(plan, [{ kind: 'comments', artistIds: [artistId] }]);
  countDailyAction(plan, fan, award, 'comment');
  return { plan, comment: { ...commentView(record), pointsAwarded: plan.pointsAwarded } };
}

// --- Fora da API: o seed dos emuladores -------------------------------------------

type RunOptions = { now: number; config: PointsConfig; actor: Actor; random?: () => number };

/** Curtir fora da API (seed). */
export function runLikePost(
  db: Firestore,
  uid: string,
  postId: string,
  options: RunOptions,
): Promise<LikeOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) => likePost(tx, db, { fan, award, postId }));
}

/** Comentar fora da API (seed), com o id fixo: rodar de novo não duplica. */
export function runComment(
  db: Firestore,
  uid: string,
  input: { postId: string; text: string; commentId: string },
  options: RunOptions,
): Promise<CommentOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    commentOnPost(tx, db, { fan, award, ...input }),
  );
}

// --- As contagens: a cópia da soma dos shards ----------------------------------------

export type PostCountsSync = {
  status: 'copied' | 'stale' | 'missing';
  likeCount: number;
  commentCount: number;
};

/**
 * Soma curtidas e comentários dos shards fora de transação (para não travar
 * as ações que gravam neles) e, numa transação que lê posts/{postId}, copia
 * `likeCount`, `commentCount` e `countsAt` (o instante da leitura) quando a
 * leitura é mais nova que a última cópia. Post apagado: não grava nada. Não
 * mexe no `updatedAt` (as edições da equipe). Repetir é seguro.
 */
export async function syncPostCounts(
  db: Firestore,
  postId: string,
  log: Log = logger,
): Promise<PostCountsSync> {
  const shards = await countShardsRef(db, postId).get();
  let likeCount = sumShards(shards.docs.map((doc) => doc.get('likes')));
  let commentCount = sumShards(shards.docs.map((doc) => doc.get('comments')));
  if (likeCount < 0 || commentCount < 0) {
    log.error('posts: soma dos shards das contagens negativa', { postId, likeCount, commentCount });
    likeCount = Math.max(0, likeCount);
    commentCount = Math.max(0, commentCount);
  }
  const readTime = shards.readTime;
  return db.runTransaction(async (tx): Promise<PostCountsSync> => {
    const post = await tx.get(postRef(db, postId));
    if (!post.exists) return { status: 'missing', likeCount, commentCount };
    if (!shouldCopyCounts(exactMillis(post.get('countsAt')), exactMillis(readTime)!)) {
      return { status: 'stale', likeCount, commentCount };
    }
    tx.update(post.ref, { likeCount, commentCount, countsAt: readTime });
    return { status: 'copied', likeCount, commentCount };
  });
}

// --- Exclusão de conta -----------------------------------------------------------------

/** Os -1 de uma página, somados por post: uma gravação de shard por post e transação. */
type ShardDeltas = Map<string, { likes: number; comments: number }>;

function addDelta(deltas: ShardDeltas, postId: string, field: 'likes' | 'comments'): void {
  const delta = deltas.get(postId) ?? { likes: 0, comments: 0 };
  delta[field] -= 1;
  deltas.set(postId, delta);
}

function writeDeltas(
  tx: Transaction,
  db: Firestore,
  deltas: ShardDeltas,
  random: () => number,
  at: Timestamp,
): void {
  for (const [postId, delta] of deltas) {
    const fields: Record<string, unknown> = { updatedAt: at };
    if (delta.likes !== 0) fields.likes = FieldValue.increment(delta.likes);
    if (delta.comments !== 0) fields.comments = FieldValue.increment(delta.comments);
    const shard = Math.min(POST_SHARD_COUNT - 1, Math.floor(random() * POST_SHARD_COUNT));
    tx.set(countShardRef(db, postId, shard), fields, { merge: true });
  }
}

/**
 * Roda `page` até a consulta voltar vazia (o que sai não volta na seguinte,
 * como no deleteIdempotencyKeys). Devolve quantos documentos saíram.
 */
async function drain(
  query: Query,
  page: (refs: DocumentReference[]) => Promise<number>,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(ENGAGEMENT_DELETE_PAGE).get();
    if (snap.empty) return removed;
    const count = await page(snap.docs.map((doc) => doc.ref));
    removed += count;
    // Nada saiu (outra entrega da exclusão levou tudo no meio): a seguinte vê vazio.
    if (count === 0 && snap.size < ENGAGEMENT_DELETE_PAGE) return removed;
  }
}

/**
 * Exclusão de conta (21.12), depois de o perfil sair (deleteUserData), nesta
 * ordem e em páginas de 100, cada uma numa transação que relê cada documento
 * (o que já saiu não desconta de novo):
 * 1. curtidas: apaga, e a ativa tira 1 da contagem do post;
 * 2. comentários (o grupo `postComments` por `authorUid`): apaga, o visível
 *    tira 1, e o item da fila dele perde o texto e, aberto, vai a `resolved`
 *    com `author_deleted` (as denúncias contra ele ficam: são de quem
 *    denunciou);
 * 3. denúncias que ele fez: apaga e desconta do item da fila (nunca abaixo de
 *    0); o item aberto que fica sem denúncia vai a `resolved` com `withdrawn`;
 * 4. bloqueios: a lista dele e o uid dele nas listas dos outros.
 * As presenças, sem contador, saem no recursiveDelete do perfil. Os agregados
 * do painel não descontam (seção 12).
 */
export async function removeFanEngagement(
  db: Firestore,
  uid: string,
  options: { random?: () => number; now?: () => number } = {},
): Promise<{ likes: number; comments: number; reports: number; blocks: number }> {
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  const likes = await drain(postLikesRef(db, uid).orderBy(FieldPath.documentId()), (refs) =>
    db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...refs);
      const deltas: ShardDeltas = new Map();
      let count = 0;
      for (const snap of snaps) {
        if (!snap.exists) continue;
        tx.delete(snap.ref);
        if (snap.get('liked') === true) addDelta(deltas, snap.id, 'likes');
        count += 1;
      }
      writeDeltas(tx, db, deltas, random, tsOf(now()));
      return count;
    }),
  );

  const comments = await drain(
    db.collectionGroup('postComments').where('authorUid', '==', uid),
    (refs) =>
      db.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...refs, ...refs.map((ref) => queueItemRef(db, ref.id)));
        const at = tsOf(now());
        const deltas: ShardDeltas = new Map();
        let count = 0;
        refs.forEach((ref, index) => {
          const snap = snaps[index]!;
          if (!snap.exists) return;
          tx.delete(ref);
          const postId = snap.get('postId');
          if (snap.get('status') === 'visible' && typeof postId === 'string') {
            addDelta(deltas, postId, 'comments');
          }
          const item = snaps[refs.length + index]!;
          if (item.exists) {
            tx.update(item.ref, {
              commentText: null,
              ...(item.get('status') === 'open'
                ? {
                    status: 'resolved',
                    resolution: 'author_deleted',
                    resolvedAt: at,
                    resolvedBy: null,
                  }
                : {}),
            });
          }
          count += 1;
        });
        writeDeltas(tx, db, deltas, random, at);
        return count;
      }),
  );

  const reports = await drain(reportsRef(db).where('reporterUid', '==', uid), (refs) =>
    db.runTransaction(async (tx) => {
      const reportSnaps = await tx.getAll(...refs);
      const itemIds = [
        ...new Set(
          reportSnaps
            .filter((snap) => snap.exists)
            .map((snap) => snap.get('commentId'))
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const itemSnaps =
        itemIds.length > 0 ? await tx.getAll(...itemIds.map((id) => queueItemRef(db, id))) : [];
      const items = new Map(itemIds.map((id, index) => [id, itemSnaps[index]!]));
      const updates = new Map<
        string,
        { reportCount: number; reasons: ReturnType<typeof reasonsOf>; status: unknown }
      >();
      let count = 0;
      for (const snap of reportSnaps) {
        if (!snap.exists) continue;
        tx.delete(snap.ref);
        count += 1;
        const commentId = snap.get('commentId');
        const item = typeof commentId === 'string' ? items.get(commentId) : undefined;
        if (!item?.exists) continue;
        const current = updates.get(item.id) ?? {
          reportCount: safeCount(item.get('reportCount')),
          reasons: reasonsOf(item.get('reasons')),
          status: item.get('status'),
        };
        const reason = snap.get('reason');
        const key = reasonKey(
          reason === 'spam' ||
            reason === 'offensive' ||
            reason === 'harassment' ||
            reason === 'other'
            ? reason
            : null,
        );
        current.reportCount = Math.max(0, current.reportCount - 1);
        current.reasons[key] = Math.max(0, current.reasons[key] - 1);
        updates.set(item.id, current);
      }
      const at = tsOf(now());
      for (const [id, update] of updates) {
        const withdrawn = update.status === 'open' && update.reportCount === 0;
        tx.update(queueItemRef(db, id), {
          reportCount: update.reportCount,
          reasons: update.reasons,
          ...(withdrawn
            ? { status: 'resolved', resolution: 'withdrawn', resolvedAt: at, resolvedBy: null }
            : {}),
        });
      }
      return count;
    }),
  );

  await blockListRef(db, uid).delete();
  let blocks = 0;
  for (;;) {
    const snap = await blockListsRef(db)
      .where('blocked', 'array-contains', uid)
      .limit(ENGAGEMENT_DELETE_PAGE)
      .get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.update(doc.ref, { blocked: FieldValue.arrayRemove(uid) });
    }
    await batch.commit();
    blocks += snap.size;
    if (snap.size < ENGAGEMENT_DELETE_PAGE) break;
  }

  return { likes, comments, reports, blocks };
}
