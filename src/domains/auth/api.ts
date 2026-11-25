import { AppleAuthenticationCredentialState } from 'expo-apple-authentication';
import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

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
import { appleCredential, appleCredentialState } from '@/services/apple-sign-in';
import {
  googleIdToken,
  GoogleSignInError,
  revokeGoogleAccess,
  signOutGoogle,
} from '@/services/google-sign-in';
import type { SessionUser } from '@/stores/session';
import { displayNameOrNull } from '@/utils/visible-line';

// Nunca o `./apple-entry`, que importa este arquivo: o ciclo de import.
import {
  APPLE_PROVIDER_ID,
  appleUidOf,
  clearPendingAppleNameOf,
  revokeAppleToken,
} from './apple-account';
import { PROFILE_WAIT_MS } from './consts';

export function toSessionUser(user: User): SessionUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    // A foto pública continua sendo a enviada no perfil do ImagineUP.
    photoURL: user.providerData?.some((info) => info.providerId === 'google.com')
      ? null
      : user.photoURL,
    // Sem a lista (usuário montado à mão), conta como sem senha: as linhas de
    // trocar senha e e-mail só aparecem com certeza.
    hasPassword: user.providerData?.some((info) => info.providerId === 'password') ?? false,
  };
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const { user } = await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
  return user;
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

export async function signOut(expectedUid?: string | null): Promise<void> {
  const auth = getFirebaseAuth();
  if (expectedUid !== undefined && auth.currentUser && auth.currentUser.uid !== expectedUid) return;
  await firebaseSignOut(auth);
  void signOutGoogle();
}

/** Não há conta logada para a ação (a sessão caiu por fora do app). */
export class SessionEndedError extends Error {
  constructor(message = 'Sem sessão no Firebase Auth.') {
    super(message);
    this.name = 'SessionEndedError';
  }
}

/** A exclusão parou num passo que o app conhece (a confirmação que falta ou que falhou). */
class DeletionError extends Error {
  constructor(
    readonly failure:
      | 'needsPassword'
      | 'needsGoogle'
      | 'wrongGoogleAccount'
      | 'googleUnavailable'
      | 'wrongAppleAccount'
      | 'appleUnavailable',
  ) {
    super(failure);
  }
}

export type DeleteAccountOutcome = 'deleted' | 'canceled';

/**
 * O provedor que abriu a sessão (o `signInProvider` do ID token: `password`,
 * `google.com`, `apple.com`), ou `null` quando o token não sai. Ler o token
 * pode encerrar uma sessão invalidada (o `_logoutIfInvalidated` do SDK): quem
 * chama confere a sessão depois. O usuário montado à mão, sem o método, também
 * dá `null`.
 */
export async function sessionSignInProvider(user: User): Promise<string | null> {
  try {
    return (await user.getIdTokenResult()).signInProvider ?? null;
  } catch {
    return null;
  }
}

/**
 * A conta da exclusão ainda é a da sessão. Sem sessão nenhuma (a leitura do
 * token a encerrou, a conta caiu por fora), `SessionEndedError`; com a sessão
 * de outra conta, `false`, e a exclusão para sem erro.
 */
function stillSameSession(auth: Auth, user: User): boolean {
  if (!auth.currentUser) throw new SessionEndedError();
  return auth.currentUser.uid === user.uid;
}

/**
 * Como a exclusão confirma a Apple da conta, só no iPhone (39.4):
 * - `apple`: a folha da Apple reautentica, e o código dela revoga o acesso;
 * - `appleLinked`: a senha confirma, e a folha da Apple só tenta revogar;
 * - `null`: sem a Apple na conta, ou fora do iPhone (como antes).
 */
export type AppleDeletionMode = 'apple' | 'appleLinked' | null;

async function appleDeletionModeFor(user: User): Promise<AppleDeletionMode> {
  // Android e conta sem Apple: nem lê o token.
  if (Platform.OS !== 'ios' || appleUidOf(user) === null) return null;
  if ((await sessionSignInProvider(user)) === APPLE_PROVIDER_ID) return 'apple';
  // No iPhone só a senha ou a Apple confirmam (o Google é só do Android): a
  // conta sem senha nunca cai em needsPassword.
  return toSessionUser(user).hasPassword ? 'appleLinked' : 'apple';
}

/**
 * O modo da Apple na exclusão da conta da sessão `expectedUid`, para a tela
 * escrever o botão e o aviso antes do toque. Fora do iPhone, sem Firebase, com
 * outra sessão ou com erro, `null`.
 */
export async function appleDeletionMode(expectedUid: string): Promise<AppleDeletionMode> {
  if (Platform.OS !== 'ios' || !isFirebaseConfigured) return null;
  try {
    const auth = getFirebaseAuth();
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user || user.uid !== expectedUid) return null;
    return await appleDeletionModeFor(user);
  } catch {
    return null;
  }
}

/**
 * A sessão aberta pela Apple (ou a conta só da Apple): a folha da Apple sempre,
 * que reautentica e traz o código da revogação. A ordem é a folha, a
 * reautenticação, a revogação e só então o `deleteUser`, com a sessão
 * conferida depois de cada espera. A folha fechada é `canceled`, sem mudar
 * nada; outra Conta Apple é `wrongAppleAccount`, e o resto da Apple,
 * `appleUnavailable`, nunca o campo da senha.
 */
async function deleteWithApple(
  auth: Auth,
  user: User,
  appleUid: string | null,
): Promise<DeleteAccountOutcome> {
  let apple;
  try {
    apple = await appleCredential();
  } catch {
    throw new DeletionError('appleUnavailable');
  }
  if (!apple) return 'canceled';
  if (!stillSameSession(auth, user)) return 'canceled';
  try {
    // O Firebase confere que o token da Apple é da conta original.
    await reauthenticateWithCredential(
      user,
      new OAuthProvider(APPLE_PROVIDER_ID).credential({
        idToken: apple.identityToken,
        rawNonce: apple.rawNonce,
      }),
    );
  } catch (error) {
    if (!stillSameSession(auth, user)) return 'canceled';
    if (error instanceof FirebaseError && error.code === 'auth/user-mismatch') {
      throw new DeletionError('wrongAppleAccount');
    }
    if (
      error instanceof FirebaseError &&
      (error.code === 'auth/invalid-credential' || error.code === 'auth/missing-or-invalid-nonce')
    ) {
      throw new DeletionError('appleUnavailable');
    }
    throw error;
  }
  if (auth.currentUser?.uid !== user.uid) return 'canceled';
  // Antes do `deleteUser`: a revogação leva o ID token da conta viva. Nunca lança.
  if (apple.authorizationCode) await revokeAppleToken(apple.authorizationCode, user);
  if (!stillSameSession(auth, user)) return 'canceled';
  try {
    await deleteUser(user);
  } catch (error) {
    if (error instanceof FirebaseError && error.code === 'auth/requires-recent-login') {
      throw new DeletionError('appleUnavailable');
    }
    throw error;
  }
  if (appleUid) await clearPendingAppleNameOf(appleUid).catch(() => undefined);
  return 'deleted';
}

/**
 * A Apple ligada a uma sessão de senha, no iPhone, depois da senha e antes do
 * `deleteUser`: a tentativa de revogar, sem reautenticar pela Apple. A folha
 * sempre autoriza a Conta Apple que está no iPhone: com a credencial da conta
 * já fora dele (`REVOKED`, `NOT_FOUND`, `TRANSFERRED`), ela nem abre, para não
 * deixar uma autorização do ImagineUP em outra Conta Apple. O código só vai ao
 * REST quando a folha volta com o `user` da Apple desta conta: o de outra Conta
 * Apple revogaria o acesso de outra pessoa. Cancelada, com outra Conta Apple
 * ou com erro, a exclusão segue sem revogar.
 */
async function revokeLinkedApple(auth: Auth, user: User, appleUid: string): Promise<void> {
  const state = await appleCredentialState(appleUid);
  // Nada a revogar neste iPhone; o estado desconhecido (`null`) abre a folha.
  if (state !== null && state !== AppleAuthenticationCredentialState.AUTHORIZED) return;
  const apple = await appleCredential().catch(() => null);
  // Cancelou, outra Conta Apple ou erro.
  if (!apple || apple.user !== appleUid || !apple.authorizationCode) return;
  if (auth.currentUser?.uid !== user.uid) return;
  await revokeAppleToken(apple.authorizationCode, user);
}

/**
 * Exclui a conta no Firebase Auth. Se o Firebase pedir um login recente,
 * reautentica a mesma conta com a senha ou com o Google. O perfil
 * (`users/{uid}`) e a reserva do @ são apagados no servidor, pela função
 * `deleteUserProfile`; o app não apaga nada no Firestore. A exclusão é uma
 * só chamada ao Auth: ou a conta some, ou fica como estava.
 *
 * Com a Apple na conta, no iPhone (39.4): a sessão da Apple (ou a conta só da
 * Apple) confirma pela folha da Apple (`deleteWithApple`); a Apple ligada a
 * uma sessão de senha pede a senha já no primeiro toque (`needsPassword`) e,
 * depois dela, tenta revogar a Apple (`revokeLinkedApple`). O nome guardado da
 * Apple dessa conta sai do aparelho com ela. Fora do iPhone e sem a Apple,
 * nada muda: nem o token é lido.
 *
 * Espera a sessão confirmada (o app abre com a sessão presumida). Sem conta
 * logada, ou sem e-mail para reautenticar, devolve `SessionEndedError`: o fã
 * entra de novo e a exclusão passa.
 */
export async function deleteAccount(
  password?: string,
  confirmGoogle = false,
  expectedUid?: string,
): Promise<DeleteAccountOutcome> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new SessionEndedError();
  if (expectedUid && user.uid !== expectedUid) return 'canceled';
  const hasGoogle = user.providerData?.some((info) => info.providerId === 'google.com') ?? false;
  const googleOnly = hasGoogle && !toSessionUser(user).hasPassword;
  // Lido antes: a lista de provedores some com a conta.
  const appleUid = appleUidOf(user);
  const apple = await appleDeletionModeFor(user);
  if (!stillSameSession(auth, user)) return 'canceled';
  if (apple === 'apple') return deleteWithApple(auth, user, appleUid);

  if (confirmGoogle) {
    if (!googleOnly) return 'canceled';
    const google = await googleIdToken().catch((error: unknown) => {
      if (error instanceof GoogleSignInError) throw new DeletionError('googleUnavailable');
      throw error;
    });
    if (!google) return 'canceled';
    if (auth.currentUser?.uid !== user.uid) return 'canceled';
    try {
      // O Firebase valida que o token pertence à conta original e não entra em outra.
      await reauthenticateWithCredential(user, GoogleAuthProvider.credential(google.idToken));
    } catch (error) {
      if (auth.currentUser?.uid !== user.uid) return 'canceled';
      void signOutGoogle();
      if (error instanceof FirebaseError && error.code === 'auth/user-mismatch') {
        throw new DeletionError('wrongGoogleAccount');
      }
      if (error instanceof FirebaseError && error.code === 'auth/invalid-credential') {
        throw new DeletionError('googleUnavailable');
      }
      throw error;
    }
  } else if (password !== undefined) {
    if (!user.email) throw new SessionEndedError('Conta sem e-mail para reautenticar.');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  } else if (apple === 'appleLinked') {
    // A confirmação no primeiro toque: a revogação vem depois de um login recente.
    throw new DeletionError('needsPassword');
  }

  // Depois da senha, antes do `deleteUser`.
  if (apple === 'appleLinked' && appleUid) await revokeLinkedApple(auth, user, appleUid);
  if (auth.currentUser?.uid !== user.uid) return 'canceled';
  try {
    await deleteUser(user);
  } catch (error) {
    if (
      googleOnly &&
      error instanceof FirebaseError &&
      error.code === 'auth/requires-recent-login'
    ) {
      throw new DeletionError('needsGoogle');
    }
    throw error;
  }
  if (appleUid) await clearPendingAppleNameOf(appleUid).catch(() => undefined);
  if (confirmGoogle) void revokeGoogleAccess();
  else if (hasGoogle) void signOutGoogle();
  return 'deleted';
}

/**
 * Por que a exclusão não passou:
 * - `needsPassword`, `needsGoogle`: o Firebase pede um login recente (e a Apple
 *   ligada a uma sessão de senha, no iPhone, pede a senha já no primeiro toque);
 * - `wrongPassword`, `wrongGoogleAccount`, `googleUnavailable`, `wrongAppleAccount`,
 *   `appleUnavailable`: a reautenticação falhou;
 * - `sessionEnded`: a conta já não está logada (ou sumiu, ou foi desativada);
 * - `network`, `tooManyRequests` e `unknown`: a conta continua como estava.
 */
export type DeleteAccountFailure =
  | DeletionError['failure']
  | 'wrongPassword'
  | 'network'
  | 'tooManyRequests'
  | 'sessionEnded'
  | 'unknown';

export function deleteAccountFailure(error: unknown): DeleteAccountFailure {
  if (error instanceof SessionEndedError) return 'sessionEnded';
  if (error instanceof DeletionError) return error.failure;
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

/**
 * A conta da sessão, confirmada e reautenticada com a senha atual, para trocar
 * a senha ou o e-mail (seção 29, decisão 18). Reautentica sempre, sem esperar
 * o `auth/requires-recent-login`. Espera a sessão confirmada (o app abre com
 * a presumida); sem conta logada, ou sem e-mail para reautenticar,
 * `SessionEndedError`.
 */
async function reauthenticatedUser(currentPassword: string): Promise<User> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new SessionEndedError();
  if (!user.email) throw new SessionEndedError('Conta sem e-mail para reautenticar.');
  await reauthenticateWithCredential(
    user,
    EmailAuthProvider.credential(user.email, currentPassword),
  );
  return user;
}

/**
 * Troca a senha. O SDK renova o token deste aparelho, e a sessão continua; os
 * outros aparelhos saem quando o token deles vence, em até 1 hora. A `api`
 * aceita o token antigo até ele vencer (sem `checkRevoked`, 29.1, decisão 18).
 */
export async function changePassword(current: string, next: string): Promise<void> {
  const user = await reauthenticatedUser(current);
  await updatePassword(user, next);
}

/**
 * Pede a troca do e-mail: manda o link para o e-mail novo, e nada muda até o
 * fã abrir o link. Sempre o `verifyBeforeUpdateEmail`, nunca o `updateEmail`:
 * com a proteção contra enumeração de e-mails ligada, ele é barrado
 * (`auth/operation-not-allowed`). Sem `actionCodeSettings`: o link abre o
 * tratador padrão do Firebase, e o e-mail sai em pt-BR pelo `languageCode`
 * do Auth. Aberto o link, o Firebase revoga as sessões, e este aparelho sai
 * quando o SDK renova o token.
 */
export async function requestEmailChange(current: string, newEmail: string): Promise<void> {
  const user = await reauthenticatedUser(current);
  await verifyBeforeUpdateEmail(user, newEmail);
}

/** As falhas que a troca de senha e a de e-mail dividem, pelo código do Firebase. */
type SharedChangeFailure = 'wrongPassword' | 'tooManyRequests' | 'network' | 'sessionEnded';

const SHARED_CHANGE_FAILURES: Partial<Record<string, SharedChangeFailure>> = {
  'auth/invalid-credential': 'wrongPassword',
  'auth/wrong-password': 'wrongPassword',
  'auth/too-many-requests': 'tooManyRequests',
  'auth/network-request-failed': 'network',
  'auth/user-token-expired': 'sessionEnded',
  'auth/user-not-found': 'sessionEnded',
  'auth/user-disabled': 'sessionEnded',
};

/**
 * Por que a troca de senha não passou:
 * - `wrongPassword`: a senha atual não confere;
 * - `weakPassword`: o Firebase recusou a senha nova;
 * - `sessionEnded`: a conta já não está logada (sumiu, foi desativada, o token caiu);
 * - `network`, `tooManyRequests` e `unknown`: a senha continua a de antes.
 */
export type ChangePasswordFailure = SharedChangeFailure | 'weakPassword' | 'unknown';

export function changePasswordFailure(error: unknown): ChangePasswordFailure {
  if (error instanceof SessionEndedError) return 'sessionEnded';
  if (!(error instanceof FirebaseError)) return 'unknown';
  switch (error.code) {
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return 'weakPassword';
    default:
      return SHARED_CHANGE_FAILURES[error.code] ?? 'unknown';
  }
}

/**
 * Por que o link da troca de e-mail não saiu: as falhas da senha atual e da
 * sessão, como na troca de senha, e as do e-mail novo (`emailInUse`,
 * `invalidEmail`) e da configuração do projeto (`notAllowed`).
 */
export type ChangeEmailFailure =
  SharedChangeFailure | 'emailInUse' | 'invalidEmail' | 'notAllowed' | 'unknown';

export function changeEmailFailure(error: unknown): ChangeEmailFailure {
  if (error instanceof SessionEndedError) return 'sessionEnded';
  if (!(error instanceof FirebaseError)) return 'unknown';
  switch (error.code) {
    case 'auth/email-already-in-use':
      return 'emailInUse';
    case 'auth/invalid-new-email':
    case 'auth/invalid-email':
    case 'auth/missing-new-email':
      return 'invalidEmail';
    case 'auth/operation-not-allowed':
      return 'notAllowed';
    default:
      return SHARED_CHANGE_FAILURES[error.code] ?? 'unknown';
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
    // A política de senha do projeto, como na troca de senha: sem ela aqui, o
    // cadastro dizia só que não foi possível criar a conta, sem apontar a senha.
    case 'auth/password-does-not-meet-requirements':
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
