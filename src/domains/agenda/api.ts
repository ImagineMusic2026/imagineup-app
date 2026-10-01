import { dataSource } from '@/config/env';
import { api } from '@/services/api';
import { fixtureDelay, fixtureNow } from '@/services/fixtures';

import { buildAgendaPageFixture, buildArtistAgendaPageFixture, rsvpFixture } from './fixtures';
import type { AgendaPage, MyRsvps, RsvpResult, RsvpVariables } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */

/** Shows futuros em ordem de data, uma página por vez. */
export async function fetchAgenda(cursor: string | null): Promise<AgendaPage> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return buildAgendaPageFixture(fixtureNow(), cursor);
  }
  const { data } = await api.get<AgendaPage>('/agenda', { params: { cursor } });
  return data;
}

/** Os shows de uma central (aba Agenda da 1d), em ordem de data, sem destaque. */
export async function fetchArtistAgenda(
  artistId: string,
  cursor: string | null,
): Promise<AgendaPage> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return buildArtistAgendaPageFixture(fixtureNow(), artistId, cursor);
  }
  const { data } = await api.get<AgendaPage>('/agenda', { params: { artistId, cursor } });
  return data;
}

export async function fetchMyRsvps(): Promise<MyRsvps> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return rsvpFixture.mine();
  }
  const { data } = await api.get<MyRsvps>('/me/rsvps');
  return data;
}

/**
 * Confirma ("Eu vou") ou desfaz a presença num show. Quem decide os pontos é o
 * servidor; a chave de idempotência impede que uma repetição conte duas vezes.
 */
export async function setEventRsvp({
  eventId,
  going,
  idempotencyKey,
}: RsvpVariables): Promise<RsvpResult> {
  if (dataSource === 'fixtures') {
    await fixtureDelay();
    return rsvpFixture.set(eventId, going, idempotencyKey);
  }
  const { data } = await api.request<RsvpResult>({
    method: going ? 'PUT' : 'DELETE',
    url: `/events/${encodeURIComponent(eventId)}/rsvp`,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}
