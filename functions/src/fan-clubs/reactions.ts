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
import { fanClubPostRef, fanClubReactionRef, writeFanClubDay } from './store';

// As reações às publicações do fã-clube (docs/arquitetura-api.md, seção 37,
// R1, 37.2 e 37.3; a etapa 1 de 37.13): uma reação por fã e publicação, de
// uma lista fechada de 5, em `fanClubReactions/{uid}_{postId}` (na raiz, fora
// do `postLikes` do Mural), e os contadores por `increment` na própria
// publicação, sem gatilho nem fila (decisão 10 de 37.1). Na taxa de
// engajamento, a reação conta como curtida, uma vez na vida por fã e
// publicação (37.11).

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
