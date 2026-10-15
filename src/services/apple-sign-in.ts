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

import { isExpoGo } from '@/config/runtime';
import { firebaseEmulatorHost } from '@/config/server';

/**
 * Entrar com a Apple, só no iPhone (seção 33 de docs/arquitetura-api.md,
 * decisões 2, 9 e 16), pelo `expo-apple-authentication`, com o nonce do
 * `expo-crypto`. O SDK JS do Firebase não abre a folha da Apple: ela devolve o
 * token, e o `social.ts` do `auth` o troca pela sessão.
 */

/** O código do `expo-apple-authentication` para a folha fechada pelo fã. */
const CANCELED_CODE = 'ERR_REQUEST_CANCELED';

/**
 * O botão da Apple aparece: só no iOS, com o sistema que tem a Apple e fora do
 * Expo Go. No Expo Go, o token sai com os identificadores dele, que o projeto
 * de produção recusa; com os emuladores, que não conferem o token, ele aparece
 * (hipótese a conferir no iPhone, decisão 16).
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (isExpoGo() && !firebaseEmulatorHost) return false;
  try {
    return await isAvailableAsync();
  } catch {
    return false;
  }
}

/** O que a folha da Apple devolve, já pronto para o Firebase e para o nome guardado. */
export interface AppleCredential {
  /** O identificador da pessoa na Apple (o `uid` da Apple no `providerData` da conta). */
  user: string;
  identityToken: string;
  /** O nonce bruto, que vai ao Firebase; a Apple recebeu o SHA-256 dele. */
  rawNonce: string;
  /** O código de uso único que a revogação da Apple pede (decisão 12). */
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
 * bruto aleatório; a Apple recebe o SHA-256 dele em hex, e o Firebase, o bruto
 * (ao contrário, o Firebase recusa com `auth/missing-or-invalid-nonce`).
 * Cancelada, `null`, sem erro.
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
 * O estado da credencial da Apple dessa pessoa no aparelho. Fora do iOS, ou
 * com erro (o simulador sempre lança, a rede), `null`: só o `REVOKED` tira a
 * sessão, e o erro não faz nada (33.16).
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

/** Avisa quando a pessoa tira o ImagineUP do ID Apple. Devolve a função que para de ouvir. */
export function onAppleRevoked(listener: () => void): () => void {
  if (Platform.OS !== 'ios') return () => undefined;
  try {
    const subscription = addRevokeListener(listener);
    return () => subscription.remove();
  } catch {
    return () => undefined;
  }
}
