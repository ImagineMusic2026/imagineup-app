import { createHash } from 'node:crypto';

import { Timestamp, type Transaction } from 'firebase-admin/firestore';

import {
  applyAwards,
  planAwards,
  requireFan,
  retryOnAlreadyExists,
  walletRef,
  type AwardContext,
  type FanContext,
} from '../points/award';
import type { GameConfig, PointsConfig } from '../points/model';
import { pickShard } from '../points/stats';
import { apiError } from './errors';
import type { ResolvedDeps, WorkResult } from './types';

// Idempotência do pedido: a chave do app (`Idempotency-Key`) guardada no
// servidor por 30 dias, gravada na mesma transação do efeito. Só sucesso fica
// guardado. docs/arquitetura-api.md, seção 1 (Idempotência).

/** Cobre o createIdempotencyKey() do app e a chave do convite, que leva a data ISO. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

/** Por que 30 dias: cobre a fila offline do app. O TTL do Firestore apaga depois do expiresAt. */
export const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A chave do cabeçalho; sem ela ou fora do formato, 400 idempotency_key_required. */
export function parseIdempotencyKey(value: string | undefined): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw apiError('idempotency_key_required');
  }
  return value;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** idempotency/{id}: a chave vale por fã, e um fã nunca recebe a resposta guardada de outro. */
export function idempotencyDocId(uid: string, key: string): string {
  return sha256(`${uid}\n${key}`);
}

/** JSON com as chaves dos objetos em ordem: o mesmo corpo dá o mesmo texto. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

/** sha256 de método, caminho e corpo: a mesma chave com outro pedido é 422. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return sha256(`${method}\n${path}\n${canonicalJson(body)}`);
}

export type IdempotentCall = {
  uid: string;
  key: string;
  /** O padrão da rota ("PUT /posts/:postId/like"). */
  route: string;
  fingerprint: string;
  now: number;
  config: PointsConfig;
  /** Missões, conquistas e meta da temporada, da mesma carga do cache dos valores (bloco 7). */
  game: GameConfig;
};

export type IdempotentWork = (ctx: {
  tx: Transaction;
  fan: FanContext;
  award: AwardContext;
}) => Promise<WorkResult>;

export type IdempotentResult = { status: number; body: unknown; replayed: boolean };

/**
 * A resposta como o app vai recebê-la: o JSON do `res.json`, sem campo
 * `undefined` (que o Firestore recusa e derrubaria a transação toda vez) e com
 * data em texto ISO (guardada como está, voltaria como Timestamp na repetição).
 * A primeira resposta e a repetida saem deste mesmo valor.
 */
export function storedBody(body: unknown): unknown {
  const text = JSON.stringify(body ?? null);
  return text === undefined ? null : (JSON.parse(text) as unknown);
}

/**
 * Roda o efeito de uma rota que grava, numa transação:
 * 1. lê a chave, o perfil e a carteira num getAll só;
 * 2. chave com o mesmo pedido: a resposta guardada, sem efeito; com outro: 422;
 * 3. requireFan (perfil exigido, marcas de atividade);
 * 4. o trabalho da rota (leituras, planAwards, gravações do domínio);
 * 5. grava o plano (ou só a atividade de quem chama) e a chave, juntos.
 * O plano da rota precisa ter partido do `fan` deste pedido (`plan.caller`).
 * O shard é sorteado de novo a cada tentativa. ALREADY_EXISTS roda tudo de
 * novo uma vez: a segunda rodada acha a chave ou o lançamento.
 */
export function runIdempotent(
  deps: ResolvedDeps,
  call: IdempotentCall,
  work: IdempotentWork,
): Promise<IdempotentResult> {
  const { db } = deps;
  const keyRef = db.collection('idempotency').doc(idempotencyDocId(call.uid, call.key));
  return retryOnAlreadyExists(() =>
    db.runTransaction(async (tx): Promise<IdempotentResult> => {
      const [saved, profile, wallet] = await tx.getAll(
        keyRef,
        db.collection('users').doc(call.uid),
        walletRef(db, call.uid),
      );
      if (saved!.exists) {
        if (saved!.get('fingerprint') !== call.fingerprint)
          throw apiError('idempotency_key_reused');
        return { status: saved!.get('status'), body: saved!.get('body') ?? null, replayed: true };
      }

      const fan = await requireFan(tx, db, call.uid, profile!, wallet!, call.now, {
        markActivity: true,
      });
      const award: AwardContext = {
        now: call.now,
        config: call.config,
        shard: pickShard(deps.random),
        actor: { type: 'fan', uid: call.uid, name: null },
        game: call.game,
      };
      const result = await work({ tx, fan, award });
      const plan =
        result.plan ?? (await planAwards(tx, db, [{ uid: call.uid, entries: [], fan }], award));
      // Plano sem o retrato deste pedido perderia a atividade de quem chama (o
      // planAwards leria a carteira de novo, sem as marcas do requireFan).
      if (plan.caller !== fan) {
        throw new Error('O plano de pontos precisa partir do fan de quem chama (o do pedido).');
      }
      applyAwards(tx, db, plan);

      const status = result.status ?? 200;
      const body = storedBody(result.body);
      tx.create(keyRef, {
        uid: call.uid,
        route: call.route,
        fingerprint: call.fingerprint,
        status,
        body,
        createdAt: Timestamp.fromMillis(call.now),
        expiresAt: Timestamp.fromMillis(call.now + IDEMPOTENCY_TTL_MS),
      });
      return { status, body, replayed: false };
    }),
  );
}
