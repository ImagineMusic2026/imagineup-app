/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado.
 *
 * Presença em show ("Eu vou"): nasce no post de show da home (1b, aprovado em
 * 2026-09-29) e é a mesma da agenda (1m). As presenças do fã moram numa lista
 * só (`MyRsvps`), e o feed e a agenda leem dela, para o "Eu vou" dos dois
 * lugares nunca discordar.
 */
export interface MyRsvps {
  /** Shows em que o fã confirmou presença. */
  eventIds: string[];
}

export interface RsvpVariables {
  eventId: string;
  /** `true` confirma, `false` desfaz. */
  going: boolean;
  /** A mesma chave numa repetição (fila offline, rede que caiu) não conta duas vezes. */
  idempotencyKey: string;
}

export interface RsvpResult {
  eventId: string;
  going: boolean;
  /**
   * Pontos que a confirmação rendeu (a primeira presença conta na missão
   * "Confirme presença em um show"). Zero no resto, e sempre zero ao desfazer.
   */
  pointsAwarded: number;
}
