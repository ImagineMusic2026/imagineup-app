import { HttpsError } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import type { EventRecord } from '../agenda/model';
import { INVITE_CODE_ALPHABET } from '../invites/model';
import {
  COST_MAX,
  drawRedemptionCode,
  isVisibleToFan,
  parseExpectedCost,
  parseRedemptionCodes,
  parseRedemptionStatusRequest,
  parseRewardCreate,
  parseRewardIds,
  parseRewardPatch,
  PER_FAN_LIMIT_MAX,
  REDEMPTION_CODE_PATTERN,
  REDEMPTION_STATUSES,
  redeemProblem,
  redemptionView,
  REWARDS_RULES_URL,
  rewardView,
  rulesUrlOf,
  STOCK_MAX,
  transitionProblem,
  type RedemptionRecord,
  type RedemptionStatus,
  type RewardRecord,
} from './model';

// Loja e resgate, puro (bloco 10, docs/arquitetura-api.md, 25.14): os campos
// do painel nas pontas, o código sorteado, a tabela das transições, a ordem
// das recusas do resgate e o que a loja mostra. Relógio fixo.

const DAY_MS = 24 * 60 * 60 * 1000;
// Segunda-feira, 18:00 em São Paulo.
const NOW = Date.parse('2026-10-05T21:00:00.000Z');
// O começo do dia de hoje em São Paulo (o corte do que já passou).
const TODAY_START = Date.parse('2026-10-05T03:00:00.000Z');

function reward(extra: Partial<RewardRecord> = {}): RewardRecord {
  return {
    id: 'ingressos',
    kind: 'ticket',
    title: 'Par de ingressos',
    subtitle: 'Pra Encher e Derramar',
    description: 'Dois ingressos de pista.',
    cost: 6_000,
    photo: null,
    featured: false,
    scarcity: false,
    stockTotal: null,
    redeemedCount: 0,
    perFanLimit: 1,
    eventId: null,
    instructions: 'Retire na bilheteria com este código.',
    status: 'published',
    order: 1,
    publishedAt: NOW - 10 * DAY_MS,
    closedAt: null,
    ...extra,
  };
}

function event(extra: Partial<EventRecord> = {}): EventRecord {
  return {
    id: 'sao-joao-irara',
    title: 'São João de Irará',
    artistIds: ['nettobrito'],
    city: 'Irará',
    state: 'BA',
    venue: null,
    startsAt: NOW + 20 * DAY_MS,
    photoUrl: null,
    featured: true,
    status: 'published',
    publishedAt: NOW - 30 * DAY_MS,
    ...extra,
  };
}

function redemption(extra: Partial<RedemptionRecord> = {}): RedemptionRecord {
  return {
    code: 'UP-4KD9TM',
    rewardId: 'ingressos',
    rewardTitle: 'Par de ingressos',
    rewardKind: 'ticket',
    eventId: null,
    points: 6_000,
    uid: 'camila',
    fanName: 'Camila Ribeiro',
    fanUsername: 'camilarib',
    status: 'requested',
    instructions: 'A instrução da hora do resgate.',
    refusalReason: null,
    refundedPoints: 0,
    restocked: null,
    requestedAt: NOW - 7 * DAY_MS,
    approvedAt: null,
    deliveredAt: null,
    refusedAt: null,
    canceledAt: null,
    statusAt: NOW - 7 * DAY_MS,
    accountDeleted: false,
    ...extra,
  };
}

/** O motivo do `HttpsError` do painel, com o campo. */
function panelReason(run: () => unknown): { reason?: string; field?: string } | null {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpsError);
    return (error as HttpsError).details as { reason?: string; field?: string };
  }
}

const BASE = {
  kind: 'ticket',
  title: 'Par de ingressos',
  subtitle: 'Pra Encher e Derramar',
  cost: 6_000,
  instructions: 'Retire na bilheteria com este código.',
};

describe('campos da recompensa (createReward)', () => {
  it('sem os opcionais: descrição null, destaque e escassez falsos, sem estoque, limite 1, sem show', () => {
    expect(parseRewardCreate({ ...BASE })).toEqual({
      ...BASE,
      description: null,
      featured: false,
      scarcity: false,
      stockTotal: null,
      perFanLimit: 1,
      eventId: null,
    });
  });

  it('textos de uma linha limpos (espaços, isolantes colados, NFC)', () => {
    const parsed = parseRewardCreate({
      ...BASE,
      title: '  Par de ingressos⁦ ',
      subtitle: ' Show ',
    });
    expect(parsed.title).toBe('Par de ingressos');
    expect(parsed.subtitle).toBe('Show');
  });

  it.each([
    ['título com 60', { title: 'x'.repeat(60) }, null],
    ['título com 61', { title: 'x'.repeat(61) }, 'title'],
    ['título vazio', { title: '   ' }, 'title'],
    ['título com quebra de linha', { title: 'Par\nde ingressos' }, 'title'],
    ['subtítulo com 61', { subtitle: 'x'.repeat(61) }, 'subtitle'],
    ['custo 0', { cost: 0 }, 'cost'],
    ['custo 1', { cost: 1 }, null],
    ['custo no máximo', { cost: COST_MAX }, null],
    ['custo 1.000.001', { cost: COST_MAX + 1 }, 'cost'],
    ['custo quebrado', { cost: 10.5 }, 'cost'],
    ['estoque 0', { stockTotal: 0 }, null],
    ['estoque null', { stockTotal: null }, null],
    ['estoque no máximo', { stockTotal: STOCK_MAX }, null],
    ['estoque 100.001', { stockTotal: STOCK_MAX + 1 }, 'stockTotal'],
    ['estoque negativo', { stockTotal: -1 }, 'stockTotal'],
    ['limite 0', { perFanLimit: 0 }, 'perFanLimit'],
    ['limite 1', { perFanLimit: 1 }, null],
    ['limite 100', { perFanLimit: PER_FAN_LIMIT_MAX }, null],
    ['limite 101', { perFanLimit: PER_FAN_LIMIT_MAX + 1 }, 'perFanLimit'],
    ['limite null (sem limite)', { perFanLimit: null }, null],
    ['tipo fora da lista', { kind: 'voucher' }, 'kind'],
    ['instruções vazias', { instructions: ' \n ' }, 'instructions'],
    ['instruções com 1.001', { instructions: 'x'.repeat(1_001) }, 'instructions'],
    ['descrição com invisível', { description: 'Show​ㅤ' }, 'description'],
    ['descrição com 1.000', { description: 'x'.repeat(1_000) }, null],
    ['descrição com 1.001', { description: 'x'.repeat(1_001) }, 'description'],
    ['eventId fora do formato', { eventId: 'show/irara' }, 'eventId'],
    ['eventId reservado', { eventId: '__show__' }, 'eventId'],
    ['destaque que não é booleano', { featured: 'sim' }, 'featured'],
  ])('%s', (_name, extra, field) => {
    const result = panelReason(() => parseRewardCreate({ ...BASE, ...extra }));
    if (field === null) expect(result).toBeNull();
    else expect(result).toEqual({ reason: 'invalid-request', field });
  });

  it('faltar um obrigatório é pedido inválido com o campo', () => {
    for (const field of ['kind', 'title', 'subtitle', 'cost', 'instructions'] as const) {
      const input: Record<string, unknown> = { ...BASE };
      delete input[field];
      expect(panelReason(() => parseRewardCreate(input))).toEqual({
        reason: 'invalid-request',
        field,
      });
    }
  });

  it('a descrição vazia vira null, e as várias linhas ficam limpas', () => {
    expect(parseRewardCreate({ ...BASE, description: '  ' }).description).toBeNull();
    expect(
      parseRewardCreate({ ...BASE, description: ' Linha 1 \r\n\n\n Linha 2 ' }).description,
    ).toBe('Linha 1\n\nLinha 2');
  });
});

describe('campos da recompensa (updateReward)', () => {
  it('ausente não muda; null limpa a descrição, o limite e o show', () => {
    expect(parseRewardPatch({})).toEqual({});
    expect(parseRewardPatch({ description: null, perFanLimit: null, eventId: null })).toEqual({
      description: null,
      perFanLimit: null,
      eventId: null,
    });
    expect(parseRewardPatch({ cost: 7_000, featured: true })).toEqual({
      cost: 7_000,
      featured: true,
    });
  });

  it('o estoque não muda por aqui (setRewardStock)', () => {
    expect(panelReason(() => parseRewardPatch({ stockTotal: 10 }))).toEqual({
      reason: 'invalid-request',
      field: 'stockTotal',
    });
  });
});

describe('código de retirada', () => {
  it('UP- mais 6 caracteres só do alfabeto do convite, com o sorteio nas pontas', () => {
    expect(drawRedemptionCode(() => 0)).toBe(`UP-${INVITE_CODE_ALPHABET[0]!.repeat(6)}`);
    const last = INVITE_CODE_ALPHABET.length - 1;
    expect(drawRedemptionCode(() => last)).toBe(`UP-${INVITE_CODE_ALPHABET[last]!.repeat(6)}`);
    // Sorteio fora da faixa fica dentro do alfabeto.
    expect(drawRedemptionCode(() => 99)).toMatch(REDEMPTION_CODE_PATTERN);
    expect(drawRedemptionCode(() => -1)).toMatch(REDEMPTION_CODE_PATTERN);
  });

  it('o sorteio de verdade sai no formato, sem vogal nem 0, 1, I, L e O', () => {
    const codes = Array.from({ length: 200 }, () => drawRedemptionCode());
    for (const code of codes) {
      expect(code).toMatch(REDEMPTION_CODE_PATTERN);
      expect(code.slice(3)).not.toMatch(/[AEIOU01L]/);
    }
    // 200 sorteios de 4,8 × 10^8: repetir seria um sorteio quebrado.
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('o padrão aceita os códigos do seed e recusa o sequencial das fixtures antigas', () => {
    for (const code of ['UP-4KD9TM', 'UP-9FJT6V', 'UP-7QXH2R', 'UP-C3NWPB']) {
      expect(code).toMatch(REDEMPTION_CODE_PATTERN);
    }
    for (const code of ['UP-1001', 'UP-ABCDEF', 'up-4kd9tm', 'UP-4KD9TMX', ' UP-4KD9TM']) {
      expect(code).not.toMatch(REDEMPTION_CODE_PATTERN);
    }
  });
});

describe('transições do pedido (25.1, decisão 3)', () => {
  const VALID = new Set([
    'requested>approved',
    'requested>delivered',
    'requested>refused',
    'approved>delivered',
    'approved>refused',
  ]);
  const pairs = REDEMPTION_STATUSES.flatMap((from) =>
    REDEMPTION_STATUSES.map((to) => [from, to] as [RedemptionStatus, RedemptionStatus]),
  );

  it('são 25 combinações', () => {
    expect(pairs).toHaveLength(25);
  });

  it.each(pairs)('%s para %s', (from, to) => {
    const expected =
      from === to ? 'unchanged' : VALID.has(`${from}>${to}`) ? null : 'invalid-transition';
    expect(transitionProblem(from, to)).toBe(expected);
  });
});

describe('recusas do resgate, na ordem da rota (25.4)', () => {
  const check = (extra: Partial<Parameters<typeof redeemProblem>[0]> = {}) =>
    redeemProblem({
      reward: reward(),
      event: null,
      expectedCost: 6_000,
      fanRedemptions: [],
      now: NOW,
      ...extra,
    });

  it('tudo certo: nenhuma recusa', () => {
    expect(check()).toBeNull();
  });

  it('não existe ou em rascunho: reward_not_found', () => {
    expect(check({ reward: null })).toMatchObject({ reason: 'reward_not_found' });
    expect(check({ reward: reward({ status: 'draft' }) })).toMatchObject({
      reason: 'reward_not_found',
    });
  });

  it('encerrada vem antes do resto, mesmo com vaga e com outro custo', () => {
    expect(check({ reward: reward({ status: 'closed' }), expectedCost: 1 })).toMatchObject({
      reason: 'sold_out',
      details: { reason: 'closed' },
    });
  });

  it('sem vaga: sold_out por estoque, antes do show e do custo', () => {
    expect(
      check({
        reward: reward({ stockTotal: 3, redeemedCount: 3, eventId: 'x' }),
        expectedCost: 1,
      }),
    ).toMatchObject({ reason: 'sold_out', details: { reason: 'stock' } });
    expect(check({ reward: reward({ stockTotal: 0 }) })).toMatchObject({
      details: { reason: 'stock' },
    });
    expect(check({ reward: reward({ stockTotal: 3, redeemedCount: 2 }) })).toBeNull();
  });

  it('show fechado nas pontas da meia-noite de São Paulo', () => {
    const withShow = reward({ eventId: 'sao-joao-irara' });
    // De hoje (desde a meia-noite de São Paulo): aberto.
    expect(check({ reward: withShow, event: event({ startsAt: TODAY_START }) })).toBeNull();
    // De ontem às 23:59:59.999: fechado.
    expect(check({ reward: withShow, event: event({ startsAt: TODAY_START - 1 }) })).toMatchObject({
      reason: 'sold_out',
      details: { reason: 'event' },
    });
  });

  it('show fora do ar, em rascunho ou apagado: sold_out pelo show', () => {
    const withShow = reward({ eventId: 'sao-joao-irara' });
    for (const ev of [event({ status: 'unpublished' }), event({ status: 'draft' }), null]) {
      expect(check({ reward: withShow, event: ev })).toMatchObject({
        reason: 'sold_out',
        details: { reason: 'event' },
      });
    }
  });

  it('custo mudado: reward_changed com o custo de agora, antes do limite', () => {
    expect(
      check({ expectedCost: 5_000, fanRedemptions: [redemption({ status: 'delivered' })] }),
    ).toMatchObject({ reason: 'reward_changed', details: { cost: 6_000 } });
  });

  it.each([
    ['requested', true],
    ['approved', true],
    ['delivered', true],
    ['refused', false],
    ['canceled', false],
  ] as const)('o pedido %s conta no limite: %s', (status, counts) => {
    const problem = check({ fanRedemptions: [redemption({ status })] });
    if (counts) {
      expect(problem).toMatchObject({ reason: 'redeem_limit_reached', details: { limit: 1 } });
    } else {
      expect(problem).toBeNull();
    }
  });

  it('limite 2 com um pedido passa; sem limite, nunca recusa', () => {
    expect(
      check({ reward: reward({ perFanLimit: 2 }), fanRedemptions: [redemption()] }),
    ).toBeNull();
    expect(
      check({
        reward: reward({ perFanLimit: null }),
        fanRedemptions: Array.from({ length: 5 }, () => redemption()),
      }),
    ).toBeNull();
  });
});

describe('o corpo do resgate', () => {
  it.each([
    [{ expectedCost: 6_000 }, 6_000],
    [{ expectedCost: 1 }, 1],
    [{ expectedCost: COST_MAX }, COST_MAX],
    [{ expectedCost: 0 }, undefined],
    [{ expectedCost: COST_MAX + 1 }, undefined],
    [{ expectedCost: '6000' }, undefined],
    [{ expectedCost: 6.5 }, undefined],
    [{}, undefined],
    [null, undefined],
    [[6_000], undefined],
  ])('%j vale %s', (body, expected) => {
    expect(parseExpectedCost(body)).toBe(expected);
  });
});

describe('o que a loja mostra (25.2)', () => {
  it('a recompensa no ar, sem estoque e sem show', () => {
    expect(rewardView(reward(), { event: null, redemptions: [], now: NOW })).toEqual({
      id: 'ingressos',
      kind: 'ticket',
      title: 'Par de ingressos',
      subtitle: 'Pra Encher e Derramar',
      description: 'Dois ingressos de pista.',
      cost: 6_000,
      imageUrl: null,
      featured: false,
      scarcity: false,
      stock: null,
      event: null,
      status: 'available',
      perFanLimit: 1,
      limitReached: false,
      redemptions: [],
    });
  });

  it('soldOut pela encerrada, pela vaga e pelo show fechado; o que sobra nunca negativo', () => {
    const view = (extra: Partial<RewardRecord>, ev: EventRecord | null = null) =>
      rewardView(reward(extra), { event: ev, redemptions: [], now: NOW });
    expect(view({ status: 'closed' }).status).toBe('soldOut');
    expect(view({ stockTotal: 1, redeemedCount: 1 })).toMatchObject({
      status: 'soldOut',
      stock: { total: 1, remaining: 0 },
    });
    // O total abaixo do resgatado (dado antigo) não sai negativo.
    expect(view({ stockTotal: 1, redeemedCount: 3 }).stock).toEqual({ total: 1, remaining: 0 });
    expect(view({ eventId: 'sao-joao-irara' }, event({ startsAt: TODAY_START - 1 }))).toMatchObject(
      { status: 'soldOut', event: null },
    );
    expect(view({ eventId: 'sao-joao-irara' }, null)).toMatchObject({
      status: 'soldOut',
      event: null,
    });
    expect(view({ stockTotal: 20, redeemedCount: 0 })).toMatchObject({
      status: 'available',
      stock: { total: 20, remaining: 20 },
    });
  });

  it('o show só no ar e aberto, com o nome e a data dele', () => {
    const startsAt = NOW + 20 * DAY_MS;
    expect(
      rewardView(reward({ eventId: 'sao-joao-irara' }), {
        event: event({ startsAt }),
        redemptions: [],
        now: NOW,
      }).event,
    ).toEqual({ name: 'São João de Irará', startsAt: new Date(startsAt).toISOString() });
  });

  it('o destaque some na encerrada e fica na no ar esgotada; a foto vira a URL', () => {
    const photo = { url: 'https://foto', path: 'rewards/x/a.webp', width: 1200, height: 643 };
    const closed = rewardView(reward({ featured: true, status: 'closed' }), {
      event: null,
      redemptions: [],
      now: NOW,
    });
    expect(closed.featured).toBe(false);
    const soldOut = rewardView(reward({ featured: true, stockTotal: 1, redeemedCount: 1, photo }), {
      event: null,
      redemptions: [],
      now: NOW,
    });
    expect(soldOut).toMatchObject({ featured: true, status: 'soldOut', imageUrl: 'https://foto' });
  });

  it('os pedidos do fã: só desta recompensa, do mais novo ao mais antigo, sem o cancelado', () => {
    const view = rewardView(reward({ perFanLimit: 2 }), {
      event: null,
      now: NOW,
      redemptions: [
        redemption({ code: 'UP-4KD9TM', requestedAt: NOW - 7 * DAY_MS, status: 'delivered' }),
        redemption({ code: 'UP-C3NWPB', requestedAt: NOW - 2 * DAY_MS }),
        redemption({ code: 'UP-9FJT6V', rewardId: 'videochamada' }),
        redemption({ code: 'UP-7QXH2R', status: 'canceled', uid: null }),
      ],
    });
    expect(view.redemptions.map((item) => item.code)).toEqual(['UP-C3NWPB', 'UP-4KD9TM']);
    // Os dois contam: o limite de 2 chegou.
    expect(view.limitReached).toBe(true);
  });

  it('limitReached conta só solicitado, aprovado e entregue', () => {
    const limitOf = (status: RedemptionStatus) =>
      rewardView(reward(), { event: null, now: NOW, redemptions: [redemption({ status })] })
        .limitReached;
    expect(limitOf('requested')).toBe(true);
    expect(limitOf('approved')).toBe(true);
    expect(limitOf('delivered')).toBe(true);
    expect(limitOf('refused')).toBe(false);
    expect(limitOf('canceled')).toBe(false);
    expect(
      rewardView(reward({ perFanLimit: null }), {
        event: null,
        now: NOW,
        redemptions: [redemption()],
      }).limitReached,
    ).toBe(false);
  });

  it('pedido aberto leva as instruções de agora; o fechado, a cópia da hora do resgate', () => {
    const now = reward({ instructions: 'Instrução de agora.' });
    expect(redemptionView(redemption({ status: 'requested' }), now).instructions).toBe(
      'Instrução de agora.',
    );
    expect(redemptionView(redemption({ status: 'approved' }), now).instructions).toBe(
      'Instrução de agora.',
    );
    expect(redemptionView(redemption({ status: 'delivered' }), now).instructions).toBe(
      'A instrução da hora do resgate.',
    );
  });

  it('o recusado leva o motivo e o que voltou de fato; os outros, 0 e null', () => {
    const refused = redemptionView(
      redemption({
        status: 'refused',
        refusalReason: 'A agenda fechou.',
        refundedPoints: 6_000,
        statusAt: NOW - DAY_MS,
      }),
      reward(),
    );
    expect(refused).toEqual({
      id: 'UP-4KD9TM',
      code: 'UP-4KD9TM',
      status: 'refused',
      statusAt: new Date(NOW - DAY_MS).toISOString(),
      points: 6_000,
      refundedPoints: 6_000,
      instructions: 'A instrução da hora do resgate.',
      refusalReason: 'A agenda fechou.',
      redeemedAt: new Date(NOW - 7 * DAY_MS).toISOString(),
    });
    // Recusado sem pontos de volta (o fã sem perfil): 0.
    expect(
      redemptionView(redemption({ status: 'refused', refundedPoints: 0 }), reward()).refundedPoints,
    ).toBe(0);
    // Fora do recusado, nunca o motivo nem pontos devolvidos.
    expect(
      redemptionView(
        redemption({ status: 'delivered', refusalReason: 'x', refundedPoints: 9 }),
        reward(),
      ),
    ).toMatchObject({ refusalReason: null, refundedPoints: 0 });
  });

  it('o regulamento: null com a constante vazia', () => {
    expect(REWARDS_RULES_URL).toBe('');
    expect(rulesUrlOf()).toBeNull();
    expect(rulesUrlOf('  ')).toBeNull();
    expect(rulesUrlOf('https://imagineup.com.br/regulamento/')).toBe(
      'https://imagineup.com.br/regulamento/',
    );
  });
});

describe('quem vê a recompensa (25.1, decisão 10)', () => {
  it.each([
    ['draft', false, false],
    ['draft', true, false],
    ['published', false, true],
    ['published', true, true],
    ['closed', false, false],
    ['closed', true, true],
  ] as const)('%s, com pedido %s: %s', (status, hasRedemption, visible) => {
    expect(isVisibleToFan({ status }, hasRedemption)).toBe(visible);
  });
});

describe('pedidos do painel', () => {
  it('setRedemptionStatus: o código no formato e o status aceito', () => {
    expect(parseRedemptionStatusRequest({ redemptionId: 'UP-4KD9TM', status: 'approved' })).toEqual(
      { code: 'UP-4KD9TM', status: 'approved', reason: null, restock: true },
    );
    expect(
      panelReason(() =>
        parseRedemptionStatusRequest({ redemptionId: 'up-4kd9tm', status: 'approved' }),
      ),
    ).toEqual({
      reason: 'invalid-request',
      field: 'redemptionId',
    });
    for (const status of ['canceled', 'requested', 'x', undefined]) {
      expect(
        panelReason(() => parseRedemptionStatusRequest({ redemptionId: 'UP-4KD9TM', status })),
      ).toEqual({
        reason: 'invalid-request',
        field: 'status',
      });
    }
  });

  it('motivo e restock só na recusa', () => {
    expect(
      panelReason(() =>
        parseRedemptionStatusRequest({
          redemptionId: 'UP-4KD9TM',
          status: 'delivered',
          reason: 'x',
        }),
      ),
    ).toEqual({ reason: 'reason-not-allowed' });
    expect(
      panelReason(() =>
        parseRedemptionStatusRequest({
          redemptionId: 'UP-4KD9TM',
          status: 'approved',
          restock: false,
        }),
      ),
    ).toEqual({ reason: 'reason-not-allowed' });
    expect(
      parseRedemptionStatusRequest({
        redemptionId: 'UP-4KD9TM',
        status: 'refused',
        reason: '  Show cancelado. ',
        restock: false,
      }),
    ).toEqual({ code: 'UP-4KD9TM', status: 'refused', reason: 'Show cancelado.', restock: false });
    expect(
      parseRedemptionStatusRequest({ redemptionId: 'UP-4KD9TM', status: 'refused', reason: null }),
    ).toEqual({ code: 'UP-4KD9TM', status: 'refused', reason: null, restock: true });
  });

  it.each([
    [{ reason: '' }, 'reason'],
    [{ reason: 'x'.repeat(201) }, 'reason'],
    [{ reason: 'Linha 1\nLinha 2' }, 'reason'],
    [{ restock: 'não' }, 'restock'],
  ])('recusa com %j é pedido inválido', (extra, field) => {
    expect(
      panelReason(() =>
        parseRedemptionStatusRequest({ redemptionId: 'UP-4KD9TM', status: 'refused', ...extra }),
      ),
    ).toEqual({ reason: 'invalid-request', field });
  });

  it('os contatos: de 1 a 50 códigos no formato, sem repetir', () => {
    expect(parseRedemptionCodes(['UP-4KD9TM', 'UP-9FJT6V'])).toEqual(['UP-4KD9TM', 'UP-9FJT6V']);
    const fifty = Array.from({ length: 51 }, (_, index) => drawRedemptionCode(() => index % 28));
    for (const value of [[], ['UP-4KD9TM', 'UP-4KD9TM'], ['UP-1001'], fifty, 'UP-4KD9TM']) {
      expect(panelReason(() => parseRedemptionCodes(value))).toEqual({
        reason: 'invalid-request',
        field: 'redemptionIds',
      });
    }
  });

  it('a ordem: de 1 a 240 ids no formato, sem repetir', () => {
    expect(parseRewardIds(['camisa', 'ingressos'])).toEqual(['camisa', 'ingressos']);
    for (const value of [
      [],
      ['camisa', 'camisa'],
      ['__x__'],
      Array.from({ length: 241 }, (_, i) => `r${i}`),
    ]) {
      expect(panelReason(() => parseRewardIds(value))).toEqual({
        reason: 'invalid-request',
        field: 'rewardIds',
      });
    }
  });
});
