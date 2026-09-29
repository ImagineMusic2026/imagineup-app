import { dataSource } from '@/config/env';
import { api } from '@/services/api';
import { fixtureDelay } from '@/services/fixtures';

import { rsvpFixture } from './fixtures';
import type { MyRsvps, RsvpResult, RsvpVariables } from './types';

/** Chamadas cruas à API. Sem React: quem cacheia é o queries.ts. */
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
