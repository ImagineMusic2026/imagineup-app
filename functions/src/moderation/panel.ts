import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

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
    const [comment, item] = await tx.getAll(
      commentRef(db, postId, commentId),
      queueItemRef(db, commentId),
    );
    if (!comment!.exists) throw moderationPanelError('comment-not-found');
    const status: 'visible' | 'hidden' = comment!.get('status') === 'hidden' ? 'hidden' : 'visible';
    const reported = item!.exists;
    if (action === 'keep') {
      if (!reported) throw moderationPanelError('not-reported');
      if (status === 'hidden') throw moderationPanelError('comment-hidden');
    }

    const now = Timestamp.fromMillis((deps.now ?? Date.now)());
    const resolvedBy = { uid: actor.uid, name: actor.name };
    const resolve = (resolution: 'hidden' | 'kept') => {
      if (!reported) return false;
      if (item!.get('status') === 'resolved' && item!.get('resolution') === resolution) {
        return false;
      }
      tx.update(item!.ref, { status: 'resolved', resolution, resolvedAt: now, resolvedBy });
      return true;
    };
    const bump = (delta: 1 | -1) =>
      tx.set(
        countShardRef(
          db,
          postId,
          Math.min(POST_SHARD_COUNT - 1, Math.floor(random() * POST_SHARD_COUNT)),
        ),
        { comments: FieldValue.increment(delta), updatedAt: now },
        { merge: true },
      );

    let next = status;
    let auditAction: AuditAction | null = null;
    if (action === 'hide') {
      if (status === 'visible') {
        tx.update(comment!.ref, { status: 'hidden', hiddenAt: now, hiddenBy: actor.uid });
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
        tx.update(comment!.ref, {
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
    if (auditAction) {
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
            artistId: comment!.get('artistId') ?? null,
            authorUid: comment!.get('authorUid') ?? null,
          },
        },
        now,
      );
    }
    return { ok: true as const, status: next };
  });
}
