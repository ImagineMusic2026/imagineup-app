import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { formatDayMonth, formatLongDate } from '@/utils/date';
import { formatNumber, formatPointsSpoken } from '@/utils/number';

import { REDEEM_ERROR_CODES } from './consts';
import type { RedemptionStatus, Reward, RewardRedemption } from './types';

/**
 * Situação da recompensa diante do saldo, só para mostrar: quem decide o
 * resgate é o servidor.
 * - `redeemable`: o saldo cobre o custo;
 * - `short`: faltam pontos (`missing`);
 * - `soldOut`: esgotou;
 * - `limitReached`: o fã já tem o limite de pedidos desta recompensa (bloco 10);
 * - `unknown`: o saldo ainda não chegou (ou não carregou).
 */
export type RewardAvailability =
  | { state: 'redeemable' }
  | { state: 'short'; missing: number }
  | { state: 'soldOut' }
  | { state: 'limitReached' }
  | { state: 'unknown' };

export function isSoldOut(reward: Reward): boolean {
  return reward.status === 'soldOut' || reward.stock?.remaining === 0;
}

/**
 * O fã já chegou ao limite de pedidos (`limitReached` do servidor). Campo do
 * bloco 10: uma loja sem o campo vale `false`.
 */
export function isLimitReached(reward: Reward): boolean {
  return reward.limitReached === true;
}

/** Esgotado vem antes do limite; o limite, antes do saldo (25.12). */
export function rewardAvailability(reward: Reward, balance: number | null): RewardAvailability {
  if (isSoldOut(reward)) return { state: 'soldOut' };
  if (isLimitReached(reward)) return { state: 'limitReached' };
  if (balance === null) return { state: 'unknown' };
  if (balance >= reward.cost) return { state: 'redeemable' };
  return { state: 'short', missing: reward.cost - balance };
}

/** O botão desligado do limite: "Você já resgatou" (limite 1) ou "Limite de N resgates atingido". */
export function limitReachedText(reward: Reward): string {
  const limit = reward.perFanLimit ?? 1;
  if (limit <= 1) return t('rewards.details.limitReachedOne');
  return t('rewards.details.limitReached', { count: formatNumber(limit) });
}

const STATUS_KEYS = {
  requested: 'rewards.redeemed.status.requested',
  approved: 'rewards.redeemed.status.approved',
  delivered: 'rewards.redeemed.status.delivered',
  refused: 'rewards.redeemed.status.refused',
} as const satisfies Record<RedemptionStatus, TranslationKey>;

/** O que a linha do status lê: o pedido da loja, ou a resposta do resgate (o passo de sucesso). */
type StatusLine = Pick<RewardRedemption, 'status' | 'statusAt'>;

/** Status que o app não conhece (campo novo do servidor) vale o solicitado. */
function statusKey(status: RedemptionStatus): TranslationKey {
  return STATUS_KEYS[status] ?? STATUS_KEYS.requested;
}

/**
 * A linha do status do pedido com a data dele: "Solicitado em 5 out",
 * "Aprovado em 4 out", "Entregue em 2 out" ou "Recusado em 2 out".
 */
export function redemptionStatusText(redemption: StatusLine): string {
  return t(statusKey(redemption.status), { date: formatDayMonth(redemption.statusAt) });
}

/** A mesma linha para o leitor de tela, com a data por extenso ("Entregue em 2 de outubro"). */
export function redemptionStatusSpoken(redemption: StatusLine): string {
  return t(statusKey(redemption.status), { date: formatLongDate(redemption.statusAt) });
}

/** O pedido ainda pede as instruções (retirada ou contato): solicitado e aprovado. */
export function isOpenRedemption(redemption: RewardRedemption): boolean {
  return redemption.status === 'requested' || redemption.status === 'approved';
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

/** O que o card diz do preço: o custo, o que falta, "Esgotado" ou o limite atingido. */
function spokenValue(reward: Reward, availability: RewardAvailability): string {
  switch (availability.state) {
    case 'short':
      return missingSpoken(availability.missing);
    case 'soldOut':
      return t('rewards.soldOut');
    case 'limitReached':
      return t('rewards.spoken.limitReached');
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

/** Esgotada ou no limite do fã: vai para o fim da grade. */
const outOfShop = (reward: Reward) => isSoldOut(reward) || isLimitReached(reward);

/**
 * "Ao seu alcance": uma seção só, do menor custo para o maior (o que dá para
 * resgatar vem antes), com as esgotadas e as no limite do fã no fim. Empate
 * fica na ordem do painel. O destaque sai da grade.
 */
export function buildRewardGrid(rewards: readonly Reward[]): RewardGrid {
  const featured = rewards.find((reward) => reward.featured) ?? null;
  const rest = rewards
    .map((reward, index) => ({ reward, index }))
    .filter(({ reward }) => reward !== featured)
    .sort(
      (a, b) =>
        Number(outOfShop(a.reward)) - Number(outOfShop(b.reward)) ||
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
 * - `limitReached`: o fã chegou ao limite de pedidos desta recompensa;
 * - `changed`: o custo de agora não é o que o fã viu na confirmação;
 * - `dailyLimit`: o teto de resgates do dia;
 * - `alreadyRedeemed`: a chave da tentativa já gravou um pedido (25.5);
 * - `failed`: o resto (rede, servidor); o resultado pode ser incerto.
 */
export type RedeemFailure =
  | 'insufficientPoints'
  | 'soldOut'
  | 'notFound'
  | 'limitReached'
  | 'changed'
  | 'dailyLimit'
  | 'alreadyRedeemed'
  | 'failed';

const FAILURES: Readonly<Record<string, Exclude<RedeemFailure, 'failed'>>> = {
  [REDEEM_ERROR_CODES.insufficientPoints]: 'insufficientPoints',
  [REDEEM_ERROR_CODES.soldOut]: 'soldOut',
  [REDEEM_ERROR_CODES.notFound]: 'notFound',
  [REDEEM_ERROR_CODES.limitReached]: 'limitReached',
  [REDEEM_ERROR_CODES.changed]: 'changed',
  [REDEEM_ERROR_CODES.dailyLimit]: 'dailyLimit',
  [REDEEM_ERROR_CODES.alreadyRedeemed]: 'alreadyRedeemed',
};

export function redeemFailure(error: unknown): RedeemFailure {
  if (!(error instanceof ApiError) || error.code === null) return 'failed';
  return FAILURES[error.code] ?? 'failed';
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
