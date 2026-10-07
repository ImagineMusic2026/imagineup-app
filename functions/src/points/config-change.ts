import {
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';

import { ConfigValidationError } from '../config-validation';
import { gamePanelError } from '../missions/errors';
import { MissionsError } from '../missions/model';
import type { SectionId } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';

// A mudança de um documento versionado de config/ pelas callables do painel
// (bloco 7, docs/arquitetura-api.md, 22.8): todas gravam do mesmo jeito. Na
// transação, relê quem chama, lê o documento, recusa com `config-changed`
// quando a versão não é a da tela, valida, grava a versão +1 com `updatedAt`
// e `updatedBy`, a cópia em `versions/{n}` e uma entrada em `staffAudit`.
// Nada mudou: `{ ok: true, version }` sem gravar nem auditar.

export type ConfigPanelDeps = {
  db: Firestore;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
  /** Sorteio dos ids gerados (missão, conquista); os testes fixam. */
  random?: () => number;
};

/** O que o trabalho da callable vê: a transação, quem chama, o agora e o documento lido. */
export type ConfigChangeContext = {
  tx: Transaction;
  actor: PanelActor;
  now: number;
  snap: DocumentSnapshot;
  version: number;
};

export type ConfigChange<R> = {
  /** O documento novo sem `version`, `updatedAt` e `updatedBy`; null quando nada mudou. */
  doc: DocumentData | null;
  audit?: { action: AuditAction; details: Record<string, unknown> };
  /** Gravações a mais na mesma transação (o arquivo das missões), com a versão nova. */
  writes?: (tx: Transaction, version: number) => void;
  /** O que volta ao painel além de `{ ok, version }`. */
  result?: R;
};

/** O `expectedVersion` do pedido: inteiro de 0 em diante. */
export function expectedVersionOf(input: Record<string, unknown>): number {
  const value = input.expectedVersion;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw gamePanelError('invalid-request', { field: 'expectedVersion' });
  }
  return value;
}

/** O campo de validação e o alvo da missão viram os motivos combinados com o painel. */
function panelErrorOf(error: unknown): unknown {
  if (error instanceof ConfigValidationError) {
    return gamePanelError('invalid-request', { field: error.field });
  }
  if (error instanceof MissionsError) return gamePanelError(error.reason);
  return error;
}

/** A versão gravada no documento (0 sem documento ou fora do formato). */
export function versionOfSnap(snap: DocumentSnapshot): number {
  const value = snap.get('version');
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Roda uma mudança de configuração: acesso de edição à seção (lido fora e de
 * novo na transação: quem perde o acesso no meio não grava), a versão
 * conferida, o trabalho da callable e a gravação. Devolve `{ ok, version }`
 * mais o resultado do trabalho.
 */
export async function runConfigChange<R extends object = Record<string, never>>(
  deps: ConfigPanelDeps,
  caller: CallerAuth | undefined,
  section: SectionId,
  ref: DocumentReference,
  expectedVersion: number,
  work: (ctx: ConfigChangeContext) => Promise<ConfigChange<R>> | ConfigChange<R>,
): Promise<R & { ok: true; version: number }> {
  const { db } = deps;
  await readPanelActor(directRead, db, caller, section, 'edit');
  try {
    return await db.runTransaction(async (tx) => {
      const actor = await readPanelActor(transactionRead(tx), db, caller, section, 'edit');
      const snap = await tx.get(ref);
      const version = versionOfSnap(snap);
      if (version !== expectedVersion) throw gamePanelError('config-changed', { version });
      const now = (deps.now ?? Date.now)();
      const change = await work({ tx, actor, now, snap, version });
      const result = (change.result ?? {}) as R;
      if (change.doc === null) return { ...result, ok: true as const, version };

      const next = version + 1;
      const at = Timestamp.fromMillis(now);
      const doc = {
        ...change.doc,
        version: next,
        updatedAt: at,
        updatedBy: { uid: actor.uid, name: actor.name },
      };
      tx.set(ref, doc);
      tx.set(ref.collection('versions').doc(String(next)), doc);
      change.writes?.(tx, next);
      if (change.audit) {
        writeAudit(
          tx,
          db,
          {
            action: change.audit.action,
            actorUid: actor.uid,
            actorName: actor.name,
            targetEmail: '',
            targetUid: null,
            details: { ...change.audit.details, fromVersion: version, toVersion: next },
          },
          at,
        );
      }
      return { ...result, ok: true as const, version: next };
    });
  } catch (error) {
    const mapped = panelErrorOf(error);
    if (mapped instanceof HttpsError || mapped !== error) throw mapped;
    throw error;
  }
}

/** ms para Timestamp, null fica null (as datas dos catálogos no Firestore). */
export function tsOrNull(ms: number | null): Timestamp | null {
  return ms === null ? null : Timestamp.fromMillis(ms);
}
