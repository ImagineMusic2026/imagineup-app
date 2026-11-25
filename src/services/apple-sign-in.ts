import { isRunningInExpoGo } from 'expo';
import {
  addRevokeListener,
  AppleAuthenticationScope,
  getCredentialStateAsync,
  isAvailableAsync,
  signInAsync,
  type AppleAuthenticationCredentialState,
  type AppleAuthenticationFullName,
} from 'expo-apple-authentication';
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';

/**
 * Entrar com a Apple, só no iPhone (seção 39 de docs/arquitetura-api.md), pelo
 * `expo-apple-authentication`, com o nonce do `expo-crypto`. O SDK JS do
 * Firebase não abre a folha da Apple: ela devolve o token, e o `apple-entry.ts`
 * do `auth` o troca pela sessão.
 */

/** O código do `expo-apple-authentication` para a folha fechada pelo fã. */
const CANCELED_CODE = 'ERR_REQUEST_CANCELED';

/**
 * O botão da Apple aparece: só no iOS, fora do Expo Go e com o sistema que tem
 * a Apple. No Expo Go, o token sai com os identificadores dele, que o projeto
 * recusa; o emulador não muda isso (39.1, D1). A conferência do Firebase
 * configurado fica no hook, como no Google.
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios' || isRunningInExpoGo()) return false;
  try {
    return (await isAvailableAsync()) === true;
  } catch {
    return false;
  }
}

// No iOS, a resposta não muda durante uma abertura do app: ela é perguntada uma
// vez, e o botão já nasce no primeiro quadro das telas de conta (39.6).
let availability: Promise<boolean> | null = null;
let known: boolean | undefined;

/** A disponibilidade da Apple, perguntada uma vez por abertura do app. */
export function appleSignInAvailability(): Promise<boolean> {
  availability ??= isAppleSignInAvailable().then((value) => {
    known = value;
    return value;
  });
  return availability;
}

/** A resposta de `appleSignInAvailability`, quando ela já chegou; antes, `undefined`. */
export function knownAppleSignInAvailability(): boolean | undefined {
  return known;
}

/** O que a folha da Apple devolve, já pronto para o Firebase e para o nome guardado. */
export interface AppleCredential {
  /** O identificador da pessoa na Apple (o `uid` da Apple no `providerData` da conta). */
  user: string;
  identityToken: string;
  /** O nonce bruto, que vai ao Firebase; a Apple recebeu o SHA-256 dele. */
  rawNonce: string;
  /** O código de uso único que a revogação da Apple pede (39.4). */
  authorizationCode: string | null;
  /** O nome, só na primeira entrada de cada pessoa no app (e se ela não apagou). */
  fullName: string | null;
  email: string | null;
}

/** O nome da Apple numa linha ("Camila Ribeiro"), ou `null` sem nome. */
export function appleFullName(fullName: AppleAuthenticationFullName | null): string | null {
  if (!fullName) return null;
  const name = [fullName.givenName, fullName.middleName, fullName.familyName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
  return name.length > 0 ? name : null;
}

function isCanceled(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === CANCELED_CODE;
}

/**
 * Abre a folha da Apple, com o nome e o e-mail pedidos. O nonce é um valor
 * bruto aleatório, novo a cada folha; a Apple recebe o SHA-256 dele em hex, e o
 * Firebase, o bruto (ao contrário, o Firebase recusa com
 * `auth/missing-or-invalid-nonce`). Cancelada, `null`, sem erro; outra falha
 * passa adiante.
 */
export async function appleCredential(): Promise<AppleCredential | null> {
  const rawNonce = randomUUID();
  const hashedNonce = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce, {
    encoding: CryptoEncoding.HEX,
  });
  let credential;
  try {
    credential = await signInAsync({
      requestedScopes: [AppleAuthenticationScope.FULL_NAME, AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (error) {
    if (isCanceled(error)) return null;
    throw error;
  }
  // O pacote já recusa a credencial sem o token; a conferência é para o tipo.
  if (!credential.identityToken) throw new Error('A Apple respondeu sem o token.');
  return {
    user: credential.user,
    identityToken: credential.identityToken,
    rawNonce,
    authorizationCode: credential.authorizationCode,
    fullName: appleFullName(credential.fullName),
    email: credential.email,
  };
}

/**
 * O estado da credencial da Apple dessa pessoa no aparelho, sem folha. Fora do
 * iOS, ou com erro, `null`: só o `REVOKED` tira a sessão, e o erro não faz nada
 * (39.5). O simulador responde `NOT_FOUND`.
 */
export async function appleCredentialState(
  appleUserId: string,
): Promise<AppleAuthenticationCredentialState | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    return await getCredentialStateAsync(appleUserId);
  } catch {
    return null;
  }
}

/**
 * Avisa quando a pessoa tira o ImagineUP da Conta Apple. Devolve a função que
 * para de ouvir. Fora do iOS, ninguém ouve (o pacote no Android devolve
 * `undefined` no lugar da inscrição).
 */
export function onAppleRevoked(listener: () => void): () => void {
  if (Platform.OS !== 'ios') return () => undefined;
  try {
    const subscription = addRevokeListener(listener);
    return () => subscription?.remove();
  } catch {
    return () => undefined;
  }
}
