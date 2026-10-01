/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado.
 * Recompensas, custos, estoque e instruções são decididos no servidor e
 * ajustáveis pelo painel admin: o app só mostra. O resgate é por pontos (o
 * resgate pago e a loja paga do fandom estão fora do contrato).
 */

/** Decide o ícone e a cor do quadro (`REWARD_ICONS`). */
export type RewardKind = 'ticket' | 'videocall' | 'merch' | 'screen' | 'meet';

/** `soldOut`: o painel encerrou ou o estoque acabou. O detalhe abre só para leitura. */
export type RewardStatus = 'available' | 'soldOut';

export interface RewardStock {
  remaining: number;
  total: number;
}

/** O show da recompensa ("São João de Irará · 21 out"). */
export interface RewardEvent {
  name: string;
  /** ISO. */
  startsAt: string;
}

/**
 * Um resgate que o fã já fez desta recompensa. O código e as instruções
 * voltam sempre que ele abre a recompensa: a retirada pode ser semanas depois
 * ("mostre este código no dia do show"), e a sheet do resgate pode ter
 * fechado antes da resposta (o arrasto do Android não trava).
 */
export interface RewardRedemption {
  id: string;
  /** Código que o fã mostra na retirada ("UP-1001"). */
  code: string;
  instructions: string;
  /** ISO. */
  redeemedAt: string;
}

export interface Reward {
  id: string;
  kind: RewardKind;
  /** "Par de ingressos". */
  title: string;
  /** "Pra Encher e Derramar". */
  subtitle: string;
  /** Texto do painel, no detalhe do resgate. */
  description: string | null;
  /** Em pontos do saldo (o contador que o resgate gasta; o nível não cai). */
  cost: number;
  /** Sem foto, o destaque mostra o placeholder de marca e a grade, o ícone do tipo. */
  imageUrl: string | null;
  /** O destaque do topo da 1h. */
  featured: boolean;
  /** O painel marcou escassez: o selo "Só N vagas" aparece. */
  scarcity: boolean;
  /** `null` quando não há limite. */
  stock: RewardStock | null;
  event: RewardEvent | null;
  status: RewardStatus;
  /** Os resgates do fã, do mais novo para o mais antigo (vazio quando não resgatou). */
  redemptions: RewardRedemption[];
}

/** Na ordem do painel. */
export interface RewardsResponse {
  rewards: Reward[];
}

export interface RedeemVariables {
  rewardId: string;
  /** A mesma chave de novo não gasta duas vezes. */
  idempotencyKey: string;
}

/**
 * O que o servidor devolve ao confirmar. O app não pede endereço nem dado
 * pessoal novo: a entrega física fica com a equipe, e as instruções (retirada
 * com o código ou contato pelo e-mail da conta) vêm do painel.
 */
export interface RedeemResult {
  redemptionId: string;
  rewardId: string;
  /** Código que o fã mostra na retirada ("UP-1001"). */
  code: string;
  /** Saldo depois do resgate. */
  balance: number;
  instructions: string;
  /** ISO. */
  redeemedAt: string;
}
