import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { formatDayMonth, formatLongDate } from '@/utils/date';
import { formatNumber, formatPointsSpoken } from '@/utils/number';

import { REDEEM_ERROR_CODES } from './consts';
import type { Reward } from './types';

/**
 * Situação da recompensa diante do saldo, só para mostrar: quem decide o
 * resgate é o servidor.
 * - `redeemable`: o saldo cobre o custo;
 * - `short`: faltam pontos (`missing`);
 * - `soldOut`: esgotou;
 * - `unknown`: o saldo ainda não chegou (ou não carregou).
 */
export type RewardAvailability =
  | { state: 'redeemable' }
  | { state: 'short'; missing: number }
  | { state: 'soldOut' }
  | { state: 'unknown' };

export function isSoldOut(reward: Reward): boolean {
  return reward.status === 'soldOut' || reward.stock?.remaining === 0;
}

export function rewardAvailability(reward: Reward, balance: number | null): RewardAvailability {
  if (isSoldOut(reward)) return { state: 'soldOut' };
  if (balance === null) return { state: 'unknown' };
  if (balance >= reward.cost) return { state: 'redeemable' };
  return { state: 'short', missing: reward.cost - balance };
}

/** "6.000 pts", no bloco lima do card e no destaque. */
export function priceText(cost: number): string {
  return t('rewards.price', { points: formatNumber(cost) });
}

/** "faltam 2.520", no lugar do preço quando o saldo não cobre. */
export function missingText(missing: number): string {
  if (missing === 1) return t('rewards.missingOne');
  return t('rewards.missing', { points: formatNumber(missing) });
}

/** "Faltam 2.520 pontos", para o leitor de tela e o botão desligado do detalhe. */
export function missingSpoken(missing: number): string {
  if (missing === 1) return t('rewards.spoken.missingOne');
  return t('rewards.spoken.missing', { points: formatPointsSpoken(missing) });
}

/**
 * "Só 20 vagas" quando o painel marcou escassez e ainda há vaga. Esgotada (o
 * painel encerrou, mesmo com vagas sobrando), não: o selo e o rótulo dizem
 * "Esgotado".
 */
export function scarcityText(reward: Reward): string | null {
  const remaining = reward.stock?.remaining ?? 0;
  if (!reward.scarcity || isSoldOut(reward) || remaining <= 0) return null;
  if (remaining === 1) return t('rewards.scarcityOne');
  return t('rewards.scarcity', { count: formatNumber(remaining) });
}

/**
 * Linha de baixo do título no destaque e no detalhe: o show ("São João de
 * Irará · 21 out") ou, sem show, o subtítulo do painel.
 */
export function rewardMeta(reward: Reward): string {
  if (!reward.event) return reward.subtitle;
  return t('rewards.meta.event', {
    name: reward.event.name,
    date: formatDayMonth(reward.event.startsAt),
  });
}

/** A mesma linha para o leitor de tela: data por extenso, sem o "·". */
export function rewardMetaSpoken(reward: Reward): string {
  if (!reward.event) return reward.subtitle;
  return t('rewards.spoken.event', {
    name: reward.event.name,
    date: formatLongDate(reward.event.startsAt),
  });
}

/** O que o card diz do preço: o custo, o que falta ou "Esgotado". */
function spokenValue(reward: Reward, availability: RewardAvailability): string {
  switch (availability.state) {
    case 'short':
      return missingSpoken(availability.missing);
    case 'soldOut':
      return t('rewards.soldOut');
    default:
      return formatPointsSpoken(reward.cost);
  }
}

/**
 * O card da grade inteiro num rótulo só: "Par de ingressos. Pra Encher e
 * Derramar. 6.000 pontos." ou "Camisa oficial. Coleção São João. Faltam 2.520
 * pontos." O preço é só visual, não um botão à parte.
 */
export function rewardCardLabel(reward: Reward, availability: RewardAvailability): string {
  return t('rewards.label.card', {
    title: reward.title,
    meta: reward.subtitle,
    value: spokenValue(reward, availability),
  });
}

/** "Meet & greet com o Netto. Só 20 vagas. São João de Irará, 21 de outubro. 10.000 pontos." */
export function featuredRewardLabel(reward: Reward, availability: RewardAvailability): string {
  const params = {
    title: reward.title,
    meta: rewardMetaSpoken(reward),
    value: spokenValue(reward, availability),
  };
  const scarcity = scarcityText(reward);
  return scarcity
    ? t('rewards.label.featuredScarce', { ...params, scarcity })
    : t('rewards.label.card', params);
}

/** Duas recompensas por linha da grade; a última pode ficar sozinha. */
export interface RewardRow {
  key: string;
  rewards: readonly [Reward] | readonly [Reward, Reward];
}

export interface RewardGrid {
  /** O primeiro destaque do painel, no topo. */
  featured: Reward | null;
  rows: RewardRow[];
}

/**
 * "Ao seu alcance": uma seção só, do menor custo para o maior (o que dá para
 * resgatar vem antes), com as esgotadas no fim. Empate fica na ordem do
 * painel. O destaque sai da grade.
 */
export function buildRewardGrid(rewards: readonly Reward[]): RewardGrid {
  const featured = rewards.find((reward) => reward.featured) ?? null;
  const rest = rewards
    .map((reward, index) => ({ reward, index }))
    .filter(({ reward }) => reward !== featured)
    .sort(
      (a, b) =>
        Number(isSoldOut(a.reward)) - Number(isSoldOut(b.reward)) ||
        a.reward.cost - b.reward.cost ||
        a.index - b.index,
    )
    .map(({ reward }) => reward);

  const rows: RewardRow[] = [];
  for (let start = 0; start < rest.length; start += 2) {
    const first = rest[start];
    const second = rest[start + 1];
    if (!first) break;
    rows.push(
      second
        ? { key: `${first.id}+${second.id}`, rewards: [first, second] }
        : { key: first.id, rewards: [first] },
    );
  }
  return { featured, rows };
}

/**
 * Por que o servidor recusou o resgate:
 * - `insufficientPoints`: o saldo não cobre (mudou desde a última busca);
 * - `soldOut`: esgotou no meio;
 * - `notFound`: a recompensa saiu da loja;
 * - `failed`: o resto (rede, servidor); o resultado pode ser incerto.
 */
export type RedeemFailure = 'insufficientPoints' | 'soldOut' | 'notFound' | 'failed';

export function redeemFailure(error: unknown): RedeemFailure {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === REDEEM_ERROR_CODES.insufficientPoints) return 'insufficientPoints';
  if (error.code === REDEEM_ERROR_CODES.soldOut) return 'soldOut';
  if (error.code === REDEEM_ERROR_CODES.notFound) return 'notFound';
  return 'failed';
}

/**
 * O servidor pode ter gravado o resgate antes de a resposta se perder (rede,
 * prazo, erro 5xx): tentar de novo leva a mesma chave, para não gastar duas
 * vezes. Recusa definitiva (saldo, esgotado) não gravou nada, e a próxima
 * tentativa é uma ação nova.
 */
export function outcomeUnknown(error: unknown): boolean {
  return !(error instanceof ApiError) || error.isRetryable;
}
