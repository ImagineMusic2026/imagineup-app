import { sourceOf } from '@/config/data-source';
import { api } from '@/services/api';
import { fixtureDelay } from '@/services/fixtures';

import type { SendSupportMessageVariables, SupportMessageResult } from './types';

/** Chamadas cruas à API. Sem React: a mutação mora no queries.ts. */

/**
 * Manda a mensagem do Suporte à equipe (`POST /me/support`, seção 38). Sem a
 * API (o Expo Go sem o `.env`), finge o envio com a espera das fixtures: nada
 * sai do aparelho.
 */
export async function sendSupportMessage({
  idempotencyKey,
  ...body
}: SendSupportMessageVariables): Promise<SupportMessageResult> {
  if (sourceOf('support') === 'fixtures') {
    await fixtureDelay();
    return { id: `fixture-${idempotencyKey}`, status: 'sent' };
  }
  const { data } = await api.post<SupportMessageResult>('/me/support', body, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return data;
}
