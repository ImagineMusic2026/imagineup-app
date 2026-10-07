import { fixtureWallet } from '@/services/fixtures';

import {
  buildLedgerPageFixture,
  buildMyAchievementsFixture,
  buildMyProgressFixture,
  buildWalletFixture,
  FIXTURE_LEVELS,
  LEDGER_PAGE_SIZE,
  levelForXp,
} from '../fixtures';

// Terça, 29 de setembro de 2026, 20 h: as datas das conquistas saem daqui.
const NOW = new Date(2026, 8, 29, 20, 0);

beforeEach(() => fixtureWallet.reset());

describe('régua de níveis de exemplo', () => {
  it('os 12.480 de XP da Camila ficam no nível 7, Purainha, a caminho do 8, Xodó', () => {
    expect(levelForXp(12_480)).toEqual({
      level: { number: 7, name: 'Purainha', minXp: 7_000 },
      nextLevel: { number: 8, name: 'Xodó', minXp: 15_000 },
    });
  });

  it('o degrau começa no mínimo dele', () => {
    expect(levelForXp(14_999).level.number).toBe(7);
    expect(levelForXp(15_000).level.number).toBe(8);
    expect(levelForXp(0).level.number).toBe(1);
  });

  it('no último degrau não há próximo', () => {
    const last = FIXTURE_LEVELS[FIXTURE_LEVELS.length - 1];
    expect(levelForXp(1_000_000)).toEqual({ level: last, nextLevel: null });
  });

  it('a régua sobe sempre, sem degrau repetido', () => {
    FIXTURE_LEVELS.forEach((level, index) => {
      expect(level.number).toBe(index + 1);
      if (index > 0) expect(level.minXp).toBeGreaterThan(FIXTURE_LEVELS[index - 1]!.minXp);
    });
  });
});

describe('progresso de exemplo', () => {
  it('começa com os números do protótipo', () => {
    expect(buildMyProgressFixture()).toEqual({
      xp: 12_480,
      level: { number: 7, name: 'Purainha', minXp: 7_000 },
      nextLevel: { number: 8, name: 'Xodó', minXp: 15_000 },
      weekEarned: 840,
      stats: { linksCreated: 63, peopleBrought: 418, seasons: 3 },
    });
  });

  it('o XP e a semana acompanham o que o fã ganha na carteira', () => {
    fixtureWallet.earn(15);
    expect(buildMyProgressFixture()).toMatchObject({ xp: 12_495, weekEarned: 855 });
  });

  it('o resgate só desconta o saldo: nível, XP e semana ficam', () => {
    fixtureWallet.spend(6_000);
    expect(buildWalletFixture()).toMatchObject({ balance: 6_480, xp: 12_480 });
    expect(buildMyProgressFixture()).toMatchObject({
      xp: 12_480,
      level: { number: 7 },
      weekEarned: 840,
    });
  });

  it('ganhar o bastante sobe o nível, como o servidor faria', () => {
    fixtureWallet.earn(2_520);
    expect(buildMyProgressFixture()).toMatchObject({
      xp: 15_000,
      level: { number: 8, name: 'Xodó' },
      nextLevel: { number: 9 },
    });
  });
});

describe('conquistas de exemplo', () => {
  it('14 de 32, com as três últimas conquistadas e a próxima bloqueada', () => {
    const achievements = buildMyAchievementsFixture(NOW);
    expect(achievements.unlockedCount).toBe(14);
    expect(achievements.totalCount).toBe(32);
    expect(
      achievements.highlights.map(({ title, tone, unlockedAt }) => [title, tone, !!unlockedAt]),
    ).toEqual([
      ['Boca a boca', 'action', true],
      ['Top 20', 'points', true],
      // No lugar do "DJ da vez", que era de playlist (fora do contrato).
      ['Fã de show', 'events', true],
      ['Backstage', 'points', false],
    ]);
  });

  it('as datas são relativas ao relógio das fixtures e ficam no passado', () => {
    const { highlights } = buildMyAchievementsFixture(NOW);
    for (const { unlockedAt } of highlights) {
      if (unlockedAt) expect(new Date(unlockedAt).getTime()).toBeLessThan(NOW.getTime());
    }
    expect(highlights[0]?.unlockedAt).toBe(new Date(2026, 8, 27, 20, 0).toISOString());
  });
});

describe('extrato de exemplo, igual ao seed da Camila', () => {
  const all = () => {
    const first = buildLedgerPageFixture(NOW, null);
    const second = buildLedgerPageFixture(NOW, first.nextCursor);
    return { first, second, items: [...first.items, ...second.items] };
  };

  it('os 23 lançamentos em duas páginas de 20, do mais novo ao mais antigo', () => {
    const { first, second, items } = all();
    expect(first.items).toHaveLength(LEDGER_PAGE_SIZE);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(items).toHaveLength(23);
    const times = items.map((item) => Date.parse(item.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('os 6 da loja (bloco 10, 25.13): só o saldo, às 18 h, com a recompensa no título', () => {
    const shop = all().items.filter(
      (item) =>
        item.source === 'redeem' ||
        item.source === 'redeem_refund' ||
        item.id === 'seed:camila-loja',
    );
    expect(shop.map((item) => [item.id, item.kind, item.points, item.subjectTitle])).toEqual([
      ['redeem:UP-C3NWPB', 'spend', -15_000, 'Camisa oficial'],
      ['redeem:UP-7QXH2R', 'spend', -3_000, 'Passagem de som'],
      ['redeem_refund:UP-9FJT6V', 'refund', 8_500, 'Videochamada'],
      ['redeem:UP-9FJT6V', 'spend', -8_500, 'Videochamada'],
      ['redeem:UP-4KD9TM', 'spend', -6_000, 'Par de ingressos'],
      ['seed:camila-loja', 'adjust', 24_000, null],
    ]);
    for (const item of shop) {
      expect(item).toMatchObject({ xpDelta: 0, seasonDelta: 0, artistId: null });
      expect(new Date(item.createdAt).getHours()).toBe(18);
    }
    expect(shop[0]!.subject).toEqual({ type: 'reward', id: 'camisa' });
    // O que a loja gasta e devolve fecha com o ajuste: o saldo fica o do protótipo.
    expect(shop.reduce((sum, item) => sum + item.points, 0)).toBe(0);
  });
});
