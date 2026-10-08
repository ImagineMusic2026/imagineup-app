import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

import { isFanId } from '../moderation/model';
import type { AdjustCounter } from './limits';
import { panelAccessError } from './panel-actor';
import type { CallerAuth } from './service';

/**
 * Motivos que o painel recebe em `details.reason` nas callables do bloco 11
 * que mexem num fã ou leem o ranking ao vivo (docs/arquitetura-api.md, 26.4):
 * `adjustFanPoints`, `findFanByEmail`, `getPanelRanking`, `resetFanUsername`,
 * `clearFanPhoto`, `setFanSuspended` e `hideFanComments`. A mensagem em pt-BR
 * vai junto e pode ser mostrada como está. Os de acesso (`unauthenticated`,
 * `not-staff`, `no-section`) vêm do `readPanelActor`.
 */
export type PanelErrorReason =
  | 'invalid-request'
  | 'self'
  | 'fan-not-found'
  | 'artist-not-found'
  | 'season-required'
  | 'negative-counter'
  | 'adjust-above-limit'
  | 'adjust-daily-limit'
  | 'adjustment-id-reused'
  | 'lookup-daily-limit'
  | 'username-changed'
  | 'username-of-central';

const ERRORS: Record<PanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  self: ['permission-denied', 'Você não pode mudar a sua própria conta de fã pelo painel.'],
  'fan-not-found': ['not-found', 'Fã não encontrado.'],
  'artist-not-found': ['not-found', 'Central não encontrada.'],
  'season-required': [
    'failed-precondition',
    'Não há temporada em andamento para ajustar os pontos da temporada.',
  ],
  'negative-counter': ['failed-precondition', 'O ajuste deixaria um contador negativo.'],
  'adjust-above-limit': ['invalid-argument', 'O ajuste passa do limite por contador.'],
  'adjust-daily-limit': ['resource-exhausted', 'Você chegou ao limite de ajustes de hoje.'],
  'adjustment-id-reused': [
    'already-exists',
    'Um ajuste desta tentativa já foi gravado. Confira o extrato antes de ajustar de novo.',
  ],
  'lookup-daily-limit': [
    'resource-exhausted',
    'Você chegou ao limite de 50 buscas por e-mail hoje.',
  ],
  'username-changed': [
    'failed-precondition',
    'O @ deste fã mudou. Confira o @ de agora antes de trocar.',
  ],
  'username-of-central': ['failed-precondition', 'Este @ é de uma central, não de um fã.'],
};

/** Erro das callables do bloco 11: código do Firebase, mensagem em pt-BR e `details: { reason, ... }`. */
export function panelError(
  reason: PanelErrorReason,
  details: Record<string, unknown> = {},
  message?: string,
): HttpsError {
  const [code, fallback] = ERRORS[reason];
  return new HttpsError(code, message ?? fallback, { reason, ...details });
}

/**
 * O fã que a callable muda (o ajuste e as quatro da Moderação, 26.4), antes
 * de qualquer leitura: sem login, `unauthenticated`; o uid fora do formato do
 * fã, `invalid-request` com o campo; o uid de quem chama, `self` (um membro da
 * equipe pode ser fã na mesma conta, e não muda a própria).
 */
export function targetFanUid(caller: CallerAuth | undefined, value: unknown): string {
  if (!caller) throw panelAccessError('unauthenticated');
  if (!isFanId(value)) throw panelError('invalid-request', { field: 'uid' });
  if (value === caller.uid) throw panelError('self');
  return value;
}

/** Número em pt-BR, com o ponto dos milhares ("50.000"), sem depender do ICU. */
export function formatPoints(value: number): string {
  const sign = value < 0 ? '-' : '';
  return sign + String(Math.abs(Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** O contador como as frases dizem ("no saldo", "nos pontos da temporada"). */
const COUNTER_IN: Record<AdjustCounter, string> = {
  balance: 'no saldo',
  xp: 'no XP',
  season: 'nos pontos da temporada',
  centralSeason: 'nos pontos da temporada da central',
  centralTotal: 'nos pontos da central',
};

const COUNTER_NEGATIVE: Record<AdjustCounter, string> = {
  balance: 'O ajuste deixaria o saldo negativo.',
  xp: 'O ajuste deixaria o XP negativo.',
  season: 'O ajuste deixaria os pontos da temporada negativos.',
  centralSeason: 'O ajuste deixaria os pontos da temporada da central negativos.',
  centralTotal: 'O ajuste deixaria os pontos da central negativos.',
};

/** `negative-counter`, com o contador em `details.counter`. */
export function negativeCounterError(counter: AdjustCounter): HttpsError {
  return panelError('negative-counter', { counter }, COUNTER_NEGATIVE[counter]);
}

/** `adjust-above-limit`, com o teto do papel em `details.max`. */
export function aboveLimitError(max: number): HttpsError {
  return panelError(
    'adjust-above-limit',
    { max },
    `O ajuste passa do limite de ${formatPoints(max)} pontos por contador. Fale com um admin.`,
  );
}

/** `adjust-daily-limit`, com o contador e quanto ainda cabe nele hoje. */
export function dailyLimitError(counter: AdjustCounter, remaining: number): HttpsError {
  return panelError(
    'adjust-daily-limit',
    { counter, remaining },
    `Hoje você ainda pode ajustar ${formatPoints(remaining)} pontos ${COUNTER_IN[counter]}. Fale com um admin.`,
  );
}
