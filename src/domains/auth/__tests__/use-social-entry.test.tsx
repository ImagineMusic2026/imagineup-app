import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { User } from 'firebase/auth';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { bindPendingInvite, readPendingInvite } from '@/domains/invites';
import { t, type TranslationKey } from '@/i18n';
import { api } from '@/services/api';
import { appleSignInAvailability, knownAppleSignInAvailability } from '@/services/apple-sign-in';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { fillMissingProfileName, SessionEndedError, waitForProfile } from '../api';
import { settlePendingAppleName, signInWithApple } from '../apple-entry';
import { signInWithGoogle } from '../google-entry';
import { useAppleEntry } from '../hooks/use-apple-entry';
import { playAuthExit } from '../hooks/use-auth-exit';
import { useGoogleEntry } from '../hooks/use-google-entry';
import {
  hasPendingSocialInvite,
  holdSocialInvite,
  releaseHeldSocialInvite,
} from '../hooks/use-sign-up';
import {
  useSocialEntry,
  type SocialEntry,
  type SocialEntryOutcome,
} from '../hooks/use-social-entry';
import type { SocialProvider, SocialSignInResult } from '../social-entry';

/**
 * O núcleo da entrada pelo Google e pela Apple (`useSocialEntry`, seção 39 de
 * docs/arquitetura-api.md), com um provedor falso: a trava das telas de conta,
 * as conferências da sessão, o convite da conta nova, as centrais da que já
 * existe, o toque duplo, os anúncios e o erro. No fim, o Google e a Apple
 * ligados ao núcleo.
 */

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));

const mockAuth: { currentUser: { uid: string } | null } = { currentUser: null };
let mockFirebaseConfigured = true;
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  getDb: () => ({}),
  get isFirebaseConfigured() {
    return mockFirebaseConfigured;
  },
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  firebaseEmulatorHost: undefined,
  googleWebClientId: undefined,
  apiUrl: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: jest.fn(() => 'api'),
  usesFixtures: () => false,
}));
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api/errors'),
  api: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/domains/invites', () => ({
  readPendingInvite: jest.fn(),
  bindPendingInvite: jest.fn(),
  clearBoundInvite: jest.fn(() => Promise.resolve()),
  clearPendingInvite: jest.fn(() => Promise.resolve()),
  invitePathForServer: (path: string) => path,
  normalizeInviteCode: (code: string) => code,
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  waitForProfile: jest.fn(),
  fillMissingProfileName: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../hooks/use-auth-exit', () => ({ playAuthExit: jest.fn(() => Promise.resolve()) }));
jest.mock('../google-entry', () => ({
  signInWithGoogle: jest.fn(),
  googleSignInErrorKey: jest.fn(() => 'auth.google.errors.unknown'),
}));
jest.mock('@/services/google-sign-in', () => ({
  isGoogleSignInAvailable: jest.fn(() => true),
  GoogleSignInError: class GoogleSignInError extends Error {},
  googleIdToken: jest.fn(),
  signOutGoogle: jest.fn(() => Promise.resolve()),
  revokeGoogleAccess: jest.fn(() => Promise.resolve()),
}));
jest.mock('../apple-entry', () => ({
  signInWithApple: jest.fn(),
  appleSignInErrorKey: jest.fn(() => 'auth.apple.errors.unknown'),
  settlePendingAppleName: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/services/apple-sign-in', () => ({
  appleSignInAvailability: jest.fn(() => Promise.resolve(false)),
  knownAppleSignInAvailability: jest.fn(() => undefined),
  appleCredential: jest.fn(),
  appleCredentialState: jest.fn(),
}));

const UID = 'uid-camila';
const user = { uid: UID, email: 'camila@x.com', displayName: 'Camila Ribeiro' } as User;
const PROFILE = { displayName: null };

const readInvite = jest.mocked(readPendingInvite);
const bindInvite = jest.mocked(bindPendingInvite);
const profileWait = jest.mocked(waitForProfile);
const centrals = jest.mocked(api.get);
const announce = () => jest.mocked(AccessibilityInfo.announceForAccessibility);
const holds = () => useSessionStore.getState().authHolds;

function provider(signIn: () => Promise<SocialSignInResult | null>) {
  return {
    signIn: jest.fn(signIn),
    signingInKey: 'auth.apple.signingIn',
    errorKey: jest.fn((): TranslationKey => 'auth.apple.errors.unknown'),
    settleNewProfileName: jest.fn(() => Promise.resolve()),
    logName: 'Apple',
  } satisfies SocialProvider;
}

const signedIn = (isNewUser: boolean, account: User = user): SocialSignInResult => ({
  kind: 'signedIn',
  user: account,
  isNewUser,
  profileName: 'Camila Ribeiro',
});

/** A entrada do provedor dado, sem o deixar entrar na sessão antes da hora. */
function entersAs(result: SocialSignInResult | null) {
  return provider(async () => {
    if (result?.kind === 'signedIn') mockAuth.currentUser = { uid: result.user.uid };
    return result;
  });
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Uma volta dos relógios: o React Query avisa a tela num `setTimeout` depois da mutação. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Toca no provedor e espera a mutação assentar na tela. */
async function enter(result: { current: SocialEntry }): Promise<SocialEntryOutcome | undefined> {
  let outcome: SocialEntryOutcome | undefined;
  await act(async () => {
    outcome = await result.current.signIn();
    await tick();
  });
  return outcome;
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: Infinity } } });
  mockAuth.currentUser = null;
  mockFirebaseConfigured = true;
  releaseHeldSocialInvite();
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
  usePreferencesStore.setState({ hasCompletedOnboarding: true });
  readInvite.mockResolvedValue(null);
  bindInvite.mockResolvedValue(null);
  profileWait.mockResolvedValue(PROFILE);
  centrals.mockResolvedValue({ data: [] });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('o núcleo da entrada por um provedor', () => {
  it('indisponível, o toque não faz nada', async () => {
    const fake = entersAs(signedIn(false));
    const { result } = renderHook(() => useSocialEntry(fake, false), { wrapper });

    await expect(result.current.signIn()).resolves.toBeUndefined();
    expect(fake.signIn).not.toHaveBeenCalled();
    expect(holds()).toBe(0);
  });

  it('a folha fechada: a trava sai, e nenhuma sessão nasce', async () => {
    const fake = entersAs(null);
    const { result } = renderHook(() => useSocialEntry(fake, true), { wrapper });

    const outcome = await enter(result);
    expect(outcome).toEqual({ status: 'canceled' });
    expect(holds()).toBe(0);
    expect(useSessionStore.getState().status).toBe('signedOut');
  });

  it('o modo "ligar" devolve o e-mail e solta a trava', async () => {
    const fake = entersAs({ kind: 'link', email: 'camila@empresa.com.br' });
    const { result } = renderHook(() => useSocialEntry(fake, true), { wrapper });

    const outcome = await enter(result);
    expect(outcome).toEqual({ status: 'link', email: 'camila@empresa.com.br' });
    expect(holds()).toBe(0);
  });

  it('a conta nova com o convite do link: amarra o código, espera o perfil, leva o nome e sai', async () => {
    readInvite.mockResolvedValue({ code: 'K7P3M9QX' } as Awaited<
      ReturnType<typeof readPendingInvite>
    >);
    bindInvite.mockResolvedValue({ code: 'K7P3M9QX' } as Awaited<
      ReturnType<typeof bindPendingInvite>
    >);
    const result = signedIn(true);
    const fake = entersAs(result);
    const { result: hook } = renderHook(() => useSocialEntry(fake, true), { wrapper });

    const outcome = await enter(hook);

    expect(outcome).toEqual({ status: 'done' });
    expect(bindInvite).toHaveBeenCalledWith(UID, 'K7P3M9QX');
    expect(profileWait).toHaveBeenCalledWith(UID);
    expect(fake.settleNewProfileName).toHaveBeenCalledWith(result, PROFILE);
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);
    expect(useSessionStore.getState().user).toMatchObject({ uid: UID });
    expect(playAuthExit).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    expect(holds()).toBe(0);
  });

  it.each([
    ['sem convite', () => readInvite.mockResolvedValue(null)],
    [
      'com o convite que não amarra',
      () => {
        readInvite.mockResolvedValue({ code: 'K7P3M9QX' } as Awaited<
          ReturnType<typeof readPendingInvite>
        >);
        bindInvite.mockRejectedValue(new Error('disco'));
      },
    ],
  ])(
    'a conta nova %s para na pergunta do código, com a trava guardada até ela seguir',
    async (_, setup) => {
      setup();
      const fake = entersAs(signedIn(true));
      const { result } = renderHook(() => useSocialEntry(fake, true), { wrapper });

      const outcome = await enter(result);

      expect(outcome).toEqual({ status: 'askInvite' });
      expect(playAuthExit).not.toHaveBeenCalled();
      expect(holds()).toBe(1);
      expect(hasPendingSocialInvite()).toBe(true);

      act(() => releaseHeldSocialInvite(UID));
      expect(holds()).toBe(0);
      expect(hasPendingSocialInvite()).toBe(false);
    },
  );

  it('a conta que já existe com centrais pula a escolha de artistas; sem centrais, volta a ela', async () => {
    usePreferencesStore.setState({ hasCompletedOnboarding: false });
    centrals.mockResolvedValueOnce({ data: [{ id: 'central' }] });
    const { result } = renderHook(() => useSocialEntry(entersAs(signedIn(false)), true), {
      wrapper,
    });

    await enter(result);
    expect(centrals).toHaveBeenCalledWith(
      '/me/centrals',
      expect.objectContaining({ sessionUid: UID }),
    );
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(true);
    expect(profileWait).not.toHaveBeenCalled();

    centrals.mockResolvedValueOnce({ data: [] });
    mockAuth.currentUser = null;
    await enter(result);
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('a conta que já existe sem resposta das centrais em 3 s segue com o que o aparelho tem', async () => {
    jest.useFakeTimers();
    centrals.mockImplementationOnce(() => new Promise(() => undefined));
    const { result } = renderHook(() => useSocialEntry(entersAs(signedIn(false)), true), {
      wrapper,
    });

    let outcome: unknown;
    await act(async () => {
      const pending = result.current.signIn().then((value) => {
        outcome = value;
      });
      await jest.advanceTimersByTimeAsync(3_000);
      await pending;
      // O aviso do React Query para a tela, num `setTimeout`.
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(outcome).toEqual({ status: 'done' });
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('a sessão de outra conta logo depois da folha: erro com a frase do provedor, e a trava sai', async () => {
    const fake = provider(async () => {
      mockAuth.currentUser = { uid: 'outra-conta' };
      return signedIn(true);
    });
    const { result } = renderHook(() => useSocialEntry(fake, true), { wrapper });

    const outcome = await enter(result);

    expect(outcome).toBeUndefined();
    expect(fake.errorKey).toHaveBeenCalledWith(expect.any(SessionEndedError));
    expect(announce()).toHaveBeenLastCalledWith(t('auth.apple.errors.unknown'));
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(holds()).toBe(0);
  });

  it('a sessão que troca enquanto o perfil chega: erro, sem a pergunta do código', async () => {
    profileWait.mockImplementationOnce(async () => {
      mockAuth.currentUser = { uid: 'outra-conta' };
      return PROFILE;
    });
    const fake = entersAs(signedIn(true));
    const { result } = renderHook(() => useSocialEntry(fake, true), { wrapper });

    const outcome = await enter(result);

    expect(outcome).toBeUndefined();
    expect(fake.settleNewProfileName).not.toHaveBeenCalled();
    expect(hasPendingSocialInvite()).toBe(false);
    expect(holds()).toBe(0);
  });

  it('o toque duplo entra uma vez só', async () => {
    let finish: (value: SocialSignInResult | null) => void = () => undefined;
    const fake = provider(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useSocialEntry(fake, true), { wrapper });

    await act(async () => {
      const first = result.current.signIn();
      const second = result.current.signIn();
      await expect(second).resolves.toBeUndefined();
      finish(null);
      await first;
      await tick();
    });

    expect(fake.signIn).toHaveBeenCalledTimes(1);
  });

  it('a trava guardada de uma entrada anterior sai no começo da nova', async () => {
    const earlier = jest.fn();
    holdSocialInvite('conta-anterior', earlier);
    const { result } = renderHook(() => useSocialEntry(entersAs(null), true), { wrapper });

    await enter(result);

    expect(earlier).toHaveBeenCalledTimes(1);
    expect(hasPendingSocialInvite()).toBe(false);
  });

  it('anuncia o início; o erro dá o toque de erro e a frase dele, e o reset a tira', async () => {
    const fake = provider(async () => {
      throw new Error('falhou');
    });
    const { result } = renderHook(() => useSocialEntry(fake, true), { wrapper });

    await enter(result);

    expect(announce()).toHaveBeenCalledWith(t('auth.apple.signingIn'));
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(announce()).toHaveBeenLastCalledWith(t('auth.apple.errors.unknown'));
    await waitFor(() => expect(result.current.error).toBe('auth.apple.errors.unknown'));

    act(() => result.current.reset());
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});

describe('o Google e a Apple no núcleo', () => {
  it('o Google leva ao perfil o nome da conta do Google', async () => {
    jest.mocked(signInWithGoogle).mockImplementationOnce(async () => {
      mockAuth.currentUser = { uid: UID };
      return { kind: 'signedIn', user, isNewUser: true, profileName: 'Bia Souza' };
    });
    bindInvite.mockResolvedValue({ code: 'K7P3M9QX' } as Awaited<
      ReturnType<typeof bindPendingInvite>
    >);
    readInvite.mockResolvedValue({ code: 'K7P3M9QX' } as Awaited<
      ReturnType<typeof readPendingInvite>
    >);
    const { result } = renderHook(() => useGoogleEntry(), { wrapper });

    expect(result.current.available).toBe(true);
    await enter(result);

    expect(fillMissingProfileName).toHaveBeenCalledWith(UID, PROFILE, 'Bia Souza');
  });

  it('com a disponibilidade da Apple já conhecida, o botão nasce no primeiro quadro', () => {
    jest.mocked(knownAppleSignInAvailability).mockReturnValue(true);
    const { result } = renderHook(() => useAppleEntry(), { wrapper });

    expect(result.current.available).toBe(true);
    expect(appleSignInAvailability).not.toHaveBeenCalled();
  });

  it('sem a resposta conhecida, a Apple aparece quando ela chega', async () => {
    jest.mocked(knownAppleSignInAvailability).mockReturnValue(undefined);
    jest.mocked(appleSignInAvailability).mockResolvedValueOnce(true);
    const { result } = renderHook(() => useAppleEntry(), { wrapper });

    expect(result.current.available).toBe(false);
    await waitFor(() => expect(result.current.available).toBe(true));
  });

  it('sem o Firebase configurado, a Apple fica de fora', async () => {
    mockFirebaseConfigured = false;
    jest.mocked(knownAppleSignInAvailability).mockReturnValue(true);
    const { result } = renderHook(() => useAppleEntry(), { wrapper });

    expect(result.current.available).toBe(false);
    await act(async () => undefined);
    expect(appleSignInAvailability).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
  });

  it('o nome que a Apple mandou vai ao perfil pelo nome guardado; sem ele, vale o nome da conta', async () => {
    jest.mocked(knownAppleSignInAvailability).mockReturnValue(true);
    jest.mocked(signInWithApple).mockImplementationOnce(async () => {
      mockAuth.currentUser = { uid: UID };
      return { kind: 'signedIn', user, isNewUser: true, profileName: 'Camila Ribeiro' };
    });
    readInvite.mockResolvedValue({ code: 'K7P3M9QX' } as Awaited<
      ReturnType<typeof readPendingInvite>
    >);
    bindInvite.mockResolvedValue({ code: 'K7P3M9QX' } as Awaited<
      ReturnType<typeof bindPendingInvite>
    >);
    const { result } = renderHook(() => useAppleEntry(), { wrapper });

    await enter(result);
    expect(settlePendingAppleName).toHaveBeenCalledWith(UID, PROFILE, 'Camila Ribeiro');
    expect(fillMissingProfileName).not.toHaveBeenCalled();

    jest.mocked(signInWithApple).mockImplementationOnce(async () => {
      mockAuth.currentUser = { uid: UID };
      return { kind: 'signedIn', user, isNewUser: true, profileName: null };
    });
    mockAuth.currentUser = null;
    await enter(result);
    expect(fillMissingProfileName).toHaveBeenCalledWith(UID, PROFILE, 'Camila Ribeiro');
  });
});
