import { FieldValue, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { requestFields } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { panelError, targetFanUid } from '../staff/panel-errors';
import { writeAudit, type CallerAuth } from '../staff/service';
import { isVisibleLine } from '../visible-line';
import { REPORT_REASONS, type ReportReason } from './model';
import { bumpCommentCount, readModerationTargets, writeModeration } from './panel';

// As ferramentas da Moderação sobre a conta de um fã (bloco 11,
// docs/arquitetura-api.md, 26.4 e 26.6): suspender e tirar a suspensão
// (`setFanSuspended`) e ocultar todos os comentários visíveis dele, em páginas
// (`hideFanComments`). As duas com a seção moderation e edição, e nunca na
// própria conta de fã de quem chama (`self`). A suspensão mora no perfil
// (`suspendedAt` e `suspensionReason`): as rotas da API que gravam recusam o
// suspenso com 403 `account_suspended`, salvo as de desfazer e de segurança.

/** Os motivos da suspensão: os mesmos da denúncia de comentário. */
export const SUSPENSION_REASONS = REPORT_REASONS;
export type SuspensionReason = ReportReason;

/** A nota da suspensão, opcional: de 1 a 280, numa linha visível. */
export const SUSPENSION_NOTE_MAX = 280;

/**
 * Comentários por chamada do `hideFanComments`, todos numa transação só, com
 * a auditoria (o painel chama de novo enquanto vier `more`). 24 para o fã, os
 * comentários e os posts deles caberem nos 50 alvos da auditoria
 * (`AUDIT_TARGETS_MAX`): 1 + 24 + 24. A transação lê os 24 comentários e os
 * itens da fila (mais o membro) e grava até 73 documentos.
 */
export const HIDE_FAN_COMMENTS_PAGE = 24;

export type SuspensionInput = {
  uid: string;
  suspended: boolean;
  reason: SuspensionReason | null;
  note: string | null;
};

const invalid = (field: string) => panelError('invalid-request', { field });

/**
 * O corpo do `setFanSuspended` (puro, com o uid já conferido): `suspended`
 * booleano; para suspender, o `reason` da lista e o `note` opcional; para
 * tirar, os dois ficam de fora.
 */
export function parseSuspensionInput(
  uid: string,
  fields: Record<string, unknown>,
): SuspensionInput {
  if (typeof fields.suspended !== 'boolean') throw invalid('suspended');
  if (!fields.suspended) {
    if (fields.reason !== undefined && fields.reason !== null) throw invalid('reason');
    if (fields.note !== undefined && fields.note !== null) throw invalid('note');
    return { uid, suspended: false, reason: null, note: null };
  }
  if (!(SUSPENSION_REASONS as readonly unknown[]).includes(fields.reason)) throw invalid('reason');
  let note: string | null = null;
  if (fields.note !== undefined && fields.note !== null) {
    if (typeof fields.note !== 'string') throw invalid('note');
    note = fields.note.normalize('NFC').trim();
    if (note.length < 1 || note.length > SUSPENSION_NOTE_MAX || !isVisibleLine(note)) {
      throw invalid('note');
    }
  }
  return { uid, suspended: true, reason: fields.reason as SuspensionReason, note };
}

/**
 * O núcleo do `setFanSuspended`, na transação de quem chama (a callable e o
 * seed dos emuladores): o perfil (`fan-not-found`); já no estado pedido, nada
 * a gravar. Suspender grava `suspendedAt` (o "agora") e `suspensionReason`;
 * tirar apaga os dois (`FieldValue.delete()`: a lista dos suspensos depende
 * disso). Nunca `updatedAt`, o carimbo de edição do fã. Auditoria
 * `fan.suspended` (com o motivo e a nota) ou `fan.unsuspended`.
 */
export async function applyFanSuspension(
  tx: Transaction,
  db: Firestore,
  input: SuspensionInput,
  options: { actor: Pick<PanelActor, 'uid' | 'name'>; now: number },
): Promise<{ changed: boolean }> {
  const profile = await tx.get(db.collection('users').doc(input.uid));
  if (!profile.exists) throw panelError('fan-not-found');
  const current = profile.get('suspendedAt');
  const suspended = current !== undefined && current !== null;
  if (suspended === input.suspended) return { changed: false };
  const at = Timestamp.fromMillis(options.now);
  if (input.suspended) {
    tx.update(profile.ref, { suspendedAt: at, suspensionReason: input.reason });
  } else {
    tx.update(profile.ref, {
      suspendedAt: FieldValue.delete(),
      suspensionReason: FieldValue.delete(),
    });
  }
  writeAudit(
    tx,
    db,
    {
      action: input.suspended ? 'fan.suspended' : 'fan.unsuspended',
      actorUid: options.actor.uid,
      actorName: options.actor.name,
      targetEmail: '',
      targetUid: input.uid,
      details: input.suspended
        ? { uid: input.uid, reason: input.reason, ...(input.note ? { note: input.note } : {}) }
        : { uid: input.uid },
    },
    at,
  );
  return { changed: true };
}

/** A suspensão fora do painel, com um ator dado (o seed dos emuladores). Rodar de novo não muda nada. */
export function runFanSuspension(
  db: Firestore,
  input: SuspensionInput,
  options: { actor: Pick<PanelActor, 'uid' | 'name'>; now?: number },
): Promise<{ changed: boolean }> {
  return db.runTransaction((tx) =>
    applyFanSuspension(tx, db, input, { actor: options.actor, now: options.now ?? Date.now() }),
  );
}

export type ModerationFansDeps = {
  db: Firestore;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
  /** Sorteio do shard da contagem do post; os testes fixam. */
  random?: () => number;
  /** Comentários por chamada do `hideFanComments` (padrão 24); os testes diminuem. */
  pageSize?: number;
  /** Chamado depois de ler a página, antes da transação; os testes mudam o acesso no meio. */
  onPage?: () => Promise<void>;
};

const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();

/**
 * setFanSuspended (26.4, 26.6): suspende (com o motivo e a nota opcional) ou
 * tira a suspensão de um fã. A suspensão vale até a equipe tirar, sem prazo,
 * e não mexe no login: o fã continua entrando, lendo, desfazendo e excluindo
 * a conta. No estado pedido: `{ ok: true, suspended }` sem gravar nem auditar.
 */
export async function setFanSuspended(
  deps: ModerationFansDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; suspended: boolean }> {
  const { db } = deps;
  const fields = requestFields(data);
  const uid = targetFanUid(caller, fields.uid);
  await readPanelActor(directRead, db, caller, 'moderation', 'edit');
  const input = parseSuspensionInput(uid, fields);
  const now = clock(deps);
  await db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'moderation', 'edit');
    await applyFanSuspension(tx, db, input, { actor, now });
  });
  return { ok: true, suspended: input.suspended };
}

/**
 * hideFanComments (26.4): oculta os comentários visíveis de um fã, até 24 por
 * chamada (`collectionGroup('postComments')` com `authorUid` e `status ==
 * 'visible'`, índice de 26.11), todos numa transação só, com a auditoria:
 * relê o membro, relê cada comentário e o item da fila (o oculto ou apagado
 * no meio fica de fora), oculta pelo núcleo do `moderateComment` sem auditar
 * cada um, soma a contagem de cada post num shard só e resolve os itens da
 * fila como `hidden`; na mesma transação, uma entrada `fan.comments.hidden`
 * com a contagem, os posts e os comentários. Nunca há comentário oculto sem a
 * auditoria: quem perde o acesso no meio, um prazo estourado ou uma falha não
 * deixam nada pela metade. `more` quando a página veio cheia: o painel chama
 * de novo até `more: false`. Ocultar não tira pontos. Nada oculto: `{ hidden:
 * 0, more }` sem auditar.
 */
export async function hideFanComments(
  deps: ModerationFansDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ hidden: number; more: boolean }> {
  const { db } = deps;
  const uid = targetFanUid(caller, requestFields(data).uid);
  await readPanelActor(directRead, db, caller, 'moderation', 'edit');
  const random = deps.random ?? Math.random;
  const pageSize = deps.pageSize ?? HIDE_FAN_COMMENTS_PAGE;
  const page = await db
    .collectionGroup('postComments')
    .where('authorUid', '==', uid)
    .where('status', '==', 'visible')
    .limit(pageSize)
    .get();
  const keys = page.docs.flatMap((doc) => {
    const postId = doc.ref.parent.parent?.id;
    return postId ? [{ postId, commentId: doc.id }] : [];
  });
  const more = page.size === pageSize;
  if (keys.length === 0) return { hidden: 0, more };
  await deps.onPage?.();

  const hidden = await db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'moderation', 'edit');
    const targets = await readModerationTargets(tx, db, keys);
    const now = clock(deps);
    const deltas = new Map<string, number>();
    const postIds: string[] = [];
    const commentIds: string[] = [];
    for (const target of targets) {
      // O comentário que sumiu (a exclusão da conta) ou foi ocultado no meio fica de fora,
      // sem gravar nada: toda gravação da transação vai com a auditoria.
      if (!target.comment.exists || target.comment.get('status') === 'hidden') continue;
      const outcome = writeModeration(tx, db, target, {
        action: 'hide',
        actor,
        now,
        random,
        audit: false,
        count: (postId, delta) => deltas.set(postId, (deltas.get(postId) ?? 0) + delta),
      });
      if (!outcome.changedComment) continue;
      commentIds.push(target.commentId);
      if (!postIds.includes(target.postId)) postIds.push(target.postId);
    }
    if (commentIds.length === 0) return 0;
    const at = Timestamp.fromMillis(now);
    for (const [postId, delta] of deltas) bumpCommentCount(tx, db, postId, delta, random, at);
    writeAudit(
      tx,
      db,
      {
        action: 'fan.comments.hidden',
        actorUid: actor.uid,
        actorName: actor.name,
        targetEmail: '',
        targetUid: uid,
        details: { uid, count: commentIds.length, postIds, commentIds },
      },
      at,
    );
    return commentIds.length;
  });
  return { hidden, more };
}
