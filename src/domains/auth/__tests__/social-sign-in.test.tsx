import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { FirebaseError } from 'firebase/app';
import { signInWithEmailAndPassword, type User, type UserCredential } from 'firebase/auth';
import { onSnapshot, updateDoc } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import { readBoundInvite, readPendingInvite, savePendingInvite } from '@/domains/invites';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { StorageKeys } from '@/storage/storage';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { useSignIn } from '../hooks/use-sign-in';
import { useFinishSignUp } from '../hooks/use-sign-up';
import { useSocialSignIn } from '../hooks/use-social-sign-in';
import {
  hasAnyCentral,
  linkPendingGoogle,
  signInWithApple,
  signInWithGoogle,
  type SocialSignInResult,
} from '../social';

/**
 * A entrada com a Apple e com o Google pelo hook (seção 33 de
 * docs/arquitetura-api.md, decisões 7, 9 e 11) e o entrar com e-mail com as
 * centrais e a ligação do Google. A folha do provedor e o Firebase ficam no
 * `social.ts`, falso aqui (o núcleo tem os testes próprios); o resto é o do
 * app: o convite guardado, o perfil esperado, o nome pela regra e as travas.
 */

jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(),
  updateDoc: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => 'agora-do-servidor'),
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
  googleWebClientId: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('../social', () => ({
  ...jest.requireActual('../social'),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  hasAnyCentral: jest.fn(() => Promise.resolve(null)),
  linkPendingGoogle: jest.fn(() => Promise.resolve(null)),
}));

type SnapshotListener = (snapshot: {
  exists: () => boolean;
  data: () => { displayName?: unknown };
}) => void;

const apple = jest.mocked(signInWithApple);
const google = jest.mocked(signInWithGoogle);
const centrals = jest.mocked(hasAnyCentral);
const linkGoogle = jest.mocked(linkPendingGoogle);
const listen = jest.mocked(onSnapshot);
const writeProfile = jest.mocked(updateDoc);
const emailSignIn = jest.mocked(signInWithEmailAndPassword);

const APPLE_UID = '000123.apple';
const LINK = { path: '/post/p-clipe', utm: { source: 'instagram' } };

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    uid: 'uid-nova',
    email: 'bia@gmail.com',
    displayName: null,
    photoURL: null,
    providerData: [{ providerId: 'google.com', uid: 'g-1' }],
    ...overrides,
  } as unknown as User;
}

function signedIn(
  overrides: Partial<Extract<SocialSignInResult, { kind: 'signedIn' }>>,
): SocialSignInResult {
  return {
    kind: 'signedIn',
    method: 'google',
    user: fakeUser(),
    isNewUser: true,
    appleName: null,
    ...overrides,
  };
}

/** O perfil do Firestore: o listener que o hook registrou, para o teste fazer o perfil nascer. */
function fakeProfile() {
  let listener: SnapshotListener | null = null;
  listen.mockImplementation(((_ref: unknown, next: SnapshotListener) => {
    listener = next;
    return () => undefined;
  }) as unknown as typeof onSnapshot);
  return {
    arrives: (displayName: string | null) =>
      listener?.({ exists: () => true, data: () => ({ displayName }) }),
    listening: () => listener !== null,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const announce = () => jest.mocked(AccessibilityInfo.announceForAccessibility);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
  usePreferencesStore.setState({ hasCompletedOnboarding: false, lastSignInMethod: null });
  centrals.mockResolvedValue(null);
  linkGoogle.mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
  // Solta o fã que um teste deixou no passo do convite.
  useSessionStore.setState({ authHolds: 0 });
});

describe('a conta nova pelo provedor segue o cadastro', () => {
  it('com o convite do link: segura o fã, amarra o código do pendente, espera o perfil, põe o nome e solta', async () => {
    await savePendingInvite('ABC123', LINK);
    usePreferencesStore.setState({ hasCompletedOnboarding: true });
    let heldDuringSheet = false;
    google.mockImplementationOnce(async () => {
      heldDuringSheet = useSessionStore.getState().authHolds > 0;
      return signedIn({ user: fakeUser({ displayName: 'Bia Souza' }) });
    });
    const profile = fakeProfile();
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('google'));
    await waitFor(() => expect(profile.listening()).toBe(true));

    expect(heldDuringSheet).toBe(true);
    // Conta nova nunca escolheu artistas, mesmo com o aparelho já tendo concluído.
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signedIn',
      authHolds: 1,
      user: { uid: 'uid-nova', displayName: 'Bia Souza', signInProvider: 'google' },
    });
    // O convite do link fica preso à conta nova antes da espera do perfil.
    expect(await readPendingInvite()).toBeNull();
    expect(await readBoundInvite('uid-nova')).toMatchObject({
      code: 'ABC123',
      via: 'link',
      origin: LINK,
    });

    act(() => profile.arrives(null));
    await waitFor(() => expect(result.current.data).toEqual({ status: 'done' }));
    // O perfil nasceu sem nome: o nome do Google vai pela regra do primeiro nome.
    expect(writeProfile).toHaveBeenCalledWith('users/uid-nova', {
      displayName: 'Bia Souza',
      updatedAt: 'agora-do-servidor',
    });
    expect(useSessionStore.getState().authHolds).toBe(0);
    expect(usePreferencesStore.getState().lastSignInMethod).toBe('google');
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    // A conta nova não pergunta pelas centrais.
    expect(centrals).not.toHaveBeenCalled();
  });

  it('sem convite de link: para no passo do convite, ainda seguro, e o "Pular" solta', async () => {
    google.mockResolvedValueOnce(signedIn({}));
    const profile = fakeProfile();
    const { result } = renderHook(
      () => ({ social: useSocialSignIn(), finish: useFinishSignUp() }),
      { wrapper },
    );

    act(() => result.current.social.mutate('google'));
    await waitFor(() => expect(profile.listening()).toBe(true));
    act(() => profile.arrives('Bia Souza'));

    await waitFor(() => expect(result.current.social.data).toEqual({ status: 'askInvite' }));
    expect(useSessionStore.getState().authHolds).toBe(1);
    expect(usePreferencesStore.getState().lastSignInMethod).toBe('google');
    expect(haptics.trigger).not.toHaveBeenCalledWith('success');
    expect(await readBoundInvite('uid-nova')).toBeNull();

    // "Pular" é o "Continuar sem código" do cadastro: a trava estacionada sai.
    act(() => result.current.finish.mutate({ inviteCode: '' }));
    await waitFor(() => expect(result.current.finish.data).toEqual({ status: 'done' }));
    expect(useSessionStore.getState().authHolds).toBe(0);
  });

  it('a Apple com nome: o nome guardado vai para o perfil sem nome, e a chave sai', async () => {
    await AsyncStorage.setItem(
      StorageKeys.ApplePendingName,
      JSON.stringify({ appleUserId: APPLE_UID, name: 'Camila Ribeiro' }),
    );
    await savePendingInvite('ABC123', LINK);
    apple.mockResolvedValueOnce(
      signedIn({
        method: 'apple',
        appleName: 'Camila Ribeiro',
        user: fakeUser({
          email: 'camila@privaterelay.appleid.com',
          displayName: 'Camila Ribeiro',
          providerData: [{ providerId: 'apple.com', uid: APPLE_UID }],
        } as Partial<User>),
      }),
    );
    const profile = fakeProfile();
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('apple'));
    await waitFor(() => expect(profile.listening()).toBe(true));
    act(() => profile.arrives(null));

    await waitFor(() => expect(result.current.data).toEqual({ status: 'done' }));
    expect(writeProfile).toHaveBeenCalledWith('users/uid-nova', {
      displayName: 'Camila Ribeiro',
      updatedAt: 'agora-do-servidor',
    });
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(StorageKeys.ApplePendingName)).toBeNull(),
    );
    expect(useSessionStore.getState().user?.signInProvider).toBe('apple');
    expect(usePreferencesStore.getState().lastSignInMethod).toBe('apple');
  });

  it('a Apple sem nome: o perfil fica sem nome, e nada é gravado', async () => {
    await savePendingInvite('ABC123', LINK);
    apple.mockResolvedValueOnce(
      signedIn({
        method: 'apple',
        user: fakeUser({ providerData: [{ providerId: 'apple.com', uid: APPLE_UID }] } as never),
      }),
    );
    const profile = fakeProfile();
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('apple'));
    await waitFor(() => expect(profile.listening()).toBe(true));
    act(() => profile.arrives(null));

    await waitFor(() => expect(result.current.data).toEqual({ status: 'done' }));
    expect(writeProfile).not.toHaveBeenCalled();
  });
});

describe('a conta que já existe segue o entrar', () => {
  it.each([
    ['com alguma central, a 1l fica concluída', true, false, true],
    ['sem nenhuma, a 1l aparece', false, true, false],
    ['sem a resposta, vale o que o aparelho tem', null, true, true],
  ])('%s', async (_, answer, before, after) => {
    usePreferencesStore.setState({ hasCompletedOnboarding: before });
    centrals.mockResolvedValueOnce(answer);
    google.mockResolvedValueOnce(signedIn({ isNewUser: false }));
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('google'));

    await waitFor(() => expect(result.current.data).toEqual({ status: 'done' }));
    expect(centrals).toHaveBeenCalledWith('uid-nova');
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(after);
    // Nada do cadastro: nem o perfil esperado, nem o convite.
    expect(listen).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({
      authHolds: 0,
      user: { uid: 'uid-nova', signInProvider: 'google' },
    });
  });

  it('o convite do link guardado não é amarrado: vai como visita, pela sincronização', async () => {
    await savePendingInvite('ABC123', LINK);
    google.mockResolvedValueOnce(signedIn({ isNewUser: false }));
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('google'));

    await waitFor(() => expect(result.current.data).toEqual({ status: 'done' }));
    expect(await readPendingInvite()).toMatchObject({ code: 'ABC123' });
    expect(await readBoundInvite('uid-nova')).toBeNull();
  });

  it('o nome guardado da Apple vai para o perfil que ficou sem nome', async () => {
    await AsyncStorage.setItem(
      StorageKeys.ApplePendingName,
      JSON.stringify({ appleUserId: APPLE_UID, name: 'Camila Ribeiro' }),
    );
    apple.mockResolvedValueOnce(
      signedIn({
        method: 'apple',
        isNewUser: false,
        appleName: 'Camila Ribeiro',
        user: fakeUser({ providerData: [{ providerId: 'apple.com', uid: APPLE_UID }] } as never),
      }),
    );
    const profile = fakeProfile();
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('apple'));
    await waitFor(() => expect(profile.listening()).toBe(true));
    act(() => profile.arrives(null));

    await waitFor(() => expect(result.current.data).toEqual({ status: 'done' }));
    expect(writeProfile).toHaveBeenCalledWith('users/uid-nova', {
      displayName: 'Camila Ribeiro',
      updatedAt: 'agora-do-servidor',
    });
  });

  it('o nome do Google não vai para o perfil sem nome de uma conta que já existe', async () => {
    google.mockResolvedValueOnce(
      signedIn({ isNewUser: false, user: fakeUser({ displayName: 'Camila Ribeiro' }) }),
    );
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('google'));

    await waitFor(() => expect(result.current.data).toEqual({ status: 'done' }));
    expect(listen).not.toHaveBeenCalled();
    expect(writeProfile).not.toHaveBeenCalled();
  });
});

describe('o que não vira entrada', () => {
  it('cancelar solta o fã, sem erro, sem toque e sem lembrar o jeito', async () => {
    usePreferencesStore.setState({ lastSignInMethod: 'password' });
    apple.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('apple'));

    await waitFor(() => expect(result.current.data).toEqual({ status: 'canceled' }));
    expect(useSessionStore.getState().authHolds).toBe(0);
    expect(haptics.trigger).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().lastSignInMethod).toBe('password');
    expect(announce()).toHaveBeenCalledTimes(1);
    expect(announce()).toHaveBeenCalledWith(t('auth.social.signingInApple'));
  });

  it('o Google numa conta de senha vira o modo "ligar", com o fã solto', async () => {
    google.mockResolvedValueOnce({ kind: 'link', email: 'enzo@empresa.com.br' });
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('google'));

    await waitFor(() =>
      expect(result.current.data).toEqual({ status: 'link', email: 'enzo@empresa.com.br' }),
    );
    expect(useSessionStore.getState().authHolds).toBe(0);
    expect(usePreferencesStore.getState().lastSignInMethod).toBeNull();
  });

  it('a falha mostra e anuncia a frase da entrada social, com o toque de erro', async () => {
    google.mockRejectedValueOnce(new FirebaseError('auth/operation-not-allowed', 'desligado'));
    const { result } = renderHook(() => useSocialSignIn(), { wrapper });

    act(() => result.current.mutate('google'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(useSessionStore.getState().authHolds).toBe(0);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(announce()).toHaveBeenCalledWith(t('auth.social.signingInGoogle'));
    expect(announce()).toHaveBeenLastCalledWith(t('auth.social.errors.unavailable'));
  });
});

describe('entrar com e-mail (decisões 8 e 11)', () => {
  const camila = fakeUser({
    uid: 'uid-camila',
    email: 'camila@x.com',
    providerData: [{ providerId: 'password', uid: 'camila@x.com' }],
  } as Partial<User>);

  beforeEach(() => {
    emailSignIn.mockResolvedValue({ user: camila } as UserCredential);
  });

  it('lembra o e-mail e senha e confere as centrais da conta', async () => {
    usePreferencesStore.setState({ hasCompletedOnboarding: false });
    centrals.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useSignIn(), { wrapper });

    act(() => result.current.mutate({ email: 'camila@x.com', password: 'senha-123' }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(centrals).toHaveBeenCalledWith('uid-camila');
    expect(usePreferencesStore.getState()).toMatchObject({
      hasCompletedOnboarding: true,
      lastSignInMethod: 'password',
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('com o Google pendente, liga depois do login e anuncia', async () => {
    linkGoogle.mockResolvedValueOnce('linked');
    const { result } = renderHook(() => useSignIn(), { wrapper });

    act(() => result.current.mutate({ email: 'camila@x.com', password: 'senha-123' }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(linkGoogle).toHaveBeenCalledWith(camila);
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      t('auth.link.done'),
      { queue: true },
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', undefined],
    ['inUse', t('auth.link.inUse')],
  ] as const)(
    'a ligação que falha (%s) não segura a entrada: o fã entra e ouve o aviso, uma vez',
    async (outcome, message) => {
      linkGoogle.mockResolvedValueOnce(outcome);
      const { result } = renderHook(() => useSignIn(), { wrapper });

      act(() => result.current.mutate({ email: 'camila@x.com', password: 'senha-123' }));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(useSessionStore.getState().authHolds).toBe(0);
      expect(Alert.alert).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalledWith(t('auth.link.failed'), message, [
        { text: t('errors.ok') },
      ]);
    },
  );

  it('a senha recusada não tenta a ligação, que fica para a próxima tentativa', async () => {
    emailSignIn.mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'recusada'));
    const { result } = renderHook(() => useSignIn(), { wrapper });

    act(() => result.current.mutate({ email: 'camila@x.com', password: 'errada' }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(linkGoogle).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().lastSignInMethod).toBeNull();
  });
});
