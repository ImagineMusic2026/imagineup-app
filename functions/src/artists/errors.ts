import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` nas funções de Artistas e
 * centrais. A mensagem em pt-BR vai junto e pode ser mostrada como está.
 */
export type ArtistErrorReason =
  | 'unauthenticated'
  | 'not-staff'
  | 'no-section'
  | 'not-admin'
  | 'invalid-request'
  | 'invalid-handle'
  | 'handle-taken'
  | 'handle-reserved'
  | 'invalid-name'
  | 'invalid-short-name'
  | 'invalid-genre'
  | 'invalid-city'
  | 'invalid-bio'
  | 'invalid-email'
  | 'invalid-phone'
  | 'invalid-manager'
  | 'artist-not-found'
  | 'invalid-photo'
  | 'photo-not-found'
  | 'published-needs-photo'
  | 'published-needs-image-rights'
  | 'missing-photo'
  | 'missing-image-rights'
  | 'unknown-artist'
  | 'incomplete-list'
  | 'was-published';

const ERRORS: Record<ArtistErrorReason, [FunctionsErrorCode, string]> = {
  unauthenticated: ['unauthenticated', 'Entre na sua conta para continuar.'],
  'not-staff': ['permission-denied', 'Só a equipe ativa do painel pode fazer isso.'],
  'no-section': [
    'permission-denied',
    'Seu acesso ao painel não permite fazer isso em Artistas e centrais.',
  ],
  'not-admin': ['permission-denied', 'Só um admin ativo da equipe pode apagar uma central.'],
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'invalid-handle': [
    'invalid-argument',
    'O @ da central precisa ter de 3 a 30 letras minúsculas, números ou _.',
  ],
  'handle-taken': ['already-exists', 'Esse @ já está em uso no app. Escolha outro.'],
  'handle-reserved': ['already-exists', 'Esse @ é reservado da Imagine. Escolha outro.'],
  'invalid-name': [
    'invalid-argument',
    'Informe o nome artístico, de 1 a 60 caracteres, numa linha só.',
  ],
  'invalid-short-name': [
    'invalid-argument',
    'O nome curto pode ter até 20 caracteres, numa linha só.',
  ],
  'invalid-genre': ['invalid-argument', 'Escolha um gênero da lista.'],
  'invalid-city': ['invalid-argument', 'A cidade pode ter até 60 caracteres, numa linha só.'],
  'invalid-bio': [
    'invalid-argument',
    'A bio pode ter até 500 caracteres, sem caracteres invisíveis.',
  ],
  'invalid-email': ['invalid-argument', 'Informe um e-mail de contato válido.'],
  'invalid-phone': [
    'invalid-argument',
    'Informe o celular com DDD, de 10 a 15 dígitos, com + opcional no começo.',
  ],
  'invalid-manager': ['invalid-argument', 'O gestor responsável precisa ser da equipe ativa.'],
  'artist-not-found': ['not-found', 'Central não encontrada.'],
  'invalid-photo': ['invalid-argument', 'Envie a foto de novo: o arquivo não é desta central.'],
  'photo-not-found': ['not-found', 'A foto não chegou ao armazenamento. Envie de novo.'],
  'published-needs-photo': [
    'failed-precondition',
    'Uma central no ar precisa de foto. Tire do ar antes de remover a foto.',
  ],
  'published-needs-image-rights': [
    'failed-precondition',
    'Uma central no ar precisa da autorização de imagem. Tire do ar antes de desmarcar.',
  ],
  'missing-photo': ['failed-precondition', 'Envie a foto do artista antes de publicar.'],
  'missing-image-rights': [
    'failed-precondition',
    'Confirme a autorização de uso de imagem antes de publicar.',
  ],
  'unknown-artist': ['invalid-argument', 'A lista tem uma central que não existe mais.'],
  'incomplete-list': [
    'failed-precondition',
    'A lista de centrais mudou enquanto você ordenava. Confira a ordem e tente de novo.',
  ],
  'was-published': [
    'failed-precondition',
    'Central que já foi publicada não pode ser apagada. Tire do ar em vez de apagar.',
  ],
};

/**
 * Erro das callables de artistas: código do Firebase, mensagem em pt-BR e
 * `details: { reason }`, como as da equipe.
 */
export function artistError(reason: ArtistErrorReason): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason });
}

/** Motivo (`details.reason`) de um HttpsError, ou undefined se o erro é outro. */
export function errorReason(error: unknown): string | undefined {
  if (!(error instanceof HttpsError)) return undefined;
  const details = error.details as { reason?: string } | undefined;
  return details?.reason;
}
