import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updatePassword,
  updateProfile,
  verifyBeforeUpdateEmail,
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
import type { SessionUser, SignInMethod } from '@/stores/session';
import { displayNameOrNull } from '@/utils/visible-line';

import { PROFILE_WAIT_MS } from './consts';

const METHOD_BY_PROVIDER: Readonly<Record<string, SignInMethod>> = {
  password: 'password',
  'google.com': 'google',
  'apple.com': 'apple',
};

/** O jeito de entrar de um `providerId` do Firebase; outro provedor (o Admin SDK, o seed), `null`. */
export function signInMethodOf(providerId: string | null | undefined): SignInMethod | null {
  return providerId ? (METHOD_BY_PROVIDER[providerId] ?? null) : null;
}

export function toSessionUser(user: User): SessionUser {
  // Sem a lista (usuário montado à mão), conta como sem senha: as linhas de
  // trocar senha e e-mail só aparecem com certeza.
  const providers: SignInMethod[] = [];
  for (const info of user.providerData ?? []) {
    const method = signInMethodOf(info.providerId);
    if (method && !providers.includes(method)) providers.push(method);
  }
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    hasPassword: providers.includes('password'),
    providers,
  };
}

/**
 * Por onde a sessão entrou: o `signInProvider` do token (seção 33, decisões 9,
 * 12 e 14), e não a lista de provedores, porque a mesma conta pode ter a Apple
 * e o Google. Lê o token em cache; vencido, o SDK renova pela rede, e a falha
 * (sem rede) rejeita. Outro provedor (o Admin SDK, o seed), `null`. Quem chama
 * não espera por ele para abrir o app.
 */
export async function sessionProvider(user: User): Promise<SignInMethod | null> {
  const { signInProvider } = await user.getIdTokenResult();
  return signInMethodOf(signInProvider);
}

/** Entra com e-mail e senha e devolve a conta (a entrada social mora em `social.ts`). */
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
 * A conta da sessão, confirmada pelo Auth (o app abre com a sessão presumida,
 * e o SDK pode levar segundos para confirmá-la). Sem conta logada,
 * `SessionEndedError`.
 */
export async function confirmedUser(): Promise<User> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new SessionEndedError();
  return user;
}

/**
 * A exclusão precisa da sessão confirmada agora, pelo provedor dela (`method`):
 * o Firebase pediu o login recente (`auth/requires-recent-login`) ou a Apple
 * ligada pede a confirmação antes da tentativa de revogação (seção 33,
 * decisão 12). A exclusão em `social.ts` lança este erro.
 */
export class RecentLoginRequiredError extends Error {
  constructor(readonly method: SignInMethod) {
    super(`A exclusão pede o login recente (${method}).`);
    this.name = 'RecentLoginRequiredError';
  }
}

/**
 * Por que a exclusão não passou:
 * - `needsPassword`: o login é antigo, e o Firebase pede a senha de novo;
 * - `needsGoogle`: o mesmo, na sessão do Google, que confirma pela folha do Google;
 * - `wrongPassword`: a senha da reautenticação não confere;
 * - `wrongAccount`: a folha do Google ou da Apple voltou com outra conta (`auth/user-mismatch`);
 * - `sessionEnded`: a conta já não está logada (ou sumiu, ou foi desativada);
 * - `network`, `tooManyRequests` e `unknown`: a conta continua como estava.
 *
 * O `auth/invalid-credential` só é senha errada no pedido da senha (`method`).
 * Na reautenticação pelo Google ou pela Apple, é o token da folha que o
 * Firebase recusou (vencido, de outro público): `unknown`, que a tela mostra,
 * e não "Senha incorreta.", que só o campo de senha mostra.
 */
export type DeleteAccountFailure =
  | 'needsPassword'
  | 'needsGoogle'
  | 'wrongPassword'
  | 'wrongAccount'
  | 'network'
  | 'tooManyRequests'
  | 'sessionEnded'
  | 'unknown';

export function deleteAccountFailure(
  error: unknown,
  method: SignInMethod = 'password',
): DeleteAccountFailure {
  if (error instanceof SessionEndedError) return 'sessionEnded';
  if (error instanceof RecentLoginRequiredError) {
    // A sessão da Apple sempre abre a folha dela: não há estágio a mostrar.
    if (error.method === 'apple') return 'unknown';
    return error.method === 'google' ? 'needsGoogle' : 'needsPassword';
  }
  if (!(error instanceof FirebaseError)) return 'unknown';
  switch (error.code) {
    case 'auth/requires-recent-login':
      return 'needsPassword';
    case 'auth/user-mismatch':
      return 'wrongAccount';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
      return method === 'password' ? 'wrongPassword' : 'unknown';
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
  const user = await confirmedUser();
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

/**
 * Avisa a cada mudança de sessão. Sem Firebase configurado, responde
 * "deslogado". O provedor da sessão (`sessionProvider`) chega depois, pelo
 * `onSignInProvider`, só se a conta ainda for a da sessão: ler o token não
 * segura a abertura.
 */
export function listenToAuth(
  callback: (user: SessionUser | null) => void,
  onSignInProvider?: (uid: string, provider: SignInMethod | null) => void,
): () => void {
  if (!isFirebaseConfigured) {
    callback(null);
    return () => undefined;
  }
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, (user) => {
    callback(user ? toSessionUser(user) : null);
    if (!user || !onSignInProvider) return;
    // Sem rede com o token vencido, fica sem o provedor, e vale o último
    // jeito de entrar do aparelho; a próxima mudança de sessão lê de novo.
    sessionProvider(user)
      .then((provider) => {
        if (auth.currentUser?.uid === user.uid) onSignInProvider(user.uid, provider);
      })
      .catch(() => undefined);
  });
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
