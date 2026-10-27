import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QuerySnapshot,
  type Transaction,
} from 'firebase-admin/firestore';

import type { FanClubComment, FanClubCommentPage } from '../api/contract';
import { dayKey } from '../day';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import { withoutBlocked } from '../moderation/model';
import { encodePageCursor, type PageCursor } from '../page-cursor';
import {
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import { COMMENT_PAGE_ROUNDS, PostError } from '../posts/model';
import { readCommentScene, writeCommentRemoval, type RemovedCommentTarget } from './comment-queue';
import {
  commentQueueRecord,
  commentReview,
  FAN_CLUB_OWN_HIDDEN_MAX,
  fanClubCommentNotFound,
  fanClubCommentRecord,
  findMentionTokens,
  isBlockedWithMentions,
  mentionHandles,
  newCommentCounts,
  replyTarget,
  resolvedMentions,
  type CommentInput,
  type FanClubCommentRecord,
  type FanClubCommentStatus,
  type FanClubRecord,
} from './model';
import { readActionPost, readVisiblePost } from './posts';
import {
  fanClubCommentQueueRef,
  fanClubCommentRef,
  fanClubCommentsOf,
  fanClubPostRef,
  mentionTargetsOf,
  ownerCopiesOf,
  usernameRef,
  writeFanClubDay,
} from './store';

// Os comentários das publicações do fã-clube (docs/arquitetura-api.md, seção
// 37, 37.2 e 37.3; a etapa 1 de 37.13): a lista dos comentários de cima e as
// respostas de um nível, e comentar, com os contadores por `increment` na
// própria publicação (decisão 10 de 37.1) e o dia da taxa de engajamento num
// shard do fã-clube (37.11). Fora dos nomes do Mural: a coleção é a
// `fanClubComments`, na raiz (decisão 9), e o comentário nunca vai ao
// `postStats` nem às missões. As marcações (a etapa 2, 37.7) são resolvidas
// no envio, dentro da transação, e o filtro confere o texto com o "@" tirado
// dos resolvidos. Desde a etapa 3 (37.6), a lista mostra ao gestor, no
// próprio fã-clube, também os que ele ocultou, e ao autor, na primeira página,
// os dele ocultos pelo gestor (o `ownHidden`); o ocultar, a denúncia e o
// pedido de revisão moram no `comment-queue.ts`. Desde a etapa 4 (37.8), o
// passo dos comentários na exclusão de conta, com as respostas embaixo dos
// dele saindo antes e os contadores pelas gravações do `comment-queue.ts`.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

const iso = (ms: number): string => new Date(ms).toISOString();

/** O que cada um vê na lista: todos, só o visível; o gestor no próprio fã-clube, também o que ele ocultou. */
const VISIBLE_ONLY: readonly FanClubCommentStatus[] = ['visible'];
const MANAGER_SHOWN: readonly FanClubCommentStatus[] = ['visible', 'manager_hidden'];

/**
 * O comentário como o app recebe (37.3), para quem pede (`viewerUid`). O
 * `isManager` é calculado na leitura, pelo `ownerUid` de agora (decisão 19 de
 * 37.1). O `hidden: 'manager'` sai só para o autor e para o gestor; o
 * `review`, só para o autor do oculto pelo gestor; e o `hiddenReplyCount` (as
 * respostas no `manager_hidden`), só para o gestor no próprio fã-clube, no
 * comentário de cima. O oculto pela equipe não sai em rota nenhuma (decisão
 * 22).
 */
export function fanClubCommentView(
  comment: FanClubCommentRecord,
  club: Pick<FanClubRecord, 'ownerUid'>,
  viewerUid: string,
): FanClubComment {
  const isManagerView = club.ownerUid !== null && club.ownerUid === viewerUid;
  const isAuthor = comment.authorUid === viewerUid;
  const managerHidden = comment.status === 'manager_hidden' && (isManagerView || isAuthor);
  return {
    id: comment.id,
    postId: comment.postId,
    clubId: comment.clubId,
    author: {
      uid: comment.authorUid,
      name: comment.authorName,
      username: comment.authorUsername,
      photoURL: comment.authorPhotoURL,
    },
    isManager: club.ownerUid !== null && comment.authorUid === club.ownerUid,
    text: comment.text,
    mentions: comment.mentions,
    replyToId: comment.replyToId,
    replyCount: comment.replyCount,
    ...(isManagerView && comment.replyToId === null
      ? { hiddenReplyCount: comment.managerHiddenReplyCount }
      : {}),
    createdAt: iso(comment.createdAt),
    hidden: managerHidden ? 'manager' : null,
    review: managerHidden && isAuthor ? commentReview(comment) : null,
  };
}

/**
 * O comentário que quem pede vê: da publicação, num dos status que ele vê
 * (`shown`) e de autor que ele não bloqueou.
 */
function isShownComment(
  comment: FanClubCommentRecord | null,
  postId: string,
  blocked: ReadonlySet<string>,
  shown: readonly FanClubCommentStatus[] = VISIBLE_ONLY,
): comment is FanClubCommentRecord {
  return (
    comment !== null &&
    comment.postId === postId &&
    shown.includes(comment.status) &&
    !blocked.has(comment.authorUid)
  );
}

/** O filtro do status na consulta: a igualdade do visível, ou o `in` do gestor (o mesmo índice). */
const withStatus = (query: Query, shown: readonly FanClubCommentStatus[]): Query =>
  shown.length === 1
    ? query.where('status', '==', shown[0])
    : query.where('status', 'in', [...shown]);

/**
 * O `ownHidden` (37.3): os comentários de quem pede ocultos pelo gestor
 * naquela publicação, de cima e respostas, até 10, do mais novo ao mais
 * antigo. Só igualdades (`postId`, `authorUid` e `status`), pela junção dos
 * índices de um campo; a ordem sai na memória.
 */
async function readOwnHidden(
  db: Firestore,
  uid: string,
  postId: string,
): Promise<FanClubCommentRecord[]> {
  const snap = await fanClubCommentsOf(db)
    .where('postId', '==', postId)
    .where('authorUid', '==', uid)
    .where('status', '==', 'manager_hidden')
    .limit(FAN_CLUB_OWN_HIDDEN_MAX)
    .get();
  return snap.docs
    .map((doc) => fanClubCommentRecord(doc.id, doc.data()))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

const commentOf = (snap: DocumentSnapshot | undefined): FanClubCommentRecord | null =>
  snap?.exists ? fanClubCommentRecord(snap.id, snap.data() ?? {}) : null;

// --- A lista ------------------------------------------------------------------------------

export type CommentsQuery = { limit: number; cursor: PageCursor | null; replyTo: string | null };

/**
 * `GET /fan-club-posts/:postId/comments` (37.3), fora de transação, com as
 * condições da publicação (`readVisiblePost`; não exige seguir: ler é de quem
 * vê, 37.6). Sem o `replyTo`: os comentários de cima visíveis, do mais novo ao
 * mais antigo (o índice `postId`, `replyToId`, `status`, `createdAt` e o id,
 * decrescentes), cada um com o `replyCount`. Com o `replyTo`: as respostas
 * visíveis daquele comentário, da mais antiga para a mais nova (o índice
 * `replyToId`, `status`, `createdAt` e o id); o comentário de cima, lido
 * junto do artista, tem de ser desta publicação, de cima, visível e de autor
 * que quem pede não bloqueou (senão, 404 `fan_club_comment_not_found`). Sem os
 * autores que quem pede bloqueou (o `withoutBlocked`): faltando para encher a
 * página, busca de novo a partir do último lido, até 5 rodadas, como o
 * `readComments` do Mural; a página pode vir menor, até vazia, com o
 * `nextCursor`. No próprio fã-clube, o gestor vê todos, também os de quem ele
 * bloqueou, para poder ocultá-los (37.8; resposta do dono, 37.15, pergunta 9),
 * e também os que ele ocultou (o `in` do status, com o `hidden: 'manager'`, o
 * `hiddenReplyCount` nos de cima e as respostas embaixo do de cima oculto por
 * ele, etapa 3). Na primeira página dos de cima, quem não é o gestor recebe o
 * `ownHidden`: os dele ocultos pelo gestor naquela publicação, com o `review`
 * (lidos junto da página).
 */
export async function readFanClubComments(
  db: Firestore,
  uid: string,
  postId: string,
  query: CommentsQuery,
): Promise<FanClubCommentPage> {
  const { club, blocked, extra } = await readVisiblePost(db, uid, postId, () =>
    query.replyTo === null ? [] : [fanClubCommentRef(db, query.replyTo)],
  );
  const isManager = club.ownerUid === uid;
  // O gestor no próprio fã-clube não filtra: ele precisa ver para ocultar (37.8).
  const hidden = new Set(isManager ? [] : blocked);
  const shown = isManager ? MANAGER_SHOWN : VISIBLE_ONLY;
  let base: Query;
  if (query.replyTo !== null) {
    const top = commentOf(extra[0]);
    if (!isShownComment(top, postId, hidden, shown) || top.replyToId !== null) {
      throw fanClubCommentNotFound();
    }
    base = withStatus(fanClubCommentsOf(db).where('replyToId', '==', top.id), shown)
      .orderBy('createdAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');
  } else {
    base = withStatus(
      fanClubCommentsOf(db).where('postId', '==', postId).where('replyToId', '==', null),
      shown,
    )
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
  }
  const ownHidden =
    !isManager && query.replyTo === null && query.cursor === null
      ? readOwnHidden(db, uid, postId)
      : null;
  // Lida junto da página: a falha dela chega no `await` do fim, nunca solta.
  void ownHidden?.catch(() => undefined);

  const items: FanClubCommentRecord[] = [];
  let cursor = query.cursor;
  let lastRead: FanClubCommentRecord | null = null;
  let hasMore = false;
  for (let round = 0; round < COMMENT_PAGE_ROUNDS; round += 1) {
    const need = query.limit - items.length;
    const page = cursor ? base.startAfter(tsOf(cursor.at), cursor.id) : base;
    const snap = await page.limit(need + 1).get();
    const read = snap.docs.slice(0, need).map((doc) => fanClubCommentRecord(doc.id, doc.data()));
    if (read.length > 0) lastRead = read.at(-1)!;
    items.push(...withoutBlocked(read, hidden));
    hasMore = snap.docs.length > need;
    if (!hasMore || items.length >= query.limit || !lastRead) break;
    cursor = { at: lastRead.createdAt, id: lastRead.id };
  }
  const own = ownHidden ? await ownHidden : null;
  return {
    items: items.map((comment) => fanClubCommentView(comment, club, uid)),
    nextCursor:
      hasMore && lastRead ? encodePageCursor({ at: lastRead.createdAt, id: lastRead.id }) : null,
    ...(own ? { ownHidden: own.map((comment) => fanClubCommentView(comment, club, uid)) } : {}),
  };
}

// --- Comentar -----------------------------------------------------------------------------

export type AddCommentOutcome = { plan: AwardPlan; comment: FanClubComment | null };

/**
 * `POST /fan-club-posts/:postId/comments` (37.3), na transação do
 * runIdempotent, com o corpo já conferido e limpo (`parseFanClubComment`),
 * nesta ordem: o que reagir e comentar pedem (`readActionPost`: a publicação
 * no ar, o fã-clube visível e seguir ou ser o gestor, senão 409
 * `not_following`), com o comentário respondido e as reservas dos @ do texto
 * (`usernames/{@}`, 37.7) lidos junto da publicação; o respondido tem de ser
 * desta publicação, visível e de autor que quem comenta não bloqueou (o
 * gestor, que vê todos no próprio fã-clube, responde a todos), e a resposta a
 * uma resposta vai para o comentário de cima dela (R7), lido depois, com as
 * mesmas condições e de cima (senão, 404 `fan_club_comment_not_found`); as
 * centrais dos @ reservados por central, conferidas no ar; o filtro de novo,
 * com o "@" tirado só dos @ resolvidos (barrado: 400 `comment_invalid` com
 * `not_allowed`, sem gravar a chave, sem contar o teto e sem guardar o
 * texto); o teto `club_comment`; o `planAwards` com a origem
 * `fanclub_comment` e o id do comentário, só quando quem comenta não é o
 * gestor (37.5; o valor 0 não lança nada); o comentário visível, com as
 * cópias do perfil lido no runIdempotent (o nome, o @ e a foto; o
 * `FanContext` não traz o @), as marcações resolvidas (as `mentions`, por
 * ocorrência, e os `mentionUids`) e o
 * `replyToId` sempre gravado, também null (a lista dos de cima filtra o null,
 * 37.16); o `commentCount` mais 1 na publicação e, na resposta, o
 * `replyCount` mais 1 no comentário de cima (`newCommentCounts`); o
 * `days.{dia}.comments` mais 1 num shard do fã-clube, menos para o gestor
 * (37.11); e o contador do teto. Sem o `addEngagementCounts`: os números do
 * Mural não mudam (37.5). O seed passa um id fixo, lido junto da publicação:
 * se ele já existe, sai sem efeito (`comment: null`).
 */
export async function addFanClubComment(
  tx: Transaction,
  db: Firestore,
  options: {
    fan: FanContext;
    award: AwardContext;
    profile: DocumentSnapshot;
    postId: string;
    input: CommentInput;
    commentId?: string;
  },
): Promise<AddCommentOutcome> {
  const { fan, award, profile, postId, input } = options;
  const fixed = options.commentId ? fanClubCommentRef(db, options.commentId) : null;
  const repliedRef = input.replyToId === null ? null : fanClubCommentRef(db, input.replyToId);
  const tokens = findMentionTokens(input.text);
  const handles = mentionHandles(tokens);
  const { club, isOwner, blocked, extra } = await readActionPost(tx, db, fan.uid, postId, [
    ...(repliedRef ? [repliedRef] : []),
    ...(fixed ? [fixed] : []),
    ...handles.map((handle) => usernameRef(db, handle)),
  ]);
  const repliedSnap = repliedRef ? extra[0] : undefined;
  const fixedSnap = fixed ? extra[repliedRef ? 1 : 0] : undefined;
  const reservations = extra.slice(extra.length - handles.length);
  if (fixedSnap?.exists) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      comment: null,
    };
  }
  const hidden = new Set(isOwner ? [] : blocked);
  let topId: string | null = null;
  if (repliedRef) {
    const replied = commentOf(repliedSnap);
    if (!isShownComment(replied, postId, hidden)) throw fanClubCommentNotFound();
    topId = replyTarget(replied);
    if (topId !== replied.id) {
      const top = commentOf(await tx.get(fanClubCommentRef(db, topId)));
      if (!isShownComment(top, postId, hidden) || top.replyToId !== null) {
        throw fanClubCommentNotFound();
      }
    }
  }
  // As marcações (37.7): as reservas vieram com a publicação; as centrais, agora.
  // O filtro de novo, com o "@" tirado só dos resolvidos: barrado, nada é gravado.
  const targets = await mentionTargetsOf(tx, db, handles, reservations);
  if (isBlockedWithMentions(input.text, tokens, targets, 'comment')) {
    throw new PostError('comment_invalid', { reason: 'not_allowed' });
  }
  const { mentions, mentionUids } = resolvedMentions(tokens, targets);
  enforceDailyCap(fan, award, 'club_comment');
  const ref = fixed ?? fanClubCommentsOf(db).doc();
  const plan = await planAwards(
    tx,
    db,
    [
      {
        uid: fan.uid,
        fan,
        entries: isOwner ? [] : [{ kind: 'earn', source: 'fanclub_comment', eventId: ref.id }],
      },
    ],
    award,
  );

  const at = tsOf(award.now);
  const copies = ownerCopiesOf(profile.data() ?? {});
  const record: FanClubCommentRecord = {
    id: ref.id,
    clubId: club.id,
    postId,
    artistId: club.artistId,
    authorUid: fan.uid,
    authorName: copies.name,
    authorUsername: copies.username,
    authorPhotoURL: copies.photoURL,
    text: input.text,
    mentions,
    mentionUids,
    replyToId: topId,
    replyCount: 0,
    managerHiddenReplyCount: 0,
    status: 'visible',
    hiddenAt: null,
    hiddenBy: null,
    restoredByStaffAt: null,
    reviewRequestedAt: null,
    reviewOutcome: null,
    createdAt: award.now,
  };
  tx.create(ref, {
    clubId: record.clubId,
    postId,
    artistId: record.artistId,
    authorUid: record.authorUid,
    authorName: record.authorName,
    authorUsername: record.authorUsername,
    authorPhotoURL: record.authorPhotoURL,
    text: record.text,
    mentions,
    mentionUids,
    replyToId: topId,
    replyCount: 0,
    managerHiddenReplyCount: 0,
    status: 'visible',
    hiddenAt: null,
    hiddenBy: null,
    restoredByStaffAt: null,
    reviewRequestedAt: null,
    reviewOutcome: null,
    createdAt: at,
    schemaVersion: 1,
  });
  const counts = newCommentCounts(topId);
  tx.update(fanClubPostRef(db, postId), {
    commentCount: FieldValue.increment(counts.commentCount),
  });
  if (topId !== null) {
    tx.update(fanClubCommentRef(db, topId), {
      replyCount: FieldValue.increment(counts.replyCount),
    });
  }
  // A taxa mede os fãs: o que o gestor faz no próprio fã-clube não conta (37.11).
  if (!isOwner) {
    writeFanClubDay(tx, db, club.id, 'comments', dayKey(award.now), award.shard, at);
  }
  countDailyAction(plan, fan, award, 'club_comment');
  return { plan, comment: fanClubCommentView(record, club, fan.uid) };
}

/** Comentar fora da API (o seed dos emuladores), com o id fixo: rodar de novo não duplica. */
export function runAddFanClubComment(
  db: Firestore,
  uid: string,
  input: { postId: string; text: string; replyToId: string | null; commentId: string },
  options: RunOptions,
): Promise<AddCommentOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award, profile) =>
    addFanClubComment(tx, db, {
      fan,
      award,
      profile,
      postId: input.postId,
      input: { text: input.text, replyToId: input.replyToId },
      commentId: input.commentId,
    }),
  );
}

// --- A exclusão de conta (37.8) -----------------------------------------------------------

/** Comentários por página (e por transação) na exclusão de conta. */
export const COMMENTS_DELETE_PAGE = 100;

/**
 * Uma página de comentários que saem, numa transação: relê cada um e o item
 * da fila dele num `getAll`, deixa de fora o que já saiu (a resposta que a
 * varredura do de cima levou não desconta de novo) e o que o `keep` recusa;
 * de cada comentário de cima, lê as respostas que chegaram depois da
 * varredura dele (o `removeRepliesOf`), com os itens, e as leva junto; e lê
 * o que os contadores pedem (os de cima que não vieram junto e as
 * publicações, o `readCommentScene`); depois apaga, com os contadores e os
 * itens (o `writeCommentRemoval`). O do fã que saiu fecha o item com
 * `author_deleted`; o de outro fã, com `removed`. Devolve quantos saíram.
 * Exportada para o teste da resposta que chega entre a varredura e a página.
 */
export function removeCommentsPage(
  db: Firestore,
  refs: readonly DocumentReference[],
  uid: string,
  now: number,
  keep: (comment: FanClubCommentRecord) => boolean,
): Promise<number> {
  return db.runTransaction(async (tx) => {
    const itemRefs = refs.map((ref) => fanClubCommentQueueRef(db, ref.id));
    const snaps = await tx.getAll(...refs, ...itemRefs);
    const targets = refs.flatMap((_ref, index): RemovedCommentTarget[] => {
      const comment = commentOf(snaps[index]);
      if (comment === null || !keep(comment)) return [];
      const item = snaps[refs.length + index]!;
      return [
        {
          comment,
          item: item.exists ? commentQueueRecord(item.data() ?? {}) : null,
          itemRef: itemRefs[index]!,
          resolution: comment.authorUid === uid ? 'author_deleted' : 'removed',
        },
      ];
    });
    if (targets.length === 0) return 0;
    // As respostas que chegaram depois da varredura do de cima (o removeRepliesOf):
    // lidas aqui, saem junto, e a leitura do de cima segura a resposta nova
    // (ela também grava o de cima, então ou entra antes e sai aqui, ou recebe 404).
    const ids = new Set(targets.map((target) => target.comment.id));
    const late = (
      await Promise.all(
        targets
          .filter((target) => target.comment.replyToId === null)
          .map((target) =>
            tx.get(fanClubCommentsOf(db).where('replyToId', '==', target.comment.id)),
          ),
      )
    )
      .flatMap((snap) => snap.docs)
      .filter((doc) => !ids.has(doc.id));
    if (late.length > 0) {
      const lateItemRefs = late.map((doc) => fanClubCommentQueueRef(db, doc.id));
      const lateItems = await tx.getAll(...lateItemRefs);
      late.forEach((doc, index) => {
        const comment = fanClubCommentRecord(doc.id, doc.data());
        const item = lateItems[index]!;
        targets.push({
          comment,
          item: item.exists ? commentQueueRecord(item.data() ?? {}) : null,
          itemRef: lateItemRefs[index]!,
          resolution: comment.authorUid === uid ? 'author_deleted' : 'removed',
        });
      });
    }
    const scene = await readCommentScene(
      tx,
      db,
      targets.map((target) => target.comment),
    );
    writeCommentRemoval(tx, db, targets, scene, now);
    return targets.length;
  });
}

/**
 * Roda `page` sobre a consulta, em páginas de 100, até ela voltar vazia (o
 * que sai não volta na seguinte, como o `drain` do Mural). Devolve quantos
 * saíram.
 */
async function drainComments(
  query: Query,
  page: (snap: QuerySnapshot) => Promise<number>,
): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await query.limit(COMMENTS_DELETE_PAGE).get();
    if (snap.empty) return removed;
    const count = await page(snap);
    removed += count;
    // Nada saiu (outra entrega da exclusão levou tudo no meio): a seguinte vê vazio.
    if (count === 0 && snap.size < COMMENTS_DELETE_PAGE) return removed;
  }
}

/**
 * As respostas embaixo de um comentário de cima do fã que saiu, de qualquer
 * autor (37.8, passo 1): por `replyToId`, pela ordem do id, em páginas de 100,
 * cada uma numa transação que relê as respostas e o de cima, com os
 * contadores de 37.6 (o `replyCount` e o `managerHiddenReplyCount` do de cima
 * e, com ele visível, o `commentCount`). Devolve quantas saíram.
 */
function removeRepliesOf(db: Firestore, topId: string, uid: string, now: number) {
  return drainComments(
    fanClubCommentsOf(db).where('replyToId', '==', topId).orderBy(FieldPath.documentId()),
    (snap) =>
      removeCommentsPage(
        db,
        snap.docs.map((doc) => doc.ref),
        uid,
        now,
        (comment) => comment.replyToId === topId,
      ),
  );
}

/**
 * Os comentários do fã na exclusão de conta (37.8, passo 1), por `authorUid`,
 * pela ordem do id, em páginas de 100. Antes de um comentário de cima dele
 * sair, saem as respostas embaixo dele, inclusive as de outros fãs
 * (`removeRepliesOf`), e só depois a página dele, numa transação que relê e
 * desconta o que sobrou (o `1 + replyCount` do de cima já leva a resposta
 * dele que sai junto) e leva também as respostas que chegaram depois da
 * varredura (a leitura do de cima as segura: ou entram antes e saem junto, ou
 * recebem 404). Assim a nova tentativa do gatilho (`deleteUserProfile`,
 * com `retry: true`) ainda acha o de cima pelo `authorUid` e as respostas que
 * faltaram pelo `replyToId`. Os itens abertos da fila vão a `resolved`, com
 * `author_deleted` (os dele) ou `removed` (as respostas de outros). Os dias da
 * taxa não descontam (37.11). Devolve quantos comentários saíram.
 */
export async function removeFanClubCommentsOf(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<number> {
  return drainComments(
    fanClubCommentsOf(db).where('authorUid', '==', uid).orderBy(FieldPath.documentId()),
    async (snap) => {
      let removed = 0;
      for (const doc of snap.docs) {
        if (doc.get('replyToId') === null) removed += await removeRepliesOf(db, doc.id, uid, now);
      }
      const mine = await removeCommentsPage(
        db,
        snap.docs.map((doc) => doc.ref),
        uid,
        now,
        (comment) => comment.authorUid === uid,
      );
      return removed + mine;
    },
  );
}
