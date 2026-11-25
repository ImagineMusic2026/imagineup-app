import type { User } from 'firebase/auth';

import { firebaseEmulatorHost, firebaseEnv } from '@/config/env';
import { getFirebaseAuth } from '@/firebase';
import { storage, StorageKeys } from '@/storage/storage';

import { APPLE_REVOKE_TIMEOUT_MS, IOS_BUNDLE_ID } from './consts';

// A Apple na conta, sem React e sem o `api.ts` (que importa este arquivo):
// quem a conta tem na Apple, o nome que a Apple manda uma vez e a revogação do
// acesso na exclusão (seção 39 de docs/arquitetura-api.md).

/** O provedor da Apple no Firebase Auth. */
export const APPLE_PROVIDER_ID = 'apple.com';

/** O `uid` da Apple na conta (o `user` da Apple), ou `null` sem a Apple. */
export function appleUidOf(user: User): string | null {
  return user.providerData?.find((info) => info.providerId === APPLE_PROVIDER_ID)?.uid ?? null;
}

// --- O nome guardado da Apple (39.5) --------------------------------------------------

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

export function savePendingAppleName(pending: PendingAppleName): Promise<void> {
  return storage.setJSON(StorageKeys.ApplePendingName, pending);
}

export function clearPendingAppleName(): Promise<void> {
  return storage.remove(StorageKeys.ApplePendingName);
}

/** Tira o nome guardado só quando ele é do `user` da Apple dado (a conta que saiu). */
export async function clearPendingAppleNameOf(appleUserId: string): Promise<void> {
  const pending = await readPendingAppleName();
  if (pending?.appleUserId === appleUserId) await clearPendingAppleName();
}

// --- A revogação da Apple (39.4) ------------------------------------------------------

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

const REVOKE_TOKEN_URL = 'https://identitytoolkit.googleapis.com/v2/accounts:revokeToken';

/**
 * Revoga o acesso do ImagineUP à Conta Apple, antes do `deleteUser` (o pedido
 * leva o ID token de uma conta viva, o da reautenticação recém-feita). Fora do
 * axios, pelo REST do Identity Toolkit, como o SDK do Firebase para iOS: o
 * código da folha da Apple (`CODE`, sem `redirectUri`) e o cabeçalho
 * `X-Ios-Bundle-Identifier`, que diz para qual app o código foi emitido. O
 * `revokeAccessToken` do SDK JS não serve: manda `ACCESS_TOKEN`, e o fluxo
 * nativo só traz o código. Só para a conta `user` que está sendo excluída: a
 * sessão de outra conta (antes ou depois do token) não manda nada. Prazo de
 * 10 s; nunca lança (a falha não trava a exclusão) e devolve se o servidor
 * aceitou. Com o emulador, que não tem a rota, nem tenta.
 */
export async function revokeAppleToken(authorizationCode: string, user: User): Promise<boolean> {
  if (firebaseEmulatorHost || !firebaseEnv) return false; // o emulador não tem a rota
  const { firebaseApiKey } = firebaseEnv;
  const isCurrent = () => getFirebaseAuth().currentUser?.uid === user.uid;
  if (!isCurrent()) return false;
  const ok = await withDeadline(
    async (signal) => {
      const idToken = await user.getIdToken(); // o da reautenticação recém-feita
      if (!isCurrent()) return false;
      const response = await fetch(
        `${REVOKE_TOKEN_URL}?key=${encodeURIComponent(firebaseApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Ios-Bundle-Identifier': IOS_BUNDLE_ID },
          body: JSON.stringify({
            providerId: APPLE_PROVIDER_ID,
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
  if (__DEV__ && !ok) console.warn('[auth] A Apple não confirmou a revogação.');
  return ok;
}
