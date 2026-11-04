import { useMutation } from '@tanstack/react-query';

import { ApiError } from '@/services/api/errors';
import { createIdempotencyKey } from '@/utils/id';

import { sendSupportMessage } from './api';
import type {
  SendSupportMessageVariables,
  SupportDevice,
  SupportKind,
  SupportMessageResult,
} from './types';

export const supportMutationKeys = {
  send: ['support', 'send'] as const,
};

/** A falha que pode ter gravado (rede, prazo, 5xx): a nova tentativa usa a mesma chave. */
function isUncertain(error: unknown): boolean {
  return !(error instanceof ApiError) || error.isRetryable;
}

/**
 * Manda a mensagem do Suporte (seção 38). Sem fila offline nem nova tentativa
 * sozinha: a tela só deixa enviar com rede e mostra a recusa. A nova tentativa
 * do mesmo texto depois de uma falha incerta repete a chave, e o servidor
 * devolve a mensagem que já gravou, sem outra. O suspenso manda (a rota tem
 * `allowSuspended`), então o alerta global da suspensão fica desligado.
 */
export function useSendSupportMessageMutation() {
  const mutation = useMutation<SupportMessageResult, Error, SendSupportMessageVariables>({
    mutationKey: supportMutationKeys.send,
    mutationFn: (variables) => sendSupportMessage(variables),
    networkMode: 'always',
    retry: false,
    meta: { suspendedAlert: false },
  });

  const send = (kind: SupportKind, text: string, device: SupportDevice | null): void => {
    if (mutation.isPending) return;
    const failed = mutation.isError ? mutation.variables : undefined;
    const idempotencyKey =
      failed && failed.kind === kind && failed.text === text && isUncertain(mutation.error)
        ? failed.idempotencyKey
        : `support-${kind}-${createIdempotencyKey()}`;
    mutation.mutate(
      kind === 'problem' ? { kind, text, device, idempotencyKey } : { kind, text, idempotencyKey },
    );
  };

  return {
    send,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    error: mutation.error,
    reset: mutation.reset,
  };
}
