import { dataSource } from '@/config/env';
import { api } from '@/services/api';
import { fixtureDelay } from '@/services/fixtures';

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
} from './types';

const artistUrl = (artistId: string) => `/artists/${encodeURIComponent(artistId)}`;

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
export async function fetchArtists(): Promise<Artist[]> {
  if (dataSource === 'fixtures') {
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
  if (dataSource === 'fixtures') {
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

/** Centrais que o fã segue, com a posição dele em cada uma (carrossel da 1b). */
export async function fetchFanCentrals(): Promise<FanCentral[]> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return buildFanCentralsFixture();
  }
  const { data } = await api.get<FanCentral[]>('/me/centrals');
  return data;
}

/** A central de um artista (página 1d), com o fã dentro ou fora dela. */
export async function fetchArtist(artistId: string): Promise<ArtistDetails> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return buildArtistDetailsFixture(artistId);
  }
  const { data } = await api.get<ArtistDetails>(artistUrl(artistId));
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
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return followFixture.join(artistId, idempotencyKey);
  }
  const { data } = await api.put<JoinCentralResult>(
    `/me/centrals/${encodeURIComponent(artistId)}`,
    null,
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  return data;
}
