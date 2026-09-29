import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import type { ReactNode } from 'react';

import { readPendingInvite, savePendingInvite } from '@/domains/invites';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { authErrorMessageKey, sendPasswordReset, signUpWithEmail, waitForProfile } from '../api';
import { usePasswordReset } from '../hooks/use-password-reset';
import { useSignUp } from '../hooks/use-sign-up';

// O build do Firebase que o Jest resolve é ESM; o app só precisa da classe de erro.
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
  createUserWithEmailAndPassword: jest.fn(),
  updateProfile: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(),
}));

// Sem .env no Jest: a API fica de fora (fixtures) e o aviso de configuração não polui a saída.
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  dataSource: 'fixtures',
  firebaseEmulatorHost: undefined,
}));

jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));

type SnapshotListener = (snapshot: { exists: () => boolean }) => void;

const createUser = jest.mocked(createUserWithEmailAndPassword);
const setProfile = jest.mocked(updateProfile);
const listen = jest.mocked(onSnapshot);
const sendReset = jest.mocked(sendPasswordResetEmail);

const form = { name: 'Beatriz Santos', email: 'beatriz@x.com', password: 'senha-123' };

/** Registra a ordem das chamadas ao Firebase e guarda o listener do perfil. */
function fakeFirebase() {
  const calls: string[] = [];
  const unsubscribe = jest.fn();
  let profileListener: SnapshotListener | null = null;
  let profileError: (() => void) | null = null;
  const user = { uid: 'nova', email: form.email, displayName: null, photoURL: null } as User;

  createUser.mockImplementation(async () => {
    // O guard já precisa estar seguro quando a conta nasce (logada).
    calls.push(`createUser:held=${useSessionStore.getState().authHolds > 0}`);
    return { user } as UserCredential;
  });
  setProfile.mockImplementation(async (target, { displayName }) => {
    calls.push(`updateProfile:${displayName}`);
    Object.assign(target, { displayName });
  });
  listen.mockImplementation(((ref: unknown, next: SnapshotListener, error: () => void) => {
    calls.push(`onSnapshot:${String(ref)}`);
    profileListener = next;
    profileError = error;
    return unsubscribe;
  }) as unknown as typeof onSnapshot);

  return {
    calls,
    unsubscribe,
    profileArrives: () => profileListener?.({ exists: () => true }),
    profileMissing: () => profileListener?.({ exists: () => false }),
    readFails: () => profileError?.(),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  // gcTime infinito: sem o timer de limpeza, o Jest não fica esperando depois do teste.
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
  usePreferencesStore.setState({ hasCompletedOnboarding: false });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('cadastro (useSignUp)', () => {
  it('põe o nome na conta antes de esperar o perfil, e segura o guard até ele nascer', async () => {
    const firebase = fakeFirebase();
    const { result } = renderHook(() => useSignUp(), { wrapper });

    act(() => result.current.mutate(form));

    await waitFor(() => expect(listen).toHaveBeenCalled());
    expect(firebase.calls).toEqual([
      'createUser:held=true',
      'updateProfile:Beatriz Santos',
      'onSnapshot:users/nova',
    ]);
    // Conta criada e logada, mas o fã segue fora até o perfil existir.
    expect(useSessionStore.getState()).toMatchObject({
      authHolds: 1,
      status: 'signedIn',
      user: { uid: 'nova', displayName: 'Beatriz Santos' },
    });

    firebase.profileMissing();
    expect(useSessionStore.getState().authHolds).toBe(1);

    act(() => firebase.profileArrives());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useSessionStore.getState().authHolds).toBe(0);
    expect(firebase.unsubscribe).toHaveBeenCalled();
    expect(haptics.trigger).toHaveBeenCalledWith('success');
  });

  it('manda o convite guardado depois do cadastro e o tira do aparelho', async () => {
    await savePendingInvite('ABC123');
    const firebase = fakeFirebase();
    const { result } = renderHook(() => useSignUp(), { wrapper });

    act(() => result.current.mutate(form));
    await waitFor(() => expect(listen).toHaveBeenCalled());
    expect(await readPendingInvite()).toMatchObject({ code: 'ABC123' });

    act(() => firebase.profileArrives());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // O convite vai depois de soltar o fã, sem segurar a tela.
    expect(useSessionStore.getState().authHolds).toBe(0);
    await waitFor(async () => expect(await readPendingInvite()).toBeNull());
  });

  it('conta nova passa pela escolha de artistas, mesmo que outra já tenha passado no aparelho', async () => {
    usePreferencesStore.setState({ hasCompletedOnboarding: true });
    const firebase = fakeFirebase();
    const { result } = renderHook(() => useSignUp(), { wrapper });

    act(() => result.current.mutate(form));
    await waitFor(() => expect(listen).toHaveBeenCalled());
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);

    act(() => firebase.profileArrives());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);
  });

  it('e-mail com conta: mostra o erro e solta o guard, sem mexer em nome nem perfil', async () => {
    usePreferencesStore.setState({ hasCompletedOnboarding: true });
    fakeFirebase();
    createUser.mockRejectedValueOnce(new FirebaseError('auth/email-already-in-use', 'in use'));
    const { result } = renderHook(() => useSignUp(), { wrapper });

    act(() => result.current.mutate(form));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(authErrorMessageKey(result.current.error, 'signUp')).toBe('auth.errors.emailInUse');
    expect(setProfile).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    expect(useSessionStore.getState().authHolds).toBe(0);
    // A conta não nasceu: a escolha de artistas feita no aparelho fica como estava.
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(true);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('se só o nome falhar, a conta segue e o perfil é esperado do mesmo jeito', async () => {
    const firebase = fakeFirebase();
    setProfile.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'rede'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSignUp(), { wrapper });

    act(() => result.current.mutate(form));
    await waitFor(() => expect(listen).toHaveBeenCalled());
    act(() => firebase.profileArrives());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useSessionStore.getState().authHolds).toBe(0);
    warn.mockRestore();
  });
});

describe('espera do perfil (waitForProfile)', () => {
  it('passado o prazo, libera sem o perfil e desliga o listener', async () => {
    jest.useFakeTimers();
    const firebase = fakeFirebase();
    const waiting = waitForProfile('nova', 20_000);

    jest.advanceTimersByTime(19_999);
    firebase.profileMissing();
    jest.advanceTimersByTime(1);

    await expect(waiting).resolves.toBe(false);
    expect(firebase.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('se a leitura falhar, libera na hora', async () => {
    const firebase = fakeFirebase();
    const waiting = waitForProfile('nova');
    firebase.readFails();
    await expect(waiting).resolves.toBe(false);
    expect(firebase.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('o perfil que chega depois do prazo não muda nada', async () => {
    jest.useFakeTimers();
    const firebase = fakeFirebase();
    const waiting = waitForProfile('nova', 1_000);
    jest.advanceTimersByTime(1_000);
    firebase.profileArrives();
    await expect(waiting).resolves.toBe(false);
    expect(firebase.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('criar a conta (signUpWithEmail)', () => {
  it('devolve a conta já com o nome', async () => {
    fakeFirebase();
    await expect(signUpWithEmail(form)).resolves.toEqual({
      uid: 'nova',
      email: form.email,
      displayName: 'Beatriz Santos',
      photoURL: null,
    });
    expect(createUser).toHaveBeenCalledWith({}, form.email, form.password);
  });
});

describe('esqueci minha senha', () => {
  it('conta que não existe responde igual à que existe', async () => {
    sendReset.mockRejectedValueOnce(new FirebaseError('auth/user-not-found', 'não existe'));
    await expect(sendPasswordReset('ninguem@x.com')).resolves.toBeUndefined();
    sendReset.mockResolvedValueOnce(undefined);
    await expect(sendPasswordReset('camila@x.com')).resolves.toBeUndefined();
  });

  it('falha de rede aparece como erro, com a mensagem da redefinição', async () => {
    sendReset.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed', 'rede'));
    const { result } = renderHook(() => usePasswordReset(), { wrapper });

    act(() => result.current.mutate('camila@x.com'));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(authErrorMessageKey(result.current.error, 'passwordReset')).toBe('auth.errors.network');
  });
});

describe('mensagens de erro do Firebase', () => {
  it.each([
    ['auth/invalid-credential', 'signIn', 'auth.errors.invalidCredentials'],
    ['auth/wrong-password', 'signIn', 'auth.errors.invalidCredentials'],
    ['auth/invalid-email', 'signUp', 'validation.emailInvalid'],
    ['auth/email-already-in-use', 'signUp', 'auth.errors.emailInUse'],
    ['auth/weak-password', 'signUp', 'auth.errors.weakPassword'],
    ['auth/operation-not-allowed', 'signUp', 'auth.errors.notAllowed'],
    ['auth/too-many-requests', 'passwordReset', 'auth.errors.tooManyRequests'],
    ['auth/network-request-failed', 'signUp', 'auth.errors.network'],
    ['auth/internal-error', 'signIn', 'auth.errors.unknown'],
    ['auth/internal-error', 'signUp', 'auth.errors.signUpUnknown'],
    ['auth/internal-error', 'passwordReset', 'auth.errors.resetUnknown'],
  ] as const)('%s (%s) vira %s', (code, action, key) => {
    expect(authErrorMessageKey(new FirebaseError(code, code), action)).toBe(key);
  });

  it('erro que não é do Firebase cai na mensagem genérica da ação', () => {
    expect(authErrorMessageKey(new Error('x'), 'signUp')).toBe('auth.errors.signUpUnknown');
  });
});
