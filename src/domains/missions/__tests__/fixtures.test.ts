import { fixtureWallet, setFixtureNow } from '@/services/fixtures';

import { fetchDailyMission, fetchMissions } from '../api';
import {
  buildDailyMissionFixture,
  buildMissionsFixture,
  missionsFixture,
  RSVP_MISSION_POINTS,
} from '../fixtures';

// O api.ts importa o axios do app, que puxa o Firebase (ESM no Jest).
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/config/env', () => ({ dataSource: 'fixtures' }));

const NOW = new Date(2026, 8, 29, 20, 0);

beforeEach(() => {
  setFixtureNow(NOW);
});

afterEach(() => {
  missionsFixture.reset();
  fixtureWallet.reset();
  setFixtureNow(null);
});

describe('missões de exemplo', () => {
  it('são as do protótipo, sem a de playlist, com a meta da temporada em 12 de 20', () => {
    const { season, missions } = buildMissionsFixture(NOW);
    expect(season).toMatchObject({
      title: 'Semana do arrocha',
      completedCount: 12,
      targetCount: 20,
    });
    expect(missions.map((mission) => mission.title)).toEqual([
      'Leve 5 pessoas para o clipe novo do Netto',
      'Curta 5 posts do Nenho',
      'Comente em 3 posts da central',
      'Missão relâmpago do show',
      'Traga 3 amigos novos pro app',
      'Confirme presença em um show',
    ]);
    expect(missions.some((mission) => /playlist/i.test(mission.title))).toBe(false);
  });

  it('a missão do dia da home é a destacada de "Hoje" da mesma lista', async () => {
    const daily = await fetchDailyMission();
    const { missions } = await fetchMissions();
    expect(daily).toEqual(missions[0]);
    expect(daily).toEqual(buildDailyMissionFixture(NOW));
    expect(daily).toMatchObject({ featured: true, period: 'daily' });
  });

  it('a de clipe é link de post do app com atribuição, não do YouTube', () => {
    expect(buildDailyMissionFixture(NOW)).toMatchObject({
      action: 'share',
      target: { postId: 'p-clipe' },
      pointsBreakdown: { perVisit: 2, perSignup: 10 },
    });
  });
});

describe('servidor das missões nas fixtures', () => {
  it('a ação que conclui a missão rende os pontos dela, na carteira e na resposta', () => {
    expect(missionsFixture.record('rsvp')).toBe(RSVP_MISSION_POINTS);
    expect(fixtureWallet.get().balance).toBe(12_480 + RSVP_MISSION_POINTS);

    const { season, missions } = buildMissionsFixture(NOW);
    expect(missions.find((mission) => mission.id === 'm-presenca-show')).toMatchObject({
      status: 'completed',
      progress: { current: 1, target: 1 },
      completedAt: NOW.toISOString(),
    });
    // A meta da temporada anda com cada missão concluída.
    expect(season?.completedCount).toBe(13);
  });

  it('missão já concluída não rende de novo', () => {
    missionsFixture.record('rsvp');
    expect(missionsFixture.record('rsvp')).toBe(0);
    expect(fixtureWallet.get().balance).toBe(12_480 + RSVP_MISSION_POINTS);
  });

  it('ação que só anda a missão não rende ponto ainda', () => {
    expect(missionsFixture.record('like')).toBe(0);
    const like = buildMissionsFixture(NOW).missions.find((item) => item.id === 'm-curtir-nenho');
    expect(like).toMatchObject({ status: 'active', progress: { current: 3, target: 5 } });
    expect(fixtureWallet.get().balance).toBe(12_480);
  });

  it('bloqueada não anda, e ação sem missão aberta não rende', () => {
    // A relâmpago (bloqueada) também é de comentar, e a única de comentar aberta já foi.
    expect(missionsFixture.record('comment')).toBe(0);
    const flash = buildMissionsFixture(NOW).missions.find((item) => item.id === 'm-relampago-show');
    expect(flash).toMatchObject({ status: 'locked', progress: { current: 0 } });
  });

  it('volta ao início', () => {
    missionsFixture.record('rsvp');
    missionsFixture.reset();
    const rsvp = buildMissionsFixture(NOW).missions.find((item) => item.id === 'm-presenca-show');
    expect(rsvp?.status).toBe('active');
  });
});
