import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import type { FanClubReactionCounts } from '../api/contract';
import { dayKey } from '../day';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import { isContentId } from '../page-cursor';
import {
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import {
  applyReactionDelta,
  emptyReactionCounts,
  FAN_CLUB_REACTIONS,
  fanClubPostRecord,
  fanClubReactionOf,
  reactionDelta,
  type FanClubReactionKey,
  type ReactionDelta,
} from './model';
import { readActionPost } from './posts';
import { fanClubPostRef, fanClubReactionRef, fanClubReactionsOf, writeFanClubDay } from './store';

// As reações às publicações do fã-clube (docs/arquitetura-api.md, seção 37,
// R1, 37.2 e 37.3; a etapa 1 de 37.13): uma reação por fã e publicação, de
// uma lista fechada de 5, em `fanClubReactions/{uid}_{postId}` (na raiz, fora
// do `postLikes` do Mural), e os contadores por `increment` na própria
// publicação, sem gatilho nem fila (decisão 10 de 37.1). Na taxa de
// engajamento, a reação conta como curtida, uma vez na vida por fã e
// publicação (37.11). Desde a etapa 4 (37.8), o passo das reações na exclusão
// de conta.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

/** A reação de agora e os contadores da publicação, sem as recompensas (a rota junta). */
export type ReactionBody = {
  postId: string;
  reaction: FanClubReactionKey | null;
  reactionCount: number;
  reactionCounts: FanClubReactionCounts;
};

export type ReactionOutcome = { plan: AwardPlan; body: ReactionBody };

/** O que a troca grava na publicação: os `increment` do total e de cada emoji que mexe. */
function reactionUpdate(delta: ReactionDelta): DocumentData {
  const fields: DocumentData = {};
  if (delta.total !== 0) fields.reactionCount = FieldValue.increment(delta.total);
  for (const key of FAN_CLUB_REACTIONS) {
    const value = delta.counts[key];
    if (value) fields[`reactionCounts.${key}`] = FieldValue.increment(value);
  }
  return fields;
}

/**
 * `PUT /fan-club-posts/:postId/reaction` (37.3), na transação do
 * runIdempotent, com a reação já conferida (`parseReaction`), nesta ordem: o
 * que reagir e comentar pedem (`readActionPost`: a publicação no ar, o
 * fã-clube visível e seguir ou ser o gestor, senão 409 `not_following`), com a
 * reação de quem pede lida junto da publicação. A mesma reação responde os
 * números lidos, sem gravar e sem contar no teto. Senão: o teto `club_react`
 * (dar e trocar de emoji contam, decisão 16 de 37.1); sem reação antes, o
 * `planAwards` com a origem `fanclub_like` e o id da publicação (o extrato
 * paga uma vez na vida, como o `like:<postId>`; nunca para o gestor, e o
 * valor 0 não lança nada, 37.5); o documento da reação, com o
 * `firstReactedAt` na primeira; na publicação, os `increment` da troca
 * (`reactionDelta`); na primeira reação da vida nessa publicação, de quem não
 * é o gestor, o `days.{dia}.reactions` mais 1 num shard do fã-clube (37.11:
 * trocar, tirar e reagir de novo não somam); e o contador do teto. A resposta
 * traz os contadores depois da gravação, a partir dos lidos.
 */
export async function setFanClubReaction(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; postId: string; reaction: FanClubReactionKey },
): Promise<ReactionOutcome> {
  const { fan, award, postId, reaction } = options;
  const reactionDoc = fanClubReactionRef(db, fan.uid, postId);
  const { post, club, isOwner, extra } = await readActionPost(tx, db, fan.uid, postId, [
    reactionDoc,
  ]);
  const current = extra[0]!;
  const before = current.exists ? fanClubReactionOf(current.get('reaction')) : null;
  if (before === reaction) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      body: {
        postId,
        reaction,
        reactionCount: post.reactionCount,
        reactionCounts: post.reactionCounts,
      },
    };
  }
  enforceDailyCap(fan, award, 'club_react');
  const plan = await planAwards(
    tx,
    db,
    [
      {
        uid: fan.uid,
        fan,
        entries:
          before === null && !isOwner
            ? [{ kind: 'earn', source: 'fanclub_like', eventId: postId }]
            : [],
      },
    ],
    award,
  );
  const at = tsOf(award.now);
  if (current.exists) {
    tx.update(reactionDoc, { reaction, updatedAt: at });
  } else {
    tx.create(reactionDoc, {
      uid: fan.uid,
      clubId: club.id,
      postId,
      reaction,
      firstReactedAt: at,
      updatedAt: at,
      schemaVersion: 1,
    });
  }
  const delta = reactionDelta(before, reaction);
  tx.update(fanClubPostRef(db, postId), reactionUpdate(delta));
  // A primeira reação da vida nessa publicação, e nunca a do gestor (37.11).
  if (!current.exists && !isOwner) {
    writeFanClubDay(tx, db, club.id, 'reactions', dayKey(award.now), award.shard, at);
  }
  countDailyAction(plan, fan, award, 'club_react');
  return {
    plan,
    body: {
      postId,
      reaction,
      ...applyReactionDelta(post.reactionCount, post.reactionCounts, delta),
    },
  };
}

/**
 * `DELETE /fan-club-posts/:postId/reaction` (37.3): desfazer, aceito do
 * suspenso e nunca recusado, como o `unlikePost` do Mural. Lê a reação e a
 * publicação num `getAll`; com a reação ativa, grava `reaction: null` (o
 * documento fica, para o lançamento e o dia da taxa contarem uma vez só) e,
 * se a publicação existe, tira 1 do total e do emoji, em qualquer status dela
 * (os números ficam certos quando ela volta). Não tira ponto nem desconta o
 * dia da taxa. A resposta traz os contadores depois da gravação (zeros sem a
 * publicação).
 */
export async function clearFanClubReaction(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; postId: string },
): Promise<ReactionOutcome> {
  const { fan, award, postId } = options;
  const reactionDoc = fanClubReactionRef(db, fan.uid, postId);
  const postRef = fanClubPostRef(db, postId);
  const [current, postSnap] = await tx.getAll(reactionDoc, postRef);
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  const post = postSnap!.exists ? fanClubPostRecord(postSnap!.id, postSnap!.data() ?? {}) : null;
  const counts = post
    ? { reactionCount: post.reactionCount, reactionCounts: post.reactionCounts }
    : { reactionCount: 0, reactionCounts: emptyReactionCounts() };
  const before = current!.exists ? fanClubReactionOf(current!.get('reaction')) : null;
  if (before === null) return { plan, body: { postId, reaction: null, ...counts } };
  tx.update(reactionDoc, { reaction: null, updatedAt: tsOf(award.now) });
  const delta = reactionDelta(before, null);
  if (post) tx.update(postRef, reactionUpdate(delta));
  return {
    plan,
    body: {
      postId,
      reaction: null,
      ...(post ? applyReactionDelta(counts.reactionCount, counts.reactionCounts, delta) : counts),
    },
  };
}

/** Reagir fora da API (o seed dos emuladores), com o ator dado (o de sistema não conta no teto). */
export function runSetFanClubReaction(
  db: Firestore,
  uid: string,
  input: { postId: string; reaction: FanClubReactionKey },
  options: RunOptions,
): Promise<ReactionOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) =>
    setFanClubReaction(tx, db, { fan, award, ...input }),
  );
}

// --- A exclusão de conta (37.8) -----------------------------------------------------------

/** Reações por página (e por transação) na exclusão de conta. */
export const REACTIONS_DELETE_PAGE = 100;

/**
 * As reações do fã na exclusão de conta (37.8, passo 2), por `uid`, em
 * páginas de 100, cada uma numa transação que relê as reações e as
 * publicações delas: a reação sai e, a ativa com a publicação ainda lá, tira
 * 1 do total e do emoji dela, como o `DELETE` da reação, em qualquer status da
 * publicação (os números ficam certos quando ela volta). Os descontos de uma
 * página vão juntos, numa gravação por publicação. O dia da taxa não desconta
 * (37.11). Devolve quantas saíram.
 */
export async function removeFanClubReactionsOf(db: Firestore, uid: string): Promise<number> {
  const query = fanClubReactionsOf(db).where('uid', '==', uid).limit(REACTIONS_DELETE_PAGE);
  let removed = 0;
  for (;;) {
    const snap = await query.get();
    if (snap.empty) return removed;
    const refs = snap.docs.map((doc) => doc.ref);
    const count = await db.runTransaction(async (tx) => {
      const reactions = await tx.getAll(...refs);
      const active = reactions.flatMap((reaction) => {
        if (!reaction.exists) return [];
        const key = fanClubReactionOf(reaction.get('reaction'));
        const postId = reaction.get('postId');
        return key !== null && isContentId(postId) ? [{ postId, key }] : [];
      });
      const postIds = [...new Set(active.map((item) => item.postId))];
      const posts =
        postIds.length > 0 ? await tx.getAll(...postIds.map((id) => fanClubPostRef(db, id))) : [];
      const existing = new Set(postIds.filter((_id, index) => posts[index]?.exists === true));
      const deltas = new Map<string, ReactionDelta>();
      for (const { postId, key } of active) {
        if (!existing.has(postId)) continue;
        const delta = deltas.get(postId) ?? { total: 0, counts: {} };
        delta.total -= 1;
        delta.counts[key] = (delta.counts[key] ?? 0) - 1;
        deltas.set(postId, delta);
      }
      let deleted = 0;
      for (const reaction of reactions) {
        if (!reaction.exists) continue;
        tx.delete(reaction.ref);
        deleted += 1;
      }
      for (const [postId, delta] of deltas) {
        tx.update(fanClubPostRef(db, postId), reactionUpdate(delta));
      }
      return deleted;
    });
    removed += count;
    // Nada saiu (outra entrega da exclusão levou tudo no meio): a seguinte vê vazio.
    if (count === 0 && snap.size < REACTIONS_DELETE_PAGE) return removed;
  }
}
