import { api } from '@/services/api';
import { setFixtureNow } from '@/services/fixtures';

import { doCheckin, fetchCheckin, toCheckinResult, toCheckinState } from '../api';
import { checkinFixture } from '../fixtures';
import type { CheckinState } from '../types';

// O api.ts importa o axios do app, que puxa o Firebase (ESM no Jest).
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
/** Meio-dia de São Paulo de 10 de novembro de 2026. */
const NOW = new Date('2026-11-10T15:00:00.000Z');
const RESETS_AT = '2026-11-11T03:00:00.000Z';

/** A resposta do servidor com a chave ligada: 4 dias seguidos, o de hoje por fazer. */
const PENDING: CheckinState = {
  enabled: true,
  checkedInToday: false,
  streak: 4,
  best: 9,
  cycle: [3, 3, 4, 4, 5, 6, 15],
  cycleDay: 5,
  todayPoints: 5,
  resetsAt: RESETS_AT,
};

/** A resposta com a chave desligada: tudo em 0 e o ciclo vazio. */
const OFF: CheckinState = {
  enabled: false,
  checkedInToday: false,
  streak: 0,
  best: 0,
  cycle: [],
  cycleDay: 0,
  todayPoints: 0,
  resetsAt: RESETS_AT,
};

beforeEach(() => {
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  get.mockReset();
  post.mockReset();
});

afterEach(() => {
  checkinFixture.reset();
  setFixtureNow(null);
});

describe('check-in diário do servidor', () => {
  it('com a API, o estado vem de GET /me/checkin', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    await expect(fetchCheckin()).resolves.toEqual(PENDING);
    expect(get).toHaveBeenCalledWith('/me/checkin');
  });

  it('com a chave desligada, o servidor responde enabled false e o estado segue desligado', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: OFF });
    await expect(fetchCheckin()).resolves.toEqual(OFF);
  });

  it('o toque é um POST /me/checkin sem corpo, com a chave de idempotência', async () => {
    mockDataSource = 'api';
    const done = { ...PENDING, checkedInToday: true, streak: 5 };
    const body = {
      pointsAwarded: 5,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [{ id: 'streak-7', title: '7 dias seguidos' }],
      missionsChanged: false,
      checkin: done,
    };
    post.mockResolvedValue({ data: body });

    await expect(doCheckin({ idempotencyKey: 'checkin-abc' })).resolves.toEqual(body);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/me/checkin', null, {
      headers: { 'Idempotency-Key': 'checkin-abc' },
    });
  });

  it('nas fixtures, com o exemplo ligado, o estado e o toque não chamam a API', async () => {
    // O exemplo nasce desligado: o teste liga, e o `afterEach` volta ao padrão.
    checkinFixture.setEnabled(true);
    await expect(fetchCheckin()).resolves.toMatchObject({ enabled: true, streak: 4 });
    await expect(doCheckin({ idempotencyKey: 'checkin-abc' })).resolves.toMatchObject({
      pointsAwarded: 5,
      checkin: { checkedInToday: true, streak: 5 },
    });
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('nas fixtures, por padrão, o check-in vem desligado como no servidor, sem chamar a API', async () => {
    await expect(fetchCheckin()).resolves.toMatchObject({ enabled: false, streak: 0, cycle: [] });
    await expect(doCheckin({ idempotencyKey: 'checkin-abc' })).rejects.toMatchObject({
      status: 409,
      code: 'checkin_disabled',
    });
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});

// A conferência da resposta: o card só aparece com a chave ligada e o ciclo.
describe('a resposta conferida (toCheckinState)', () => {
  it.each<[string, unknown]>([
    ['nada', undefined],
    ['null', null],
    ['um texto', 'ok'],
    ['uma lista', [PENDING]],
    ['o corpo de outra rota (as missões)', { season: null, missions: [] }],
    ['enabled que não é true', { ...PENDING, enabled: 'true' }],
    ['sem o ciclo', { ...PENDING, cycle: undefined }],
    ['o ciclo vazio', { ...PENDING, cycle: [] }],
    ['o ciclo que não é lista', { ...PENDING, cycle: { 0: 3 } }],
    ['o ciclo com texto', { ...PENDING, cycle: [3, '3', 4] }],
    ['o ciclo com valor negativo', { ...PENDING, cycle: [3, -1, 4, 4, 5, 6, 15] }],
    ['o ciclo com valor quebrado', { ...PENDING, cycle: [3, 3.5, 4, 4, 5, 6, 15] }],
    ['o dia do ciclo em 0', { ...PENDING, cycleDay: 0 }],
    ['o dia do ciclo depois do fim', { ...PENDING, cycleDay: 8 }],
    ['o dia do ciclo que não é número', { ...PENDING, cycleDay: '5' }],
    ['sem o resetsAt', { ...PENDING, resetsAt: undefined }],
    ['o resetsAt que não é data', { ...PENDING, resetsAt: 'amanhã' }],
  ])('%s vira a chave desligada: nada aparece', (_name, data) => {
    expect(toCheckinState(data)).toMatchObject({
      enabled: false,
      checkedInToday: false,
      streak: 0,
      best: 0,
      cycle: [],
      cycleDay: 0,
      todayPoints: 0,
    });
  });

  it('a resposta certa passa como veio, com o ciclo copiado', () => {
    const state = toCheckinState(PENDING);
    expect(state).toEqual(PENDING);
    expect(state.cycle).not.toBe(PENDING.cycle);
  });

  it('o ciclo com 0 passa (o servidor tolera na leitura), e os valores são os do servidor', () => {
    const zeroed = { ...PENDING, cycle: [0, 0, 0, 0, 0, 0, 0], todayPoints: 0 };
    expect(toCheckinState(zeroed)).toEqual(zeroed);
    // Outro tamanho de ciclo, do painel: nada é fixo em 7 no app.
    const short = { ...PENDING, cycle: [1, 2, 9], cycleDay: 3, todayPoints: 9 };
    expect(toCheckinState(short)).toEqual(short);
  });

  it.each<[string, Partial<Record<keyof CheckinState, unknown>>, Partial<CheckinState>]>([
    ['a sequência fora do formato vira 0', { streak: -2, best: 0 }, { streak: 0, best: 0 }],
    ['a sequência ausente vira 0', { streak: undefined }, { streak: 0, best: 9 }],
    ['o recorde nunca fica abaixo da sequência', { best: 2 }, { streak: 4, best: 4 }],
    ['o recorde ausente é a sequência', { best: undefined }, { best: 4 }],
    ['sem o valor de hoje, o do dia do ciclo', { todayPoints: undefined }, { todayPoints: 5 }],
    ['o feito hoje só com true', { checkedInToday: 1 }, { checkedInToday: false }],
  ])('%s', (_name, fields, expected) => {
    expect(toCheckinState({ ...PENDING, ...fields })).toMatchObject({ enabled: true, ...expected });
  });
});

describe('a resposta do toque conferida (toCheckinResult)', () => {
  it('sem o que a ação rendeu (um servidor antigo), só os pontos e o estado', () => {
    expect(toCheckinResult({ pointsAwarded: 3, checkin: PENDING })).toEqual({
      pointsAwarded: 3,
      levelUp: null,
      checkin: PENDING,
    });
  });

  it('o que vem fora do formato não quebra a festa: pontos em 0, listas de fora, estado desligado', () => {
    const result = toCheckinResult({
      pointsAwarded: '5',
      completedMissions: 'x',
      levelUp: 3,
      unlockedAchievements: {},
      missionsChanged: 'sim',
      checkin: null,
    });
    expect(result).toEqual({
      pointsAwarded: 0,
      levelUp: null,
      checkin: expect.objectContaining({ enabled: false, cycle: [] }),
    });
    expect(toCheckinResult(undefined)).toMatchObject({
      pointsAwarded: 0,
      checkin: { enabled: false },
    });
  });
});
