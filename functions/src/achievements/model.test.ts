import { describe, expect, it } from 'vitest';

import { ConfigValidationError } from '../config-validation';
import {
  achievementsView,
  DEFAULT_ACHIEVEMENTS_CONFIG,
  defaultAchievements,
  levelsInUse,
  parseAchievementsConfig,
  unlockAchievements,
  validateAchievementChanges,
  validateAchievementInput,
  type AchievementRecord,
  type FirstAction,
} from './model';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T15:00:00.000Z');
const silent = { error: () => undefined };
const CATALOG = DEFAULT_ACHIEVEMENTS_CONFIG.achievements;

describe('lista provisória (22.6)', () => {
  it('10 ativas: o "Top 20" saiu do rascunho no bloco 8 (23.9)', () => {
    expect(CATALOG.map((item) => [item.id, item.status])).toEqual([
      ['boca-a-boca', 'active'],
      ['fa-de-show', 'active'],
      ['missao-cumprida', 'active'],
      ['puxa-conversa', 'active'],
      ['pe-de-serra', 'active'],
      ['sanfona', 'active'],
      ['purainha', 'active'],
      ['backstage', 'active'],
      ['lenda', 'active'],
      ['top-20', 'active'],
    ]);
  });

  it('conta como publicada: todas com activatedAt, o Top 20 inclusive', () => {
    const list = defaultAchievements(NOW);
    expect(list.every((item) => item.status === 'active' && item.activatedAt === NOW)).toBe(true);
    expect(list.find((item) => item.id === 'top-20')!.rule).toEqual({ type: 'rank', top: 20 });
  });
});

describe('leitura e validação', () => {
  it('documento ausente ou fora do formato vale o padrão do código', () => {
    expect(parseAchievementsConfig(undefined, silent).achievements).toHaveLength(10);
    expect(parseAchievementsConfig({ achievements: 'x' }, silent).version).toBe(0);
  });

  it('a conquista fora do formato sai e as outras ficam', () => {
    const errors: string[] = [];
    const config = parseAchievementsConfig(
      {
        version: 2,
        achievements: [
          { ...CATALOG[0], activatedAt: { toMillis: () => NOW } },
          { ...CATALOG[1], rule: { type: 'level', level: 1 } },
          { ...CATALOG[2], icon: 'Ícone' },
        ],
      },
      { error: (message) => errors.push(message) },
    );
    expect(config.version).toBe(2);
    expect(config.achievements.map((item) => item.id)).toEqual(['boca-a-boca']);
    expect(config.achievements[0]!.activatedAt).toBe(NOW);
    expect(errors).toHaveLength(2);
  });

  it('validação estrita: cada campo com o caminho dele', () => {
    const input = {
      title: 'Dez shows',
      icon: 'ticket',
      tone: 'events',
      rule: { type: 'first', action: 'rsvp' },
    };
    expect(validateAchievementInput(input)).toEqual(input);
    for (const [field, extra] of [
      ['title', { title: '' }],
      ['icon', { icon: 'Ticket' }],
      ['tone', { tone: 'rosa' }],
      ['rule', { rule: { type: 'first', action: 'dance' } }],
      ['rule.level', { rule: { type: 'level', level: 1 } }],
      // A sequência de check-in (seção 40): de 2 a 1.000 dias.
      ['rule.days', { rule: { type: 'streak', days: 1 } }],
    ] as const) {
      let error: unknown;
      try {
        validateAchievementInput({ ...input, ...extra });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).field).toBe(`achievement.${field}`);
    }
    expect(validateAchievementChanges({ title: 'Outro' })).toEqual({ title: 'Outro' });
  });

  it('os níveis pedidos pelas não arquivadas', () => {
    const archived = CATALOG.map((item) =>
      item.id === 'lenda' ? { ...item, status: 'archived' as const } : item,
    );
    expect(levelsInUse(archived).map((item) => item.id)).toEqual([
      'pe-de-serra',
      'sanfona',
      'purainha',
      'backstage',
    ]);
  });
});

describe('desbloqueio', () => {
  const unlock = (
    extra: Partial<{
      owned: Record<string, number>;
      levelBefore: number;
      levelAfter: number;
      firsts: FirstAction[];
      catalog: AchievementRecord[];
      readAt: number | null;
      streakBest: number;
    }> = {},
  ) =>
    unlockAchievements({
      catalog: extra.catalog ?? CATALOG,
      owned: extra.owned ?? {},
      levelBefore: extra.levelBefore ?? 1,
      levelAfter: extra.levelAfter ?? 1,
      firsts: new Set(extra.firsts ?? []),
      streakBest: extra.streakBest ?? 0,
      now: NOW,
      readAt: extra.readAt ?? null,
    });

  it('nível alcançado de uma vez destrava os de baixo, com o anúncio', () => {
    const out = unlock({ levelBefore: 1, levelAfter: 7 });
    expect(out.added.map((item) => item.id)).toEqual(['pe-de-serra', 'sanfona', 'purainha']);
    expect(out.announced).toEqual(out.added);
    expect(out.owned).toEqual({ 'pe-de-serra': NOW, sanfona: NOW, purainha: NOW });
  });

  it.each([
    ['share', 'boca-a-boca'],
    ['rsvp', 'fa-de-show'],
    ['mission', 'missao-cumprida'],
    ['comment', 'puxa-conversa'],
  ] as const)('a primeira vez de %s dá %s', (action, id) => {
    expect(unlock({ firsts: [action] }).added).toEqual([
      { id, title: CATALOG.find((item) => item.id === id)!.title },
    ]);
  });

  it('o que já tem não muda de data', () => {
    const owned = { 'boca-a-boca': NOW - DAY_MS };
    const out = unlock({ owned, firsts: ['share'] });
    expect(out.added).toEqual([]);
    expect(out.owned).toEqual(owned);
  });

  it('a de nível que o XP lido já alcançava entra com a data lida, fora do anúncio', () => {
    const out = unlock({ levelBefore: 8, levelAfter: 8, readAt: NOW - 3 * DAY_MS });
    expect(out.added.map((item) => item.id)).toEqual([
      'pe-de-serra',
      'sanfona',
      'purainha',
      'backstage',
    ]);
    expect(out.announced).toEqual([]);
    expect(out.owned.backstage).toBe(NOW - 3 * DAY_MS);
  });

  it('rank nunca antes do bloco 8; arquivada e rascunho não desbloqueiam', () => {
    const catalog = CATALOG.map((item) =>
      item.id === 'top-20'
        ? { ...item, status: 'active' as const }
        : item.id === 'fa-de-show'
          ? { ...item, status: 'archived' as const }
          : item,
    );
    expect(unlock({ catalog, firsts: ['rsvp'], levelAfter: 1 }).added).toEqual([]);
  });
});

describe('conquista de posição (bloco 8, 23.9)', () => {
  it('a ação nunca desbloqueia o Top 20: só o retrato semanal e a virada', () => {
    const outcome = unlockAchievements({
      catalog: CATALOG,
      owned: {},
      levelBefore: 7,
      levelAfter: 10,
      firsts: new Set<FirstAction>([
        'like',
        'comment',
        'rsvp',
        'join',
        'share',
        'invite',
        'mission',
      ]),
      streakBest: 1_000,
      now: NOW,
      readAt: NOW,
    });
    expect(outcome.added.map((item) => item.id)).not.toContain('top-20');
  });
});

describe('a 1e (achievementsView)', () => {
  it('a Camila do seed: 6 de 10, Boca a boca, Top 20, Purainha e a próxima, Backstage (23.15)', () => {
    const view = achievementsView({
      catalog: CATALOG,
      owned: {
        'missao-cumprida': NOW - 17 * DAY_MS,
        'pe-de-serra': NOW - 8 * DAY_MS,
        sanfona: NOW - 8 * DAY_MS,
        purainha: NOW - 8 * DAY_MS,
        // O retrato da segunda-feira, 0:00 de São Paulo.
        'top-20': NOW - 12 * 60 * 60 * 1000,
        'boca-a-boca': NOW,
      },
      level: 7,
      updatedAt: NOW,
    });
    expect(view.unlockedCount).toBe(6);
    expect(view.totalCount).toBe(10);
    expect(view.highlights.map((item) => [item.id, item.unlockedAt !== null])).toEqual([
      ['boca-a-boca', true],
      ['top-20', true],
      ['purainha', true],
      ['backstage', false],
    ]);
    expect(view.highlights[0]).toEqual({
      id: 'boca-a-boca',
      title: 'Boca a boca',
      icon: 'share',
      tone: 'action',
      unlockedAt: new Date(NOW).toISOString(),
    });
  });

  it('o fã novo: Pé de serra primeiro, depois a ordem do catálogo', () => {
    const view = achievementsView({ catalog: CATALOG, owned: {}, level: 1, updatedAt: null });
    expect(view).toMatchObject({ unlockedCount: 0, totalCount: 10 });
    expect(view.highlights.map((item) => item.id)).toEqual([
      'pe-de-serra',
      'boca-a-boca',
      'fa-de-show',
      'missao-cumprida',
    ]);
  });

  it('a de nível que o nível de agora alcança conta, com a data do updatedAt; a arquivada sai', () => {
    const catalog = CATALOG.map((item) =>
      item.id === 'lenda' ? { ...item, status: 'archived' as const } : item,
    );
    const view = achievementsView({
      catalog,
      owned: { lenda: NOW - DAY_MS },
      level: 8,
      updatedAt: NOW - 2 * DAY_MS,
    });
    expect(view).toMatchObject({ unlockedCount: 4, totalCount: 9 });
    expect(view.highlights.slice(0, 3).map((item) => item.id)).toEqual([
      'backstage',
      'purainha',
      'sanfona',
    ]);
    expect(view.highlights[0]!.unlockedAt).toBe(new Date(NOW - 2 * DAY_MS).toISOString());
  });
});

describe('conquista de sequência de check-in (seção 40)', () => {
  const streak = (days: number, extra: Partial<AchievementRecord> = {}): AchievementRecord => ({
    id: `sequencia-${days}`,
    title: `${days} dias seguidos`,
    icon: 'flame',
    tone: 'action',
    rule: { type: 'streak', days },
    status: 'active',
    activatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  });
  const MILESTONES = [streak(7), streak(30), streak(100), streak(365)];
  const unlock = (
    streakBest: number,
    extra: { catalog?: AchievementRecord[]; owned?: Record<string, number> } = {},
  ) =>
    unlockAchievements({
      catalog: extra.catalog ?? [...CATALOG, ...MILESTONES],
      owned: extra.owned ?? {},
      levelBefore: 1,
      levelAfter: 1,
      firsts: new Set<FirstAction>(),
      streakBest,
      now: NOW,
      // A data lida é mais velha: a de sequência nunca a usa (só a de nível que já valia).
      readAt: NOW - 3 * DAY_MS,
    });

  it('a lista provisória do código não tem conquista de sequência: elas nascem pelo painel', () => {
    expect(CATALOG.some((item) => item.rule.type === 'streak')).toBe(false);
    expect(CATALOG).toHaveLength(10);
  });

  it.each([
    [{ type: 'streak', days: 2 }, true],
    [{ type: 'streak', days: 365 }, true],
    [{ type: 'streak', days: 1_000 }, true],
    [{ type: 'streak', days: 1 }, false],
    [{ type: 'streak', days: 0 }, false],
    [{ type: 'streak', days: 1_001 }, false],
    [{ type: 'streak', days: 7.5 }, false],
    [{ type: 'streak', days: '7' }, false],
    [{ type: 'streak' }, false],
    [{ type: 'streak', days: 7, level: 3 }, false],
  ])('a leitura do catálogo com a regra %j: fica? %s', (rule, kept) => {
    const errors: string[] = [];
    const config = parseAchievementsConfig(
      { version: 3, achievements: [{ ...streak(7), rule }, CATALOG[0]] },
      { error: (message) => errors.push(message) },
    );
    expect(config.achievements.map((item) => item.id)).toEqual(
      kept ? ['sequencia-7', 'boca-a-boca'] : ['boca-a-boca'],
    );
    expect(errors).toHaveLength(kept ? 0 : 1);
    if (kept) expect(config.achievements[0]!.rule).toEqual(rule);
  });

  it('a validação estrita aceita de 2 a 1.000 dias e recusa o resto em achievement.rule.days', () => {
    const input = {
      title: '30 dias seguidos',
      icon: 'flame',
      tone: 'action',
      rule: { type: 'streak', days: 30 },
    };
    expect(validateAchievementInput(input)).toEqual(input);
    expect(validateAchievementChanges({ rule: { type: 'streak', days: 2 } })).toEqual({
      rule: { type: 'streak', days: 2 },
    });
    for (const rule of [
      { type: 'streak', days: 1 },
      { type: 'streak', days: 1_001 },
      { type: 'streak', days: 2.5 },
      { type: 'streak' },
      { type: 'streak', days: 7, top: 20 },
    ]) {
      let error: unknown;
      try {
        validateAchievementInput({ ...input, rule });
      } catch (caught) {
        error = caught;
      }
      expect(error, JSON.stringify(rule)).toBeInstanceOf(ConfigValidationError);
      expect((error as ConfigValidationError).field).toBe('achievement.rule.days');
    }
  });

  it.each([
    [0, []],
    [6, []],
    [7, ['sequencia-7']],
    [29, ['sequencia-7']],
    [30, ['sequencia-7', 'sequencia-30']],
    [120, ['sequencia-7', 'sequencia-30', 'sequencia-100']],
    [365, ['sequencia-7', 'sequencia-30', 'sequencia-100', 'sequencia-365']],
  ])('a melhor sequência de %i dias destrava %j', (best, ids) => {
    const out = unlock(best);
    expect(out.added.map((item) => item.id)).toEqual(ids);
    // Sempre com o anúncio e a data de agora, também o marco que já valia antes.
    expect(out.announced).toEqual(out.added);
    expect(Object.values(out.owned).every((at) => at === NOW)).toBe(true);
  });

  it('a que o fã já tem não muda de data, e a seguinte entra', () => {
    const owned = { 'sequencia-7': NOW - 10 * DAY_MS };
    const out = unlock(30, { owned });
    expect(out.added).toEqual([{ id: 'sequencia-30', title: '30 dias seguidos' }]);
    expect(out.owned).toEqual({ 'sequencia-7': NOW - 10 * DAY_MS, 'sequencia-30': NOW });
  });

  it('rascunho e arquivada não desbloqueiam', () => {
    const catalog = [
      streak(7, { status: 'draft', activatedAt: null }),
      streak(30, { status: 'archived' }),
    ];
    expect(unlock(400, { catalog }).added).toEqual([]);
  });

  it('na 1e, a de sequência conta no "de N" e fica bloqueada até entrar na carteira', () => {
    const catalog = [...CATALOG, ...MILESTONES];
    const locked = achievementsView({ catalog, owned: {}, level: 1, updatedAt: null });
    expect(locked).toMatchObject({ unlockedCount: 0, totalCount: 14 });
    const view = achievementsView({
      catalog,
      owned: { 'sequencia-7': NOW },
      level: 1,
      updatedAt: NOW,
    });
    expect(view).toMatchObject({ unlockedCount: 1, totalCount: 14 });
    expect(view.highlights[0]).toEqual({
      id: 'sequencia-7',
      title: '7 dias seguidos',
      icon: 'flame',
      tone: 'action',
      unlockedAt: new Date(NOW).toISOString(),
    });
  });
});
