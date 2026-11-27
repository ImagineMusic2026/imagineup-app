import AsyncStorage from '@react-native-async-storage/async-storage';

import { readBoundInvite, savePendingInvite } from '@/domains/invites';
import { ApiError } from '@/services/api';
import { useInviteSettledStore } from '@/stores/invite-settled';

import { sendInviteClaim } from '../api';
import { INVITE_CLAIM_WINDOW_MS } from '../consts';
import { applyInviteCode, inviteWindowOpen } from '../invite-code';

// O build do Firebase que o Jest resolve é ESM; aqui nada chega a ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/data-source', () => ({ sourceOf: () => 'api', usesFixtures: () => false }));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

// O claim de verdade fica de fora: a resposta do servidor é a de cada caso.
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  sendInviteClaim: jest.fn(async () => ({ status: 'claimed' })),
}));

const claim = jest.mocked(sendInviteClaim);
const UID = 'uid-convidada';
const NOW = Date.parse('2026-11-27T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const settled = () => useInviteSettledStore.getState().settled[UID];
const refusal = (status: number, code: string, details: Record<string, unknown> | null = null) =>
  new ApiError('validation', code, status, code, details);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  claim.mockImplementation(async () => ({ status: 'claimed' }));
  useInviteSettledStore.setState({ settled: {}, hydrated: true });
});

describe('a janela de 7 dias do código', () => {
  it.each<[string, string | null, boolean]>([
    ['sem a data do perfil', null, false],
    ['data que não é data', 'ontem', false],
    ['a conta que acabou de nascer', new Date(NOW).toISOString(), true],
    ['no último instante dos 7 dias', new Date(NOW - INVITE_CLAIM_WINDOW_MS).toISOString(), true],
    ['1 ms depois dos 7 dias', new Date(NOW - INVITE_CLAIM_WINDOW_MS - 1).toISOString(), false],
    ['a conta de um mês', new Date(NOW - 30 * DAY).toISOString(), false],
  ])('%s', (_name, createdAt, open) => {
    expect(inviteWindowOpen(createdAt, NOW)).toBe(open);
  });
});

describe('usar o código depois do cadastro', () => {
  it('aceito: manda o código digitado como via code, o convite sai do aparelho e a conta fica resolvida', async () => {
    await expect(applyInviteCode(UID, 'k7p3-m9qx', NOW)).resolves.toEqual({
      status: 'claimed',
      code: 'K7P3M9QX',
    });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ uid: UID, code: 'K7P3M9QX', via: 'code', origin: null }),
    );
    await expect(readBoundInvite(UID, NOW)).resolves.toBeNull();
    expect(settled()).toBeDefined();
  });

  it('a conta que já tinha convite: a resposta diz, e a conta fica resolvida', async () => {
    claim.mockResolvedValueOnce({ status: 'already_claimed' });
    await expect(applyInviteCode(UID, 'K7P3M9QX', NOW)).resolves.toEqual({
      status: 'alreadyClaimed',
    });
    expect(settled()).toBeDefined();
  });

  it('o código do link guardado vai como via link, com a origem dele', async () => {
    await savePendingInvite('K7P3M9QX', { path: '/post/p-clipe', utm: {} }, NOW - 1000);
    await applyInviteCode(UID, 'K7P3M9QX', NOW);
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'link', origin: { path: '/post/p-clipe', utm: {} } }),
    );
  });

  it.each<[string, ApiError, unknown]>([
    [
      'código que não existe',
      refusal(404, 'invite_not_found'),
      { status: 'rejected', reason: 'notFound' },
    ],
    [
      'o próprio código',
      refusal(409, 'invite_not_allowed', { reason: 'self' }),
      { status: 'rejected', reason: 'self' },
    ],
    [
      'a conta fora dos 7 dias',
      refusal(409, 'invite_not_allowed', { reason: 'account_too_old' }),
      { status: 'tooOld' },
    ],
    ['a conta suspensa', refusal(403, 'account_suspended'), { status: 'failed' }],
  ])(
    'recusa definitiva (%s): o convite sai do aparelho e a conta não fica resolvida',
    async (_name, error, outcome) => {
      claim.mockRejectedValueOnce(error);
      await expect(applyInviteCode(UID, 'K7P3M9QX', NOW)).resolves.toEqual(outcome);
      await expect(readBoundInvite(UID, NOW)).resolves.toBeNull();
      expect(settled()).toBeUndefined();
    },
  );

  it.each<[string, ApiError]>([
    ['sem rede', new ApiError('network', 'x')],
    ['o servidor fora do ar', new ApiError('server', 'x', 503, 'unavailable')],
    ['o getIdToken que falhou antes de sair (unknown sem status)', new ApiError('unknown', 'x')],
  ])(
    'sem resposta certa (%s): o convite fica amarrado, com a mesma chave, para a sincronização',
    async (_name, error) => {
      claim.mockRejectedValueOnce(error);
      await expect(applyInviteCode(UID, 'K7P3M9QX', NOW)).resolves.toEqual({ status: 'pending' });
      const bound = await readBoundInvite(UID, NOW);
      expect(bound).toEqual(expect.objectContaining({ code: 'K7P3M9QX', via: 'code' }));
      expect(bound?.idempotencyKey).toBe(claim.mock.calls[0]?.[0].idempotencyKey);
      expect(settled()).toBeUndefined();
    },
  );
});
