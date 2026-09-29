import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onUserCreated, onUserDeleted } from 'firebase-functions/identity';
import * as logger from 'firebase-functions/logger';
import { setGlobalOptions } from 'firebase-functions/options';

import { handleUserCreated, type FindUser } from './handlers';
import { deleteUserData } from './store';

// Mesma região do Firestore. Sem isso, o gatilho de Auth vai para os EUA.
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

initializeApp();

/**
 * O perfil do fã nasce aqui, a cada conta nova (e-mail e senha, Apple, Google
 * ou criada pelo servidor). Nova tentativa no erro. O app espera users/{uid}
 * aparecer depois do cadastro: leva alguns segundos.
 */
export const createUserProfile = onUserCreated({ retry: true }, async (event) => {
  const result = await handleUserCreated(getFirestore(), findUser, event.data);
  logger.info('Perfil do fã.', { uid: event.data.uid, ...result });
});

/** Excluir a conta apaga o perfil, as subcoleções e libera o @. */
export const deleteUserProfile = onUserDeleted({ retry: true }, async (event) => {
  await deleteUserData(getFirestore(), event.data.uid);
  logger.info('Dados do fã apagados.', { uid: event.data.uid });
});

const findUser: FindUser = async (uid) => {
  try {
    return await getAuth().getUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw error;
  }
};
