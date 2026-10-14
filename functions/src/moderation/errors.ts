import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` no `moderateComment`
 * (bloco 6, docs/arquitetura-api.md, 21.9) e, desde as exigências das lojas
 * (seção 29, 29.6), no `resolveProfileReport` (`profile-not-reported` e
 * `stale-report`). Os de acesso vêm do `readPanelActor`.
 */
export type ModerationPanelErrorReason =
  | 'invalid-request'
  | 'comment-not-found'
  | 'invalid-action'
  | 'not-reported'
  | 'comment-hidden'
  | 'profile-not-reported'
  | 'stale-report';

const ERRORS: Record<ModerationPanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'comment-not-found': ['not-found', 'Comentário não encontrado.'],
  'invalid-action': ['invalid-argument', 'Ação inválida: ocultar, manter ou reexibir.'],
  'not-reported': ['failed-precondition', 'Esse comentário não está na fila da Moderação.'],
  'comment-hidden': [
    'failed-precondition',
    'Esse comentário está oculto. Para mostrar de novo, use reexibir.',
  ],
  'profile-not-reported': ['failed-precondition', 'Esse perfil não está na fila da Moderação.'],
  'stale-report': ['failed-precondition', 'A denúncia mudou desde que o card abriu. Abra de novo.'],
};

/**
 * Erro do `moderateComment` e do `resolveProfileReport`: código do Firebase,
 * mensagem em pt-BR e `details: { reason }`.
 */
export function moderationPanelError(reason: ModerationPanelErrorReason): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason });
}
