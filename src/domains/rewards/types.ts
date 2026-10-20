/**
 * Contrato com a API da loja (bloco 10, docs/arquitetura-api.md, seção 25),
 * espelho do `functions/src/api/contract.ts`: mudou um, mude o outro.
 * Recompensas, custos, estoque, limites e instruções são decididos no servidor
 * e ajustáveis pelo painel admin: o app só mostra. O resgate é por pontos (o
 * resgate pago e a loja paga do fandom estão fora do contrato).
 */

/**
 * Decide o ícone e a cor do quadro (`REWARD_ICONS`). O `discount` (Desconto,
 * seção 34, decisão 42) é só dos prêmios de fã-clube e chega só no `prizes`;
 * um tipo que o app ainda não conhece ganha o ícone de reserva.
 */
export type RewardKind = 'ticket' | 'videocall' | 'merch' | 'screen' | 'meet' | 'discount';

/** Os tipos da loja (o `rewards`): o servidor nunca manda o `discount` ali. */
export type StoreRewardKind = Exclude<RewardKind, 'discount'>;

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
  kind: StoreRewardKind;
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

/**
 * Um prêmio de fã-clube do gestor (seção 34, decisão 51): o pedido que a
 * equipe deu pelo Recompensar e a recompensa "Só para prêmios" resumida, que
 * nunca está no `rewards`. A fileira "Seus prêmios" e o detalhe em modo
 * prêmio leem daqui.
 */
export interface FanClubPrize {
  /** O mesmo valor do `code`: a chave da lista. */
  id: string;
  /** O código de retirada ("UP-4KD9TM"), o de sempre dos pedidos. */
  code: string;
  /** Nasce aprovado ou entregue; o recusado é o prêmio cancelado pela equipe. */
  status: RedemptionStatus;
  /** ISO: quando o pedido chegou ao status de agora. */
  statusAt: string;
  /** ISO: quando a equipe deu o prêmio. */
  grantedAt: string;
  /** O cupom do parceiro, ou `null`; nunca no recusado. */
  coupon: string | null;
  /** A mensagem da equipe ao gestor, ou `null`. */
  message: string | null;
  /** Só no recusado: o texto da equipe, ou `null`. */
  refusalReason: string | null;
  reward: {
    id: string;
    /** Pode ser o `discount`, ou um tipo que o app ainda não conhece (o ícone de reserva). */
    kind: RewardKind | (string & {});
    title: string;
    imageUrl: string | null;
    /** As de agora no prêmio aberto; a cópia da hora do prêmio no fechado. */
    instructions: string;
  };
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
  /**
   * Os prêmios de fã-clube do fã, do mais novo ao mais antigo (seção 34).
   * Opcional: a `api` de antes da publicação não manda, e a loja gravada no
   * disco antes dela também não tem o campo (34.22, etapa 5). Sem ele, nada
   * novo aparece.
   */
  prizes?: FanClubPrize[];
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
  /**
   * O WhatsApp do fã em E.164 (`+5575991234567`, seção 35): o servidor guarda
   * no contato do fã, para a equipe combinar a entrega. Fora do formato, 400
   * `invalid_request` com o campo `whatsapp`.
   */
  whatsapp: string;
}

/**
 * O que o servidor devolve ao confirmar. Desde a seção 35, o app pede só o
 * WhatsApp, para a equipe combinar a entrega (o endereço, quando a entrega
 * pede, a equipe combina por ele); as instruções (retirada com o código ou o
 * contato da equipe) vêm do painel. O número não volta na resposta.
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
