import { followFixture, JOIN_CENTRAL_POINTS } from '@/domains/artists/fixtures';
import {
  buildMissionsFixture,
  missionsFixture,
  RSVP_MISSION_POINTS,
} from '@/domains/missions/fixtures';
import { postsFixture } from '@/domains/posts/fixtures';
import { buildRewardsFixture, rewardsFixture } from '@/domains/rewards/fixtures';
import { API_ERROR_CODES, ApiError } from '@/services/api/errors';

import {
  earnFixturePoints,
  FIXTURE_POINTS_UNAVAILABLE,
  fixtureWallet,
  resetFixtureSession,
  setFixtureNow,
} from '..';

/**
 * A regra de coerência (docs/arquitetura-api.md, seção 13): ponto existe num
 * lugar só. Com a carteira nas fixtures, as ações de exemplo rendem pontos na
 * `fixtureWallet`, como hoje; com a carteira na API, nenhuma ação de fixture
 * rende ponto e o resgate de exemplo recusa, para os números da tela (do
 * servidor) nunca divergirem em silêncio.
 */

// O perfil (Firestore) entra pelos domínios; nada aqui fala com ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), request: jest.fn() },
}));

// A carteira muda de fonte; os outros domínios seguem nas fixtures, como no
// desenvolvimento com os emuladores no bloco 1.
let mockWalletSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => (domain === 'wallet' ? mockWalletSource : 'fixtures'),
  usesFixtures: () => true,
}));

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const INITIAL = { balance: 12_480, xp: 12_480, seasonPoints: 4_120 };
const CAMILA = { id: 'uid-camila', name: 'Camila Ribeiro', photoURL: null };

function comment(idempotencyKey: string) {
  return postsFixture.addComment(
    {
      postId: 'p-clipe',
      text: 'Que clipe!',
      idempotencyKey,
      author: CAMILA,
    },
    NOW,
  );
}

beforeEach(() => {
  mockWalletSource = 'fixtures';
  setFixtureNow(NOW);
});

afterEach(() => {
  resetFixtureSession();
  setFixtureNow(null);
});

describe('carteira nas fixtures (builds de hoje)', () => {
  it('earnFixturePoints soma nos três contadores e devolve os pontos', () => {
    expect(earnFixturePoints(10)).toBe(10);
    expect(fixtureWallet.get()).toEqual({ balance: 12_490, xp: 12_490, seasonPoints: 4_130 });
  });

  it('comentar, entrar na central e concluir missão rendem como hoje', () => {
    expect(comment('c-1').pointsAwarded).toBe(2);
    expect(followFixture.join('rock-salles', 'join-1').pointsAwarded).toBe(JOIN_CENTRAL_POINTS);
    expect(missionsFixture.record('rsvp', NOW)).toBe(RSVP_MISSION_POINTS);
    expect(fixtureWallet.get().balance).toBe(
      12_480 + 2 + JOIN_CENTRAL_POINTS + RSVP_MISSION_POINTS,
    );
  });

  it('o resgate desconta só o saldo', () => {
    expect(rewardsFixture.redeem('videochamada', 'resgate-1', NOW).balance).toBe(3_980);
  });
});

describe('carteira na API (emuladores no bloco 1)', () => {
  beforeEach(() => {
    mockWalletSource = 'api';
  });

  it('earnFixturePoints não soma nada e devolve 0', () => {
    expect(earnFixturePoints(10)).toBe(0);
    expect(fixtureWallet.get()).toEqual(INITIAL);
    expect(fixtureWallet.earned()).toBe(0);
  });

  it('o comentário acontece, sem o "+N" e sem mexer em carteira nenhuma', () => {
    const result = comment('c-1');
    expect(result).toMatchObject({ text: 'Que clipe!', pointsAwarded: 0 });
    expect(fixtureWallet.get()).toEqual(INITIAL);
  });

  it('entrar na central acontece e rende 0', () => {
    expect(followFixture.join('rock-salles', 'join-1')).toEqual({
      artistId: 'rock-salles',
      pointsAwarded: 0,
    });
    expect(followFixture.followedIds()).toContain('rock-salles');
    expect(fixtureWallet.get()).toEqual(INITIAL);
  });

  it('a missão anda e conclui, mas a ação devolve 0 e a carteira não muda', () => {
    expect(missionsFixture.record('rsvp', NOW)).toBe(0);
    const mission = buildMissionsFixture(NOW).missions.find(
      (item) => item.id === 'm-presenca-show',
    );
    expect(mission).toMatchObject({ status: 'completed', progress: { current: 1, target: 1 } });
    expect(fixtureWallet.get()).toEqual(INITIAL);
  });

  it('o resgate de exemplo recusa com points_unavailable, sem baixar o estoque', () => {
    const before = buildRewardsFixture(NOW).rewards.find((item) => item.id === 'ingressos');
    expect(() => rewardsFixture.redeem('ingressos', 'resgate-1', NOW)).toThrow(ApiError);
    try {
      rewardsFixture.redeem('ingressos', 'resgate-2', NOW);
    } catch (error) {
      expect(error).toMatchObject({
        kind: 'validation',
        status: 409,
        code: FIXTURE_POINTS_UNAVAILABLE,
      });
      // Não é o "sem saldo" da API: o app mostra o erro genérico do resgate.
      expect((error as ApiError).code).not.toBe(API_ERROR_CODES.insufficientPoints);
    }
    expect(buildRewardsFixture(NOW).rewards.find((item) => item.id === 'ingressos')).toEqual(
      before,
    );
    expect(fixtureWallet.get()).toEqual(INITIAL);
  });
});
