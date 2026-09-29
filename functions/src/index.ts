import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall } from 'firebase-functions/https';
import { onUserCreated, onUserDeleted } from 'firebase-functions/identity';
import * as logger from 'firebase-functions/logger';
import { setGlobalOptions } from 'firebase-functions/options';

import { handleUserCreated, type FindUser } from './handlers';
import {
  acceptInvite,
  cancelInvite,
  createInvite,
  emailConfig,
  EMAILJS_PRIVATE_KEY,
  getInvite,
  linkInvite,
  PANEL_ORIGINS,
  panelUrl,
  removeMember,
  resendInvite,
  sendInviteEmail,
  setMemberActive,
  updateMember,
  type StaffDeps,
} from './staff';
import { deleteUserData } from './store';

// Mesma região do Firestore. Sem isso, o gatilho de Auth vai para os EUA. As
// funções abaixo leem esta opção quando são definidas: ela vem antes de todas.
setGlobalOptions({ region: 'southamerica-east1', maxInstances: 10 });

initializeApp();

/**
 * O perfil do fã nasce aqui, a cada conta nova (e-mail e senha, Apple, Google
 * ou criada pelo servidor). Nova tentativa no erro. O app espera users/{uid}
 * aparecer depois do cadastro: leva alguns segundos. Conta da equipe do
 * painel (staff/{uid}) fica sem perfil de fã.
 */
export const createUserProfile = onUserCreated({ retry: true }, async (event) => {
  const result = await handleUserCreated(getFirestore(), findUser, event.data);
  logger.info('Perfil do fã.', { uid: event.data.uid, ...result });
});

/** Excluir a conta apaga o perfil, as subcoleções, libera o @ e tira o acesso ao painel. */
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

// Equipe do painel: callables chamadas pelo painel web (getFunctions(app,
// 'southamerica-east1')). Quem é da equipe e o que pode ver moram em
// staff/{uid}, lido a cada chamada; nada vem de custom claims. Os logs levam
// ids, nunca o link do convite nem a chave do EmailJS.

const staffDeps = (): StaffDeps => ({
  db: getFirestore(),
  auth: getAuth(),
  panelUrl: panelUrl(),
  // Só as funções com o secret no array `secrets` chegam a mandar e-mail.
  sendInviteEmail: (params) => sendInviteEmail(emailConfig(), params),
});

/** Admin convida alguém para a equipe: grava o convite e manda o e-mail pelo EmailJS. */
export const createStaffInvite = onCall(
  { cors: PANEL_ORIGINS, secrets: [EMAILJS_PRIVATE_KEY] },
  async (request) => {
    const result = await createInvite(staffDeps(), request.auth, request.data);
    logger.info('Convite da equipe criado.', {
      actorUid: request.auth?.uid,
      inviteId: result.inviteId,
      emailStatus: result.emailStatus,
    });
    return result;
  },
);

/** Admin reenvia um convite pendente: link novo, o antigo para de valer. */
export const resendStaffInvite = onCall(
  { cors: PANEL_ORIGINS, secrets: [EMAILJS_PRIVATE_KEY] },
  async (request) => {
    const result = await resendInvite(staffDeps(), request.auth, request.data);
    logger.info('Convite da equipe reenviado.', {
      actorUid: request.auth?.uid,
      inviteId: result.inviteId,
      emailStatus: result.emailStatus,
    });
    return result;
  },
);

/** Admin cancela um convite pendente. */
export const cancelStaffInvite = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await cancelInvite(staffDeps(), request.auth, request.data);
  logger.info('Convite da equipe cancelado.', { actorUid: request.auth?.uid });
  return result;
});

/** Página do convite (sem login): mostra o convite de quem tem o link. */
export const getStaffInvite = onCall({ cors: PANEL_ORIGINS }, (request) =>
  getInvite(staffDeps(), request.data),
);

/** Página do convite (sem login): cria a conta nova e dá o acesso ao painel. */
export const acceptStaffInvite = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await acceptInvite(staffDeps(), request.data);
  logger.info('Convite da equipe aceito.', { uid: result.uid, accountCreatedByInvite: true });
  return result;
});

/** Página do convite (logado): liga o acesso ao painel numa conta que já existe. */
export const linkStaffInvite = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await linkInvite(staffDeps(), request.auth, request.data);
  logger.info('Convite da equipe aceito.', { uid: result.uid, accountCreatedByInvite: false });
  return result;
});

/** Admin muda papel e seções de alguém da equipe. */
export const updateStaffMember = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await updateMember(staffDeps(), request.auth, request.data);
  logger.info('Acesso da equipe alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Admin desativa ou reativa alguém da equipe (a conta do Auth continua). */
export const setStaffMemberActive = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await setMemberActive(staffDeps(), request.auth, request.data);
  logger.info('Acesso da equipe ligado ou desligado.', { actorUid: request.auth?.uid });
  return result;
});

/** Admin tira alguém da equipe; a conta sai junto só se nasceu no convite e não é de fã. */
export const removeStaffMember = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await removeMember(staffDeps(), request.auth, request.data);
  logger.info('Membro removido da equipe.', { actorUid: request.auth?.uid });
  return result;
});
