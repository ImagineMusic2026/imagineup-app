import { sourceOf } from '@/config/data-source';
import { storageFileExists, uploadLocalFile } from '@/firebase';
import { api } from '@/services/api';
import { fixtureDelay } from '@/services/fixtures';

import { fanClubFixture } from './fixtures';
import type {
  AcceptFanClubRulesVariables,
  ApplyForFanClubVariables,
  CreateFanClubPostVariables,
  FanClubArtists,
  FanClubCard,
  FanClubListPage,
  FanClubNumbers,
  FanClubPage,
  FanClubPost,
  FanClubUploadSlot,
  FanClubWriteVariables,
  FollowedFanClubs,
  FollowFanClubResult,
  FollowFanClubVariables,
  MyFanClub,
  OwnFanClubPost,
  RemoveFanClubPostVariables,
  ReportFanClubPostResult,
  ReportFanClubPostVariables,
  UnfollowFanClubResult,
} from './types';

// Chamadas cruas às rotas do fã-clube (seção 34, 34.3), sem React: quem
// cacheia é o queries.ts das telas (etapas 7 e 8 de 34.14). As que gravam
// levam a chave da tentativa no `Idempotency-Key`. O contato do fã (`GET` e
// `PUT /me/contact`) mora no perfil (`fetchContact` e `updateContact`), que a
// loja também usa. Desde a etapa 7, os Ajustes chamam só o `fetchMyFanClub`; o
// resto, só as telas do fã-clube, depois de ele responder com o programa
// aberto ou com a candidatura do fã. As da página, do seguir e da Início
// chegam às telas na etapa 8.

const isFixtures = () => sourceOf('fanClub') === 'fixtures';

const idempotency = (idempotencyKey: string) => ({ 'Idempotency-Key': idempotencyKey });

const clubPath = (clubId: string) => `/fan-clubs/${encodeURIComponent(clubId)}`;

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

/** Seguir: quando falta, entra junto na central oficial (com as recompensas da entrada). */
export async function followFanClub({
  clubId,
  idempotencyKey,
}: FollowFanClubVariables): Promise<FollowFanClubResult> {
  if (isFixtures()) {
    await fixtureDelay();
    return fanClubFixture.follow(clubId, idempotencyKey);
  }
  const { data } = await api.request<FollowFanClubResult>({
    method: 'PUT',
    url: `/me/fan-club-follows/${encodeURIComponent(clubId)}`,
    headers: idempotency(idempotencyKey),
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
