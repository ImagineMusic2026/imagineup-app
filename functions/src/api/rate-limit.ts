// Teto de pedidos por fã em cada instância da função api (proteção contra
// abuso, docs/arquitetura-api.md, 27.3), puro: só memória, sem Firestore. Um
// balde por uid: começa com RATE_LIMIT_BURST fichas, cada pedido gasta uma, e
// elas voltam a RATE_LIMIT_PER_SECOND por segundo. Sem ficha, 429
// `rate_limited` com o Retry-After até a próxima. A conta é de cada instância
// (a api tem até 8, `maxInstances`): quem martela a API com uma conta passa
// de no máximo 8 pedidos por segundo, em vez de centenas. Não é o teto do dia
// das ações (`actionCaps`): aquele fica na carteira e vale entre instâncias.

/** Fichas de um fã que acabou de chegar: a abertura do app pede uns 15 pedidos de uma vez. */
export const RATE_LIMIT_BURST = 60;

/** Fichas que voltam por segundo: 60 pedidos por minuto, sustentados. */
export const RATE_LIMIT_PER_SECOND = 1;

/**
 * Baldes guardados por instância. Passado o teto, sai o fã sem pedido há mais
 * tempo; o balde dele, depois de um minuto parado, já estaria cheio.
 */
export const RATE_LIMIT_TRACKED_MAX = 10_000;

export type RateLimiter = {
  /** Gasta uma ficha do fã; null quando passou, ou os segundos até a próxima ficha. */
  take(uid: string, now: number): number | null;
};

type Bucket = { tokens: number; at: number };

export function createRateLimiter(
  options: { burst?: number; perSecond?: number; trackedMax?: number } = {},
): RateLimiter {
  const burst = options.burst ?? RATE_LIMIT_BURST;
  const perSecond = options.perSecond ?? RATE_LIMIT_PER_SECOND;
  const trackedMax = options.trackedMax ?? RATE_LIMIT_TRACKED_MAX;
  // O Map guarda a ordem de inserção: apagar e gravar de novo deixa o fã do
  // último pedido no fim, e o primeiro da fila é o mais parado.
  const buckets = new Map<string, Bucket>();

  return {
    take(uid, now) {
      const previous = buckets.get(uid);
      let tokens = burst;
      // O instante guardado nunca volta: o relógio que recua não tira ficha, e
      // a volta dele ao normal não as dá de novo.
      let at = now;
      if (previous) {
        at = Math.max(previous.at, now);
        const elapsed = (at - previous.at) / 1000;
        tokens = Math.min(burst, previous.tokens + elapsed * perSecond);
        buckets.delete(uid);
      }
      if (tokens < 1) {
        buckets.set(uid, { tokens, at });
        return Math.max(1, Math.ceil((1 - tokens) / perSecond));
      }
      buckets.set(uid, { tokens: tokens - 1, at });
      if (buckets.size > trackedMax) {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
      }
      return null;
    },
  };
}
