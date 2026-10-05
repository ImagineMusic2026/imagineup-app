import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import {
  bindPendingInvite,
  readBoundInvite,
  readPendingInvite,
  savePendingInvite,
} from '@/domains/invites';
import { ApiError } from '@/services/api';
import { useSessionStore } from '@/stores/session';

import { currentAccountTimes, sendInviteClaim, sendInviteVisit } from '../api';
import { INVITE_SYNC_RETRY_MS, VISIT_FRESH_MS } from '../consts';
import { useInviteSync } from '../hooks/use-invite-sync';

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

// A sincronização de verdade, menos a ida ao servidor e o metadata do Auth.
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  sendInviteClaim: jest.fn(async () => ({ status: 'claimed' })),
  sendInviteVisit: jest.fn(async () => ({ status: 'received' })),
  currentAccountTimes: jest.fn(() => null),
}));

const claim = jest.mocked(sendInviteClaim);
const visit = jest.mocked(sendInviteVisit);
const accountTimes = jest.mocked(currentAccountTimes);

const LINK = { path: '/post/p-clipe', utm: { source: 'instagram' } };
const HOUR = 60 * 60 * 1000;

function signIn(uid: string, authHolds = 0): void {
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid, email: `${uid}@x.com`, displayName: null, photoURL: null },
    authHolds,
  });
}

/** Uma conta que já existia: criada antes do link e que entrou depois. */
function oldAccount(): void {
  accountTimes.mockReturnValue({
    createdAt: Date.now() - 30 * 24 * HOUR,
    lastSignInAt: Date.now(),
  });
}

let appStateListener: ((state: AppStateStatus) => void) | null = null;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  claim.mockImplementation(async () => ({ status: 'claimed' }));
  visit.mockImplementation(async () => ({ status: 'received' }));
  accountTimes.mockReturnValue(null);
  onlineManager.setOnline(true);
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void;
    return { remove: () => undefined } as ReturnType<typeof AppState.addEventListener>;
  });
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('convite amarrado (o claim)', () => {
  it('vai só para o uid dele, com a chave dele, e sai do aparelho', async () => {
    const bound = await bindPendingInvite('uid-bia', 'CAMILA12');
    signIn('uid-bia');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim).toHaveBeenCalledWith(bound);
    await waitFor(async () => expect(await readBoundInvite('uid-bia')).toBeNull());
    unmount();
  });

  it.each([
    ['invalid_request', 400],
    ['idempotency_key_required', 400],
    ['not_fan', 403],
    ['invite_not_found', 404],
    ['invite_not_allowed', 409],
    ['idempotency_key_reused', 422],
  ])('recusa definitiva %s (%s): o convite sai do aparelho', async (code, status) => {
    claim.mockRejectedValueOnce(new ApiError('validation', 'x', status, code));
    await bindPendingInvite('uid-bia', 'CAMILA12');
    signIn('uid-bia');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(() => expect(claim).toHaveBeenCalled());
    await waitFor(async () => expect(await readBoundInvite('uid-bia')).toBeNull());
    unmount();
  });

  it.each([
    ['o getIdToken que falhou antes de sair (unknown sem status)', new ApiError('unknown', 'x')],
    ['sem rede', new ApiError('network', 'x')],
    ['429', new ApiError('unknown', 'x', 429, 'too_many_requests')],
    ['404 sem o código do convite', new ApiError('notFound', 'x', 404, 'not_found')],
    ['503 do perfil que ainda nasce', new ApiError('server', 'x', 503, 'profile_not_ready')],
  ])('falha incerta (%s): o convite fica, com a mesma chave', async (_, error) => {
    claim.mockRejectedValueOnce(error);
    const bound = await bindPendingInvite('uid-bia', 'CAMILA12');
    signIn('uid-bia');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(() => expect(claim).toHaveBeenCalled());
    expect(await readBoundInvite('uid-bia')).toEqual(bound);
    unmount();
  });

  it('falha incerta tenta de novo pelo relógio (30 s) e quando o app volta ao primeiro plano', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-05T15:00:00.000Z') });
    claim.mockRejectedValue(new ApiError('network', 'sem rede'));
    const bound = await bindPendingInvite('uid-bia', 'CAMILA12');
    signIn('uid-bia');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    await act(async () => {
      jest.advanceTimersByTime(INVITE_SYNC_RETRY_MS[0]!);
    });
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));

    claim.mockResolvedValue({ status: 'claimed' });
    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(3));
    expect(claim).toHaveBeenLastCalledWith(bound);
    await waitFor(async () => expect(await readBoundInvite('uid-bia')).toBeNull());
    unmount();
  });

  it('as novas tentativas param quando a sessão muda', async () => {
    jest.useFakeTimers({ now: Date.parse('2026-10-05T15:00:00.000Z') });
    claim.mockRejectedValue(new ApiError('network', 'sem rede'));
    await bindPendingInvite('uid-bia', 'CAMILA12');
    signIn('uid-bia');
    const { unmount } = renderHook(() => useInviteSync());
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));

    act(() => useSessionStore.setState({ status: 'signedOut', user: null }));
    await act(async () => {
      jest.advanceTimersByTime(INVITE_SYNC_RETRY_MS.reduce((sum, ms) => sum + ms, 0));
    });
    expect(claim).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('a rede voltando dispara uma rodada', async () => {
    claim.mockRejectedValueOnce(new ApiError('network', 'sem rede'));
    await bindPendingInvite('uid-bia', 'CAMILA12');
    signIn('uid-bia');
    const { unmount } = renderHook(() => useInviteSync());
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));

    act(() => onlineManager.setOnline(false));
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(2));
    unmount();
  });

  it('nada roda enquanto o cadastro segura as telas de conta', async () => {
    await bindPendingInvite('uid-bia', 'CAMILA12');
    await savePendingInvite('K7P3M9QX', LINK);
    signIn('uid-bia', 1);
    const { unmount } = renderHook(() => useInviteSync());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(claim).not.toHaveBeenCalled();
    expect(visit).not.toHaveBeenCalled();

    act(() => useSessionStore.setState({ authHolds: 0 }));
    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    unmount();
  });
});

describe('convite pendente (o link guardado, sem dono)', () => {
  it('outra conta entrando no aparelho manda a visita do link e nunca o convite amarrado de outro', async () => {
    await bindPendingInvite('uid-bia', 'CAMILA12');
    await savePendingInvite('K7P3M9QX', LINK);
    oldAccount();
    signIn('uid-alan');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(() => expect(visit).toHaveBeenCalledTimes(1));
    expect(visit).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'K7P3M9QX', origin: LINK }),
      'uid-alan',
    );
    expect(claim).not.toHaveBeenCalled();
    expect(await readPendingInvite()).toBeNull();
    // O da Bia continua esperando a sessão dela.
    expect(await readBoundInvite('uid-bia')).toMatchObject({ code: 'CAMILA12' });
    unmount();
  });

  it('a conta que nasceu depois do link e em que ninguém entrou desde então recebe o claim (via link)', async () => {
    await savePendingInvite('K7P3M9QX', LINK);
    const created = Date.now() + 1_000;
    accountTimes.mockReturnValue({ createdAt: created, lastSignInAt: created + 2_000 });
    signIn('uid-nova');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(() => expect(claim).toHaveBeenCalledTimes(1));
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'uid-nova', code: 'K7P3M9QX', via: 'link', origin: LINK }),
    );
    expect(visit).not.toHaveBeenCalled();
    expect(await readPendingInvite()).toBeNull();
    unmount();
  });

  it('a conta criada depois do link noutro aparelho, que entrou aqui, manda só a visita', async () => {
    await savePendingInvite('K7P3M9QX', LINK);
    const created = Date.now() + 1_000;
    accountTimes.mockReturnValue({ createdAt: created, lastSignInAt: created + 10 * 60_000 });
    signIn('uid-outro-aparelho');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(() => expect(visit).toHaveBeenCalledTimes(1));
    expect(claim).not.toHaveBeenCalled();
    unmount();
  });

  it('o link guardado há mais de 24 h sai sem visita (pode ser de outra pessoa)', async () => {
    const day = Date.parse('2026-10-05T15:00:00.000Z');
    await savePendingInvite('K7P3M9QX', LINK, day - VISIT_FRESH_MS - 1);
    jest.useFakeTimers({ now: day });
    oldAccount();
    signIn('uid-alan');
    const { unmount } = renderHook(() => useInviteSync());

    await waitFor(async () => expect(await readPendingInvite()).toBeNull());
    expect(visit).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    unmount();
  });

  it('um link novo guardado com o app aberto vira visita na hora', async () => {
    oldAccount();
    signIn('uid-alan');
    const { unmount } = renderHook(() => useInviteSync());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(visit).not.toHaveBeenCalled();

    await act(async () => {
      await savePendingInvite('K7P3M9QX', LINK);
    });
    await waitFor(() => expect(visit).toHaveBeenCalledTimes(1));
    unmount();
  });
});
