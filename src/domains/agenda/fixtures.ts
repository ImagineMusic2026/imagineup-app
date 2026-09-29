import { missionsFixture } from '@/domains/missions';

import type { MyRsvps, RsvpResult } from './types';

let going = new Set<string>();
// Chave de idempotência já vista e o que ela devolveu, como o servidor faria.
let answered = new Map<string, RsvpResult>();

/**
 * Estado de "servidor" das presenças do fã. Fica em memória e volta ao início
 * quando o app reabre. A lista de shows da agenda (1m) entra com a F8; até lá
 * qualquer id é aceito.
 *
 * Confirmar presença conta na missão "Confirme presença em um show" (1g): o
 * servidor das missões diz quantos pontos a confirmação rendeu (os da missão,
 * quando ela conclui; zero depois disso) e já os põe na carteira.
 */
export const rsvpFixture = {
  /** Confirma ou desfaz; a mesma chave de novo devolve a resposta da primeira vez. */
  set(eventId: string, confirm: boolean, idempotencyKey: string): RsvpResult {
    const previous = answered.get(idempotencyKey);
    if (previous) return { ...previous };

    let pointsAwarded = 0;
    if (confirm) {
      going.add(eventId);
      pointsAwarded = missionsFixture.record('rsvp');
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

  /** Volta ao início (testes). As missões voltam com `missionsFixture.reset()`. */
  reset(): void {
    going = new Set();
    answered = new Map();
  },
};
