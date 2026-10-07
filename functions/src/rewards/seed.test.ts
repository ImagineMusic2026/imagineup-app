import { describe, expect, it } from 'vitest';

import { REDEMPTION_CODE_PATTERN } from './model';
import { eveningDaysAgo, SEED_REDEMPTIONS, SEED_REWARDS, SEED_SHOP_ADJUSTMENT } from './seed';

// A loja do seed contra a tabela de docs/arquitetura-api.md, 25.13: a mesma
// tabela de src/domains/rewards/__tests__/fixtures.test.ts, no app. Mudou um
// lado, mude o outro e a tabela da nota.

describe('catálogo do seed (25.13)', () => {
  it('as 6 no ar na ordem do painel, com custo, estoque, limite, show, destaque e escassez, e o rascunho', () => {
    expect(
      SEED_REWARDS.map((item) => [
        item.id,
        item.kind,
        item.cost,
        item.stockTotal,
        item.perFanLimit,
        item.eventId,
        item.featured,
        item.scarcity,
        item.status,
      ]),
    ).toEqual([
      ['meet-netto', 'meet', 10_000, 20, 1, 'sao-joao-irara', true, true, 'published'],
      ['ingressos', 'ticket', 6_000, null, 2, null, false, false, 'published'],
      ['videochamada', 'videocall', 8_500, null, 1, null, false, false, 'published'],
      ['camisa', 'merch', 15_000, null, null, null, false, false, 'published'],
      ['telao', 'screen', 20_000, null, 1, null, false, false, 'published'],
      ['passagem-de-som', 'ticket', 3_000, 1, 1, 'arrocha-na-praia', false, false, 'published'],
      ['recompensa-rascunho', 'merch', 30_000, null, 1, null, false, false, 'draft'],
    ]);
  });
});

describe('pedidos da Camila no seed (25.13)', () => {
  it('os 4 pedidos, com os códigos, os pontos, os dias e as transições', () => {
    expect(
      SEED_REDEMPTIONS.map((item) => [
        item.code,
        item.rewardId,
        item.points,
        item.daysAgo,
        item.then.map((step) => `${step.from}>${step.to}@${step.daysAgo}`),
      ]),
    ).toEqual([
      ['UP-4KD9TM', 'ingressos', 6_000, 7, ['requested>approved@6', 'approved>delivered@5']],
      ['UP-9FJT6V', 'videochamada', 8_500, 6, ['requested>refused@5']],
      ['UP-7QXH2R', 'passagem-de-som', 3_000, 4, ['requested>approved@3']],
      ['UP-C3NWPB', 'camisa', 15_000, 2, []],
    ]);
    for (const item of SEED_REDEMPTIONS) expect(item.code).toMatch(REDEMPTION_CODE_PATTERN);
    expect(SEED_REDEMPTIONS[1]!.then[0]!.reason).toBe(
      'A agenda de videochamadas deste mês fechou antes do seu pedido.',
    );
  });

  it('o ajuste paga o que os pedidos gastam no fim (a videochamada volta): a carteira fica a de sempre', () => {
    const spent = SEED_REDEMPTIONS.filter(
      (item) => !item.then.some((step) => step.to === 'refused'),
    ).reduce((sum, item) => sum + item.points, 0);
    expect(SEED_SHOP_ADJUSTMENT).toEqual({ eventId: 'camila-loja', balance: spent, daysAgo: 8 });
  });

  it('às 18:00 de São Paulo (21:00 UTC) de cada dia, longe do meio-dia das missões', () => {
    const now = Date.parse('2026-10-07T15:00:00.000Z');
    expect(new Date(eveningDaysAgo(now, 7)).toISOString()).toBe('2026-09-30T21:00:00.000Z');
    // Perto da meia-noite de São Paulo (02:30 UTC é 23:30 do dia anterior), o dia é o de lá.
    const lateNight = Date.parse('2026-10-08T02:30:00.000Z');
    expect(new Date(eveningDaysAgo(lateNight, 0)).toISOString()).toBe('2026-10-07T21:00:00.000Z');
  });
});
