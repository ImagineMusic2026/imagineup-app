import { dataSource } from '@/config/env';
import { api } from '@/services/api';
import { fixtureDelay } from '@/services/fixtures';

import { buildArtistsFixture, followFixture } from './fixtures';
import type { Artist, FollowArtistsResult, FollowArtistsVariables } from './types';

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
