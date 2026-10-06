import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` no `moderateComment`
 * (bloco 6, docs/arquitetura-api.md, 21.9). Os de acesso vêm do
 * `readPanelActor`.
 */
export type ModerationPanelErrorReason =
  'invalid-request' | 'comment-not-found' | 'invalid-action' | 'not-reported' | 'comment-hidden';

const ERRORS: Record<ModerationPanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'comment-not-found': ['not-found', 'Comentário não encontrado.'],
  'invalid-action': ['invalid-argument', 'Ação inválida: ocultar, manter ou reexibir.'],
  'not-reported': ['failed-precondition', 'Esse comentário não está na fila da Moderação.'],
  'comment-hidden': [
    'failed-precondition',
    'Esse comentário está oculto. Para mostrar de novo, use reexibir.',
  ],
};

/** Erro do `moderateComment`: código do Firebase, mensagem em pt-BR e `details: { reason }`. */
export function moderationPanelError(reason: ModerationPanelErrorReason): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason });
}
