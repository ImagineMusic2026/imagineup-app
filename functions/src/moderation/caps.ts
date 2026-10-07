import { addDailyCount, type AwardContext, type AwardPlan, type FanContext } from '../points/award';
import { capCount, DAILY_CAPS, dailyCapProblem, type CapAction } from './model';

// Os tetos do dia do bloco 6 (21.7) sobre a carteira lida no pedido: a
// curtida, o comentário, a presença, a denúncia e o bloqueio recusam com 429
// antes de gravar quando o fã já chegou no teto, e somam 1 no contador do dia
// quando gravam. Só o fã como ator conta; o seed (sistema) não. O teto vem da
// configuração (`actionCaps`, editável pelo painel desde o bloco 7).

/** Recusa (lança `DailyCapError`) se o fã já fez a ação o máximo de vezes hoje. */
export function enforceDailyCap(fan: FanContext, award: AwardContext, action: CapAction): void {
  if (award.actor.type !== 'fan') return;
  const limit = award.config.actionCaps[DAILY_CAPS[action].key];
  const problem = dailyCapProblem(
    action,
    capCount(fan.wallet.days, action, award.now),
    award.now,
    limit,
  );
  if (problem) throw problem;
}

/** Soma 1 no contador do dia da ação, na carteira de quem chama (só o fã como ator). */
export function countDailyAction(
  plan: AwardPlan,
  fan: FanContext,
  award: AwardContext,
  action: CapAction,
): void {
  if (award.actor.type !== 'fan') return;
  addDailyCount(plan, fan, DAILY_CAPS[action].key);
}
