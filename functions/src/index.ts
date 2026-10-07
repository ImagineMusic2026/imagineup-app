import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/firestore';
import { onCall, onRequest } from 'firebase-functions/https';
import { onUserCreated, onUserDeleted } from 'firebase-functions/identity';
import * as logger from 'firebase-functions/logger';
import { setGlobalOptions } from 'firebase-functions/options';
import { onSchedule } from 'firebase-functions/scheduler';
import { onTaskDispatched } from 'firebase-functions/tasks';

import {
  addAchievement,
  changeAchievementStatus,
  editAchievement,
  reorderAchievementList,
} from './achievements';
import { addEvent, changeEventStatus, editEvent, removeEvent } from './agenda';
import {
  addArtist,
  bucketFiles,
  changeArtistStatus,
  checkHandle,
  editArtist,
  removeArtist,
  reorderArtistList,
  type ArtistDeps,
} from './artists';
import { createApiHandler } from './api';
import {
  FAN_COUNT_MAX_ATTEMPTS,
  FAN_COUNT_QUEUE,
  queueFanCountSync,
  runFanCountSync,
  type FanCountQueue,
} from './centrals';
import {
  FAN_PROFILE_MAX_ATTEMPTS,
  FAN_PROFILE_QUEUE,
  fanPhotoFiles,
  queueFanPhotoPurge,
  queueFanProfileSync as enqueueFanProfileSync,
  runFanProfileSync,
  type FanProfileQueue,
} from './fan-profile';
import { handleUserCreated, type FindUser } from './handlers';
import { INVITE_KEY_SECRET } from './invites';
import {
  addMission,
  changeMissionStatus,
  changeSeasonGoal,
  editMission,
  reorderMissionList,
} from './missions';
import { moderate } from './moderation';
import {
  changePointsConfig,
  changeSeason,
  createConfigSource,
  type ConfigPanelDeps,
  type ConfigSource,
} from './points';
import { closeNow, endCurrent, runRankingTick, scheduleNext } from './ranking';
import {
  addPost,
  changePostStatus,
  editPost,
  POST_COUNTS_MAX_ATTEMPTS,
  POST_COUNTS_QUEUE,
  queuePostCountSync as enqueuePostCountSync,
  removePost,
  runPostCountSync,
  type ContentDeps,
  type PostCountsQueue,
} from './posts';
import {
  addReward,
  changeRedemptionStatus,
  changeRewardStatus,
  changeRewardStock,
  editReward,
  readRedemptionContacts,
  removeReward,
  reorderRewardList,
  type RewardsPanelDeps,
} from './rewards';
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
 * aparecer depois do cadastro: leva alguns segundos, e conta que nasce sem nome
 * espera mais um pouco por ele (NAME_WAIT_MS, em handlers.ts). Conta da equipe
 * do painel (staff/{uid}) fica sem perfil de fã.
 */
export const createUserProfile = onUserCreated({ retry: true }, async (event) => {
  const result = await handleUserCreated(getFirestore(), findUser, event.data);
  logger.info('Perfil do fã.', { uid: event.data.uid, ...result });
});

/**
 * Excluir a conta apaga o perfil, as subcoleções, libera o @, tira o acesso ao
 * painel e, desde o bloco 9, esvazia a pasta da foto no Storage, com a segunda
 * limpeza da pasta na fila 1 h depois (24.11).
 */
export const deleteUserProfile = onUserDeleted({ retry: true }, async (event) => {
  const uid = event.data.uid;
  await deleteUserData(getFirestore(), uid, { files: fanFiles() });
  await queueFanPhotoPurge(fanProfileQueue(), uid, { now: Date.now(), emulator: isEmulator() });
  logger.info('Dados do fã apagados.', { uid });
});

const isEmulator = () => process.env.FUNCTIONS_EMULATOR === 'true';

// Bucket padrão do projeto (imagine-up-app.firebasestorage.app; no emulador,
// demo-imagine-up-app.appspot.com), resolvido só quando alguém mexe em arquivo.
const fanFiles = () => fanPhotoFiles(() => getStorage().bucket());

let profileQueue: FanProfileQueue | null = null;
const fanProfileQueue = (): FanProfileQueue =>
  (profileQueue ??= getFunctions().taskQueue<{ uid: string }>(FAN_PROFILE_QUEUE));

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

// Artistas e centrais: callables do painel, para admin e editor com a seção
// artists (leitor só usa o checkArtistHandle). Tudo que o painel muda passa
// por aqui, com auditoria em staffAudit; as fotos sobem do navegador direto
// para o Storage (storage.rules), e a função confere o arquivo antes de gravar.

const artistDeps = (): ArtistDeps => ({
  db: getFirestore(),
  // Bucket padrão do projeto (imagine-up-app.firebasestorage.app; no emulador,
  // demo-imagine-up-app.appspot.com), vindo do FIREBASE_CONFIG.
  files: bucketFiles(() => getStorage().bucket()),
});

/** Formulário da central: o @ está livre? (formato, reservados, fãs e outras centrais). */
export const checkArtistHandle = onCall({ cors: PANEL_ORIGINS }, (request) =>
  checkHandle(artistDeps(), request.auth, request.data),
);

/** Cria a central como rascunho e reserva o @ no mesmo espaço dos @ dos fãs. */
export const createArtist = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await addArtist(artistDeps(), request.auth, request.data);
  logger.info('Central criada.', { actorUid: request.auth?.uid, artistId: result.artistId });
  return result;
});

/** Edita a central: textos, gestor, contato, selo, autorização e fotos já enviadas. */
export const updateArtist = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await editArtist(artistDeps(), request.auth, request.data);
  logger.info('Central alterada.', { actorUid: request.auth?.uid });
  return result;
});

/** Publica ou tira do ar. Publicar exige foto e autorização de uso de imagem. */
export const setArtistStatus = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeArtistStatus(artistDeps(), request.auth, request.data);
  logger.info('Status da central alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Nova ordem das centrais (os 4 primeiros publicados são os destaques). */
export const reorderArtists = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await reorderArtistList(artistDeps(), request.auth, request.data);
  logger.info('Ordem das centrais alterada.', { actorUid: request.auth?.uid });
  return result;
});

/** Admin apaga uma central sem fãs, em qualquer status, com as fotos e a reserva do @. */
export const deleteArtist = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await removeArtist(artistDeps(), request.auth, request.data);
  logger.info('Central apagada.', { actorUid: request.auth?.uid });
  return result;
});

// Mural e agenda (bloco 6, docs/arquitetura-api.md, 21.9): a equipe publica
// posts e shows pelo painel, com a seção artists (o conteúdo é da central;
// provisório até a UP-9), e age nos comentários denunciados com a seção
// moderation. Mesmo molde das de artistas: auditoria em staffAudit, a mídia
// sobe do navegador para o Storage e a função confere o arquivo. As telas são
// do bloco 11 (imagineup-admin); o contrato está em 21.9.

const contentDeps = (): ContentDeps => ({
  db: getFirestore(),
  files: bucketFiles(() => getStorage().bucket()),
});

/** Cria o post como rascunho (texto, foto, vídeo ou show) numa central. */
export const createPost = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await addPost(contentDeps(), request.auth, request.data);
  logger.info('Post criado.', { actorUid: request.auth?.uid, postId: result.postId });
  return result;
});

/** Edita o texto, o show ou a mídia já enviada de um post. */
export const updatePost = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await editPost(contentDeps(), request.auth, request.data);
  logger.info('Post alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Publica ou tira do ar um post. Publicar exige a mídia e, no post de show, o show no ar. */
export const setPostStatus = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changePostStatus(contentDeps(), request.auth, request.data);
  logger.info('Status do post alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Apaga o post que nunca foi ao ar (o rascunho criado por engano), com a mídia. */
export const deletePost = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await removePost(contentDeps(), request.auth, request.data);
  logger.info('Post apagado.', { actorUid: request.auth?.uid });
  return result;
});

/** Cadastra um show como rascunho, com a data local e o fuso do lugar. */
export const createEvent = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await addEvent(contentDeps(), request.auth, request.data);
  logger.info('Show criado.', { actorUid: request.auth?.uid, eventId: result.eventId });
  return result;
});

/** Edita um show: textos, centrais, data, fuso, destaque e foto já enviada. */
export const updateEvent = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await editEvent(contentDeps(), request.auth, request.data);
  logger.info('Show alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Publica ou tira do ar um show. */
export const setEventStatus = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeEventStatus(contentDeps(), request.auth, request.data);
  logger.info('Status do show alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Apaga o show que nunca foi ao ar e para o qual nenhum post aponta. */
export const deleteEvent = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await removeEvent(contentDeps(), request.auth, request.data);
  logger.info('Show apagado.', { actorUid: request.auth?.uid });
  return result;
});

/** Oculta, mantém ou reexibe um comentário (seção Moderação, provisória até a UP-48). */
export const moderateComment = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await moderate({ db: getFirestore() }, request.auth, request.data);
  logger.info('Comentário moderado.', { actorUid: request.auth?.uid, status: result.status });
  return result;
});

// Régua, temporada, missões e conquistas (bloco 7, docs/arquitetura-api.md,
// 22.8): a equipe edita pelo painel os documentos versionados de config/, com
// a seção missions (régua, missões, meta da temporada e conquistas) ou
// ranking (temporada). Mesmo molde das de conteúdo: o acesso lido de
// staff/{uid} a cada chamada, a versão conferida (`config-changed`) e a
// auditoria em staffAudit. A mudança vale na API em até 60 s (o cache da
// configuração). As telas são do bloco 11 (imagineup-admin).

const gameDeps = (): ConfigPanelDeps => ({ db: getFirestore() });

/** Valores, limites, tetos do dia e níveis (a régua). */
export const updatePointsConfig = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changePointsConfig(gameDeps(), request.auth, request.data);
  logger.info('Régua alterada.', { actorUid: request.auth?.uid, version: result.version });
  return result;
});

/**
 * A temporada atual: o id não muda depois que ela começa, e a começada não
 * sai nem muda de início (bloco 8: sai pela virada, no fim ou pelo endSeason).
 */
export const updateSeason = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeSeason(gameDeps(), request.auth, request.data);
  logger.info('Temporada alterada.', { actorUid: request.auth?.uid, version: result.version });
  return result;
});

// Ranking e temporadas (bloco 8, docs/arquitetura-api.md, 23.10), com a
// seção ranking: a próxima temporada, o encerramento antes da hora e a virada
// na hora, quando a função agendada não roda. As telas são do bloco 11.

/** Cadastra (ou tira, com null) a próxima temporada, que a virada promove. */
export const scheduleNextSeason = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await scheduleNext(gameDeps(), request.auth, request.data);
  logger.info('Próxima temporada alterada.', {
    actorUid: request.auth?.uid,
    version: result.version,
  });
  return result;
});

/** Encerra agora a temporada em andamento; a virada fecha na rodada seguinte. */
export const endSeason = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await endCurrent(gameDeps(), request.auth, request.data);
  logger.info('Temporada encerrada antes da hora.', {
    actorUid: request.auth?.uid,
    version: result.version,
  });
  return result;
});

/** Roda na hora a virada que já venceu (a saída da equipe se a função agendada parar). */
export const closeSeasonNow = onCall(
  { cors: PANEL_ORIGINS, timeoutSeconds: 120 },
  async (request) => {
    const result = await closeNow(gameDeps(), request.auth, request.data);
    logger.info('Virada pedida pelo painel.', {
      actorUid: request.auth?.uid,
      status: result.status,
      pages: result.pages,
    });
    return result;
  },
);

/**
 * A virada de temporada e o retrato semanal do ranking (bloco 8, 23.6): a
 * cada 10 min, fecha a temporada cujo fim (mais a folga) passou e, com tempo
 * sobrando, tira o retrato da semana. Os dois andam em páginas com o
 * andamento em rankingJobs, então a rodada seguinte continua de onde esta
 * parou. Sem nova tentativa: uma falha espera a próxima rodada. O emulador
 * não roda função agendada: os testes e o seed chamam o handler.
 */
export const rankingTick = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'America/Sao_Paulo',
    timeoutSeconds: 540,
    memory: '512MiB',
    retryCount: 0,
  },
  async () => {
    await runRankingTick({ db: getFirestore(), now: Date.now, budgetMs: 7 * 60_000 });
  },
);

/** Cria uma missão como rascunho no catálogo, com o id gerado pelo servidor. */
export const createMission = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await addMission(gameDeps(), request.auth, request.data);
  logger.info('Missão criada.', { actorUid: request.auth?.uid, missionId: result.missionId });
  return result;
});

/** Edita uma missão (depois do início, só título, recompensa, destaque e fim). */
export const updateMission = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await editMission(gameDeps(), request.auth, request.data);
  logger.info('Missão alterada.', { actorUid: request.auth?.uid, version: result.version });
  return result;
});

/** Publica, arquiva ou traz de volta do arquivo uma missão. */
export const setMissionStatus = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeMissionStatus(gameDeps(), request.auth, request.data);
  logger.info('Status da missão alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Nova ordem das missões (a da 1g e da aba Missões da 1d). */
export const reorderMissions = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await reorderMissionList(gameDeps(), request.auth, request.data);
  logger.info('Ordem das missões alterada.', { actorUid: request.auth?.uid });
  return result;
});

/** A meta da temporada (missões concluídas ou pontos da temporada), ou null para tirar. */
export const updateSeasonGoal = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeSeasonGoal(gameDeps(), request.auth, request.data);
  logger.info('Meta da temporada alterada.', { actorUid: request.auth?.uid });
  return result;
});

/** Cria uma conquista como rascunho (regra de nível, de primeira vez ou de ranking). */
export const createAchievement = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await addAchievement(gameDeps(), request.auth, request.data);
  logger.info('Conquista criada.', {
    actorUid: request.auth?.uid,
    achievementId: result.achievementId,
  });
  return result;
});

/** Edita uma conquista (a regra não muda depois de publicada). */
export const updateAchievement = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await editAchievement(gameDeps(), request.auth, request.data);
  logger.info('Conquista alterada.', { actorUid: request.auth?.uid });
  return result;
});

/** Publica ou arquiva uma conquista. */
export const setAchievementStatus = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeAchievementStatus(gameDeps(), request.auth, request.data);
  logger.info('Status da conquista alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Nova ordem das conquistas. */
export const reorderAchievements = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await reorderAchievementList(gameDeps(), request.auth, request.data);
  logger.info('Ordem das conquistas alterada.', { actorUid: request.auth?.uid });
  return result;
});

// Loja e resgate (bloco 10, docs/arquitetura-api.md, 25.8), com a seção
// rewards: a equipe cadastra as recompensas (com a foto, que sobe do
// navegador para rewards/{rewardId}/ e a função confere), cuida do estoque e
// da ordem e acompanha os pedidos (aprovar, marcar entregue, recusar com
// motivo, que devolve os pontos e, por padrão, a vaga). O e-mail de quem
// resgatou só sai pelo getRedemptionContacts, dos pedidos abertos. Mesmo molde
// das de conteúdo: o acesso lido de staff/{uid} a cada chamada e de novo na
// transação, e a auditoria em staffAudit. As telas são do bloco 11.

let rewardsConfig: ConfigSource | null = null;

const rewardsDeps = (): RewardsPanelDeps => ({
  db: getFirestore(),
  files: bucketFiles(() => getStorage().bucket()),
  auth: getAuth(),
  config: (rewardsConfig ??= createConfigSource(getFirestore())),
});

/** Cria a recompensa como rascunho, no fim da ordem (o id pode vir do painel). */
export const createReward = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await addReward(rewardsDeps(), request.auth, request.data);
  logger.info('Recompensa criada.', { actorUid: request.auth?.uid, rewardId: result.rewardId });
  return result;
});

/** Edita os textos, o custo, o limite, o show, o destaque e a foto já enviada. */
export const updateReward = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await editReward(rewardsDeps(), request.auth, request.data);
  logger.info('Recompensa alterada.', { actorUid: request.auth?.uid });
  return result;
});

/** Publica (ou reabre, no fim da ordem) ou encerra uma recompensa. */
export const setRewardStatus = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeRewardStatus(rewardsDeps(), request.auth, request.data);
  logger.info('Status da recompensa alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Muda o total oferecido, nunca abaixo do já resgatado. */
export const setRewardStock = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeRewardStock(rewardsDeps(), request.auth, request.data);
  logger.info('Estoque da recompensa alterado.', { actorUid: request.auth?.uid });
  return result;
});

/** Nova ordem dos rascunhos e das recompensas no ar (a da loja). */
export const reorderRewards = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await reorderRewardList(rewardsDeps(), request.auth, request.data);
  logger.info('Ordem das recompensas alterada.', { actorUid: request.auth?.uid });
  return result;
});

/** Apaga o rascunho que nunca foi ao ar e não tem pedido, com a foto. */
export const deleteReward = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await removeReward(rewardsDeps(), request.auth, request.data);
  logger.info('Recompensa apagada.', { actorUid: request.auth?.uid });
  return result;
});

/** Aprova, marca entregue ou recusa um pedido (a recusa devolve os pontos). */
export const setRedemptionStatus = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeRedemptionStatus(rewardsDeps(), request.auth, request.data);
  logger.info('Status do pedido alterado.', {
    actorUid: request.auth?.uid,
    status: result.status,
  });
  return result;
});

/** O nome, o @ e o e-mail de quem fez os pedidos abertos, para a entrega. */
export const getRedemptionContacts = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await readRedemptionContacts(rewardsDeps(), request.auth, request.data);
  logger.info('Contatos de pedidos consultados.', {
    actorUid: request.auth?.uid,
    count: result.contacts.length,
  });
  return result;
});

// API HTTP do app (docs/arquitetura-api.md): carteira, progresso e extrato no
// bloco 1, centrais no bloco 4, convite no bloco 5, mural e agenda no bloco 6,
// missões e conquistas no bloco 7, ranking e temporada no bloco 8, o perfil
// editável no bloco 9 e a loja no bloco 10; os blocos seguintes acrescentam
// as rotas deles em src/api. Quem protege é o ID token do Firebase
// em toda rota, por isso o invoker público. Sem CORS: o app nativo não faz
// preflight, e o painel usa as callables. A visita ao link de convite conta
// no app, de conta logada, por esta mesma função (20.1, decisão 3).

let apiHandler: ReturnType<typeof createApiHandler> | null = null;

/**
 * Carteira, progresso e extrato (bloco 1), as centrais (bloco 4: lista,
 * página, "Suas centrais", seguir, entrar e sair), o convite (bloco 5: o
 * código do fã, o claim, a visita e os links) e o mural e a agenda (bloco 6:
 * posts, comentários, curtidas, shows, "Eu vou", denúncias e bloqueios), as
 * missões e conquistas (bloco 7: a 1g, a missão do dia e as conquistas da
 * 1e), o ranking (bloco 8: a temporada, o ranking geral e das centrais e a
 * posição do fã) e o perfil editável (bloco 9: o @ escolhido pelo fã e a foto
 * do perfil, conferida no Storage) e a loja (bloco 10: as recompensas e o
 * resgate, com o débito, o estoque e o pedido numa transação só); os pontos,
 * as missões, os níveis, as posições e os resgates são sempre calculados no
 * servidor. O segredo do HMAC da chave da pessoa (INVITE_KEY_SECRET) só
 * chega a esta função, lido a cada pedido.
 */
export const api = onRequest(
  {
    invoker: 'public',
    cors: false,
    timeoutSeconds: 30,
    memory: '512MiB',
    cpu: 1,
    concurrency: 80,
    secrets: [INVITE_KEY_SECRET],
  },
  (req, res) => {
    apiHandler ??= createApiHandler({
      db: getFirestore(),
      auth: getAuth(),
      inviteKey: () => INVITE_KEY_SECRET.value(),
      files: fanFiles(),
    });
    return apiHandler(req, res);
  },
);

// fanCount das centrais (bloco 4, docs/arquitetura-api.md, seção 19.6): a
// entrada e a saída somam +1 ou -1 num shard (artistStats/{id}/fanShards), o
// gatilho põe na fila uma tarefa por central e por janela de 10 s, e a tarefa
// copia a soma para artists/{id}.fanCount, que o app e o painel leem.

let fanCountQueue: FanCountQueue | null = null;

/** Põe na fila a cópia do fanCount da central da gravação (sem ler nada). */
export const queueArtistFanCountSync = onDocumentWritten(
  { document: 'artistStats/{artistId}/fanShards/{shard}', retry: true },
  async (event) => {
    fanCountQueue ??= getFunctions().taskQueue<{ artistId: string }>(FAN_COUNT_QUEUE);
    await queueFanCountSync(fanCountQueue, event.params.artistId, Date.parse(event.time), {
      emulator: process.env.FUNCTIONS_EMULATOR === 'true',
    });
  },
);

/** Soma os shards do fanCount de uma central e copia para artists/{id}. */
export const syncArtistFanCount = onTaskDispatched<{ artistId: string }>(
  { retryConfig: { maxAttempts: FAN_COUNT_MAX_ATTEMPTS, minBackoffSeconds: 10 } },
  async (request) => {
    const result = await runFanCountSync(getFirestore(), request.data, {
      retryCount: request.retryCount,
    });
    if (result) logger.info('fanCount copiado.', { artistId: request.data.artistId, ...result });
  },
);

// Contagens dos posts (bloco 6, docs/arquitetura-api.md, 21.6): curtir,
// descurtir, comentar e a moderação somam +1 ou -1 num shard
// (postStats/{id}/countShards), o gatilho põe na fila uma tarefa por post e
// por janela de 10 s, e a tarefa copia likeCount e commentCount para o post.

let postCountsQueue: PostCountsQueue | null = null;

/** Põe na fila a cópia das contagens do post da gravação (sem ler nada). */
export const queuePostCountSync = onDocumentWritten(
  { document: 'postStats/{postId}/countShards/{shard}', retry: true },
  async (event) => {
    postCountsQueue ??= getFunctions().taskQueue<{ postId: string }>(POST_COUNTS_QUEUE);
    await enqueuePostCountSync(postCountsQueue, event.params.postId, Date.parse(event.time), {
      emulator: process.env.FUNCTIONS_EMULATOR === 'true',
    });
  },
);

/** Soma as curtidas e os comentários dos shards de um post e copia para posts/{id}. */
export const syncPostCounts = onTaskDispatched<{ postId: string }>(
  { retryConfig: { maxAttempts: POST_COUNTS_MAX_ATTEMPTS, minBackoffSeconds: 10 } },
  async (request) => {
    const result = await runPostCountSync(getFirestore(), request.data, {
      retryCount: request.retryCount,
    });
    if (result)
      logger.info('Contagens do post copiadas.', { postId: request.data.postId, ...result });
  },
);

// Perfil editável (bloco 9, docs/arquitetura-api.md, 24.7): o fã troca o nome
// direto no Firestore e a foto pela API. O gatilho do perfil apaga a foto
// trocada e, quando o nome ou a foto mudam, põe na fila uma tarefa por fã e
// janela (5 min; passado o orçamento do dia, 1 h), que regrava as cópias do
// nome e da foto nos comentários do fã e varre a pasta da foto.

/** Apaga a foto trocada e põe na fila as cópias do nome e da foto (sem ler os comentários). */
export const queueFanProfileSync = onDocumentUpdated(
  { document: 'users/{uid}', retry: true },
  async (event) => {
    if (!event.data) return;
    const result = await enqueueFanProfileSync(
      getFirestore(),
      fanProfileQueue(),
      fanFiles(),
      {
        uid: event.params.uid,
        before: event.data.before.data(),
        after: event.data.after.data(),
        eventTime: Date.parse(event.time),
      },
      { emulator: isEmulator() },
    );
    if (result.photo || result.task === 'queued') {
      logger.info('Perfil do fã alterado.', { uid: event.params.uid, ...result });
    }
  },
);

/** Acerta as cópias do nome e da foto nos comentários do fã e varre a pasta da foto dele. */
export const syncFanProfile = onTaskDispatched<{ uid: string }>(
  {
    retryConfig: { maxAttempts: FAN_PROFILE_MAX_ATTEMPTS, minBackoffSeconds: 10 },
    timeoutSeconds: 300,
  },
  async (request) => {
    await runFanProfileSync(getFirestore(), fanFiles(), request.data, {
      retryCount: request.retryCount,
    });
  },
);
