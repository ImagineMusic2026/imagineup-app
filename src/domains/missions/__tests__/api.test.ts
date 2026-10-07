import { api } from '@/services/api';
import { setFixtureNow } from '@/services/fixtures';

import { fetchDailyMission, fetchMissions } from '../api';
import { buildDailyMissionFixture, missionsFixture } from '../fixtures';
import type { Mission, MissionsResponse } from '../types';

// O api.ts importa o axios do app, que puxa o Firebase (ESM no Jest).
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const NOW = new Date(2026, 9, 5, 12, 0);

const MISSION: Mission = {
  ...buildDailyMissionFixture(NOW),
  action: 'join',
  target: { artistId: 'juninhomoraes' },
  pointsBreakdown: null,
};

beforeEach(() => {
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  get.mockReset();
});

afterEach(() => {
  missionsFixture.reset();
  setFixtureNow(null);
});

describe('missões do servidor (bloco 7)', () => {
  it('com a API, a 1g vem de /missions, com a meta da temporada e o join', async () => {
    mockDataSource = 'api';
    const response: MissionsResponse = {
      season: {
        id: 'temporada-sao-joao',
        title: 'Semana do arrocha',
        description: 'Complete 20 missões.',
        completedCount: 12,
        targetCount: 20,
        endsAt: '2026-10-17T22:30:00.000Z',
        metric: 'missions',
      },
      missions: [MISSION],
    };
    get.mockResolvedValue({ data: response });
    await expect(fetchMissions()).resolves.toEqual(response);
    expect(get).toHaveBeenCalledWith('/missions');
  });

  it('com a API, a missão do dia vem de /missions/daily; sem ela, null', async () => {
    mockDataSource = 'api';
    get.mockResolvedValueOnce({ data: { mission: MISSION } });
    await expect(fetchDailyMission()).resolves.toEqual(MISSION);
    expect(get).toHaveBeenCalledWith('/missions/daily');
    get.mockResolvedValueOnce({ data: { mission: null } });
    await expect(fetchDailyMission()).resolves.toBeNull();
  });

  it('nas fixtures, como antes: sem chamar a API', async () => {
    const { missions } = await fetchMissions();
    expect(missions[0]?.id).toBe('m-clipe-netto');
    await expect(fetchDailyMission()).resolves.toMatchObject({ id: 'm-clipe-netto' });
    expect(get).not.toHaveBeenCalled();
  });
});
