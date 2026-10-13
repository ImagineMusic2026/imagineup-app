import { describe, expect, it } from 'vitest';

import { moderationPanelError } from './errors';

// Os motivos que o painel recebe do moderateComment e, desde as exigências
// das lojas (seção 29, 29.6), do resolveProfileReport.

describe('erros da Moderação no painel', () => {
  it.each([
    ['profile-not-reported', 'failed-precondition', 'Esse perfil não está na fila da Moderação.'],
    [
      'stale-report',
      'failed-precondition',
      'A denúncia mudou desde que o card abriu. Abra de novo.',
    ],
    ['not-reported', 'failed-precondition', 'Esse comentário não está na fila da Moderação.'],
    ['comment-not-found', 'not-found', 'Comentário não encontrado.'],
  ] as const)('%s: o código, a mensagem e o motivo em details', (reason, code, message) => {
    const error = moderationPanelError(reason);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.details).toEqual({ reason });
  });
});
