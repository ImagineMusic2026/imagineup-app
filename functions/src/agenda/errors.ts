import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` nas callables dos shows da
 * agenda (bloco 6, docs/arquitetura-api.md, 21.9). A mensagem em pt-BR vai
 * junto e pode ser mostrada como está. Os de acesso vêm do `readPanelActor`.
 */
export type EventPanelErrorReason =
  | 'invalid-request'
  | 'invalid-title'
  | 'invalid-artists'
  | 'artist-not-found'
  | 'invalid-city'
  | 'invalid-state'
  | 'invalid-venue'
  | 'invalid-starts-at'
  | 'invalid-time-zone'
  | 'event-in-past'
  | 'event-not-found'
  | 'invalid-photo'
  | 'photo-not-found'
  | 'event-has-posts'
  | 'invalid-status'
  | 'was-published';

const ERRORS: Record<EventPanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'invalid-title': [
    'invalid-argument',
    'Informe o nome do show, de 1 a 80 caracteres, numa linha só.',
  ],
  'invalid-artists': ['invalid-argument', 'Escolha de 1 a 6 centrais, sem repetir.'],
  'artist-not-found': ['not-found', 'Uma das centrais do show não existe.'],
  'invalid-city': ['invalid-argument', 'Informe a cidade, de 1 a 60 caracteres, numa linha só.'],
  'invalid-state': ['invalid-argument', 'Escolha a UF da lista.'],
  'invalid-venue': ['invalid-argument', 'O local pode ter até 80 caracteres, numa linha só.'],
  'invalid-starts-at': [
    'invalid-argument',
    'Informe uma data e hora que existam, até 2 anos à frente.',
  ],
  'invalid-time-zone': ['invalid-argument', 'Escolha o fuso da lista.'],
  'event-in-past': ['invalid-argument', 'A data do show já passou.'],
  'event-not-found': ['not-found', 'Show não encontrado.'],
  'invalid-photo': ['invalid-argument', 'Envie a foto de novo: o arquivo não é deste show.'],
  'photo-not-found': ['not-found', 'A foto não chegou ao armazenamento. Envie de novo.'],
  'event-has-posts': [
    'failed-precondition',
    'Há posts de show apontando para este show. Troque o show desses posts antes.',
  ],
  'invalid-status': ['invalid-argument', 'Status inválido.'],
  'was-published': [
    'failed-precondition',
    'Esse show já esteve no ar. Tire do ar em vez de apagar.',
  ],
};

/** Erro das callables de shows: código do Firebase, mensagem em pt-BR e `details: { reason }`. */
export function eventPanelError(
  reason: EventPanelErrorReason,
  details: Record<string, unknown> = {},
): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason, ...details });
}
