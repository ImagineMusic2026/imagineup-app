// O check-in diário com sequência (docs/arquitetura-api.md, seção 39): o
// espelho do contrato de `functions/src/api/contract.ts` (a parte do
// check-in). Mudou um, mude o outro. O dia (o de São Paulo), a sequência e os
// pontos são sempre do servidor: o app só mostra o que ele manda.

// As recompensas pelo arquivo, fora do index: o index das missões puxaria telas.
import type { ActionRewards } from '@/domains/missions/types';

/**
 * O estado do check-in do fã (`GET /me/checkin`). Com a chave desligada, o
 * servidor responde `enabled: false`, com os números em 0 e o `cycle` vazio:
 * o app não mostra nada.
 */
export interface CheckinState {
  /** A chave do servidor (`config/points.checkin.enabled`). */
  enabled: boolean;
  /** O fã já fez o check-in de hoje. */
  checkedInToday: boolean;
  /** Dias seguidos que valem agora: 0 sem sequência ou com ela perdida. */
  streak: number;
  /** A maior sequência que o fã já teve. */
  best: number;
  /** Os pontos de cada dia do ciclo, editáveis no painel; `[]` com a chave desligada. */
  cycle: number[];
  /**
   * O lugar de hoje no ciclo, de 1 a `cycle.length`: o do check-in feito hoje
   * ou o que o de hoje vai ocupar; 0 com a chave desligada.
   */
  cycleDay: number;
  /** Quanto vale o check-in de hoje; 0 com a chave desligada. */
  todayPoints: number;
  /** ISO: a próxima meia-noite de São Paulo, quando o dia do check-in vira. */
  resetsAt: string;
}

/**
 * Resposta de `POST /me/checkin`, no molde das ações que rendem pontos: os
 * pontos, o que mais a ação rendeu (missões, nível e conquistas, 22.2 da
 * nota) e o estado de depois. O segundo toque no mesmo dia responde com
 * `pointsAwarded: 0` e o mesmo estado.
 */
export interface CheckinResult extends ActionRewards {
  pointsAwarded: number;
  checkin: CheckinState;
}

export interface CheckinVariables {
  idempotencyKey: string;
}
