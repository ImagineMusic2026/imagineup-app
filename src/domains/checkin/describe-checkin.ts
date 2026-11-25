import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { actionRefusal, type ActionRefusal } from '@/services/api/refusal';
import { formatTimeLeft, formatTimeLeftSpoken } from '@/utils/date';
import { formatNumber, formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import type { CheckinState } from './types';

// O que o fã vê do check-in diário a partir do `GET /me/checkin`, sem React:
// se o card e a pílula aparecem, a virada do dia e os textos da tela e do
// leitor. Puro, para o teste em tabela. O aparelho nunca calcula o dia de São
// Paulo, a sequência nem os pontos: tudo aqui só lê o que o servidor mandou.

/** O `code` do 409 de `POST /me/checkin` com a chave desligada. */
export const CHECKIN_DISABLED = 'checkin_disabled';

/**
 * A rota do check-in não existe no servidor: o 404 que a `api` de antes do
 * check-in dá ao `GET` e ao `POST /me/checkin`. É a única recusa que trava a
 * consulta até o app reabrir (`useCheckinQuery`): com a `api` de antes,
 * perguntar de novo a cada tela, puxão ou volta do app só repetiria o 404.
 */
export function isMissingRoute(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'notFound';
}

/**
 * Uma recusa definitiva do `GET /me/checkin`: o 404 de rota que não existe,
 * que a `api` de antes do check-in dá, ou outra que não muda tentando de
 * novo, sempre com a resposta do servidor (o status). A falha incerta (rede,
 * servidor), o ritmo e o pedido que nem saiu (sem status) não contam. É a
 * mesma regra da trava do fã-clube (`fan-club/entry.ts`), copiada aqui porque
 * lá ela não sai pelo index. Aqui ela só esconde o card (`liveCheckin`): das
 * recusas definitivas, quem trava a consulta é só o 404 (`isMissingRoute`).
 */
export function isDefinitiveRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status !== null && !error.isRetryable && !error.isRateLimited
  );
}

/**
 * O estado que a tela pode mostrar: a resposta do servidor nesta abertura do
 * app, com a chave ligada e o ciclo. Sem resposta (carregando, ou a consulta
 * que falhou sem nada antes), com a chave desligada ou com uma recusa
 * definitiva (o 404 da `api` de antes, um 401, um 403), nada aparece, mesmo
 * com uma resposta antiga na memória. A recusa esconde o card enquanto for o
 * erro da consulta: a busca seguinte pergunta de novo e, se der certo, ele
 * volta (menos depois do 404, que trava a consulta). A falha incerta e o
 * ritmo deixam a resposta que já estava, como nas outras seções da Início: a
 * busca de novo que falha não tira o card de quem ia tocar nele.
 */
export function liveCheckin(data: CheckinState | undefined, error: unknown): CheckinState | null {
  if (!data || data.enabled !== true || data.cycle.length === 0) return null;
  if (isDefinitiveRefusal(error)) return null;
  return data;
}

/**
 * - `current`: o estado vale;
 * - `stale`: o dia virou depois da resposta. O estado é o de ontem: some da
 *   tela e a consulta busca de novo;
 * - `recheck`: o prazo passou no relógio do aparelho, mas a resposta veio
 *   depois dele (o relógio do aparelho está adiantado, e o dia do servidor
 *   ainda não virou). O estado fica na tela, porque quem diz o dia é o
 *   servidor, e a consulta pergunta de novo, uma vez por minuto.
 */
export type CheckinRollover = 'current' | 'stale' | 'recheck';

// Entre duas perguntas ao servidor com o relógio do aparelho adiantado: o
// `useNow` anda de minuto em minuto, e a pergunta sai na volta seguinte.
const RECHECK_MS = 30_000;

/**
 * A virada do dia do check-in, com o `resetsAt` do servidor (a próxima
 * meia-noite de São Paulo), a hora em que a resposta chegou e a de agora,
 * as duas no relógio do aparelho. O aparelho só compara instantes: nunca
 * calcula o dia.
 */
export function checkinRollover(resetsAt: string, fetchedAt: number, now: Date): CheckinRollover {
  const reset = new Date(resetsAt).getTime();
  const current = now.getTime();
  // Prazo ilegível não vence: o estado fica até a próxima busca.
  if (!(reset <= current)) return 'current';
  if (fetchedAt < reset) return 'stale';
  return current - fetchedAt >= RECHECK_MS ? 'recheck' : 'current';
}

/** "4 dias seguidos", "1 dia seguido" e, sem sequência, "Comece sua sequência". */
export function streakText(streak: number): string {
  if (streak <= 0) return t('checkin.streakNone');
  if (streak === 1) return t('checkin.streakOne');
  return t('checkin.streak', { count: formatNumber(streak) });
}

/** "Termina em 4 h", ou `null` com o prazo vencido (o relógio do aparelho adiantado). */
export function endsInText(state: CheckinState, now: Date): string | null {
  const time = formatTimeLeft(state.resetsAt, now);
  return time ? t('checkin.endsIn', { time }) : null;
}

/**
 * O topo do card num rótulo só, o cabeçalho dele: "Check-in diário. 4 dias
 * seguidos. Termina em 4 horas." Com o de hoje feito, sem o prazo.
 */
export function checkinSummary(state: CheckinState, now: Date): string {
  const summary = t('checkin.summary', { streak: streakText(state.streak) });
  if (state.checkedInToday) return summary;
  const time = formatTimeLeftSpoken(state.resetsAt, now);
  return time ? `${summary} ${t('checkin.endsInSpoken', { time })}` : summary;
}

/**
 * - `done`: dia do ciclo já feito (lima cheio, com o check);
 * - `today`: o dia do check-in de hoje, ainda por fazer;
 * - `upcoming`: os dias seguintes.
 */
export type CheckinCellStatus = 'done' | 'today' | 'upcoming';

/** Um dia da trilha do ciclo. */
export interface CheckinCell {
  /** O lugar no ciclo, de 1 a `cycle.length`. */
  day: number;
  status: CheckinCellStatus;
  /** "+5": quanto o dia vale. */
  value: string;
  /** "Hoje" ou "Dia 5", embaixo da célula. */
  label: string;
}

/**
 * A trilha do ciclo, uma célula por valor que o servidor mandou (a
 * quantidade e os valores são do painel): os dias antes do `cycleDay` feitos,
 * o `cycleDay` como hoje e os seguintes por vir. Com o check-in de hoje
 * feito, o `cycleDay` também entra nos feitos (o card ainda está na tela
 * enquanto encolhe).
 */
export function checkinCells(state: CheckinState): CheckinCell[] {
  const doneThrough = state.checkedInToday ? state.cycleDay : state.cycleDay - 1;
  return state.cycle.map((points, index) => {
    const day = index + 1;
    const status: CheckinCellStatus =
      day <= doneThrough ? 'done' : day === state.cycleDay ? 'today' : 'upcoming';
    return {
      day,
      status,
      value: formatPointsDelta(points),
      label: status === 'today' ? t('checkin.today') : t('checkin.day', { day }),
    };
  });
}

/** Os dias do ciclo já feitos, para o valor da trilha lida como progresso. */
export function doneCycleDays(state: CheckinState): number {
  const done = state.checkedInToday ? state.cycleDay : state.cycleDay - 1;
  return Math.min(state.cycle.length, Math.max(0, done));
}

/**
 * A trilha inteira num rótulo só: "Dia 5 de 7. O check-in de hoje vale 5
 * pontos. O dia 7 vale 15 pontos." No último dia, sem a última frase.
 */
export function trackLabel(state: CheckinState): string {
  const total = state.cycle.length;
  const label = t('checkin.track.label', {
    day: state.cycleDay,
    total,
    points: formatPointsSpoken(state.todayPoints),
  });
  const last = state.cycle[total - 1] ?? 0;
  if (state.cycleDay >= total || last <= 0) return label;
  return `${label} ${t('checkin.track.last', { total, points: formatPointsSpoken(last) })}`;
}

/** O rótulo visível do botão: "Fazer check-in +5" (sem o valor quando ele é 0). */
export function actionText(state: CheckinState): string {
  if (state.todayPoints <= 0) return t('checkin.action');
  return t('checkin.actionWithPoints', { points: formatPointsDelta(state.todayPoints) });
}

/** O botão para o leitor de tela: "Fazer check-in, vale 5 pontos". */
export function actionLabel(state: CheckinState): string {
  if (state.todayPoints <= 0) return t('checkin.action');
  return t('checkin.actionLabel', { points: formatPointsSpoken(state.todayPoints) });
}

/**
 * Quanto vale o check-in de amanhã, com o de hoje feito: o dia seguinte do
 * ciclo, que recomeça depois do último.
 */
export function nextCheckinPoints(state: CheckinState): number {
  const total = state.cycle.length;
  if (total === 0) return 0;
  return state.cycle[state.cycleDay % total] ?? 0;
}

/** Um texto com o valor no meio, em pedaços, para o valor sair em lima. */
export interface PointsText {
  before: string;
  /** "+6". */
  points: string;
  after: string;
}

function pointsText(key: 'checkin.done.earned' | 'checkin.done.next', points: number): PointsText {
  const [before = '', after = ''] = t(key).split('{{points}}');
  return { before, points: formatPointsDelta(points), after };
}

/**
 * A linha de baixo do "Check-in de hoje feito", no pé do card: quanto o de
 * hoje rendeu ("+5 hoje") e quanto vale o de amanhã ("Amanhã vale +6"), cada
 * um só quando vale mais que 0 (o ciclo com 0 num dia).
 */
export function doneMeta(state: CheckinState): {
  earned: PointsText | null;
  next: PointsText | null;
} {
  const next = nextCheckinPoints(state);
  return {
    earned: state.todayPoints > 0 ? pointsText('checkin.done.earned', state.todayPoints) : null,
    next: next > 0 ? pointsText('checkin.done.next', next) : null,
  };
}

/**
 * O pé do card com o de hoje feito num rótulo só: "Check-in de hoje feito.
 * Rendeu 5 pontos. Amanhã vale 6 pontos."
 */
export function doneFooterLabel(state: CheckinState): string {
  const parts = [t('checkin.done.todaySpoken')];
  if (state.todayPoints > 0) {
    parts.push(t('checkin.done.earnedSpoken', { points: formatPointsSpoken(state.todayPoints) }));
  }
  const next = nextCheckinPoints(state);
  if (next > 0) parts.push(t('checkin.done.nextSpoken', { points: formatPointsSpoken(next) }));
  return parts.join(' ');
}

/** O anúncio do check-in que deu certo: "Check-in feito. 5 dias seguidos." */
export function checkinAnnouncement(state: CheckinState): string {
  return t('checkin.done.summary', { streak: streakText(state.streak) });
}

/**
 * O ícone do calendário no topo da Início para o leitor de tela: "Check-in de
 * hoje por fazer, vale 5 pontos" ou, feito, "Check-in de hoje feito. 5 dias
 * seguidos." A bolinha e o pulso são só desenho: quem diz o estado é o rótulo.
 */
export function headerButtonLabel(state: CheckinState): string {
  if (state.checkedInToday) {
    return t('checkin.header.done', { streak: streakText(state.streak) });
  }
  if (state.todayPoints <= 0) return t('checkin.header.pending');
  return t('checkin.header.pendingWithPoints', {
    points: formatPointsSpoken(state.todayPoints),
  });
}

/** A pílula da 1e para o leitor de tela: "Sequência de check-in: 4 dias seguidos". */
export function streakPillLabel(streak: number): string {
  return t('checkin.profile.label', { streak: streakText(streak) });
}

/**
 * O check-in saiu do ar com o card na tela: a chave desligada (409
 * `checkin_disabled`) ou a `api` de antes (o 404 de rota que não existe). O
 * estado busca de novo e o card some.
 */
export function isCheckinUnavailable(error: unknown): boolean {
  if (isMissingRoute(error)) return true;
  return error instanceof ApiError && error.status === 409 && error.code === CHECKIN_DISABLED;
}

/**
 * Por que o toque em "Fazer check-in" falhou, e a frase: a do check-in fora
 * do ar ou a da peça comum das recusas (o suspenso, o ritmo e a genérica).
 */
export function checkinRefusal(error: unknown): ActionRefusal {
  if (isCheckinUnavailable(error)) return { type: null, key: 'checkin.unavailable' };
  return actionRefusal(error, 'checkin');
}
