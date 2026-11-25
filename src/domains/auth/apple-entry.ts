import { FirebaseError } from 'firebase/app';
import {
  getAdditionalUserInfo,
  OAuthProvider,
  signInWithCredential,
  updateProfile,
  type User,
} from 'firebase/auth';

import { getFirebaseAuth } from '@/firebase';
import type { TranslationKey } from '@/i18n';
import { appleCredential } from '@/services/apple-sign-in';
import { displayNameOrNull } from '@/utils/visible-line';

import {
  fillMissingProfileName,
  SessionEndedError,
  sessionSignInProvider,
  waitForProfile,
  type NewProfile,
} from './api';
import {
  APPLE_PROVIDER_ID,
  appleUidOf,
  clearPendingAppleName,
  readPendingAppleName,
  savePendingAppleName,
  type PendingAppleName,
} from './apple-account';
import { EXISTING_ACCOUNT_CHECK_MS } from './consts';
import type { SocialSignInResult } from './social-entry';

// Entrar com a Apple, só no iPhone (seção 39 de docs/arquitetura-api.md). A
// folha nativa da Apple devolve um token, que vira a credencial do SDK JS do
// Firebase (`signInWithCredential`): o SDK JS no React Native não tem popup nem
// redirect. Sem React: o núcleo `useSocialEntry` decide o resto da entrada.

function warnSave(error: unknown): void {
  if (__DEV__) console.warn('[auth] O nome da Apple não foi guardado no aparelho.', error);
}

/**
 * O nome da Apple desta conta: o que acabou de chegar (`fresh`) ou o guardado
 * no aparelho, só quando o `user` dele é o `uid` da Apple da conta. Vai para o
 * Auth com o `updateProfile` quando a conta está sem nome (a função de cadastro
 * espera o nome por alguns segundos). Devolve o nome, que ainda vai para o
 * perfil sem nome (`settlePendingAppleName`), ou `null`. A falha do
 * `updateProfile` não segura a entrada: o perfil recebe o nome pela regra do
 * mesmo jeito.
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
 * O nome guardado da Apple no início de uma sessão (39.5): com o app fechado
 * entre o `signInWithCredential` e o perfil com nome, a sessão fica salva no
 * aparelho e não há entrada seguinte. Só com a chave da Apple desta conta (o
 * `user` da chave igual ao `uid` da Apple no `providerData`): o nome vai para o
 * Auth, se ele estiver sem nome, e para o perfil sem nome, lido em até 3 s. Sem
 * a chave, nada. A recusa da gravação no perfil rejeita, e a chave fica para a
 * próxima sessão.
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

/**
 * A credencial da Apple foi revogada (39.5): a sessão `uid` sai? Só a sessão
 * aberta pela Apple (o `signInProvider` do token). A sessão de outro provedor,
 * com a mesma Apple ligada, fica. Sem o token (sem rede), sai só a conta que
 * tem a Apple como único provedor. A leitura do token pode encerrar uma
 * sessão invalidada: aí, nada a fazer.
 */
export async function signsOutOnRevoke(uid: string): Promise<boolean> {
  const user = currentUserOf(uid);
  if (!user) return false;
  const provider = await sessionSignInProvider(user); // null quando o token não sai
  if (currentUserOf(uid) === null) return false; // a leitura pode ter tirado a sessão
  if (provider !== null) return provider === APPLE_PROVIDER_ID;
  const ids = user.providerData?.map((info) => info.providerId) ?? [];
  return ids.length > 0 && ids.every((id) => id === APPLE_PROVIDER_ID);
}

/**
 * Entra com a Apple. O nome que a Apple manda (só na primeira entrada de cada
 * pessoa) é guardado no aparelho antes do `signInWithCredential`: depois dele,
 * um erro ou o app fechado o perderiam para sempre. Se guardar falhar, o nome
 * da memória ainda vale nesta entrada. A sessão é conferida antes e depois da
 * folha, como no Google. Sem o modo "ligar": a Apple é um provedor confiável, e
 * o Firebase não a recusa por uma conta de senha no mesmo e-mail (39.3).
 * Cancelada, `null`.
 */
export async function signInWithApple(): Promise<SocialSignInResult | null> {
  const auth = getFirebaseAuth();
  await auth.authStateReady();
  if (auth.currentUser) throw new SessionEndedError('A entrada já foi concluída.');
  const apple = await appleCredential();
  if (!apple) return null;
  const fresh = apple.fullName ? { appleUserId: apple.user, name: apple.fullName } : null;
  // Antes do signInWithCredential: depois dele, um erro ou o app fechado perderiam o nome.
  if (fresh) await savePendingAppleName(fresh).catch(warnSave);
  const credential = new OAuthProvider(APPLE_PROVIDER_ID).credential({
    idToken: apple.identityToken,
    rawNonce: apple.rawNonce,
  });
  if (auth.currentUser) throw new SessionEndedError('A entrada já foi concluída.');
  const result = await signInWithCredential(auth, credential);
  const profileName = await applyPendingAppleName(result.user, fresh);
  return {
    kind: 'signedIn',
    user: result.user,
    isNewUser: getAdditionalUserInfo(result)?.isNewUser === true,
    profileName,
  };
}

/**
 * A frase do erro da entrada com a Apple. Com a proteção contra enumeração, o
 * app não sabe o método da conta, e nenhuma frase o diz.
 */
export function appleSignInErrorKey(error: unknown): TranslationKey {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      // O provedor desligado no console, ou o token que o projeto recusa.
      case 'auth/operation-not-allowed':
      case 'auth/invalid-credential':
      case 'auth/missing-or-invalid-nonce':
        return 'auth.apple.errors.unavailable';
      case 'auth/network-request-failed':
        return 'auth.errors.network';
      case 'auth/too-many-requests':
        return 'auth.errors.tooManyRequests';
      default:
        return 'auth.apple.errors.unknown';
    }
  }
  // O módulo nativo da Apple que não existe (o `UnavailabilityError` da Expo).
  if (error instanceof Error && 'code' in error && error.code === 'ERR_UNAVAILABLE') {
    return 'auth.apple.errors.unavailable';
  }
  return 'auth.apple.errors.unknown';
}
