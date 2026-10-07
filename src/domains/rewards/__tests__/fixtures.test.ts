import { addDays } from 'date-fns';

import { buildAgendaEventsFixture } from '@/domains/agenda/fixtures';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';

import { REDEEM_ERROR_CODES } from '../consts';
import {
  buildRewardsFixture,
  FIXTURE_REDEMPTIONS,
  FIXTURE_REWARDS,
  rewardsFixture,
} from '../fixtures';

// As fixtures da loja leem os shows da agenda de exemplo, que chegam ao
// domínio das missões (com o axios e o Firebase): o build ESM do Firebase não
// roda no Jest.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

// A agenda de exemplo de verdade, com a troca do show num teste (o show que passou).
jest.mock('@/domains/agenda/fixtures', () => {
  const actual = jest.requireActual<typeof import('@/domains/agenda/fixtures')>(
    '@/domains/agenda/fixtures',
  );
  return { ...actual, buildAgendaEventsFixture: jest.fn(actual.buildAgendaEventsFixture) };
});

const agenda = jest.mocked(buildAgendaEventsFixture);

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

/** O padrão do código do servidor (REDEMPTION_CODE_PATTERN, 25.3). */
const CODE_PATTERN = /^UP-[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/;

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('era para dar erro');
}

/** 18:00 do dia `daysAgo` antes de NOW, no fuso do aparelho. */
const evening = (daysAgo: number) => new Date(2026, 8, 29 - daysAgo, 18, 0).toISOString();

beforeEach(() => {
  rewardsFixture.reset();
  fixtureWallet.reset();
});

describe('catálogo de exemplo, igual ao seed (25.13)', () => {
  // A tabela de 25.13: mudou o seed (functions/src/rewards/seed.ts), mude aqui.
  it('as 6 recompensas na ordem do painel, com custo, estoque, limite e show do seed', () => {
    expect(
      FIXTURE_REWARDS.map((item) => [
        item.id,
        item.kind,
        item.cost,
        item.stockTotal,
        item.perFanLimit,
        item.eventId,
        item.featured,
        item.scarcity,
      ]),
    ).toEqual([
      ['meet-netto', 'meet', 10_000, 20, 1, 'sao-joao-irara', true, true],
      ['ingressos', 'ticket', 6_000, null, 2, null, false, false],
      ['videochamada', 'videocall', 8_500, null, 1, null, false, false],
      ['camisa', 'merch', 15_000, null, null, null, false, false],
      ['telao', 'screen', 20_000, null, 1, null, false, false],
      ['passagem-de-som', 'ticket', 3_000, 1, 1, 'arrocha-na-praia', false, false],
    ]);
  });

  it('os 4 pedidos da Camila nos quatro status, com os códigos, os pontos e o motivo do seed', () => {
    expect(
      FIXTURE_REDEMPTIONS.map((item) => [
        item.code,
        item.rewardId,
        item.points,
        item.daysAgo,
        item.status,
        item.statusDaysAgo,
        item.refundedPoints,
      ]),
    ).toEqual([
      ['UP-4KD9TM', 'ingressos', 6_000, 7, 'delivered', 5, 0],
      ['UP-9FJT6V', 'videochamada', 8_500, 6, 'refused', 5, 8_500],
      ['UP-7QXH2R', 'passagem-de-som', 3_000, 4, 'approved', 3, 0],
      ['UP-C3NWPB', 'camisa', 15_000, 2, 'requested', 2, 0],
    ]);
    for (const item of FIXTURE_REDEMPTIONS) expect(item.code).toMatch(CODE_PATTERN);
    expect(FIXTURE_REDEMPTIONS[1]!.refusalReason).toBe(
      'A agenda de videochamadas deste mês fechou antes do seu pedido.',
    );
  });

  it('a loja da Camila: destaque com escassez, a passagem de som esgotada, a camisa sem limite e os ingressos com 1 de 2', () => {
    const { rewards, rulesUrl } = buildRewardsFixture(NOW);
    expect(rulesUrl).toBeNull();
    const byId = Object.fromEntries(rewards.map((reward) => [reward.id, reward]));
    expect(byId['meet-netto']).toMatchObject({
      featured: true,
      scarcity: true,
      stock: { total: 20, remaining: 20 },
      event: { name: 'São João de Irará', startsAt: new Date(2026, 9, 21, 22, 0).toISOString() },
      status: 'available',
      limitReached: false,
      redemptions: [],
    });
    expect(byId['passagem-de-som']).toMatchObject({
      status: 'soldOut',
      stock: { total: 1, remaining: 0 },
      event: { name: 'Arrocha na Praia' },
      limitReached: true,
    });
    expect(byId.camisa).toMatchObject({ perFanLimit: null, limitReached: false });
    expect(byId.ingressos).toMatchObject({ perFanLimit: 2, limitReached: false });
    // O recusado não conta no limite.
    expect(byId.videochamada).toMatchObject({ perFanLimit: 1, limitReached: false });
  });

  it('cada pedido no detalhe da recompensa dele, com o status, a data e o que voltou', () => {
    const byId = Object.fromEntries(
      buildRewardsFixture(NOW).rewards.map((reward) => [reward.id, reward]),
    );
    expect(byId.ingressos!.redemptions).toEqual([
      {
        id: 'UP-4KD9TM',
        code: 'UP-4KD9TM',
        status: 'delivered',
        statusAt: evening(5),
        points: 6_000,
        refundedPoints: 0,
        instructions: expect.stringMatching(/bilheteria/),
        refusalReason: null,
        redeemedAt: evening(7),
      },
    ]);
    expect(byId.videochamada!.redemptions[0]).toMatchObject({
      status: 'refused',
      refundedPoints: 8_500,
      refusalReason: expect.stringMatching(/agenda de videochamadas/),
    });
    expect(byId['passagem-de-som']!.redemptions[0]).toMatchObject({
      code: 'UP-7QXH2R',
      status: 'approved',
      statusAt: evening(3),
    });
    expect(byId.camisa!.redemptions[0]).toMatchObject({
      code: 'UP-C3NWPB',
      status: 'requested',
      statusAt: evening(2),
      redeemedAt: evening(2),
    });
  });

  it('nenhuma recompensa pede endereço nem é paga: todas custam pontos', () => {
    for (const reward of buildRewardsFixture(NOW).rewards) {
      expect(Number.isInteger(reward.cost)).toBe(true);
      expect(reward.cost).toBeGreaterThan(0);
      expect(JSON.stringify(reward)).not.toMatch(/endereço|R\$/i);
    }
  });

  it('cada chamada devolve objetos novos', () => {
    const first = buildRewardsFixture(NOW);
    first.rewards[0]!.title = 'mudado';
    first.rewards[1]!.redemptions[0]!.code = 'mudado';
    const again = buildRewardsFixture(NOW);
    expect(again.rewards[0]!.title).toBe('Meet & greet com o Netto');
    expect(again.rewards[1]!.redemptions[0]!.code).toBe('UP-4KD9TM');
  });
});

describe('resgate nas fixtures', () => {
  it('desconta só o saldo, com o código sorteado no formato e o pedido solicitado', () => {
    const result = rewardsFixture.redeem('videochamada', 'chave-1', 8_500, NOW);
    expect(result).toMatchObject({
      rewardId: 'videochamada',
      balance: 3_980,
      status: 'requested',
      redeemedAt: NOW.toISOString(),
    });
    expect(result.code).toMatch(CODE_PATTERN);
    expect(result.redemptionId).toBe(result.code);
    expect(result.instructions).toMatch(/e-mail da sua conta/);
    expect(fixtureWallet.get()).toEqual({ balance: 3_980, xp: 12_480, seasonPoints: 4_120 });
  });

  it('a mesma chave devolve o mesmo resgate; com outro custo, idempotency_key_reused', () => {
    const first = rewardsFixture.redeem('ingressos', 'chave-1', 6_000, NOW);
    expect(rewardsFixture.redeem('ingressos', 'chave-1', 6_000, NOW)).toEqual(first);
    expect(fixtureWallet.get().balance).toBe(6_480);
    expect(
      catchError(() => rewardsFixture.redeem('ingressos', 'chave-1', 7_000, NOW)),
    ).toMatchObject({ status: 422, code: REDEEM_ERROR_CODES.alreadyRedeemed });
  });

  it('o pedido volta na loja, no topo, com o status solicitado e as instruções', () => {
    const result = rewardsFixture.redeem('ingressos', 'chave-1', 6_000, NOW);
    const tickets = buildRewardsFixture(NOW).rewards.find((reward) => reward.id === 'ingressos');
    expect(tickets!.redemptions.map((item) => [item.code, item.status])).toEqual([
      [result.code, 'requested'],
      ['UP-4KD9TM', 'delivered'],
    ]);
    // Com 2 de 2, o limite chegou.
    expect(tickets!.limitReached).toBe(true);
  });

  it('as recusas na ordem da API: não existe, esgotada, custo mudado, limite e saldo', () => {
    expect(catchError(() => rewardsFixture.redeem('nao-existe', 'chave-1', 1, NOW))).toMatchObject({
      kind: 'notFound',
      status: 404,
      code: REDEEM_ERROR_CODES.notFound,
    });
    // Esgotada vem antes do custo mudado.
    expect(
      catchError(() => rewardsFixture.redeem('passagem-de-som', 'chave-1', 1, NOW)),
    ).toMatchObject({ status: 409, code: REDEEM_ERROR_CODES.soldOut });
    // Custo mudado vem antes do limite e do saldo.
    expect(catchError(() => rewardsFixture.redeem('telao', 'chave-1', 1, NOW))).toMatchObject({
      status: 409,
      code: REDEEM_ERROR_CODES.changed,
    });
    rewardsFixture.redeem('ingressos', 'chave-2', 6_000, NOW);
    // Limite vem antes do saldo (6.480 cobre, mas 2 de 2 já).
    expect(
      catchError(() => rewardsFixture.redeem('ingressos', 'chave-3', 6_000, NOW)),
    ).toMatchObject({ status: 409, code: REDEEM_ERROR_CODES.limitReached });
    expect(catchError(() => rewardsFixture.redeem('telao', 'chave-4', 20_000, NOW))).toMatchObject({
      status: 409,
      code: REDEEM_ERROR_CODES.insufficientPoints,
    });
  });

  it('recusa sem saldo não mexe em nada; a mesma chave resgata depois, com saldo', () => {
    const error = catchError(() => rewardsFixture.redeem('telao', 'chave-1', 20_000, NOW));
    expect(error).toBeInstanceOf(ApiError);
    expect(fixtureWallet.get().balance).toBe(12_480);
    fixtureWallet.earn(10_000);
    expect(rewardsFixture.redeem('telao', 'chave-1', 20_000, NOW).balance).toBe(2_480);
  });

  it('o show que já passou esgota a recompensa e recusa com sold_out', () => {
    agenda.mockImplementation((now: Date) =>
      jest
        .requireActual<typeof import('@/domains/agenda/fixtures')>('@/domains/agenda/fixtures')
        .buildAgendaEventsFixture(now)
        .map((event) =>
          event.id === 'sao-joao-irara'
            ? { ...event, startsAt: addDays(NOW, -2).toISOString() }
            : event,
        ),
    );
    try {
      const [meet] = buildRewardsFixture(NOW).rewards;
      expect(meet).toMatchObject({ status: 'soldOut', event: null });
      expect(
        catchError(() => rewardsFixture.redeem('meet-netto', 'chave-1', 10_000, NOW)),
      ).toMatchObject({ code: REDEEM_ERROR_CODES.soldOut });
    } finally {
      agenda.mockImplementation(
        jest.requireActual<typeof import('@/domains/agenda/fixtures')>('@/domains/agenda/fixtures')
          .buildAgendaEventsFixture,
      );
    }
  });

  it('baixa o estoque, e a última vaga deixa a recompensa esgotada', () => {
    fixtureWallet.earn(1_000_000);
    rewardsFixture.redeem('meet-netto', 'chave-1', 10_000, NOW);
    const [afterOne] = buildRewardsFixture(NOW).rewards;
    expect(afterOne).toMatchObject({
      stock: { remaining: 19 },
      status: 'available',
      limitReached: true,
    });
  });

  it('volta ao início com a sessão', () => {
    rewardsFixture.redeem('ingressos', 'chave-1', 6_000, NOW);
    rewardsFixture.reset();
    fixtureWallet.reset();
    const tickets = buildRewardsFixture(NOW).rewards.find((reward) => reward.id === 'ingressos');
    expect(tickets!.redemptions).toHaveLength(1);
    expect(rewardsFixture.redeem('ingressos', 'chave-1', 6_000, NOW).balance).toBe(6_480);
  });
});
