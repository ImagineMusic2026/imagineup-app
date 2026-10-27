import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type Query,
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
import {
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
  type FanClubRecord,
} from './model';
import { readActionPost, readVisiblePost } from './posts';
import {
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
// `postStats` nem às missões. O ocultar, a denúncia e o pedido de revisão são
// da etapa 3. As marcações (a etapa 2, 37.7) são resolvidas no envio, dentro
// da transação, e o filtro confere o texto com o "@" tirado dos resolvidos.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

const iso = (ms: number): string => new Date(ms).toISOString();

/**
 * O comentário como o app recebe (37.3). O `isManager` é calculado na leitura,
 * pelo `ownerUid` de agora (decisão 19 de 37.1). O `hidden` sai só do status
 * (o visível é null), e o `review` fica com o pedido de revisão (etapa 3).
 */
export function fanClubCommentView(
  comment: FanClubCommentRecord,
  club: Pick<FanClubRecord, 'ownerUid'>,
): FanClubComment {
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
    createdAt: iso(comment.createdAt),
    hidden: comment.status === 'manager_hidden' ? 'manager' : null,
    review: null,
  };
}

/** O comentário que quem pede vê: visível, da publicação e de autor que ele não bloqueou. */
function isVisibleComment(
  comment: FanClubCommentRecord | null,
  postId: string,
  blocked: ReadonlySet<string>,
): comment is FanClubCommentRecord {
  return (
    comment !== null &&
    comment.postId === postId &&
    comment.status === 'visible' &&
    !blocked.has(comment.authorUid)
  );
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
 * bloqueou, para poder ocultá-los (37.8; resposta do dono, 37.15, pergunta 9).
 * Os ocultos pelo gestor na lista dele e o `ownHidden` do autor vêm com o
 * ocultar (a etapa 3).
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
  // O gestor no próprio fã-clube não filtra: ele precisa ver para ocultar (37.8).
  const hidden = new Set(club.ownerUid === uid ? [] : blocked);
  let base: Query;
  if (query.replyTo !== null) {
    const top = commentOf(extra[0]);
    if (!isVisibleComment(top, postId, hidden) || top.replyToId !== null) {
      throw fanClubCommentNotFound();
    }
    base = fanClubCommentsOf(db)
      .where('replyToId', '==', top.id)
      .where('status', '==', 'visible')
      .orderBy('createdAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc');
  } else {
    base = fanClubCommentsOf(db)
      .where('postId', '==', postId)
      .where('replyToId', '==', null)
      .where('status', '==', 'visible')
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
  }

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
  return {
    items: items.map((comment) => fanClubCommentView(comment, club)),
    nextCursor:
      hasMore && lastRead ? encodePageCursor({ at: lastRead.createdAt, id: lastRead.id }) : null,
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
    if (!isVisibleComment(replied, postId, hidden)) throw fanClubCommentNotFound();
    topId = replyTarget(replied);
    if (topId !== replied.id) {
      const top = commentOf(await tx.get(fanClubCommentRef(db, topId)));
      if (!isVisibleComment(top, postId, hidden) || top.replyToId !== null) {
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
  return { plan, comment: fanClubCommentView(record, club) };
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
