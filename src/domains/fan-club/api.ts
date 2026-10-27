import { sourceOf } from '@/config/data-source';
import { storageFileExists, uploadLocalFile } from '@/firebase';
import { api } from '@/services/api';
import { fixtureDelay } from '@/services/fixtures';

import { FAN_CLUB_MEMBER_NOTICE_VERSION } from './consts';
import { fanClubFixture } from './fixtures';
import type {
  AcceptFanClubRulesVariables,
  AddFanClubCommentResult,
  AddFanClubCommentVariables,
  ApplyForFanClubVariables,
  ClearFanClubReactionVariables,
  CreateFanClubPostVariables,
  FanClubArtists,
  FanClubCard,
  FanClubCommentHiddenResult,
  FanClubCommentPage,
  FanClubCommentReviewResult,
  FanClubCommentsQuery,
  FanClubCommentWriteVariables,
  FanClubListPage,
  FanClubMentionsQuery,
  FanClubNumbers,
  FanClubPage,
  FanClubPost,
  FanClubPostDetails,
  FanClubReactionResult,
  FanClubUploadSlot,
  FanClubWriteVariables,
  FollowedFanClubs,
  FollowFanClubBody,
  FollowFanClubResult,
  FollowFanClubVariables,
  MentionSuggestions,
  MyFanClub,
  OwnFanClubPost,
  RemoveFanClubPostVariables,
  ReportFanClubCommentResult,
  ReportFanClubCommentVariables,
  ReportFanClubPostResult,
  ReportFanClubPostVariables,
  SetFanClubReactionVariables,
  UnfollowFanClubResult,
} from './types';

// Chamadas cruas às rotas do fã-clube (seção 34, 34.3), sem React: quem
// cacheia é o queries.ts das telas (etapas 7 e 8 de 34.14). As que gravam
// levam a chave da tentativa no `Idempotency-Key`. O contato do fã (`GET` e
// `PUT /me/contact`) mora no perfil (`fetchContact` e `updateContact`), que a
// loja também usa. Desde a etapa 7, os Ajustes chamam só o `fetchMyFanClub`; o
// resto, só as telas do fã-clube, depois de ele responder com o programa
// aberto ou com a candidatura do fã. As da página, do seguir e da Início
// chegam às telas na etapa 8. As dez da Fase 2 (seção 37, 37.3: a publicação,
// os comentários, a reação, as sugestões do @ e a moderação dos comentários)
// entram na etapa 5 de 37.13: o card usa as da reação, e as outras chegam às
// telas nas etapas 6 e 7.

const isFixtures = () => sourceOf('fanClub') === 'fixtures';

const idempotency = (idempotencyKey: string) => ({ 'Idempotency-Key': idempotencyKey });

const clubPath = (clubId: string) => `/fan-clubs/${encodeURIComponent(clubId)}`;

const postPath = (postId: string) => `/fan-club-posts/${encodeURIComponent(postId)}`;

const commentPath = (commentId: string) => `/fan-club-comments/${encodeURIComponent(commentId)}`;

const hiddenCommentPath = (commentId: string) =>
  `/me/fan-club/hidden-comments/${encodeURIComponent(commentId)}`;

/** O estado do fã nos Ajustes e no "Meu fã-clube" (`GET /me/fan-club`). */
export async function fetchMyFanClub(): Promise<MyFanClub> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.mine();
  }
  const { data } = await api.get<MyFanClub>('/me/fan-club');
  return data;
}

/** Os números do "Meu fã-clube" (`GET /me/fan-club/numbers`). */
export async function fetchMyFanClubNumbers(): Promise<FanClubNumbers> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.numbers();
  }
  const { data } = await api.get<FanClubNumbers>('/me/fan-club/numbers');
  return data;
}

/** As centrais do fã que aceitam fã-clubes, só ao abrir a candidatura. */
export async function fetchFanClubArtists(): Promise<FanClubArtists> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.artists();
  }
  const { data } = await api.get<FanClubArtists>('/me/fan-club/artists');
  return data;
}

/**
 * Candidatar (`POST /me/fan-club/application`): devolve o estado novo do fã.
 * O corpo vai montado chave a chave: o servidor recusa chave desconhecida
 * com 400 (`APPLICATION_KEYS`), e um campo a mais vindo do formulário não
 * pode ir junto.
 */
export async function applyForFanClub({
  body,
  idempotencyKey,
}: ApplyForFanClubVariables): Promise<MyFanClub> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.apply(body, idempotencyKey);
  }
  const { artistId, name, instagram, tiktok, whatsapp, pitch, adult, rulesVersion } = body;
  const { data } = await api.request<MyFanClub>({
    method: 'POST',
    url: '/me/fan-club/application',
    headers: idempotency(idempotencyKey),
    data: { artistId, name, instagram, tiktok, whatsapp, pitch, adult, rulesVersion },
  });
  return data;
}

/** Desistir da candidatura pendente; sem ela, o estado de agora. */
export async function withdrawApplication({
  idempotencyKey,
}: FanClubWriteVariables): Promise<MyFanClub> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.withdraw(idempotencyKey);
  }
  const { data } = await api.request<MyFanClub>({
    method: 'DELETE',
    url: '/me/fan-club/application',
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/** O novo aceite do regulamento (`PUT /me/fan-club/rules`), com a versão do `MyFanClub`. */
export async function acceptFanClubRules({
  rulesVersion,
  idempotencyKey,
}: AcceptFanClubRulesVariables): Promise<MyFanClub> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.acceptRules(rulesVersion, idempotencyKey);
  }
  const { data } = await api.request<MyFanClub>({
    method: 'PUT',
    url: '/me/fan-club/rules',
    headers: idempotency(idempotencyKey),
    data: { rulesVersion },
  });
  return data;
}

/** "Minhas publicações", em todos os status, da mais nova (10 por página). */
export async function fetchMyFanClubPosts(
  cursor: string | null,
): Promise<FanClubListPage<OwnFanClubPost>> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.myPosts(cursor);
  }
  const { data } = await api.get<FanClubListPage<OwnFanClubPost>>('/me/fan-club/posts', {
    params: { cursor },
  });
  return data;
}

/** A vaga de envio da foto (`POST /me/fan-club/upload`, sem corpo): os dois caminhos e o prazo. */
export async function openFanClubUpload({
  idempotencyKey,
}: FanClubWriteVariables): Promise<FanClubUploadSlot> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.openUpload(idempotencyKey);
  }
  const { data } = await api.request<FanClubUploadSlot>({
    method: 'POST',
    url: '/me/fan-club/upload',
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/**
 * Envia um arquivo preparado (a foto ou a miniatura) para o caminho da vaga,
 * em JPEG. A regra do Storage só aceita o nome da vaga aberta e não
 * sobrescreve: a nova tentativa confere antes (`fanClubFileUploaded`). Nas
 * fixtures, nada sobe (as publicações de exemplo não guardam arquivo).
 */
export async function uploadFanClubFile(path: string, localUri: string): Promise<void> {
  if (isFixtures()) {
    await fixtureDelay();
    return;
  }
  await uploadLocalFile(path, localUri, 'image/jpeg');
}

/**
 * O arquivo desta vaga já chegou? Pelos metadados, que a regra deixa o dono
 * ler enquanto a vaga está aberta. Um erro lança, e nunca vira "já subiu".
 */
export function fanClubFileUploaded(path: string): Promise<boolean> {
  if (isFixtures()) return Promise.resolve(true);
  return storageFileExists(path);
}

/** Publicar: sempre em análise; com `photo`, os dois arquivos da vaga já enviados. */
export async function createFanClubPost({
  text,
  photo,
  idempotencyKey,
}: CreateFanClubPostVariables): Promise<OwnFanClubPost> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.createPost({ text, photo }, idempotencyKey);
  }
  const { data } = await api.request<OwnFanClubPost>({
    method: 'POST',
    url: '/me/fan-club/posts',
    headers: idempotency(idempotencyKey),
    data: { text, photo },
  });
  return data;
}

/** Retirar a em análise ou tirar do ar a publicada. */
export async function removeFanClubPost({
  postId,
  idempotencyKey,
}: RemoveFanClubPostVariables): Promise<OwnFanClubPost> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.removePost(postId, idempotencyKey);
  }
  const { data } = await api.request<OwnFanClubPost>({
    method: 'DELETE',
    url: `/me/fan-club/posts/${encodeURIComponent(postId)}`,
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/** Os fã-clubes do artista: o card da 1d e o "Ver todos" (20 por página). */
export async function fetchArtistFanClubs(
  artistId: string,
  cursor: string | null,
): Promise<FanClubListPage<FanClubCard>> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.artistClubs(artistId, cursor);
  }
  const { data } = await api.get<FanClubListPage<FanClubCard>>(
    `/artists/${encodeURIComponent(artistId)}/fan-clubs`,
    { params: { cursor } },
  );
  return data;
}

/** A página pública do fã-clube. */
export async function fetchFanClub(clubId: string): Promise<FanClubPage> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.page(clubId);
  }
  const { data } = await api.get<FanClubPage>(clubPath(clubId));
  return data;
}

/** As publicações no ar da página, da mais nova (10 por página). */
export async function fetchFanClubPosts(
  clubId: string,
  cursor: string | null,
): Promise<FanClubListPage<FanClubPost>> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.clubPosts(clubId, cursor);
  }
  const { data } = await api.get<FanClubListPage<FanClubPost>>(`${clubPath(clubId)}/posts`, {
    params: { cursor },
  });
  return data;
}

/** Denunciar uma publicação no ar, com o motivo (ou null). */
export async function reportFanClubPost({
  postId,
  reason,
  idempotencyKey,
}: ReportFanClubPostVariables): Promise<ReportFanClubPostResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.report(postId, reason, idempotencyKey);
  }
  const { data } = await api.request<ReportFanClubPostResult>({
    method: 'POST',
    url: `/fan-club-posts/${encodeURIComponent(postId)}/report`,
    headers: idempotency(idempotencyKey),
    data: { reason },
  });
  return data;
}

/**
 * Seguir: quando falta, entra junto na central oficial (com as recompensas da
 * entrada). O corpo leva a versão do aviso "o gestor vê que você é membro"
 * (seção 37, "Estado"): todo botão de seguir do app mostra o aviso, e o
 * vínculo novo guarda a marca.
 */
export async function followFanClub({
  clubId,
  idempotencyKey,
}: FollowFanClubVariables): Promise<FollowFanClubResult> {
  const body: FollowFanClubBody = { memberNoticeVersion: FAN_CLUB_MEMBER_NOTICE_VERSION };
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.follow(clubId, idempotencyKey, body);
  }
  const { data } = await api.request<FollowFanClubResult>({
    method: 'PUT',
    url: `/me/fan-club-follows/${encodeURIComponent(clubId)}`,
    headers: idempotency(idempotencyKey),
    data: body,
  });
  return data;
}

/** Deixar de seguir, em qualquer status do fã-clube. */
export async function unfollowFanClub({
  clubId,
  idempotencyKey,
}: FollowFanClubVariables): Promise<UnfollowFanClubResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.unfollow(clubId, idempotencyKey);
  }
  const { data } = await api.request<UnfollowFanClubResult>({
    method: 'DELETE',
    url: `/me/fan-club-follows/${encodeURIComponent(clubId)}`,
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/** "Fã-clubes que sigo": até 50, com o indisponível marcado. */
export async function fetchFollowedFanClubs(): Promise<FollowedFanClubs> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.follows();
  }
  const { data } = await api.get<FollowedFanClubs>('/me/fan-club-follows');
  return data;
}

/** "Dos seus fã-clubes" da Início (10 por página). */
export async function fetchFanClubFeed(
  cursor: string | null,
): Promise<FanClubListPage<FanClubPost>> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.feed(cursor);
  }
  const { data } = await api.get<FanClubListPage<FanClubPost>>('/me/fan-club-feed', {
    params: { cursor },
  });
  return data;
}

// --- A Fase 2: a publicação, os comentários e a reação (seção 37, 37.3) ---------------

/** A publicação no ar (`GET /fan-club-posts/:postId`): a tela da publicação. */
export async function fetchFanClubPost(postId: string): Promise<FanClubPostDetails> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.post(postId);
  }
  const { data } = await api.get<FanClubPostDetails>(postPath(postId));
  return data;
}

/**
 * Os comentários de cima, do mais novo (20 por página), ou, com o `replyTo`,
 * as respostas de um deles, da mais antiga. O `replyTo` só vai quando há.
 */
export async function fetchFanClubComments({
  postId,
  replyTo,
  cursor,
}: FanClubCommentsQuery): Promise<FanClubCommentPage> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.comments(postId, replyTo, cursor);
  }
  const { data } = await api.get<FanClubCommentPage>(`${postPath(postId)}/comments`, {
    params: replyTo === null ? { cursor } : { cursor, replyTo },
  });
  return data;
}

/** Comentar ou responder. O `replyToId` só vai na resposta: o de cima manda só o texto. */
export async function addFanClubComment({
  postId,
  text,
  replyToId,
  idempotencyKey,
}: AddFanClubCommentVariables): Promise<AddFanClubCommentResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.addComment(postId, { text, replyToId }, idempotencyKey);
  }
  const { data } = await api.request<AddFanClubCommentResult>({
    method: 'POST',
    url: `${postPath(postId)}/comments`,
    headers: idempotency(idempotencyKey),
    data: replyToId === null ? { text } : { text, replyToId },
  });
  return data;
}

/**
 * Reagir ou trocar de emoji (`PUT`). Cada toque leva a chave dele: o corpo
 * entra na chave, e a mesma chave com outro emoji dá 422.
 */
export async function setFanClubReaction({
  postId,
  reaction,
  idempotencyKey,
}: SetFanClubReactionVariables): Promise<FanClubReactionResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.react(postId, reaction, idempotencyKey);
  }
  const { data } = await api.request<FanClubReactionResult>({
    method: 'PUT',
    url: `${postPath(postId)}/reaction`,
    headers: idempotency(idempotencyKey),
    data: { reaction },
  });
  return data;
}

/** Tirar a reação (`DELETE`, sem corpo): desfazer, aceito do suspenso e nunca recusado. */
export async function clearFanClubReaction({
  postId,
  idempotencyKey,
}: ClearFanClubReactionVariables): Promise<FanClubReactionResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.clearReaction(postId, idempotencyKey);
  }
  const { data } = await api.request<FanClubReactionResult>({
    method: 'DELETE',
    url: `${postPath(postId)}/reaction`,
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/** Denunciar um comentário, com o motivo (ou null). */
export async function reportFanClubComment({
  commentId,
  reason,
  idempotencyKey,
}: ReportFanClubCommentVariables): Promise<ReportFanClubCommentResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.reportComment(commentId, reason, idempotencyKey);
  }
  const { data } = await api.request<ReportFanClubCommentResult>({
    method: 'POST',
    url: `${commentPath(commentId)}/report`,
    headers: idempotency(idempotencyKey),
    data: { reason },
  });
  return data;
}

/** O "Pedir revisão" do autor do comentário oculto pelo gestor (sem corpo). */
export async function requestFanClubCommentReview({
  commentId,
  idempotencyKey,
}: FanClubCommentWriteVariables): Promise<FanClubCommentReviewResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.requestReview(commentId, idempotencyKey);
  }
  const { data } = await api.request<FanClubCommentReviewResult>({
    method: 'POST',
    url: `${commentPath(commentId)}/review`,
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/** O gestor oculta um comentário do próprio fã-clube (`PUT`, rota de estado). */
export async function hideFanClubComment({
  commentId,
  idempotencyKey,
}: FanClubCommentWriteVariables): Promise<FanClubCommentHiddenResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.hideComment(commentId, idempotencyKey);
  }
  const { data } = await api.request<FanClubCommentHiddenResult>({
    method: 'PUT',
    url: hiddenCommentPath(commentId),
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/** O gestor reexibe o que ele ocultou (`DELETE`). */
export async function unhideFanClubComment({
  commentId,
  idempotencyKey,
}: FanClubCommentWriteVariables): Promise<FanClubCommentHiddenResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.unhideComment(commentId, idempotencyKey);
  }
  const { data } = await api.request<FanClubCommentHiddenResult>({
    method: 'DELETE',
    url: hiddenCommentPath(commentId),
    headers: idempotency(idempotencyKey),
  });
  return data;
}

/**
 * As sugestões do @: sem o `q`, a conversa (o gestor, o artista e quem
 * comentou na publicação); com ele, a busca pelo começo do @. Cada parâmetro
 * só vai quando há.
 */
export async function fetchFanClubMentions({
  clubId,
  postId,
  q,
}: FanClubMentionsQuery): Promise<MentionSuggestions> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.mentions(clubId, postId, q);
  }
  const params: { postId?: string; q?: string } = {};
  if (postId !== null) params.postId = postId;
  if (q !== null) params.q = q;
  const { data } = await api.get<MentionSuggestions>(`${clubPath(clubId)}/mentions`, { params });
  return data;
}
