import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` nas callables da loja
 * (bloco 10, docs/arquitetura-api.md, 25.8). A mensagem em pt-BR vai junto e
 * pode ser mostrada como está. Os de acesso (`unauthenticated`, `not-staff`,
 * `no-section`) vêm do `readPanelActor`.
 */
export type RewardPanelErrorReason =
  | 'invalid-request'
  | 'reward-not-found'
  | 'event-not-found'
  | 'invalid-photo'
  | 'photo-not-found'
  | 'invalid-status'
  | 'not-published'
  | 'event-not-open'
  | 'stock-below-redeemed'
  | 'was-published'
  | 'has-redemptions'
  | 'redemption-not-found'
  | 'invalid-transition'
  | 'reason-not-allowed';

const ERRORS: Record<RewardPanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'reward-not-found': ['not-found', 'Recompensa não encontrada.'],
  'event-not-found': ['not-found', 'Show não encontrado.'],
  'invalid-photo': ['invalid-argument', 'Envie a foto de novo: o arquivo não é desta recompensa.'],
  'photo-not-found': ['not-found', 'A foto não chegou ao armazenamento. Envie de novo.'],
  'invalid-status': ['invalid-argument', 'Status inválido.'],
  'not-published': [
    'failed-precondition',
    'Só uma recompensa no ar pode ser encerrada. Apague o rascunho em vez de encerrar.',
  ],
  'event-not-open': [
    'failed-precondition',
    'O show desta recompensa já passou ou não está no ar. Troque o show antes de publicar.',
  ],
  'stock-below-redeemed': [
    'failed-precondition',
    'O estoque não pode ficar abaixo do que já foi resgatado.',
  ],
  'was-published': [
    'failed-precondition',
    'Essa recompensa já esteve no ar. Encerre em vez de apagar.',
  ],
  'has-redemptions': [
    'failed-precondition',
    'Essa recompensa já tem pedidos. Encerre em vez de apagar.',
  ],
  'redemption-not-found': ['not-found', 'Pedido não encontrado.'],
  'invalid-transition': ['failed-precondition', 'Esse pedido não pode ir para esse status.'],
  'reason-not-allowed': [
    'invalid-argument',
    'O motivo e a devolução da vaga só valem para recusar um pedido.',
  ],
};

/** Erro das callables da loja: código do Firebase, mensagem em pt-BR e `details: { reason }`. */
export function rewardPanelError(
  reason: RewardPanelErrorReason,
  details: Record<string, unknown> = {},
): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason, ...details });
}
