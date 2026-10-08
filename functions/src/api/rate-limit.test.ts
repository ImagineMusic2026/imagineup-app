import { describe, expect, it } from 'vitest';

import { createRateLimiter, RATE_LIMIT_BURST, RATE_LIMIT_PER_SECOND } from './rate-limit';

const T0 = Date.parse('2026-10-08T15:00:00.000Z');

describe('teto de pedidos por fã (27.3)', () => {
  it('padrão: 60 pedidos de uma vez e 1 por segundo depois', () => {
    expect(RATE_LIMIT_BURST).toBe(60);
    expect(RATE_LIMIT_PER_SECOND).toBe(1);
    const limiter = createRateLimiter();
    for (let i = 0; i < 60; i += 1) expect(limiter.take('camila', T0)).toBeNull();
    expect(limiter.take('camila', T0)).toBe(1);
    expect(limiter.take('camila', T0 + 1_000)).toBeNull();
    expect(limiter.take('camila', T0 + 1_000)).toBe(1);
  });

  it('cada fã tem o próprio balde', () => {
    const limiter = createRateLimiter({ burst: 1 });
    expect(limiter.take('camila', T0)).toBeNull();
    expect(limiter.take('camila', T0)).toBe(1);
    expect(limiter.take('alan', T0)).toBeNull();
  });

  it('o Retry-After é o tempo até a próxima ficha, arredondado para cima', () => {
    const limiter = createRateLimiter({ burst: 1, perSecond: 0.25 });
    expect(limiter.take('camila', T0)).toBeNull();
    expect(limiter.take('camila', T0)).toBe(4);
    // Um segundo depois, falta 0,75 de ficha: 3 s.
    expect(limiter.take('camila', T0 + 1_000)).toBe(3);
    expect(limiter.take('camila', T0 + 4_000)).toBeNull();
  });

  it('parado, o balde enche só até o teto', () => {
    const limiter = createRateLimiter({ burst: 3, perSecond: 1 });
    expect(limiter.take('camila', T0)).toBeNull();
    // Uma hora depois, 3 fichas, e não 3.600.
    for (let i = 0; i < 3; i += 1) expect(limiter.take('camila', T0 + 3_600_000)).toBeNull();
    expect(limiter.take('camila', T0 + 3_600_000)).toBe(1);
  });

  it('o relógio que volta não tira nem dá ficha, nem quando volta ao normal', () => {
    const limiter = createRateLimiter({ burst: 2, perSecond: 1 });
    expect(limiter.take('camila', T0)).toBeNull();
    expect(limiter.take('camila', T0 - 10_000)).toBeNull();
    expect(limiter.take('camila', T0 - 10_000)).toBe(1);
    // De volta a T0: os 10 s do recuo não viram fichas.
    expect(limiter.take('camila', T0)).toBe(1);
    expect(limiter.take('camila', T0 + 1_000)).toBeNull();
  });

  it('passado o teto de baldes, sai o fã parado há mais tempo, que volta com o balde cheio', () => {
    const limiter = createRateLimiter({ burst: 1, trackedMax: 2 });
    expect(limiter.take('a', T0)).toBeNull();
    expect(limiter.take('b', T0)).toBeNull();
    // O pedido de "a" (recusado) o põe no fim da fila; "b" é o mais parado.
    expect(limiter.take('a', T0)).toBe(1);
    expect(limiter.take('c', T0)).toBeNull();
    expect(limiter.take('a', T0)).toBe(1);
    // "b" saiu e volta com o balde cheio.
    expect(limiter.take('b', T0)).toBeNull();
  });
});
