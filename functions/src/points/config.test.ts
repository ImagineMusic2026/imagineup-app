import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import {
  buildLoadedConfig,
  ConfigValidationError,
  createConfigSource,
  DEFAULT_POINTS_CONFIG,
  parsePointsConfig,
  parseSeasonConfig,
  staticConfigSource,
  validatePointsConfigInput,
  validateSeasonInput,
} from './config';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T15:00:00.000Z');

function spyLog() {
  return { warn: vi.fn(), error: vi.fn() };
}

/** O campo da recusa estrita. */
function fieldOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigValidationError) return error.field;
    throw error;
  }
  return undefined;
}

describe('leitura de config/points', () => {
  it('sem documento vale o padrão do código, versão 0, com a régua das fixtures do app', () => {
    const config = parsePointsConfig(undefined, spyLog());
    expect(config).toEqual(DEFAULT_POINTS_CONFIG);
    expect(config.version).toBe(0);
    expect(config.levels[6]).toEqual({ number: 7, name: 'Purainha', minXp: 7_000 });
  });

  it('o que o painel mudou vale, e o resto fica no padrão', () => {
    const config = parsePointsConfig(
      { version: 3, values: { like: 1 }, dailyLimits: { comment: 5, rsvp: null } },
      spyLog(),
    );
    expect(config.version).toBe(3);
    expect(config.values).toEqual({ ...DEFAULT_POINTS_CONFIG.values, like: 1 });
    expect(config.dailyLimits).toEqual({
      ...DEFAULT_POINTS_CONFIG.dailyLimits,
      comment: 5,
      rsvp: null,
    });
  });

  it('origem nova no código (ausente no documento) entra com o padrão e não derruba as outras', () => {
    // Documento gravado antes de o código conhecer invite_signup.
    const config = parsePointsConfig(
      { version: 1, values: { like: 1, comment: 3, rsvp: 1, central_join: 5, invite_visit: 1 } },
      spyLog(),
    );
    expect(config.values).toMatchObject({ like: 1, comment: 3, invite_signup: 10 });
    expect(Object.values(config.values).every(Number.isInteger)).toBe(true);
  });

  it('origem desconhecida é ignorada, com aviso', () => {
    const log = spyLog();
    const config = parsePointsConfig({ version: 1, values: { share: 9, like: 2 } }, log);
    expect(config.values).not.toHaveProperty('share');
    expect(config.values.like).toBe(2);
    expect(log.warn).toHaveBeenCalledWith(expect.any(String), { source: 'share' });
    expect(log.error).not.toHaveBeenCalled();
  });

  it('valor ou limite inválido volta ao padrão só nele, com erro no log', () => {
    const log = spyLog();
    const config = parsePointsConfig(
      {
        version: 2,
        values: { like: -1, comment: 2.5, rsvp: 3, central_join: 99_999 },
        dailyLimits: { like: 0, comment: 'muito', rsvp: 4 },
      },
      log,
    );
    expect(config.values).toEqual({ ...DEFAULT_POINTS_CONFIG.values, rsvp: 3 });
    expect(config.dailyLimits).toEqual({ ...DEFAULT_POINTS_CONFIG.dailyLimits, rsvp: 4 });
    expect(log.error).toHaveBeenCalledTimes(5);
  });

  it('régua inválida volta inteira ao padrão', () => {
    const log = spyLog();
    const config = parsePointsConfig(
      {
        version: 2,
        levels: [
          { number: 1, name: 'A', minXp: 0 },
          { number: 2, name: 'B', minXp: 0 },
        ],
      },
      log,
    );
    expect(config.levels).toEqual(DEFAULT_POINTS_CONFIG.levels);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('régua válida do painel vale inteira', () => {
    const levels = [
      { number: 1, name: 'Chegando', minXp: 0 },
      { number: 2, name: 'Fã', minXp: 100 },
    ];
    expect(parsePointsConfig({ version: 4, levels }, spyLog()).levels).toEqual(levels);
  });
});

describe('leitura de config/season', () => {
  const season = {
    id: 'temporada-sao-joao',
    name: 'São João',
    startsAt: Timestamp.fromMillis(NOW - 18 * DAY_MS),
    endsAt: Timestamp.fromMillis(NOW + 12 * DAY_MS),
    leaderTitle: null,
  };

  const empty = { next: null, lastClosed: null };

  it('sem documento ou com season null, não há temporada', () => {
    expect(parseSeasonConfig(undefined, spyLog())).toEqual({ version: 0, season: null, ...empty });
    expect(parseSeasonConfig({ version: 2, season: null }, spyLog())).toEqual({
      version: 2,
      season: null,
      ...empty,
    });
  });

  it('a temporada vem com as datas em ms, o top 10 padrão e sem encerramento antes da hora', () => {
    expect(parseSeasonConfig({ version: 1, season }, spyLog())).toEqual({
      version: 1,
      season: {
        id: 'temporada-sao-joao',
        name: 'São João',
        startsAt: NOW - 18 * DAY_MS,
        endsAt: NOW + 12 * DAY_MS,
        leaderTitle: null,
        topTarget: 10,
        endedEarly: null,
      },
      ...empty,
    });
  });

  it('a próxima, a última fechada, o topTarget e o endedEarly (bloco 8, 23.3)', () => {
    const next = {
      ...season,
      id: 'temporada-verao',
      startsAt: Timestamp.fromMillis(NOW + 20 * DAY_MS),
      endsAt: Timestamp.fromMillis(NOW + 50 * DAY_MS),
      topTarget: 5,
    };
    const lastClosed = {
      ...season,
      id: 'temporada-carnaval',
      startsAt: Timestamp.fromMillis(NOW - 70 * DAY_MS),
      endsAt: Timestamp.fromMillis(NOW - 40 * DAY_MS),
      closedAt: Timestamp.fromMillis(NOW - 40 * DAY_MS + 120_000),
    };
    const endedEarly = {
      plannedEndsAt: Timestamp.fromMillis(NOW + 12 * DAY_MS),
      at: Timestamp.fromMillis(NOW),
      by: { uid: 'admin', name: 'Admin' },
    };
    const config = parseSeasonConfig(
      {
        version: 3,
        season: { ...season, endsAt: Timestamp.fromMillis(NOW), endedEarly },
        next,
        lastClosed,
      },
      spyLog(),
    );
    expect(config.season).toMatchObject({
      endsAt: NOW,
      endedEarly: {
        plannedEndsAt: NOW + 12 * DAY_MS,
        at: NOW,
        by: { uid: 'admin', name: 'Admin' },
      },
    });
    expect(config.next).toMatchObject({ id: 'temporada-verao', topTarget: 5, endedEarly: null });
    expect(config.lastClosed).toMatchObject({
      id: 'temporada-carnaval',
      closedAt: NOW - 40 * DAY_MS + 120_000,
    });
  });

  it('próxima e última fechada fora do formato viram null sem derrubar a atual; topTarget e endedEarly inválidos valem o padrão', () => {
    const log = spyLog();
    const config = parseSeasonConfig(
      {
        version: 3,
        season: { ...season, topTarget: 99, endedEarly: { at: 'ontem' } },
        next: { ...season, id: 'Com Espaço' },
        lastClosed: { ...season, id: 'temporada-carnaval' },
      },
      log,
    );
    expect(config.season).toMatchObject({
      id: 'temporada-sao-joao',
      topTarget: 10,
      endedEarly: null,
    });
    expect(config.next).toBeNull();
    // A última fechada sem o closedAt também vira null.
    expect(config.lastClosed).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('temporada inválida vira sem temporada, com erro no log', () => {
    const log = spyLog();
    expect(
      parseSeasonConfig({ version: 1, season: { ...season, id: 'Com Espaço' } }, log).season,
    ).toBeNull();
    expect(
      parseSeasonConfig({ version: 1, season: { ...season, endsAt: season.startsAt } }, log).season,
    ).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(2);
  });
});

describe('gravação estrita (callable do painel)', () => {
  it('aceita valores, limites e régua válidos', () => {
    expect(
      validatePointsConfigInput({
        values: { like: 1, invite_signup: 10_000 },
        dailyLimits: { mission: null, comment: 1_000 },
        levels: [
          { number: 1, name: 'Primeiro passo', minXp: 0 },
          { number: 2, name: 'Na roda', minXp: 600 },
        ],
      }),
    ).toEqual({
      values: { like: 1, invite_signup: 10_000 },
      dailyLimits: { mission: null, comment: 1_000 },
      levels: [
        { number: 1, name: 'Primeiro passo', minXp: 0 },
        { number: 2, name: 'Na roda', minXp: 600 },
      ],
    });
  });

  it.each([
    [{ values: { share: 1 } }, 'values.share'],
    [{ values: { mission: 10 } }, 'values.mission'],
    [{ values: { like: 10_001 } }, 'values.like'],
    [{ values: { like: 1.5 } }, 'values.like'],
    [{ dailyLimits: { like: 0 } }, 'dailyLimits.like'],
    [{ dailyLimits: { comment: 1_001 } }, 'dailyLimits.comment'],
    [{ levels: [{ number: 1, name: 'Só um', minXp: 0 }] }, 'levels'],
    [
      {
        levels: [
          { number: 1, name: 'A', minXp: 10 },
          { number: 2, name: 'B', minXp: 20 },
        ],
      },
      'levels',
    ],
    [
      {
        levels: [
          { number: 1, name: 'A', minXp: 0 },
          { number: 3, name: 'B', minXp: 20 },
        ],
      },
      'levels',
    ],
    [
      {
        levels: [
          { number: 1, name: ' A', minXp: 0 },
          { number: 2, name: 'B', minXp: 20 },
        ],
      },
      'levels',
    ],
    [
      {
        levels: [
          { number: 1, name: 'A', minXp: 0 },
          { number: 2, name: 'x'.repeat(41), minXp: 20 },
        ],
      },
      'levels',
    ],
    [{ outro: 1 }, 'outro'],
  ])('recusa %j em %s', (input, field) => {
    expect(fieldOf(() => validatePointsConfigInput(input))).toBe(field);
  });

  it('régua com 51 degraus é recusada', () => {
    const levels = Array.from({ length: 51 }, (_, index) => ({
      number: index + 1,
      name: `Nível ${index + 1}`,
      minXp: index * 100,
    }));
    expect(fieldOf(() => validatePointsConfigInput({ levels }))).toBe('levels');
    expect(
      fieldOf(() => validatePointsConfigInput({ levels: levels.slice(0, 50) })),
    ).toBeUndefined();
  });

  const season = {
    id: 'temporada-sao-joao',
    name: 'São João',
    startsAt: NOW,
    endsAt: NOW + 30 * DAY_MS,
    leaderTitle: 'Rainha do São João',
  };

  it('temporada válida passa', () => {
    expect(validateSeasonInput(season)).toEqual(season);
    expect(validateSeasonInput({ ...season, leaderTitle: null }).leaderTitle).toBeNull();
  });

  it.each([
    [{ id: 'SJ' }, 'season.id'],
    [{ name: '' }, 'season.name'],
    [{ leaderTitle: 'x'.repeat(41) }, 'season.leaderTitle'],
    [{ endsAt: NOW }, 'season.endsAt'],
    [{ endsAt: NOW + 367 * DAY_MS }, 'season.endsAt'],
    [{ topTarget: 0 }, 'season.topTarget'],
    [{ topTarget: 51 }, 'season.topTarget'],
    [{ topTarget: 2.5 }, 'season.topTarget'],
  ])('recusa a temporada com %j', (change, field) => {
    expect(fieldOf(() => validateSeasonInput({ ...season, ...change }))).toBe(field);
  });

  it('o topTarget é opcional, de 1 a 50; a próxima recusa com o campo next (bloco 8)', () => {
    expect(validateSeasonInput({ ...season, topTarget: 50 }).topTarget).toBe(50);
    expect('topTarget' in validateSeasonInput(season)).toBe(false);
    expect(fieldOf(() => validateSeasonInput({ ...season, id: 'SJ' }, 'next'))).toBe('next.id');
  });
});

describe('cache da configuração', () => {
  function fakeDb(responses: (() => Promise<unknown[]>)[]) {
    const getAll = vi.fn(() => responses.shift()!());
    const doc = (id: string) => ({ id });
    const db = { getAll, collection: () => ({ doc }) } as unknown as Firestore;
    return { db, getAll };
  }

  const snap = (data: unknown) => ({ data: () => data });

  it('lê os dois documentos juntos e guarda por 60 s', async () => {
    let clock = NOW;
    const { db, getAll } = fakeDb([
      () => Promise.resolve([snap({ version: 1, values: { like: 1 } }), snap(undefined)]),
      () => Promise.resolve([snap({ version: 2, values: { like: 5 } }), snap(undefined)]),
    ]);
    const source = createConfigSource(db, { now: () => clock, log: spyLog() });
    expect((await source.get()).points.values.like).toBe(1);
    clock += 59_999;
    expect((await source.get()).points.values.like).toBe(1);
    expect(getAll).toHaveBeenCalledOnce();
    clock += 1;
    expect((await source.get()).points.values.like).toBe(5);
    expect(getAll).toHaveBeenCalledTimes(2);
  });

  it('leitura que falha não fica no cache', async () => {
    const { db, getAll } = fakeDb([
      () => Promise.reject(new Error('fora do ar')),
      () => Promise.resolve([snap(undefined), snap(undefined)]),
    ]);
    const source = createConfigSource(db, { now: () => NOW, log: spyLog() });
    await expect(source.get()).rejects.toThrow('fora do ar');
    await expect(source.get()).resolves.toMatchObject({ points: { version: 0 } });
    expect(getAll).toHaveBeenCalledTimes(2);
  });
});

// --- Bloco 7: tetos do dia, limite da missão e o jogo na mesma carga (22.3) ---------

describe('tetos do dia e o limite da missão (bloco 7)', () => {
  it('o padrão dos tetos é o das constantes de hoje', () => {
    expect(DEFAULT_POINTS_CONFIG.actionCaps).toEqual({
      central_entry: 30,
      invite_visit_sent: 20,
      invite_link: 30,
      like_set: 300,
      comment_sent: 100,
      rsvp_set: 50,
      comment_report: 30,
      fan_block: 30,
    });
  });

  it('leitura tolerante: teto desconhecido ignorado, inválido volta ao padrão só nele', () => {
    const log = spyLog();
    const config = parsePointsConfig(
      { version: 2, actionCaps: { like_set: 10, comment_sent: 0, outro: 5 } },
      log,
    );
    expect(config.actionCaps.like_set).toBe(10);
    expect(config.actionCaps.comment_sent).toBe(100);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('o limite diário da missão é sempre null na leitura', () => {
    const log = spyLog();
    expect(
      parsePointsConfig({ version: 1, dailyLimits: { mission: 5 } }, log).dailyLimits.mission,
    ).toBeNull();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('validação estrita: tetos de 1 a 10.000 e só chaves conhecidas; a missão só aceita null', () => {
    expect(validatePointsConfigInput({ actionCaps: { like_set: 500 } })).toEqual({
      actionCaps: { like_set: 500 },
    });
    expect(fieldOf(() => validatePointsConfigInput({ actionCaps: { like_set: 0 } }))).toBe(
      'actionCaps.like_set',
    );
    expect(fieldOf(() => validatePointsConfigInput({ actionCaps: { outro: 1 } }))).toBe(
      'actionCaps.outro',
    );
    expect(fieldOf(() => validatePointsConfigInput({ dailyLimits: { mission: 10 } }))).toBe(
      'dailyLimits.mission',
    );
  });
});

describe('a carga com o jogo (bloco 7)', () => {
  const doc = (id: string) => ({ id });
  const snap = (data: unknown) => ({ data: () => data });

  it('lê os quatro documentos num getAll só e monta o índice das missões', async () => {
    const getAll = vi.fn((...refs: { id: string }[]) => {
      expect(refs.map((ref) => ref.id)).toEqual(['points', 'season', 'missions', 'achievements']);
      return Promise.resolve([
        snap(undefined),
        snap(undefined),
        snap({
          version: 4,
          missions: [
            {
              id: 'm-curtir-nenho',
              title: 'Curta 5 posts do Nenho',
              action: 'like',
              target: { postId: null, artistId: 'nenho', eventId: null },
              goal: 5,
              period: 'daily',
              rewardPoints: 10,
              featured: false,
              startsAt: Timestamp.fromMillis(NOW),
              endsAt: null,
              status: 'active',
              activatedAt: Timestamp.fromMillis(NOW),
            },
          ],
          seasonGoal: null,
        }),
        snap(undefined),
      ]);
    });
    const db = { getAll, collection: () => ({ doc }) } as unknown as Firestore;
    const loaded = await createConfigSource(db, { now: () => NOW, log: spyLog() }).get();
    expect(getAll).toHaveBeenCalledOnce();
    expect(loaded.missions.version).toBe(4);
    expect(loaded.game.missions.byAction.get('like')!.map((item) => item.id)).toEqual([
      'm-curtir-nenho',
    ]);
    expect(loaded.achievements.version).toBe(0);
    expect(loaded.game.achievements).toHaveLength(10);
  });

  it('a fonte fixa monta o jogo do que vier, e o padrão sem nada', async () => {
    const loaded = await staticConfigSource().get();
    expect(loaded.game.missions.byAction.size).toBe(0);
    expect(loaded.game.seasonGoal).toBeNull();
    expect(buildLoadedConfig().achievements.achievements).toHaveLength(10);
  });
});
