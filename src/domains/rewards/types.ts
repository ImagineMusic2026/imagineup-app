/**
 * Contrato com a API da loja (bloco 10, docs/arquitetura-api.md, seção 25),
 * espelho do `functions/src/api/contract.ts`: mudou um, mude o outro.
 * Recompensas, custos, estoque, limites e instruções são decididos no servidor
 * e ajustáveis pelo painel admin: o app só mostra. O resgate é por pontos (o
 * resgate pago e a loja paga do fandom estão fora do contrato).
 */

/** Decide o ícone e a cor do quadro (`REWARD_ICONS`). */
export type RewardKind = 'ticket' | 'videocall' | 'merch' | 'screen' | 'meet';

/**
 * `soldOut`: o painel encerrou, o estoque acabou ou o show da recompensa já
 * passou ou saiu do ar. O detalhe abre só para leitura.
 */
export type RewardStatus = 'available' | 'soldOut';

export interface RewardStock {
  remaining: number;
  total: number;
}

/** O show da recompensa ("São João de Irará · 21 out"), só enquanto ele está aberto. */
export interface RewardEvent {
  name: string;
  /** ISO. */
  startsAt: string;
}

/**
 * Status do pedido: solicitado ao resgatar, depois aprovado, entregue ou
 * recusado pela equipe no painel. O cancelado (exclusão de conta) nunca chega
 * ao fã.
 */
export type RedemptionStatus = 'requested' | 'approved' | 'delivered' | 'refused';

/**
 * Um pedido que o fã já fez desta recompensa. O código, as instruções e o
 * status voltam sempre que ele abre a recompensa: a retirada pode ser semanas
 * depois ("mostre este código no dia do show"), e a sheet do resgate pode ter
 * fechado antes da resposta (o arrasto do Android não trava).
 */
export interface RewardRedemption {
  /** O mesmo valor do `code`: a chave da lista. */
  id: string;
  /** Código que o fã mostra na retirada ("UP-4KD9TM"). */
  code: string;
  status: RedemptionStatus;
  /** ISO: quando o pedido chegou ao status de agora. */
  statusAt: string;
  /** O que o pedido gastou. */
  points: number;
  /** O que a recusa devolveu de fato ao saldo; 0 fora do recusado. */
  refundedPoints: number;
  /** As de agora no pedido aberto; a cópia da hora do resgate depois que ele fecha. */
  instructions: string;
  /** Só no recusado: o texto da equipe, ou `null`. */
  refusalReason: string | null;
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
  /** Pedidos por fã nesta recompensa, ou `null` sem limite (bloco 10). */
  perFanLimit: number | null;
  /** O fã já tem o limite de pedidos que contam: só para mostrar, quem decide é o servidor. */
  limitReached: boolean;
  /** Os pedidos do fã, do mais novo para o mais antigo (vazio quando não resgatou). */
  redemptions: RewardRedemption[];
}

/** Na ordem do painel. */
export interface RewardsResponse {
  /**
   * O endereço do regulamento das recompensas, ou `null` enquanto a cliente
   * não entregar o texto (o link fica escondido). Opcional: as fixtures
   * mandam o do app.
   */
  rulesUrl?: string | null;
  rewards: Reward[];
}

export interface RedeemVariables {
  rewardId: string;
  /** A mesma chave de novo não gasta duas vezes. */
  idempotencyKey: string;
  /**
   * O custo que o fã viu na confirmação: o servidor recusa com
   * `reward_changed` quando o custo de agora é outro.
   */
  expectedCost: number;
}

/**
 * O que o servidor devolve ao confirmar. O app não pede endereço nem dado
 * pessoal novo: a entrega física fica com a equipe, e as instruções (retirada
 * com o código ou contato pelo e-mail da conta) vêm do painel.
 */
export interface RedeemResult {
  redemptionId: string;
  rewardId: string;
  /** Código que o fã mostra na retirada ("UP-4KD9TM"). */
  code: string;
  /** Saldo depois do resgate. */
  balance: number;
  instructions: string;
  /** ISO. */
  redeemedAt: string;
  /** O pedido nasce solicitado (campo do bloco 10). */
  status?: RedemptionStatus;
}
