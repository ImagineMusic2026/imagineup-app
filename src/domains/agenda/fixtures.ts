import { fixtureWallet } from '@/services/fixtures';

import type { MyRsvps, RsvpResult } from './types';

/**
 * Pontos da primeira presença confirmada (missão "Confirme presença em um
 * show" da 1g). Exemplo: o valor real vem da API e do painel.
 */
export const FIRST_RSVP_POINTS = 15;

let going = new Set<string>();
// Chave de idempotência já vista e o que ela devolveu, como o servidor faria.
let answered = new Map<string, RsvpResult>();
let firstRsvpRewarded = false;

/**
 * Estado de "servidor" das presenças do fã. Fica em memória e volta ao início
 * quando o app reabre. A lista de shows da agenda (1m) entra com a F8; até lá
 * qualquer id é aceito.
 */
export const rsvpFixture = {
  /** Confirma ou desfaz; a mesma chave de novo devolve a resposta da primeira vez. */
  set(eventId: string, confirm: boolean, idempotencyKey: string): RsvpResult {
    const previous = answered.get(idempotencyKey);
    if (previous) return { ...previous };

    let pointsAwarded = 0;
    if (confirm) {
      going.add(eventId);
      if (!firstRsvpRewarded) {
        firstRsvpRewarded = true;
        pointsAwarded = FIRST_RSVP_POINTS;
        fixtureWallet.earn(pointsAwarded);
      }
    } else {
      going.delete(eventId);
    }
    const result: RsvpResult = { eventId, going: confirm, pointsAwarded };
    answered.set(idempotencyKey, result);
    return { ...result };
  },

  mine(): MyRsvps {
    return { eventIds: [...going] };
  },

  /** Volta ao início (testes). */
  reset(): void {
    going = new Set();
    answered = new Map();
    firstRsvpRewarded = false;
  },
};
