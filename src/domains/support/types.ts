// O Suporte dos Ajustes (docs/arquitetura-api.md, seção 38): o espelho do
// contrato de `functions/src/api/contract.ts` (a parte "Suporte dos Ajustes").
// Mudou um, mude o outro.

/** O tipo da mensagem: Reportar problema, Sugerir funcionalidade e Feedback geral. */
export type SupportKind = 'problem' | 'idea' | 'feedback';

/** O aparelho de quem reporta o problema: o sistema e as versões, nada da pessoa. */
export interface SupportDevice {
  platform: 'android' | 'ios';
  osVersion: string | null;
  appVersion: string | null;
  updateId: string | null;
}

/** Corpo de `POST /me/support`: o aparelho só no `problem`. */
export interface SupportMessageBody {
  kind: SupportKind;
  text: string;
  device?: SupportDevice | null;
}

/** Resposta de `POST /me/support`. */
export interface SupportMessageResult {
  id: string;
  status: 'sent';
}

export interface SendSupportMessageVariables extends SupportMessageBody {
  idempotencyKey: string;
}
