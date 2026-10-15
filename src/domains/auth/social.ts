import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  EmailAuthProvider,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  linkWithCredential,
  OAuthProvider,
  reauthenticateWithCredential,
  signInWithCredential,
  updateProfile,
  type OAuthCredential,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { Platform } from 'react-native';

import { sourceOf } from '@/config/data-source';
import { firebaseEmulatorHost, firebaseEnv } from '@/config/env';
import { getFirebaseAuth } from '@/firebase';
import type { TranslationKey } from '@/i18n';
import { api } from '@/services/api';
import { appleCredential } from '@/services/apple-sign-in';
import {
  GoogleSignInError,
  googleIdToken,
  revokeGoogleAccess,
  signOutGoogle,
} from '@/services/google-sign-in';
import { storage, StorageKeys } from '@/storage/storage';
import type { SignInMethod } from '@/stores/session';
import { displayNameOrNull } from '@/utils/visible-line';

import {
  confirmedUser,
  fillMissingProfileName,
  RecentLoginRequiredError,
  SessionEndedError,
  waitForProfile,
  type NewProfile,
} from './api';
import { APPLE_REVOKE_TIMEOUT_MS, EXISTING_ACCOUNT_CHECK_MS, IOS_BUNDLE_ID } from './consts';

// Entrar com a Apple e com o Google (seção 33 de docs/arquitetura-api.md,
// decisões 1, 6, 8, 11 e 12). A folha nativa do provedor devolve um token, que
// vira a credencial do SDK JS do Firebase (`signInWithCredential`): o SDK JS
// no React Native não tem popup nem redirect. Sem React: os hooks
// (`useSocialSignIn` e `useSignIn`) decidem o resto da entrada. A exclusão da
// conta pelo provedor da sessão também mora aqui, no fim, porque usa a
// revogação da Apple (o `api.ts` não importa este arquivo, que importa ele).

/** Os jeitos de entrar por um provedor, sem o e-mail e a senha. */
export type SocialMethod = Exclude<SignInMethod, 'password'>;

/** Como a entrada pelo provedor terminou, quando a folha não foi cancelada. */
export type SocialSignInResult =
  | {
      kind: 'signedIn';
      method: SocialMethod;
      user: User;
      /** A conta nasceu agora (segue o cadastro); falso, ela já existia (segue o entrar). */
      isNewUser: boolean;
      /** O nome guardado da Apple desta conta, que ainda vai para o perfil sem nome. */
      appleName: string | null;
    }
  /** O Google fora do Gmail, com uma conta de senha no mesmo e-mail: o modo "ligar" (decisão 8). */
  | { kind: 'link'; email: string };

// --- O nome da Apple (decisão 6) -----------------------------------------------------

/** O nome que a Apple mandou, com o `user` da Apple a quem ele pertence. */
export interface PendingAppleName {
  appleUserId: string;
  name: string;
}

function pendingAppleNameOf(raw: unknown): PendingAppleName | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { appleUserId, name } = raw as Record<string, unknown>;
  if (typeof appleUserId !== 'string' || !appleUserId) return null;
  if (typeof name !== 'string' || !name) return null;
  return { appleUserId, name };
}

export async function readPendingAppleName(): Promise<PendingAppleName | null> {
  return pendingAppleNameOf(await storage.getJSON<unknown>(StorageKeys.ApplePendingName));
}

function savePendingAppleName(pending: PendingAppleName): Promise<void> {
  return storage.setJSON(StorageKeys.ApplePendingName, pending);
}

export function clearPendingAppleName(): Promise<void> {
  return storage.remove(StorageKeys.ApplePendingName);
}

/** O `uid` da Apple na conta (o `user` da Apple), ou `null` sem a Apple. */
export function appleUidOf(user: User): string | null {
  return user.providerData?.find((info) => info.providerId === 'apple.com')?.uid ?? null;
}

/**
 * O nome da Apple desta conta: o que acabou de chegar (`fresh`) ou o guardado
 * no aparelho, só quando o `user` dele é o `uid` da Apple da conta. Vai para o
 * Auth com o `updateProfile` quando a conta está sem nome (a função de cadastro
 * espera o nome por 3,75 s; a Apple, ao entrar, também apaga o nome do Auth).
 * Devolve o nome, que ainda vai para o perfil sem nome
 * (`settlePendingAppleName`), ou `null`. A falha do `updateProfile` não
 * segura a entrada: o perfil recebe o nome pela regra do mesmo jeito.
 */
export async function applyPendingAppleName(
  user: User,
  fresh: PendingAppleName | null = null,
): Promise<string | null> {
  const pending = fresh ?? (await readPendingAppleName().catch(() => null));
  if (!pending || pending.appleUserId !== appleUidOf(user)) return null;
  if (!user.displayName) {
    try {
      await updateProfile(user, { displayName: pending.name });
    } catch (error) {
      if (__DEV__) console.warn('[auth] O nome da Apple não foi para a conta.', error);
    }
  }
  return pending.name;
}

/**
 * Depois de ler o perfil: sem nome, o nome guardado da Apple vai para ele pela
 * regra `firstProfileName` (o `fillMissingProfileName`), e a chave sai quando
 * o perfil tem nome (ou quando o nome não serve para ele). Sem o perfil (não
 * chegou no prazo, a leitura falhou), a chave fica para o início da próxima
 * sessão. A recusa da gravação rejeita, e a chave fica.
 */
export async function settlePendingAppleName(
  uid: string,
  profile: NewProfile | null,
  name: string,
): Promise<void> {
  if (!profile) return;
  if (profile.displayName === null && displayNameOrNull(name) !== null) {
    const written = await fillMissingProfileName(uid, profile, name);
    if (!written) return;
  }
  await clearPendingAppleName();
}

/** A conta do Auth de agora, só se ela for a da sessão `uid`. */
function currentUserOf(uid: string): User | null {
  const user = getFirebaseAuth().currentUser;
  return user && user.uid === uid ? user : null;
}

/** O `uid` da Apple na conta da sessão `uid` (o `user` da Apple), ou `null`. */
export function currentAppleUid(uid: string): string | null {
  const user = currentUserOf(uid);
  return user ? appleUidOf(user) : null;
}

/**
 * O nome guardado da Apple no início de uma sessão (decisão 6): com o app
 * fechado entre o `signInWithCredential` e o `updateProfile`, a sessão fica
 * salva no aparelho e não há entrada seguinte. Só com a chave da Apple desta
 * conta (o `user` da chave igual ao `uid` da Apple no `providerData`): o nome
 * vai para o Auth, se ele estiver sem nome, e para o perfil sem nome, lido em
 * até 3 s. Sem a chave, nada. A recusa da gravação no perfil rejeita, e a
 * chave fica para a próxima sessão.
 */
export async function settleSessionAppleName(uid: string): Promise<void> {
  const pending = await readPendingAppleName().catch(() => null);
  if (!pending) return;
  const user = currentUserOf(uid);
  if (!user) return;
  const name = await applyPendingAppleName(user, pending);
  if (name === null) return;
  const profile = await waitForProfile(uid, EXISTING_ACCOUNT_CHECK_MS);
  // A sessão trocou enquanto o perfil era lido: o nome fica para a dela.
  if (!currentUserOf(uid)) return;
  await settlePendingAppleName(uid, profile, name);
}

// --- A ligação pendente do Google (decisão 8) ----------------------------------------

/**
 * O Google que esbarrou numa conta de senha com o mesmo e-mail, só na memória:
 * o e-mail da conta Google (do pacote, e não do erro do Firebase, que só traz
 * o e-mail quando a resposta do servidor o traz) e a credencial do `idToken`.
 */
let pendingGoogleLink: { email: string; credential: OAuthCredential } | null = null;

/** O e-mail do modo "ligar", para a tela de entrar com e-mail vir preenchida. */
export function pendingGoogleLinkEmail(): string | null {
  return pendingGoogleLink?.email ?? null;
}

/** Esquece a ligação (o fã saiu da tela sem entrar) e sai do Google no aparelho. */
export function forgetPendingGoogleLink(): void {
  if (!pendingGoogleLink) return;
  pendingGoogleLink = null;
  void signOutGoogle();
}

/** Como a ligação do Google terminou, depois de o fã entrar com a senha. */
export type GoogleLinkOutcome = 'linked' | 'failed' | 'inUse';

function sameEmail(a: string | null, b: string): boolean {
  return a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Liga o Google pendente à conta que acabou de entrar com a senha. Sem ligação
 * pendente, `null`. A conta de outro e-mail não recebe o Google (`failed`, sem
 * tentar), e a conta Google que já entra em outra conta do ImagineUP é
 * `inUse`. A ligação sai da memória nos dois casos, e a falha não segura a
 * entrada: quem chama avisa o fã.
 */
export async function linkPendingGoogle(user: User): Promise<GoogleLinkOutcome | null> {
  const pending = pendingGoogleLink;
  pendingGoogleLink = null;
  if (!pending) return null;
  if (!sameEmail(user.email, pending.email)) {
    void signOutGoogle();
    return 'failed';
  }
  try {
    await linkWithCredential(user, pending.credential);
    return 'linked';
  } catch (error) {
    void signOutGoogle();
    const code = error instanceof FirebaseError ? error.code : null;
    return code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use'
      ? 'inUse'
      : 'failed';
  }
}

// --- Entrar ---------------------------------------------------------------------------

function signedIn(
  method: SocialMethod,
  result: UserCredential,
  appleName: string | null,
): SocialSignInResult {
  return {
    kind: 'signedIn',
    method,
    user: result.user,
    isNewUser: getAdditionalUserInfo(result)?.isNewUser ?? false,
    appleName,
  };
}

/**
 * Entra com a Apple. O nome que a Apple manda (só na primeira entrada de cada
 * pessoa) é guardado no aparelho antes do `signInWithCredential`: depois dele,
 * um erro ou o app fechado o perderiam para sempre. Cancelada, `null`.
 */
export async function signInWithApple(): Promise<SocialSignInResult | null> {
  pendingGoogleLink = null;
  const apple = await appleCredential();
  if (!apple) return null;
  const fresh = apple.fullName ? { appleUserId: apple.user, name: apple.fullName } : null;
  if (fresh) {
    await savePendingAppleName(fresh).catch((error: unknown) => {
      if (__DEV__) console.warn('[auth] O nome da Apple não foi guardado no aparelho.', error);
    });
  }
  const credential = new OAuthProvider('apple.com').credential({
    idToken: apple.identityToken,
    rawNonce: apple.rawNonce,
  });
  const result = await signInWithCredential(getFirebaseAuth(), credential);
  const appleName = await applyPendingAppleName(result.user, fresh);
  return signedIn('apple', result, appleName);
}

/**
 * Entra com o Google. A conta de senha com o mesmo e-mail, quando o Google não
 * é confiável para ela (fora do Gmail), dá
 * `auth/account-exists-with-different-credential`: a credencial fica na
 * memória e a entrada vira o modo "ligar" (`link`). Cancelada, `null`. Outra
 * falha sai do Google no aparelho, para a próxima tentativa abrir o seletor.
 */
export async function signInWithGoogle(): Promise<SocialSignInResult | null> {
  pendingGoogleLink = null;
  const google = await googleIdToken();
  if (!google) return null;
  const credential = GoogleAuthProvider.credential(google.idToken);
  try {
    const result = await signInWithCredential(getFirebaseAuth(), credential);
    return signedIn('google', result, null);
  } catch (error) {
    if (
      error instanceof FirebaseError &&
      error.code === 'auth/account-exists-with-different-credential'
    ) {
      pendingGoogleLink = { email: google.email, credential };
      return { kind: 'link', email: google.email };
    }
    void signOutGoogle();
    throw error;
  }
}

/**
 * A frase do erro da entrada social. Com a proteção contra enumeração, o app
 * não sabe o método da conta, e nenhuma frase o diz (33.16).
 */
export function socialErrorMessageKey(error: unknown): TranslationKey {
  if (error instanceof GoogleSignInError) {
    return error.reason === 'playServices'
      ? 'auth.social.errors.playServices'
      : 'auth.social.errors.unavailable';
  }
  if (error instanceof FirebaseError) {
    switch (error.code) {
      // O provedor desligado no console, ou o token que o projeto recusa (o
      // da Apple no Expo Go sai com os identificadores dele).
      case 'auth/operation-not-allowed':
      case 'auth/invalid-credential':
        return 'auth.social.errors.unavailable';
      case 'auth/network-request-failed':
        return 'auth.errors.network';
      case 'auth/too-many-requests':
        return 'auth.errors.tooManyRequests';
      default:
        return 'auth.social.errors.unknown';
    }
  }
  // O módulo nativo da Apple que não existe (o `UnavailabilityError` da Expo).
  if (error instanceof Error && 'code' in error && error.code === 'ERR_UNAVAILABLE') {
    return 'auth.social.errors.unavailable';
  }
  return 'auth.social.errors.unknown';
}

// --- Prazos ---------------------------------------------------------------------------

/**
 * Roda o pedido com prazo: passou dele, o pedido é abortado e vale o
 * `fallback`. A falha também vale o `fallback`: nada aqui lança.
 */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal).catch(() => fallback), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// --- As centrais da conta que já existe (decisão 11) ---------------------------------

/**
 * A conta já segue alguma central? O `GET /me/centrals` com o token da conta
 * `uid` e prazo de 3 s, só com a API (sem importar o domínio `artists`).
 * Falha, prazo, resposta fora do formato ou as fixtures: `null`, e vale o que
 * o aparelho já tem.
 */
export function hasAnyCentral(
  uid: string,
  timeoutMs: number = EXISTING_ACCOUNT_CHECK_MS,
): Promise<boolean | null> {
  if (sourceOf('artists') !== 'api') return Promise.resolve(null);
  return withDeadline<boolean | null>(
    async (signal) => {
      const { data } = await api.get<unknown>('/me/centrals', { sessionUid: uid, signal });
      return Array.isArray(data) ? data.length > 0 : null;
    },
    timeoutMs,
    null,
  );
}

// --- A revogação da Apple (decisão 12) -----------------------------------------------

const REVOKE_TOKEN_URL = 'https://identitytoolkit.googleapis.com/v2/accounts:revokeToken';

/**
 * Revoga o acesso do ImagineUP ao ID Apple, antes do `deleteUser` (ela pede o
 * ID token de uma conta viva). Fora do axios, pelo REST do Identity Toolkit,
 * como o SDK do Firebase para iOS: o código da folha da Apple (`CODE`, sem
 * `redirectUri`) e o cabeçalho `X-Ios-Bundle-Identifier`, que diz para qual
 * app o código foi emitido. O `revokeAccessToken` do SDK JS não serve: manda
 * `ACCESS_TOKEN`, e o fluxo nativo só traz o código. Prazo de 10 s; nunca
 * lança (a falha não trava a exclusão) e devolve se o servidor aceitou. Com o
 * emulador, que não tem a rota, nem tenta.
 */
export function revokeAppleToken(authorizationCode: string): Promise<boolean> {
  if (firebaseEmulatorHost || !firebaseEnv) return Promise.resolve(false);
  const { firebaseApiKey } = firebaseEnv;
  const user = getFirebaseAuth().currentUser;
  if (!user) return Promise.resolve(false);
  return withDeadline(
    async (signal) => {
      const idToken = await user.getIdToken();
      const response = await fetch(
        `${REVOKE_TOKEN_URL}?key=${encodeURIComponent(firebaseApiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Ios-Bundle-Identifier': IOS_BUNDLE_ID,
          },
          body: JSON.stringify({
            providerId: 'apple.com',
            tokenType: 'CODE',
            token: authorizationCode,
            idToken,
          }),
          signal,
        },
      );
      return response.ok;
    },
    APPLE_REVOKE_TIMEOUT_MS,
    false,
  );
}

// --- A exclusão da conta pelo provedor da sessão (decisão 12) ------------------------

/**
 * Como a sessão confirma a exclusão, pelo provedor dela (o `signInProvider` do
 * token, e não a lista de provedores: a mesma conta pode ter a Apple e o
 * Google):
 * - `password`: como antes. Sem a senha, exclui direto; com ela (depois que o
 *   Firebase pediu o login recente), reautentica antes;
 * - `google`: sem o `confirm`, exclui direto; com ele (o estágio "Confirmar com
 *   o Google"), a folha do Google traz um `idToken` novo para reautenticar;
 * - `apple`, só no iPhone: a folha da Apple sempre, que reautentica e traz o
 *   código da revogação.
 */
export type DeleteAccountRequest =
  | { kind: 'password'; password?: string }
  | { kind: 'google'; confirm?: boolean }
  | { kind: 'apple' };

export type DeleteAccountKind = DeleteAccountRequest['kind'];

/** A conta foi excluída, ou o fã fechou a folha do provedor (nada mudou). */
export type DeleteAccountOutcome = 'deleted' | 'canceled';

/**
 * O jeito de confirmar a exclusão para o provedor da sessão. A Apple só no
 * iPhone; sem o provedor (o token do Admin SDK, o aparelho sem entrada
 * gravada), a senha, como antes.
 */
export function deletionKindOf(method: SignInMethod | null): DeleteAccountKind {
  if (method === 'apple') return Platform.OS === 'ios' ? 'apple' : 'password';
  return method === 'google' ? 'google' : 'password';
}

/**
 * A exclusão tenta revogar a Apple ligada: a conta tem a Apple, a sessão é de
 * outro provedor, e o aparelho é um iPhone. No Android, a conta com a Apple
 * (só pela ligação com o Google) é excluída sem revogar (limite aceito).
 */
export function triesLinkedApple(kind: DeleteAccountKind, hasApple: boolean): boolean {
  return Platform.OS === 'ios' && kind !== 'apple' && hasApple;
}

/**
 * Reautentica pela sessão quando o pedido traz a confirmação: a senha, ou a
 * folha do Google. Devolve se reautenticou, e `canceled` com a folha fechada.
 */
async function confirmSession(
  user: User,
  request: Exclude<DeleteAccountRequest, { kind: 'apple' }>,
): Promise<boolean | 'canceled'> {
  if (request.kind === 'password') {
    if (request.password === undefined) return false;
    if (!user.email) throw new SessionEndedError('Conta sem e-mail para reautenticar.');
    await reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(user.email, request.password),
    );
    return true;
  }
  if (!request.confirm) return false;
  const google = await googleIdToken();
  if (!google) return 'canceled';
  try {
    await reauthenticateWithCredential(user, GoogleAuthProvider.credential(google.idToken));
  } catch (error) {
    // Outra conta Google (o `auth/user-mismatch`) ou a recusa: a próxima
    // tentativa abre o seletor de contas de novo.
    void signOutGoogle();
    throw error;
  }
  return true;
}

/**
 * A tentativa de revogar a Apple ligada a uma sessão de outro provedor: a folha
 * da Apple, sem reautenticar por ela (outro ID Apple no aparelho daria
 * `auth/user-mismatch`, e o fã não conseguiria excluir a conta). O código só
 * vai ao REST quando a folha volta com o `user` da Apple desta conta: o código
 * de outro ID Apple revogaria o acesso de outra pessoa. Cancelada, com outro ID
 * Apple ou com erro, a exclusão segue sem revogar.
 */
async function tryRevokeLinkedApple(appleUid: string): Promise<void> {
  const apple = await appleCredential().catch(() => null);
  if (!apple || apple.user !== appleUid || !apple.authorizationCode) return;
  await revokeAppleToken(apple.authorizationCode);
}

/**
 * Exclui a conta pelo provedor da sessão (decisão 12). O perfil e o @ somem no
 * servidor (`deleteUserProfile`); aqui ficam o Auth e os provedores, nesta
 * ordem:
 *
 * 1. A sessão confirmada: a senha ou o Google reautenticam quando vêm no
 *    pedido, e a sessão da Apple abre a folha da Apple sempre. A folha fechada
 *    responde `canceled`, sem mudar nada.
 * 2. A revogação da Apple, antes do `deleteUser` (ela pede o ID token de uma
 *    conta viva): o código da folha, na sessão da Apple; com a Apple ligada a
 *    uma sessão de outro provedor, no iPhone, a tentativa de
 *    `tryRevokeLinkedApple`, só com a sessão confirmada agora. Sem ela, o
 *    Firebase ainda poderia pedir o login recente depois da revogação, e o fã
 *    que desistisse ali ficaria com a conta e sem a Apple: o pedido sem a
 *    confirmação recebe o `RecentLoginRequiredError` antes de tudo. A falha da
 *    revogação não trava a exclusão.
 * 3. O `deleteUser`. O login antigo (`auth/requires-recent-login`) vira o
 *    `RecentLoginRequiredError` com o provedor da sessão, para a tela pedir a
 *    senha ou o Google.
 * 4. Com o Google na conta, o acesso dele revogado e a saída dele no aparelho,
 *    sem esperar e sem lançar.
 *
 * Quem chama segura o `REVOKED` da conferência da Apple enquanto isto corre
 * (`deletingAccount`, no `useSessionStore`). Sem conta logada, ou sem e-mail
 * para a senha, `SessionEndedError`.
 */
export async function deleteAccount(request: DeleteAccountRequest): Promise<DeleteAccountOutcome> {
  const user = await confirmedUser();
  // Lidos antes: a lista de provedores some com a conta.
  const appleUid = appleUidOf(user);
  const hasGoogle = user.providerData?.some((info) => info.providerId === 'google.com') ?? false;

  if (request.kind === 'apple') {
    const apple = await appleCredential();
    if (!apple) return 'canceled';
    const credential = new OAuthProvider('apple.com').credential({
      idToken: apple.identityToken,
      rawNonce: apple.rawNonce,
    });
    await reauthenticateWithCredential(user, credential);
    if (apple.authorizationCode) await revokeAppleToken(apple.authorizationCode);
  } else {
    const confirmed = await confirmSession(user, request);
    if (confirmed === 'canceled') return 'canceled';
    if (appleUid !== null && triesLinkedApple(request.kind, true)) {
      if (!confirmed) throw new RecentLoginRequiredError(request.kind);
      await tryRevokeLinkedApple(appleUid);
    }
  }

  try {
    await deleteUser(user);
  } catch (error) {
    if (error instanceof FirebaseError && error.code === 'auth/requires-recent-login') {
      throw new RecentLoginRequiredError(request.kind);
    }
    throw error;
  }
  if (hasGoogle || request.kind === 'google') void revokeGoogleAccess();
  return 'deleted';
}
