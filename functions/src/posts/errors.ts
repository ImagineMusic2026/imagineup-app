import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` nas callables de posts do
 * mural (bloco 6, docs/arquitetura-api.md, 21.9). A mensagem em pt-BR vai
 * junto e pode ser mostrada como está. Os de acesso (`unauthenticated`,
 * `not-staff`, `no-section`) vêm do `readPanelActor`.
 */
export type PostPanelErrorReason =
  | 'invalid-request'
  | 'artist-not-found'
  | 'invalid-kind'
  | 'invalid-text'
  | 'event-not-found'
  | 'event-artist-mismatch'
  | 'event-not-published'
  | 'post-not-found'
  | 'media-not-allowed'
  | 'invalid-media'
  | 'media-not-found'
  | 'published-needs-media'
  | 'missing-media'
  | 'invalid-status'
  | 'was-published';

const ERRORS: Record<PostPanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'artist-not-found': ['not-found', 'Central não encontrada.'],
  'invalid-kind': ['invalid-argument', 'Escolha o tipo do post: foto, vídeo, texto ou show.'],
  'invalid-text': [
    'invalid-argument',
    'O texto do post pode ter até 2.000 caracteres, sem caracteres invisíveis. Post de texto ou de show precisa de texto.',
  ],
  'event-not-found': ['not-found', 'Show não encontrado.'],
  'event-artist-mismatch': ['failed-precondition', 'O show precisa ter a central do post.'],
  'event-not-published': ['failed-precondition', 'Publique o show antes do post de show.'],
  'post-not-found': ['not-found', 'Post não encontrado.'],
  'media-not-allowed': ['invalid-argument', 'Post de texto ou de show não leva foto nem vídeo.'],
  'invalid-media': ['invalid-argument', 'Envie a mídia de novo: o arquivo não é deste post.'],
  'media-not-found': ['not-found', 'A mídia não chegou ao armazenamento. Envie de novo.'],
  'published-needs-media': [
    'failed-precondition',
    'Um post no ar precisa da mídia. Tire do ar antes de remover.',
  ],
  'missing-media': ['failed-precondition', 'Envie a foto ou a capa do vídeo antes de publicar.'],
  'invalid-status': ['invalid-argument', 'Status inválido.'],
  'was-published': [
    'failed-precondition',
    'Esse post já esteve no ar. Tire do ar em vez de apagar.',
  ],
};

/** Erro das callables de posts: código do Firebase, mensagem em pt-BR e `details: { reason }`. */
export function postPanelError(
  reason: PostPanelErrorReason,
  details: Record<string, unknown> = {},
): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason, ...details });
}
