import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';

import { dataSource } from '@/config/env';
import { clearPendingInvite, readPendingInvite } from '@/domains/invites';
import { getDb, getFirebaseAuth, isFirebaseConfigured } from '@/firebase';
import type { TranslationKey } from '@/i18n';
import { api } from '@/services/api';
import type { SessionUser } from '@/stores/session';
import { displayNameOrNull } from '@/utils/visible-line';

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
 * atual do Auth para montar o perfil e o @, esperando por ele alguns segundos:
 * se o nome chegar depois disso, o @ vira `fa` com dígitos (e o cadastro tenta
 * gravar o nome no perfil por `fillMissingProfileName`).
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

/** O que o cadastro lê do perfil que acabou de nascer. */
export interface NewProfile {
  displayName: string | null;
}

/**
 * Espera o perfil (`users/{uid}`) aparecer: ele nasce na função de cadastro,
 * alguns segundos depois da conta. Devolve o perfil quando ele existe e `null`
 * quando o prazo acaba ou a leitura falha; nos dois casos o app segue, e o
 * perfil chega depois.
 */
export function waitForProfile(
  uid: string,
  timeoutMs: number = PROFILE_WAIT_MS,
): Promise<NewProfile | null> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (profile: NewProfile | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(profile);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    const stop = onSnapshot(
      doc(getDb(), 'users', uid),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const { displayName } = snapshot.data();
        finish({
          displayName: typeof displayName === 'string' && displayName ? displayName : null,
        });
      },
      () => finish(null),
    );
    // Se já terminou antes de o listener existir, desliga na hora.
    if (settled) stop();
    else unsubscribe = stop;
  });
}

/**
 * Rede de segurança da corrida do cadastro. A função de cadastro espera o nome
 * por alguns segundos (`NAME_WAIT_MS` em `functions/src/handlers.ts`); se o
 * `updateProfile` chegou depois disso, o perfil nasce sem nome. Aqui o fã grava
 * o nome da sessão pelo caminho que as regras dão a ele (`displayName` com
 * `updatedAt` do servidor). É a primeira edição do perfil, então a trava de
 * 10 s não pega.
 *
 * O @ não muda: ele é do servidor (o fã não grava `username` nem `usernames/`)
 * e continua `fa` com dígitos.
 *
 * Só grava com o perfil já nascido, sem nome, e com um nome na sessão que as
 * regras aceitam (linha visível de até 60). Devolve se gravou. É uma tentativa
 * só, no cadastro: perfil que chega depois do `PROFILE_WAIT_MS` não recebe o
 * nome, e a recusa não tenta de novo. Quem chama não espera: sem rede, a
 * gravação fica na fila do SDK e não segura o cadastro, mas essa fila fica só
 * na memória no React Native e se perde se o app fechar antes de a rede voltar.
 */
export async function fillMissingProfileName(
  uid: string,
  profile: NewProfile | null,
  sessionName: string | null,
): Promise<boolean> {
  const name = displayNameOrNull(sessionName);
  if (!profile || profile.displayName !== null || !name) return false;
  await updateDoc(doc(getDb(), 'users', uid), {
    displayName: name,
    updatedAt: serverTimestamp(),
  });
  return true;
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

/** Não há conta logada para a ação (a sessão caiu por fora do app). */
export class SessionEndedError extends Error {
  constructor(message = 'Sem sessão no Firebase Auth.') {
    super(message);
    this.name = 'SessionEndedError';
  }
}

/**
 * Exclui a conta no Firebase Auth. Com `password`, reautentica antes com a
 * credencial de e-mail: o Firebase recusa a exclusão
 * (`auth/requires-recent-login`) quando o login foi há muito tempo. O perfil
 * (`users/{uid}`) e a reserva do @ são apagados no servidor, pela função
 * `deleteUserProfile`; o app não apaga nada no Firestore. A exclusão é uma
 * só chamada ao Auth: ou a conta some, ou fica como estava.
 *
 * Espera a sessão confirmada (o app abre com a sessão presumida). Sem conta
 * logada, ou sem e-mail para reautenticar, devolve `SessionEndedError`: o fã
 * entra de novo e a exclusão passa.
 */
export async function deleteAccount(password?: string): Promise<void> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new SessionEndedError();
  if (password !== undefined) {
    // Só e-mail e senha por enquanto; Apple e Google vão reautenticar pelo provedor deles.
    if (!user.email) throw new SessionEndedError('Conta sem e-mail para reautenticar.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  }
  await deleteUser(user);
}

/**
 * Por que a exclusão não passou:
 * - `needsPassword`: o login é antigo, e o Firebase pede a senha de novo;
 * - `wrongPassword`: a senha da reautenticação não confere;
 * - `sessionEnded`: a conta já não está logada (ou sumiu, ou foi desativada);
 * - `network`, `tooManyRequests` e `unknown`: a conta continua como estava.
 */
export type DeleteAccountFailure =
  'needsPassword' | 'wrongPassword' | 'network' | 'tooManyRequests' | 'sessionEnded' | 'unknown';

export function deleteAccountFailure(error: unknown): DeleteAccountFailure {
  if (error instanceof SessionEndedError) return 'sessionEnded';
  if (!(error instanceof FirebaseError)) return 'unknown';
  switch (error.code) {
    case 'auth/requires-recent-login':
      return 'needsPassword';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return 'wrongPassword';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/too-many-requests':
      return 'tooManyRequests';
    case 'auth/user-not-found':
    case 'auth/user-token-expired':
    case 'auth/user-disabled':
      return 'sessionEnded';
    default:
      return 'unknown';
  }
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
