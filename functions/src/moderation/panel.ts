import {
  FieldValue,
  Timestamp,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { isContentId } from '../page-cursor';
import { POST_SHARD_COUNT } from '../posts/model';
import { commentRef, countShardRef } from '../posts/store';
import { requestFields } from '../staff/model';
import { directRead, readPanelActor, transactionRead } from '../staff/panel-actor';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import { moderationPanelError } from './errors';
import { queueItemRef } from './store';

// A ação da equipe na seção Moderação (bloco 6, provisória até a UP-48):
// ocultar, manter ou reexibir um comentário, pela callable moderateComment,
// com a seção moderation. docs/arquitetura-api.md, 21.8 e 21.9.

export const MODERATION_ACTIONS = ['hide', 'keep', 'restore'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export type ModerationDeps = {
  db: Firestore;
  now?: () => number;
  /** Sorteio do shard da contagem do post; os testes fixam. */
  random?: () => number;
};

/** O que a ação fez: o status do comentário depois dela e se ela mudou o comentário. */
export type ModerationOutcome = {
  status: 'visible' | 'hidden';
  /** O comentário passou de visível a oculto, ou de oculto a visível, agora. */
  changedComment: boolean;
  /** A ação que foi (ou iria) para a auditoria; null quando nada mudou. */
  auditAction: AuditAction | null;
};

/** Um comentário que a moderação vai mudar: o comentário e o item da fila, lidos na transação. */
export type ModerationTarget = {
  postId: string;
  commentId: string;
  comment: DocumentSnapshot;
  item: DocumentSnapshot;
};

/**
 * A leitura do núcleo: o comentário e o item da fila de cada um, num `getAll`
 * só (o `hideFanComments` lê a página inteira antes de gravar, porque na
 * transação todas as leituras vêm antes das gravações).
 */
export async function readModerationTargets(
  tx: Transaction,
  db: Firestore,
  keys: readonly { postId: string; commentId: string }[],
): Promise<ModerationTarget[]> {
  if (keys.length === 0) return [];
  const snaps = await tx.getAll(
    ...keys.flatMap(({ postId, commentId }) => [
      commentRef(db, postId, commentId),
      queueItemRef(db, commentId),
    ]),
  );
  return keys.map(({ postId, commentId }, index) => ({
    postId,
    commentId,
    comment: snaps[2 * index]!,
    item: snaps[2 * index + 1]!,
  }));
}

/** Soma `delta` em `comments` num shard sorteado das contagens do post. */
export function bumpCommentCount(
  tx: Transaction,
  db: Firestore,
  postId: string,
  delta: number,
  random: () => number,
  now: Timestamp,
): void {
  tx.set(
    countShardRef(
      db,
      postId,
      Math.min(POST_SHARD_COUNT - 1, Math.floor(random() * POST_SHARD_COUNT)),
    ),
    { comments: FieldValue.increment(delta), updatedAt: now },
    { merge: true },
  );
}

export type ModerationWrite = {
  action: ModerationAction;
  actor: { uid: string; name: string };
  now: number;
  random: () => number;
  /** Sem `false`, grava a auditoria do comentário; o `hideFanComments` grava uma entrada só. */
  audit?: boolean;
  /**
   * Quem soma a contagem do post. Sem ele, um shard sorteado por comentário;
   * o `hideFanComments` junta os de cada post e grava um shard por post.
   */
  count?: (postId: string, delta: 1 | -1) => void;
};

/**
 * As gravações do núcleo sobre um comentário já lido (só grava, não lê): muda
 * o que a ação pede e, com `audit` (o padrão), grava a auditoria. Comentário
 * que não existe é `comment-not-found`.
 */
export function writeModeration(
  tx: Transaction,
  db: Firestore,
  target: ModerationTarget,
  options: ModerationWrite,
): ModerationOutcome {
  const { postId, commentId, comment, item } = target;
  const { action, actor, random } = options;
  if (!comment.exists) throw moderationPanelError('comment-not-found');
  const status: 'visible' | 'hidden' = comment.get('status') === 'hidden' ? 'hidden' : 'visible';
  const reported = item.exists;
  if (action === 'keep') {
    if (!reported) throw moderationPanelError('not-reported');
    if (status === 'hidden') throw moderationPanelError('comment-hidden');
  }

  const now = Timestamp.fromMillis(options.now);
  const resolvedBy = { uid: actor.uid, name: actor.name };
  const resolve = (resolution: 'hidden' | 'kept') => {
    if (!reported) return false;
    if (item.get('status') === 'resolved' && item.get('resolution') === resolution) {
      return false;
    }
    tx.update(item.ref, { status: 'resolved', resolution, resolvedAt: now, resolvedBy });
    return true;
  };
  const bump = (delta: 1 | -1) =>
    options.count
      ? options.count(postId, delta)
      : bumpCommentCount(tx, db, postId, delta, random, now);

  let next = status;
  let auditAction: AuditAction | null = null;
  if (action === 'hide') {
    if (status === 'visible') {
      tx.update(comment.ref, { status: 'hidden', hiddenAt: now, hiddenBy: actor.uid });
      bump(-1);
      next = 'hidden';
      auditAction = 'comment.hidden';
    }
    if (resolve('hidden')) auditAction ??= 'comment.hidden';
  } else if (action === 'keep') {
    if (resolve('kept')) auditAction = 'comment.kept';
  } else {
    if (status === 'hidden') {
      // Volta à contagem agora: o countedAt é o instante do commit, como no comentar (21.6).
      tx.update(comment.ref, {
        status: 'visible',
        hiddenAt: null,
        hiddenBy: null,
        countedAt: FieldValue.serverTimestamp(),
      });
      bump(1);
      next = 'visible';
      auditAction = 'comment.restored';
    }
    if (resolve('kept')) auditAction ??= 'comment.restored';
  }
  if (auditAction && options.audit !== false) {
    writeAudit(
      tx,
      db,
      {
        action: auditAction,
        actorUid: actor.uid,
        actorName: actor.name,
        targetEmail: '',
        targetUid: null,
        details: {
          postId,
          commentId,
          artistId: comment.get('artistId') ?? null,
          authorUid: comment.get('authorUid') ?? null,
        },
      },
      now,
    );
  }
  return { status: next, changedComment: next !== status, auditAction };
}

/**
 * O núcleo do `moderateComment`, na transação de quem chama (a callable e o
 * seed): lê o comentário e o item da fila e grava o que a ação pede, com a
 * auditoria (salvo `audit: false`).
 */
export async function applyModeration(
  tx: Transaction,
  db: Firestore,
  options: ModerationWrite & { postId: string; commentId: string },
): Promise<ModerationOutcome> {
  const { postId, commentId, ...write } = options;
  const [target] = await readModerationTargets(tx, db, [{ postId, commentId }]);
  return writeModeration(tx, db, target!, write);
}

/**
 * moderateComment: `hide` oculta o comentário visível para todos (sai da
 * contagem do post) e resolve o item da fila como `hidden`; `keep` resolve o
 * item como `kept` (sem item, `not-reported`; com o comentário oculto,
 * `comment-hidden`, porque para isso existe o `restore`); `restore` reexibe o
 * oculto (volta à contagem) e resolve o item como `kept`. Ação que não muda
 * nada: ok, sem gravar nem auditar. Ocultar não tira os pontos do comentário.
 * A auditoria nunca leva o texto.
 */
export async function moderate(
  deps: ModerationDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; status: 'visible' | 'hidden' }> {
  const { db } = deps;
  await readPanelActor(directRead, db, caller, 'moderation', 'edit');
  const input = requestFields(data);
  if (!isContentId(input.postId) || !isContentId(input.commentId)) {
    throw moderationPanelError('comment-not-found');
  }
  const { postId, commentId } = input as { postId: string; commentId: string };
  const action = input.action;
  if (!(MODERATION_ACTIONS as readonly unknown[]).includes(action)) {
    throw moderationPanelError('invalid-action');
  }
  const random = deps.random ?? Math.random;

  return db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'moderation', 'edit');
    const outcome = await applyModeration(tx, db, {
      postId,
      commentId,
      action: action as ModerationAction,
      actor,
      now: (deps.now ?? Date.now)(),
      random,
    });
    return { ok: true as const, status: outcome.status };
  });
}

/**
 * O `moderateComment` fora do painel, com um ator dado (o seed dos emuladores
 * do bloco 11, que oculta um comentário com a conta da equipe de teste e grava
 * o `comment.hidden` de verdade). Rodar de novo não muda nada.
 */
export function runModeration(
  db: Firestore,
  input: { postId: string; commentId: string; action: ModerationAction },
  options: { actor: { uid: string; name: string }; now?: number; random?: () => number },
): Promise<ModerationOutcome> {
  return db.runTransaction((tx) =>
    applyModeration(tx, db, {
      ...input,
      actor: options.actor,
      now: options.now ?? Date.now(),
      random: options.random ?? Math.random,
    }),
  );
}
