import {
  connectStorageEmulator,
  getMetadata,
  getStorage,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from 'firebase/storage';

import { firebaseEmulatorHost } from '@/config/env';

import { getFirebaseApp } from './config';

// O único arquivo do app que importa `firebase/storage` (o lint barra o
// resto): no Jest, `firebase/storage` resolve para o build ESM, que não roda, e
// as suítes que chegam ao Firebase mockam o `@/firebase` com uma fábrica.
// docs/arquitetura-api.md, 24.12.

/** Porta do emulador do Storage (`firebase.json`). */
const STORAGE_EMULATOR_PORT = 9199;

let storage: FirebaseStorage | null = null;

/** Storage do app (o bucket do `.env`; com os emuladores, o do projeto demo), preguiçoso. */
export function getFirebaseStorage(): FirebaseStorage {
  if (storage) return storage;
  storage = getStorage(getFirebaseApp());
  if (firebaseEmulatorHost) {
    try {
      connectStorageEmulator(storage, firebaseEmulatorHost, STORAGE_EMULATOR_PORT);
    } catch {
      // Fast Refresh: o Storage deste app já estava ligado ao emulador.
    }
  }
  return storage;
}

/**
 * O arquivo local como blob. No React Native (e no Expo Go), o `fetch` de um
 * `file://` não dá um blob que o SDK envie, e o `uploadString` em base64 não
 * funciona: o caminho que funciona é o `XMLHttpRequest` com `responseType: 'blob'`.
 */
function localBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.onload = () => resolve(request.response as Blob);
    request.onerror = () => reject(new TypeError('Não deu para ler o arquivo local.'));
    request.responseType = 'blob';
    request.open('GET', uri, true);
    request.send(null);
  });
}

/** Blob do React Native: tem `close()`, que solta a memória do arquivo. */
type ClosableBlob = Blob & { close?: () => void };

/**
 * Envia um arquivo local para o caminho do Storage, com o tipo dado, e solta o
 * blob no fim (também quando o envio falha).
 */
export async function uploadLocalFile(
  path: string,
  localUri: string,
  contentType: string,
): Promise<void> {
  const blob = (await localBlob(localUri)) as ClosableBlob;
  try {
    await uploadBytes(ref(getFirebaseStorage(), path), blob, { contentType });
  } finally {
    blob.close?.();
  }
}

/**
 * O arquivo já está no Storage? Pelos metadados (a regra deixa o dono ler os
 * da pasta dele): `storage/object-not-found` é `false`; outro erro lança
 * (sessão trocada, regra recusando, rede), e nunca vira "já subiu".
 */
export async function storageFileExists(path: string): Promise<boolean> {
  try {
    await getMetadata(ref(getFirebaseStorage(), path));
    return true;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'storage/object-not-found') return false;
    throw error;
  }
}
