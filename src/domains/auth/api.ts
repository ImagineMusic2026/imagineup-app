import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

import { dataSource } from '@/config/env';
import { clearPendingInvite, readPendingInvite } from '@/domains/invites';
import { getDb, getFirebaseAuth, isFirebaseConfigured } from '@/firebase';
import type { TranslationKey } from '@/i18n';
import { api } from '@/services/api';
import type { SessionUser } from '@/stores/session';

import { PROFILE_WAIT_MS } from './consts';

export function toSessionUser(user: User): SessionUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
}

/** Por enquanto, só e-mail e senha; Apple, Google e o login automático vêm depois (aprovado). */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

/**
 * Cria a conta e põe o nome nela logo em seguida. O SDK JS cria a conta sem
 * nome, e a função de cadastro (`createUserProfile`) lê o nome do registro
 * atual do Auth para montar o perfil e o @: quanto antes o nome chegar, menos
 * chance de o @ virar `fa` com dígitos.
 *
 * A conta já nasce logada. Se só o nome falhar (rede caindo no meio), o
 * cadastro segue: o perfil nasce sem nome e o fã preenche depois.
 */
export async function signUpWithEmail({
  name,
  email,
  password,
}: SignUpInput): Promise<SessionUser> {
  const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password);
  try {
    await updateProfile(user, { displayName: name });
  } catch (error) {
    if (__DEV__) console.warn('[auth] O nome não foi para a conta no cadastro.', error);
  }
  return toSessionUser(user);
}

/**
 * Espera o perfil (`users/{uid}`) aparecer: ele nasce na função de cadastro,
 * alguns segundos depois da conta. Devolve `true` quando ele existe e `false`
 * quando o prazo acaba ou a leitura falha; nos dois casos o app segue, e o
 * perfil chega depois.
 */
export function waitForProfile(uid: string, timeoutMs: number = PROFILE_WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (found: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(found);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);
    const stop = onSnapshot(
      doc(getDb(), 'users', uid),
      (snapshot) => {
        if (snapshot.exists()) finish(true);
      },
      () => finish(false),
    );
    // Se já terminou antes de o listener existir, desliga na hora.
    if (settled) stop();
    else unsubscribe = stop;
  });
}

/**
 * Depois do cadastro, manda à API o código do convite guardado (para ela
 * creditar quem convidou) e esquece o código. Sem a API (M2), não há a quem
 * creditar: o código sai do aparelho do mesmo jeito, para não ser atribuído a
 * uma próxima conta criada nele. Falha de rede mantém o código guardado.
 */
export async function claimPendingInvite(): Promise<void> {
  const invite = await readPendingInvite();
  if (!invite) return;
  if (dataSource === 'api') {
    // Endereço provisório, até o contrato do backend (M2). A chave sai do
    // próprio convite, para uma nova tentativa não creditar em dobro.
    await api.post(
      '/invites/claim',
      { code: invite.code },
      { headers: { 'Idempotency-Key': `invite-${invite.code}-${invite.receivedAt}` } },
    );
  }
  await clearPendingInvite();
}

/**
 * Manda o link para criar uma senha nova. Conta que não existe responde igual à
 * que existe: com a proteção contra enumeração do Firebase ligada ele já faz
 * isso, e sem ela (emulador, projeto antigo) este código garante o mesmo.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email);
  } catch (error) {
    if (error instanceof FirebaseError && error.code === 'auth/user-not-found') return;
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(getFirebaseAuth());
}

/** Avisa a cada mudança de sessão. Sem Firebase configurado, responde "deslogado". */
export function listenToAuth(callback: (user: SessionUser | null) => void): () => void {
  if (!isFirebaseConfigured) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(getFirebaseAuth(), (user) =>
    callback(user ? toSessionUser(user) : null),
  );
}

/** Qual das ações de conta falhou: muda a mensagem de erro genérica. */
export type AuthAction = 'signIn' | 'signUp' | 'passwordReset';

const UNKNOWN_ERROR: Record<AuthAction, TranslationKey> = {
  signIn: 'auth.errors.unknown',
  signUp: 'auth.errors.signUpUnknown',
  passwordReset: 'auth.errors.resetUnknown',
};

export function authErrorMessageKey(error: unknown, action: AuthAction = 'signIn'): TranslationKey {
  if (!(error instanceof FirebaseError)) return UNKNOWN_ERROR[action];
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'auth.errors.invalidCredentials';
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return 'validation.emailInvalid';
    case 'auth/email-already-in-use':
      return 'auth.errors.emailInUse';
    case 'auth/weak-password':
      return 'auth.errors.weakPassword';
    case 'auth/operation-not-allowed':
      return 'auth.errors.notAllowed';
    case 'auth/too-many-requests':
      return 'auth.errors.tooManyRequests';
    case 'auth/network-request-failed':
      return 'auth.errors.network';
    default:
      return UNKNOWN_ERROR[action];
  }
}
