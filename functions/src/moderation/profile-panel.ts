import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { profileDigest } from '../fan-profile/details';
import { requestFields } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { panelError, targetFanUid } from '../staff/panel-errors';
import { writeAudit, type CallerAuth } from '../staff/service';
import { moderationPanelError } from './errors';
import { profileQueueItemRef } from './store';

// A equipe fecha a denúncia de perfil (seção 29 de docs/arquitetura-api.md,
// 29.6; resposta 1 do dono de 13/10/2026): a callable resolveProfileReport,
// com a seção moderation e edição, sobre o item da `profileReportQueue`
// (separada da `moderationQueue`, que esta callable nunca lê nem grava). As
// ferramentas do fã (apagar bio e redes, trocar o @, tirar a foto, suspender,
// ocultar os comentários) não mudam e não fecham o item sozinhas: a equipe age
// antes de "Resolver", porque o resumo do perfil gravado é o da resolução.

/** "Manter" (o perfil está dentro das regras) e "Resolver" (a equipe agiu). */
export const PROFILE_RESOLUTIONS = ['kept', 'actioned'] as const;
export type ProfileResolution = (typeof PROFILE_RESOLUTIONS)[number];

export type ProfileResolutionInput = {
  uid: string;
  resolution: ProfileResolution;
  /** A rodada que o card mostrou: mudou (o item reabriu depois), `stale-report`. */
  round: number;
};

/**
 * O corpo da callable (puro, com o uid já conferido pelo `targetFanUid`): a
 * `resolution` da lista e o `round` inteiro de 1 em diante; senão
 * `invalid-request` com o campo.
 */
export function parseProfileResolution(
  uid: string,
  fields: Record<string, unknown>,
): ProfileResolutionInput {
  if (!(PROFILE_RESOLUTIONS as readonly unknown[]).includes(fields.resolution)) {
    throw panelError('invalid-request', { field: 'resolution' });
  }
  const round = fields.round;
  if (typeof round !== 'number' || !Number.isSafeInteger(round) || round < 1) {
    throw panelError('invalid-request', { field: 'round' });
  }
  return { uid, resolution: fields.resolution as ProfileResolution, round };
}

export type ProfilePanelDeps = {
  db: Firestore;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
};

const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/**
 * O núcleo, na transação de quem chama (a callable e os testes): lê o item da
 * fila e o perfil do fã. Sem o item, ou resolvido com `withdrawn` ou
 * `author_deleted` (não há o que a equipe decidir): `profile-not-reported`. A
 * rodada diferente da do item: `stale-report`. Já resolvido com a mesma
 * resolução: ok, sem gravar nem auditar. Senão, o item vai a `resolved` com a
 * resolução, quem resolveu e o `resolvedDigest` (o resumo do perfil lido;
 * null sem ele), e a auditoria `fan.profile.report.resolved` vai na mesma
 * transação, com a resolução, a contagem e a rodada (nunca texto do perfil
 * nem o resumo). Trocar `kept` por `actioned`, ou o contrário, na mesma
 * rodada vale: a equipe muda de ideia e fica nos Logs.
 */
export async function applyProfileResolution(
  tx: Transaction,
  db: Firestore,
  input: ProfileResolutionInput,
  options: { actor: Pick<PanelActor, 'uid' | 'name'>; now: number },
): Promise<{ ok: true; resolution: ProfileResolution }> {
  const [item, profile] = await tx.getAll(
    profileQueueItemRef(db, input.uid),
    db.collection('users').doc(input.uid),
  );
  if (!item!.exists) throw moderationPanelError('profile-not-reported');
  const status = item!.get('status');
  const current = item!.get('resolution');
  if (status !== 'open' && (current === 'withdrawn' || current === 'author_deleted')) {
    throw moderationPanelError('profile-not-reported');
  }
  if (item!.get('round') !== input.round) throw moderationPanelError('stale-report');
  if (status === 'resolved' && current === input.resolution) {
    return { ok: true, resolution: input.resolution };
  }
  const at = Timestamp.fromMillis(options.now);
  const { uid, name } = options.actor;
  tx.update(item!.ref, {
    status: 'resolved',
    resolution: input.resolution,
    resolvedAt: at,
    resolvedBy: { uid, name },
    resolvedDigest: profile!.exists
      ? profileDigest((profile!.data() ?? {}) as Record<string, unknown>)
      : null,
  });
  writeAudit(
    tx,
    db,
    {
      action: 'fan.profile.report.resolved',
      actorUid: uid,
      actorName: name,
      // Nunca o e-mail do fã: o alvo é o uid.
      targetEmail: '',
      targetUid: input.uid,
      details: {
        uid: input.uid,
        resolution: input.resolution,
        reportCount: countOf(item!.get('reportCount')),
        round: input.round,
      },
    },
    at,
  );
  return { ok: true, resolution: input.resolution };
}

/**
 * resolveProfileReport (29.6): `{ uid, resolution, round }`, com a seção
 * `moderation` e edição, lida direto e de novo na transação (o Leitor não
 * resolve). Sem login, `unauthenticated`; o uid fora do formato,
 * `invalid-request` com `field: 'uid'`; o próprio, `self`. Saída
 * `{ ok: true, resolution }`.
 */
export async function resolveProfileReport(
  deps: ProfilePanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; resolution: ProfileResolution }> {
  const { db } = deps;
  const fields = requestFields(data);
  const uid = targetFanUid(caller, fields.uid);
  await readPanelActor(directRead, db, caller, 'moderation', 'edit');
  const input = parseProfileResolution(uid, fields);
  const now = (deps.now ?? Date.now)();
  return db.runTransaction(async (tx) => {
    const actor = await readPanelActor(transactionRead(tx), db, caller, 'moderation', 'edit');
    return applyProfileResolution(tx, db, input, { actor, now });
  });
}

/**
 * O `resolveProfileReport` fora do painel, com um ator dado (os testes do
 * seed: resolver o item do Promo e rodar o seed de novo). Sem conferir o
 * acesso.
 */
export function runResolveProfileReport(
  db: Firestore,
  input: ProfileResolutionInput,
  options: { actor: Pick<PanelActor, 'uid' | 'name'>; now?: number },
): Promise<{ ok: true; resolution: ProfileResolution }> {
  return db.runTransaction((tx) =>
    applyProfileResolution(tx, db, input, {
      actor: options.actor,
      now: options.now ?? Date.now(),
    }),
  );
}
