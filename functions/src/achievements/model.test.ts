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
    }> = {},
  ) =>
    unlockAchievements({
      catalog: extra.catalog ?? CATALOG,
      owned: extra.owned ?? {},
      levelBefore: extra.levelBefore ?? 1,
      levelAfter: extra.levelAfter ?? 1,
      firsts: new Set(extra.firsts ?? []),
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
