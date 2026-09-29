import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` para escolher o estado da
 * tela. A mensagem em pt-BR vai junto e pode ser mostrada como está.
 */
export type StaffErrorReason =
  | 'unauthenticated'
  | 'not-admin'
  | 'invalid-request'
  | 'invalid-email'
  | 'invalid-name'
  | 'invalid-role'
  | 'invalid-sections'
  | 'weak-password'
  | 'invalid-password'
  | 'already-staff'
  | 'member-disabled'
  | 'invite-not-found'
  | 'not-pending'
  | 'invalid'
  | 'accepted'
  | 'canceled'
  | 'expired'
  | 'account-exists'
  | 'email-mismatch'
  | 'conflict'
  | 'self'
  | 'last-admin'
  | 'not-member'
  | 'pending-member'
  | 'admin-exists'
  | 'invite-pending';

const ERRORS: Record<StaffErrorReason, [FunctionsErrorCode, string]> = {
  unauthenticated: ['unauthenticated', 'Entre na sua conta para continuar.'],
  'not-admin': ['permission-denied', 'Só um admin ativo da equipe pode fazer isso.'],
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'invalid-email': ['invalid-argument', 'Informe um e-mail válido.'],
  'invalid-name': ['invalid-argument', 'Informe um nome de 1 a 60 caracteres, numa linha só.'],
  'invalid-role': ['invalid-argument', 'Escolha um papel: Admin, Editor ou Leitor.'],
  'invalid-sections': [
    'invalid-argument',
    'Escolha pelo menos uma seção do painel, sem repetir nenhuma.',
  ],
  'weak-password': ['invalid-argument', 'A senha precisa ter pelo menos 8 caracteres.'],
  'invalid-password': ['invalid-argument', 'A senha pode ter no máximo 4096 caracteres.'],
  'already-staff': ['failed-precondition', 'Essa pessoa já faz parte da equipe.'],
  'member-disabled': [
    'failed-precondition',
    'Essa pessoa está desativada. Reative o acesso em Equipe.',
  ],
  'invite-not-found': ['not-found', 'Convite não encontrado.'],
  'not-pending': ['failed-precondition', 'Esse convite já foi aceito ou cancelado.'],
  invalid: ['not-found', 'Convite não encontrado. Confira o link ou peça um novo convite.'],
  accepted: ['failed-precondition', 'Este convite já foi usado. Entre com seu e-mail e senha.'],
  canceled: ['failed-precondition', 'Este convite foi cancelado. Peça um novo a um admin.'],
  expired: ['failed-precondition', 'Este convite venceu. Peça um novo a um admin.'],
  'account-exists': [
    'failed-precondition',
    'Já existe uma conta com este e-mail. Entre com a senha dela para ligar o acesso ao painel.',
  ],
  'email-mismatch': [
    'permission-denied',
    'Este convite é para outro e-mail. Entre com a conta do e-mail convidado.',
  ],
  conflict: [
    'aborted',
    'Outra tentativa de aceitar este convite está em andamento. Tente de novo em instantes.',
  ],
  self: ['failed-precondition', 'Você não pode mudar nem remover o próprio acesso.'],
  'last-admin': ['failed-precondition', 'O painel precisa de pelo menos um admin ativo.'],
  'not-member': ['not-found', 'Essa pessoa não está na equipe.'],
  'pending-member': [
    'failed-precondition',
    'Essa pessoa ainda está aceitando o convite. Tente de novo em instantes.',
  ],
  'admin-exists': ['failed-precondition', 'Já existe um admin ativo. Convide pelo painel.'],
  'invite-pending': [
    'failed-precondition',
    'Já existe um convite pendente para esse e-mail. Reenvie pelo painel ou espere vencer.',
  ],
};

/**
 * Erro das callables da equipe: código do Firebase, mensagem em pt-BR e
 * `details: { reason }`. `code` troca o código padrão do motivo quando a
 * mesma situação pede outro (convidar quem já é da equipe é already-exists).
 */
export function staffError(reason: StaffErrorReason, code?: FunctionsErrorCode): HttpsError {
  const [defaultCode, message] = ERRORS[reason];
  return new HttpsError(code ?? defaultCode, message, { reason });
}

/** Motivo de um erro da equipe, ou undefined se o erro é outro. */
export function staffErrorReason(error: unknown): StaffErrorReason | undefined {
  if (!(error instanceof HttpsError)) return undefined;
  const details = error.details as { reason?: StaffErrorReason } | undefined;
  return details?.reason;
}
