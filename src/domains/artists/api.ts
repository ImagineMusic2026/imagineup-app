import { sourceOf } from '@/config/data-source';
// O número de posts de exemplo da central, pelo arquivo (fora do index): o
// posts/fixtures.ts não importa artists, então não há ciclo. Sai no bloco 6.
import { countArtistPostsFixture } from '@/domains/posts/fixtures';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import {
  buildArtistDetailsFixture,
  buildArtistsFixture,
  buildFanCentralsFixture,
  followFixture,
} from './fixtures';
import type {
  Artist,
  ArtistDetails,
  FanCentral,
  FollowArtistsResult,
  FollowArtistsVariables,
  JoinCentralResult,
  JoinCentralVariables,
  LeaveCentralResult,
  LeaveCentralVariables,
} from './types';

const artistUrl = (artistId: string) => `/artists/${encodeURIComponent(artistId)}`;
const centralUrl = (artistId: string) => `/me/centrals/${encodeURIComponent(artistId)}`;

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
export async function fetchArtists(): Promise<Artist[]> {
  if (sourceOf('artists') === 'fixtures') {
    await fixtureDelay();
    return buildArtistsFixture();
  }
  const { data } = await api.get<Artist[]>('/artists');
  return data;
}

/**
 * Segue as centrais escolhidas. As centrais são só do servidor (regras do
 * Firestore): o app pede, e a API grava.
 */
export async function followArtists({
  artistIds,
  idempotencyKey,
}: FollowArtistsVariables): Promise<FollowArtistsResult> {
  if (sourceOf('artists') === 'fixtures') {
    await fixtureDelay();
    return followFixture.follow(artistIds, idempotencyKey);
  }
  const { data } = await api.post<FollowArtistsResult>(
    '/me/artists',
    { artistIds },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}

/**
 * Centrais que o fã segue, com os pontos dele em cada uma (carrossel da 1b,
 * "Suas centrais" da 1e). Do servidor, sem posição até o bloco 8.
 */
export async function fetchFanCentrals(): Promise<FanCentral[]> {
  if (sourceOf('artists') === 'fixtures') {
    await fixtureDelay();
    return buildFanCentralsFixture();
  }
  const { data } = await api.get<FanCentral[]>('/me/centrals');
  return data;
}

/**
 * A central de um artista (página 1d), com o fã dentro ou fora dela. Com as
 * centrais na API e o mural ainda nas fixtures (até o bloco 6), o "N posts"
 * conta os posts de exemplo da central, para bater com a grade do Mural.
 */
export async function fetchArtist(artistId: string): Promise<ArtistDetails> {
  if (sourceOf('artists') === 'fixtures') {
    await fixtureDelay();
    return buildArtistDetailsFixture(artistId);
  }
  const { data } = await api.get<ArtistDetails>(artistUrl(artistId));
  if (sourceOf('posts') === 'fixtures') {
    return { ...data, postCount: countArtistPostsFixture(fixtureNow(), artistId) };
  }
  return data;
}

/**
 * Entra na central pela página do artista. Quem decide os pontos é o
 * servidor; a chave de idempotência impede que uma repetição conte duas vezes.
 */
export async function joinCentral({
  artistId,
  idempotencyKey,
}: JoinCentralVariables): Promise<JoinCentralResult> {
  if (sourceOf('artists') === 'fixtures') {
    await fixtureDelay();
    return followFixture.join(artistId, idempotencyKey);
  }
  const { data } = await api.put<JoinCentralResult>(centralUrl(artistId), null, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}

/**
 * Sai da central (a sheet "Sair da central" da 1d). Não tira pontos; sem
 * estar nela, é sucesso sem efeito. A chave de idempotência impede que uma
 * repetição conte duas vezes.
 */
export async function leaveCentral({
  artistId,
  idempotencyKey,
}: LeaveCentralVariables): Promise<LeaveCentralResult> {
  if (sourceOf('artists') === 'fixtures') {
    await fixtureDelay();
    return followFixture.leave(artistId, idempotencyKey);
  }
  const { data } = await api.delete<LeaveCentralResult>(centralUrl(artistId), {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}
