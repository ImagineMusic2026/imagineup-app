import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';

import { REDEEM_ERROR_CODES } from '../consts';
import { buildRewardsFixture, rewardsFixture } from '../fixtures';

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('era para dar erro');
}

beforeEach(() => {
  rewardsFixture.reset();
  fixtureWallet.reset();
});

describe('loja de exemplo', () => {
  it('traz as cinco recompensas do protótipo, com os custos dele', () => {
    const { rewards } = buildRewardsFixture(NOW);
    expect(rewards.map(({ id, cost }) => [id, cost])).toEqual([
      ['meet-netto', 10_000],
      ['ingressos', 6_000],
      ['videochamada', 8_500],
      ['camisa', 15_000],
      ['telao', 20_000],
    ]);
  });

  it('o meet & greet é o destaque, com 20 vagas e o São João de Irará do mês seguinte', () => {
    const [meet] = buildRewardsFixture(NOW).rewards;
    expect(meet).toMatchObject({
      featured: true,
      scarcity: true,
      stock: { remaining: 20, total: 20 },
      event: { name: 'São João de Irará', startsAt: new Date(2026, 9, 21, 22, 0).toISOString() },
      imageUrl: null,
      status: 'available',
    });
  });

  it('nenhuma recompensa pede endereço nem é paga: todas custam pontos', () => {
    const { rewards } = buildRewardsFixture(NOW);
    for (const reward of rewards) {
      expect(Number.isInteger(reward.cost)).toBe(true);
      expect(reward.cost).toBeGreaterThan(0);
      expect(JSON.stringify(reward)).not.toMatch(/endereço|R\$/i);
    }
  });

  it('cada chamada devolve objetos novos', () => {
    const first = buildRewardsFixture(NOW);
    first.rewards[0]!.title = 'mudado';
    expect(buildRewardsFixture(NOW).rewards[0]!.title).toBe('Meet & greet com o Netto');
  });
});

describe('resgate nas fixtures', () => {
  it('desconta só o saldo: o nível e a temporada não caem', () => {
    const result = rewardsFixture.redeem('videochamada', 'chave-1', NOW);
    expect(result).toMatchObject({ rewardId: 'videochamada', balance: 3_980, code: 'UP-1001' });
    expect(result.instructions).toMatch(/e-mail da sua conta/);
    expect(fixtureWallet.get()).toEqual({ balance: 3_980, xp: 12_480, seasonPoints: 4_120 });
  });

  it('a mesma chave devolve o mesmo resgate, sem gastar de novo', () => {
    const first = rewardsFixture.redeem('ingressos', 'chave-1', NOW);
    const again = rewardsFixture.redeem('ingressos', 'chave-1', NOW);
    expect(again).toEqual(first);
    expect(fixtureWallet.get().balance).toBe(6_480);
  });

  it('chaves diferentes são resgates diferentes', () => {
    rewardsFixture.redeem('ingressos', 'chave-1', NOW);
    const second = rewardsFixture.redeem('ingressos', 'chave-2', NOW);
    expect(second).toMatchObject({ code: 'UP-1002', balance: 480 });
  });

  it('o resgate volta na loja, com o código e as instruções, do mais novo para o mais antigo', () => {
    const first = rewardsFixture.redeem('ingressos', 'chave-1', NOW);
    const later = new Date(2026, 8, 30, 10, 0);
    const second = rewardsFixture.redeem('ingressos', 'chave-2', later);
    const tickets = buildRewardsFixture(NOW).rewards.find((reward) => reward.id === 'ingressos');
    expect(tickets?.redemptions).toEqual([
      {
        id: second.redemptionId,
        code: 'UP-1002',
        instructions: second.instructions,
        redeemedAt: later.toISOString(),
      },
      {
        id: first.redemptionId,
        code: 'UP-1001',
        instructions: first.instructions,
        redeemedAt: NOW.toISOString(),
      },
    ]);
    // A loja sem resgate não tem nada para mostrar.
    const video = buildRewardsFixture(NOW).rewards.find((reward) => reward.id === 'videochamada');
    expect(video?.redemptions).toEqual([]);
  });

  it('recusa sem saldo com o erro da API e não mexe em nada', () => {
    const error = catchError(() => rewardsFixture.redeem('telao', 'chave-1', NOW));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: REDEEM_ERROR_CODES.insufficientPoints });
    expect(fixtureWallet.get().balance).toBe(12_480);
    // Recusada, a chave não fica presa: com saldo, a mesma chave resgata.
    fixtureWallet.earn(10_000);
    expect(rewardsFixture.redeem('telao', 'chave-1', NOW).balance).toBe(2_480);
  });

  it('baixa o estoque, e a última vaga deixa a recompensa esgotada', () => {
    fixtureWallet.earn(1_000_000);
    rewardsFixture.redeem('meet-netto', 'chave-1', NOW);
    const [afterOne] = buildRewardsFixture(NOW).rewards;
    expect(afterOne).toMatchObject({ stock: { remaining: 19 }, status: 'available' });

    for (let index = 2; index <= 20; index += 1) {
      rewardsFixture.redeem('meet-netto', `chave-${index}`, NOW);
    }
    const [soldOut] = buildRewardsFixture(NOW).rewards;
    expect(soldOut).toMatchObject({ stock: { remaining: 0 }, status: 'soldOut' });

    const error = catchError(() => rewardsFixture.redeem('meet-netto', 'chave-21', NOW));
    expect(error).toMatchObject({ status: 409, code: REDEEM_ERROR_CODES.soldOut });
  });

  it('recompensa que não está na loja dá 404', () => {
    const error = catchError(() => rewardsFixture.redeem('nao-existe', 'chave-1', NOW));
    expect(error).toMatchObject({ kind: 'notFound', code: REDEEM_ERROR_CODES.notFound });
  });

  it('volta ao início', () => {
    rewardsFixture.redeem('ingressos', 'chave-1', NOW);
    rewardsFixture.reset();
    fixtureWallet.reset();
    expect(rewardsFixture.redeem('ingressos', 'chave-1', NOW).code).toBe('UP-1001');
  });
});
