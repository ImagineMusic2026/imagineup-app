import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` no `resolveSupportMessage`
 * (docs/arquitetura-api.md, seção 38, 38.3). Os de acesso (`unauthenticated`,
 * `not-staff`, `no-section`) vêm do `readPanelActor`.
 */
export type SupportPanelErrorReason = 'invalid-request' | 'message-not-found';

const ERRORS: Record<SupportPanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'message-not-found': ['not-found', 'Essa mensagem não existe mais.'],
};

/** Erro do `resolveSupportMessage`: código do Firebase, mensagem em pt-BR e `details`. */
export function supportPanelError(
  reason: SupportPanelErrorReason,
  details: Record<string, unknown> = {},
): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason, ...details });
}
