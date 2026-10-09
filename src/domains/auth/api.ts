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

import { sourceOf } from '@/config/data-source';
import {
  invitePathForServer,
  normalizeInviteCode,
  type BoundInvite,
  type InviteClaimBody,
  type InviteClaimResult,
  type InviteOrigin,
  type InviteUtm,
  type InviteVisitBody,
  type InviteVisitResult,
  type PendingInvite,
} from '@/domains/invites';
import { getDb, getFirebaseAuth, isFirebaseConfigured } from '@/firebase';
import type { TranslationKey } from '@/i18n';
import { api, ApiError } from '@/services/api';
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
 * `updatedAt` do servidor, o `firstProfileName` do `firestore.rules`). É a
 * única gravação do fã no perfil: com o nome de antes `null`, uma vez só;
 * depois dela, o resto da edição vai pela API (`PUT /me/profile`, seção 28 de
 * docs/arquitetura-api.md).
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

// --- Convite (bloco 5, docs/arquitetura-api.md, 20.11) -------------------------------

/** Os `utm_*` que vão no corpo: só os que vieram, e nada quando nenhum veio. */
function utmOf(origin: InviteOrigin | null): InviteUtm | undefined {
  if (!origin) return undefined;
  const utm: InviteUtm = {};
  if (origin.utm.source) utm.source = origin.utm.source;
  if (origin.utm.medium) utm.medium = origin.utm.medium;
  if (origin.utm.campaign) utm.campaign = origin.utm.campaign;
  return Object.keys(utm).length > 0 ? utm : undefined;
}

/**
 * O corpo do claim do convite amarrado: o código normalizado, como chegou
 * (`link`, com a página sem a busca, os `utm_*` e o instante em que o link
 * abriu o app) ou digitado (`code`, sem página e com `openedAt` null).
 */
export function buildClaimBody(bound: BoundInvite): InviteClaimBody {
  const code = normalizeInviteCode(bound.code) ?? bound.code;
  if (bound.via === 'code' || !bound.origin) {
    return { code, via: 'code', link: null, openedAt: null };
  }
  const utm = utmOf(bound.origin);
  return {
    code,
    via: 'link',
    link: { path: invitePathForServer(bound.origin.path) },
    ...(utm ? { utm } : {}),
    openedAt: bound.receivedAt,
  };
}

/** O corpo da visita: o link guardado no aparelho, como no claim. */
export function buildVisitBody(pending: PendingInvite): InviteVisitBody {
  const utm = utmOf(pending.origin);
  return {
    code: normalizeInviteCode(pending.code) ?? pending.code,
    link: { path: invitePathForServer(pending.origin.path) },
    ...(utm ? { utm } : {}),
    openedAt: pending.receivedAt,
  };
}

/** A chave da visita: o mesmo link, a mesma visita. */
export function visitIdempotencyKey(pending: PendingInvite): string {
  return `visit-${normalizeInviteCode(pending.code) ?? pending.code}-${pending.receivedAt}`;
}

/**
 * Manda o convite amarrado ao servidor, com o token só da conta dele
 * (`sessionUid`: se outro fã entrou no meio, o pedido não sai) e a chave fixa
 * do convite. Nas fixtures (`sourceOf('invite')`), não há a quem creditar:
 * responde como aceito, sem chamar nada, e o convite sai do aparelho.
 */
export async function sendInviteClaim(bound: BoundInvite): Promise<InviteClaimResult> {
  if (sourceOf('invite') === 'fixtures') return { status: 'claimed' };
  const { data } = await api.post<InviteClaimResult>('/invites/claim', buildClaimBody(bound), {
    headers: { 'Idempotency-Key': bound.idempotencyKey },
    sessionUid: bound.uid,
  });
  return data;
}

/**
 * A visita ao link de convite, da conta logada (`uid`). Nas fixtures, nada.
 * O app não mostra o resultado.
 */
export async function sendInviteVisit(
  pending: PendingInvite,
  uid: string,
): Promise<InviteVisitResult> {
  if (sourceOf('invite') === 'fixtures') return { status: 'received' };
  const { data } = await api.post<InviteVisitResult>('/invites/visit', buildVisitBody(pending), {
    headers: { 'Idempotency-Key': visitIdempotencyKey(pending) },
    sessionUid: uid,
  });
  return data;
}

/**
 * As recusas definitivas do convite, pelo código do corpo do erro: o app
 * esquece o convite. Todo o resto é incerto e fica para a próxima rodada:
 * sem status (rede, tempo, o `getIdToken` que falhou antes de o pedido sair,
 * a sessão que mudou), 401, 429, 5xx e um 4xx sem um destes códigos (o
 * `not_found` de um servidor que ainda não tem a rota). O `isRetryable` não
 * serve: o `unknown` sem status e o 429 não são recusa. O 403
 * `account_suspended` (a conta suspensa pela equipe, bloco 11) também é
 * definitivo: sem ele, a sincronização repetiria o claim e a visita do
 * suspenso por até 7 dias.
 */
export const FINAL_INVITE_REJECTIONS: readonly string[] = [
  'invalid_request',
  'idempotency_key_required',
  'not_fan',
  'account_suspended',
  'invite_not_found',
  'invite_not_allowed',
  'idempotency_key_reused',
];

export function isFinalInviteRejection(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status !== null &&
    error.code !== null &&
    FINAL_INVITE_REJECTIONS.includes(error.code)
  );
}

/** Por que o código digitado no cadastro foi recusado (o fã corrige ou segue sem ele). */
export type InviteRejection = 'notFound' | 'notAllowed';

/** A recusa que o fã consegue consertar digitando: código que não existe ou que não vale. */
export function typedInviteRejection(error: unknown): InviteRejection | null {
  if (!(error instanceof ApiError) || error.status === null) return null;
  if (error.code === 'invite_not_found') return 'notFound';
  if (error.code === 'invite_not_allowed') return 'notAllowed';
  return null;
}

/**
 * Quando a conta da sessão nasceu e quando entrou pela última vez (o
 * `metadata` do Firebase Auth, que vem do servidor), em ms. Sem conta, null.
 */
export function currentAccountTimes(
  uid: string,
): { createdAt: number | null; lastSignInAt: number | null } | null {
  if (!isFirebaseConfigured) return null;
  const user = getFirebaseAuth().currentUser;
  if (!user || user.uid !== uid) return null;
  const parse = (value: string | undefined) => {
    const ms = value ? Date.parse(value) : NaN;
    return Number.isNaN(ms) ? null : ms;
  };
  return {
    createdAt: parse(user.metadata.creationTime),
    lastSignInAt: parse(user.metadata.lastSignInTime),
  };
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
