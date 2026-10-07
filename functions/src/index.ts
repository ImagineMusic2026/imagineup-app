import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';
import { onDocumentWritten } from 'firebase-functions/firestore';
import { onCall, onRequest } from 'firebase-functions/https';
import { onUserCreated, onUserDeleted } from 'firebase-functions/identity';
import * as logger from 'firebase-functions/logger';
import { setGlobalOptions } from 'firebase-functions/options';
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
import { changePointsConfig, changeSeason, type ConfigPanelDeps } from './points';
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

/** A temporada (o id não muda depois que ela começa), ou null para encerrar. */
export const updateSeason = onCall({ cors: PANEL_ORIGINS }, async (request) => {
  const result = await changeSeason(gameDeps(), request.auth, request.data);
  logger.info('Temporada alterada.', { actorUid: request.auth?.uid, version: result.version });
  return result;
});

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

// API HTTP do app (docs/arquitetura-api.md): carteira, progresso e extrato no
// bloco 1, centrais no bloco 4, convite no bloco 5, mural e agenda no bloco 6,
// missões e conquistas no bloco 7; os blocos seguintes acrescentam as rotas deles em src/api. Quem protege é o ID token do Firebase
// em toda rota, por isso o invoker público. Sem CORS: o app nativo não faz
// preflight, e o painel usa as callables. A visita ao link de convite conta
// no app, de conta logada, por esta mesma função (20.1, decisão 3).

let apiHandler: ReturnType<typeof createApiHandler> | null = null;

/**
 * Carteira, progresso e extrato (bloco 1), as centrais (bloco 4: lista,
 * página, "Suas centrais", seguir, entrar e sair), o convite (bloco 5: o
 * código do fã, o claim, a visita e os links) e o mural e a agenda (bloco 6:
 * posts, comentários, curtidas, shows, "Eu vou", denúncias e bloqueios) e as
 * missões e conquistas (bloco 7: a 1g, a missão do dia e as conquistas da
 * 1e); os pontos, as missões e os níveis são sempre calculados no servidor. O segredo do HMAC da chave da pessoa (INVITE_KEY_SECRET) só
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
