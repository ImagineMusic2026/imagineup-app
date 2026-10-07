import { ApiError } from '@/services/api/errors';

import { REDEEM_ERROR_CODES } from '../consts';
import {
  buildRewardGrid,
  featuredRewardLabel,
  isOpenRedemption,
  isSoldOut,
  limitReachedText,
  missingSpoken,
  missingText,
  outcomeUnknown,
  priceText,
  redeemFailure,
  redemptionStatusSpoken,
  redemptionStatusText,
  rewardAvailability,
  rewardCardLabel,
  rewardMeta,
  rewardMetaSpoken,
  scarcityText,
} from '../describe-reward';
import { buildRewardsFixture } from '../fixtures';
import type { Reward, RewardRedemption } from '../types';

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

// Terça, 29 de setembro de 2026, 20 h: o São João de Irará cai em 21 de outubro.
const NOW = new Date(2026, 8, 29, 20, 0);
const { rewards } = buildRewardsFixture(NOW);

function byId(id: string): Reward {
  const reward = rewards.find((item) => item.id === id);
  if (!reward) throw new Error(`recompensa ${id} não existe nas fixtures`);
  return reward;
}

const MEET = byId('meet-netto');
const TICKETS = byId('ingressos');
const SHIRT = byId('camisa');

describe('o que o saldo cobre', () => {
  it.each([
    ['cobre com folga', 12_480, { state: 'redeemable' }],
    ['cobre na conta exata', 6_000, { state: 'redeemable' }],
    ['falta um ponto', 5_999, { state: 'short', missing: 1 }],
    ['saldo zerado', 0, { state: 'short', missing: 6_000 }],
    ['saldo que ainda não chegou', null, { state: 'unknown' }],
  ])('%s', (_what, balance, expected) => {
    expect(rewardAvailability(TICKETS, balance)).toEqual(expected);
  });

  it('esgotada vale mais que o saldo: esgotada com ou sem pontos', () => {
    const soldOut: Reward = { ...TICKETS, status: 'soldOut' };
    const noStock: Reward = { ...MEET, stock: { remaining: 0, total: 20 } };
    expect(rewardAvailability(soldOut, 50_000)).toEqual({ state: 'soldOut' });
    expect(rewardAvailability(noStock, null)).toEqual({ state: 'soldOut' });
    expect(isSoldOut(noStock)).toBe(true);
    expect(isSoldOut(MEET)).toBe(false);
  });

  it('o limite do fã vem depois do esgotado e antes do saldo (bloco 10)', () => {
    const reached: Reward = { ...TICKETS, limitReached: true };
    expect(rewardAvailability(reached, 50_000)).toEqual({ state: 'limitReached' });
    expect(rewardAvailability(reached, 0)).toEqual({ state: 'limitReached' });
    expect(rewardAvailability(reached, null)).toEqual({ state: 'limitReached' });
    expect(rewardAvailability({ ...reached, status: 'soldOut' }, 50_000)).toEqual({
      state: 'soldOut',
    });
  });

  it('o botão do limite: "Você já resgatou" com limite 1; "Limite de N resgates atingido" com mais', () => {
    expect(limitReachedText({ ...TICKETS, perFanLimit: 1 })).toBe('Você já resgatou');
    expect(limitReachedText({ ...TICKETS, perFanLimit: 2 })).toBe('Limite de 2 resgates atingido');
    expect(limitReachedText({ ...TICKETS, perFanLimit: null })).toBe('Você já resgatou');
  });
});

describe('status do pedido (bloco 10)', () => {
  const redemption = (status: RewardRedemption['status']): RewardRedemption => ({
    id: 'UP-4KD9TM',
    code: 'UP-4KD9TM',
    status,
    statusAt: new Date(2026, 9, 2, 18, 0).toISOString(),
    points: 6_000,
    refundedPoints: 0,
    instructions: 'Retire na bilheteria.',
    refusalReason: null,
    redeemedAt: new Date(2026, 8, 30, 18, 0).toISOString(),
  });

  it.each([
    ['requested', 'Solicitado em 2 out', 'Solicitado em 2 de outubro', true],
    ['approved', 'Aprovado em 2 out', 'Aprovado em 2 de outubro', true],
    ['delivered', 'Entregue em 2 out', 'Entregue em 2 de outubro', false],
    ['refused', 'Recusado em 2 out', 'Recusado em 2 de outubro', false],
  ] as const)('%s: "%s"', (status, text, spoken, open) => {
    expect(redemptionStatusText(redemption(status))).toBe(text);
    expect(redemptionStatusSpoken(redemption(status))).toBe(spoken);
    expect(isOpenRedemption(redemption(status))).toBe(open);
  });
});

describe('textos da loja', () => {
  it.each([
    [6_000, '6.000 pts'],
    [10_000, '10.000 pts'],
    [500, '500 pts'],
  ])('preço de %i: %s', (cost, text) => {
    expect(priceText(cost)).toBe(text);
  });

  it('o que falta sai em minúscula, como no protótipo, e no singular com um ponto', () => {
    expect(missingText(2_520)).toBe('faltam 2.520');
    expect(missingText(1)).toBe('falta 1');
    expect(missingSpoken(2_520)).toBe('Faltam 2.520 pontos');
    expect(missingSpoken(1)).toBe('Falta 1 ponto');
  });

  it.each([
    ['com escassez e vagas', MEET, 'Só 20 vagas'],
    ['com uma vaga só', { ...MEET, stock: { remaining: 1, total: 20 } }, 'Só 1 vaga'],
    ['sem vaga nenhuma', { ...MEET, stock: { remaining: 0, total: 20 } }, null],
    ['encerrada pelo painel com vagas sobrando', { ...MEET, status: 'soldOut' as const }, null],
    ['sem escassez marcada no painel', { ...MEET, scarcity: false }, null],
    ['sem estoque', TICKETS, null],
  ])('selo de vagas %s', (_what, reward, text) => {
    expect(scarcityText(reward)).toBe(text);
  });

  it('a linha do destaque é o show com a data; sem show, o subtítulo', () => {
    expect(rewardMeta(MEET)).toBe('São João de Irará · 21 out');
    expect(rewardMetaSpoken(MEET)).toBe('São João de Irará, 21 de outubro');
    expect(rewardMeta(TICKETS)).toBe('Pra Encher e Derramar');
    expect(rewardMetaSpoken(TICKETS)).toBe('Pra Encher e Derramar');
  });
});

describe('rótulos para o leitor de tela', () => {
  it.each([
    [
      'no alcance, o custo',
      TICKETS,
      { state: 'redeemable' } as const,
      'Par de ingressos. Pra Encher e Derramar. 6.000 pontos.',
    ],
    [
      'fora do alcance, o que falta',
      SHIRT,
      { state: 'short', missing: 2_520 } as const,
      'Camisa oficial. Coleção São João. Faltam 2.520 pontos.',
    ],
    [
      'esgotada',
      TICKETS,
      { state: 'soldOut' } as const,
      'Par de ingressos. Pra Encher e Derramar. Esgotado.',
    ],
    [
      'sem o saldo, o custo',
      TICKETS,
      { state: 'unknown' } as const,
      'Par de ingressos. Pra Encher e Derramar. 6.000 pontos.',
    ],
    [
      'no limite do fã',
      TICKETS,
      { state: 'limitReached' } as const,
      'Par de ingressos. Pra Encher e Derramar. Limite de resgates atingido.',
    ],
  ])('card %s', (_what, reward, availability, label) => {
    expect(rewardCardLabel(reward, availability)).toBe(label);
  });

  it('destaque: título, vagas, show com a data por extenso e o custo', () => {
    expect(featuredRewardLabel(MEET, { state: 'redeemable' })).toBe(
      'Meet & greet com o Netto. Só 20 vagas. São João de Irará, 21 de outubro. 10.000 pontos.',
    );
  });

  it('destaque encerrado pelo painel com vagas sobrando diz só "Esgotado", sem "Só 20 vagas"', () => {
    expect(featuredRewardLabel({ ...MEET, status: 'soldOut' }, { state: 'soldOut' })).toBe(
      'Meet & greet com o Netto. São João de Irará, 21 de outubro. Esgotado.',
    );
  });

  it('destaque sem vagas marcadas pula o selo', () => {
    expect(featuredRewardLabel({ ...MEET, scarcity: false }, { state: 'short', missing: 1 })).toBe(
      'Meet & greet com o Netto. São João de Irará, 21 de outubro. Falta 1 ponto.',
    );
  });
});

describe('grade "Ao seu alcance"', () => {
  it('o destaque sai da grade, que vai do menor custo para o maior, dois por linha', () => {
    const { featured, rows } = buildRewardGrid(rewards);
    expect(featured?.id).toBe('meet-netto');
    // A passagem de som, esgotada, fica no fim, mesmo sendo a mais barata.
    expect(rows.map((row) => row.rewards.map((reward) => reward.id))).toEqual([
      ['ingressos', 'videochamada'],
      ['camisa', 'telao'],
      ['passagem-de-som'],
    ]);
  });

  it('esgotadas vão para o fim, e empate de custo fica na ordem do painel', () => {
    const extra: Reward = { ...TICKETS, id: 'ingressos-2', title: 'Outro par' };
    const soldOut: Reward = { ...TICKETS, id: 'ingressos-esgotados', status: 'soldOut' };
    const { rows } = buildRewardGrid([soldOut, ...rewards, extra]);
    expect(rows.flatMap((row) => row.rewards.map((reward) => reward.id))).toEqual([
      'ingressos',
      'ingressos-2',
      'videochamada',
      'camisa',
      'telao',
      'passagem-de-som',
      'ingressos-esgotados',
    ]);
  });

  it('a recompensa no limite do fã vai para o fim, junto das esgotadas', () => {
    const reached = rewards.map((reward) =>
      reward.id === 'ingressos' ? { ...reward, limitReached: true } : reward,
    );
    expect(
      buildRewardGrid(reached).rows.flatMap((row) => row.rewards.map((reward) => reward.id)),
    ).toEqual(['videochamada', 'camisa', 'telao', 'passagem-de-som', 'ingressos']);
  });

  it('número ímpar deixa a última recompensa sozinha na linha', () => {
    const { rows } = buildRewardGrid(rewards);
    expect(rows.at(-1)).toEqual({
      key: 'passagem-de-som',
      rewards: [expect.objectContaining({ id: 'passagem-de-som' })],
    });
  });

  it('sem destaque no painel, tudo vai para a grade', () => {
    const { featured, rows } = buildRewardGrid(
      rewards.map((reward) => ({ ...reward, featured: false })),
    );
    expect(featured).toBeNull();
    expect(rows.flatMap((row) => row.rewards)).toHaveLength(6);
  });

  it('loja vazia não tem destaque nem linha', () => {
    expect(buildRewardGrid([])).toEqual({ featured: null, rows: [] });
  });
});

describe('recusa do resgate', () => {
  it.each([
    [
      'saldo',
      new ApiError('validation', 'x', 409, REDEEM_ERROR_CODES.insufficientPoints),
      'insufficientPoints',
      false,
    ],
    [
      'esgotado',
      new ApiError('validation', 'x', 409, REDEEM_ERROR_CODES.soldOut),
      'soldOut',
      false,
    ],
    ['sem rede', new ApiError('network', 'x'), 'failed', true],
    ['servidor fora do ar', new ApiError('server', 'x', 503), 'failed', true],
    ['erro qualquer', new Error('x'), 'failed', true],
    [
      'recompensa que saiu da loja',
      new ApiError('notFound', 'x', 404, REDEEM_ERROR_CODES.notFound),
      'notFound',
      false,
    ],
    [
      'limite por fã',
      new ApiError('validation', 'x', 409, REDEEM_ERROR_CODES.limitReached),
      'limitReached',
      false,
    ],
    [
      'custo mudado',
      new ApiError('validation', 'x', 409, REDEEM_ERROR_CODES.changed),
      'changed',
      false,
    ],
    [
      'teto do dia (429)',
      new ApiError('unknown', 'x', 429, REDEEM_ERROR_CODES.dailyLimit),
      'dailyLimit',
      false,
    ],
    [
      'chave já usada com outro corpo (422)',
      new ApiError('validation', 'x', 422, REDEEM_ERROR_CODES.alreadyRedeemed),
      'alreadyRedeemed',
      false,
    ],
  ])('%s', (_what, error, failure, unknown) => {
    expect(redeemFailure(error)).toBe(failure);
    // Resultado incerto: tentar de novo leva a mesma chave, para não gastar duas vezes.
    expect(outcomeUnknown(error)).toBe(unknown);
  });
});
