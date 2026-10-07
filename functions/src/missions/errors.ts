import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` nas callables da régua, da
 * temporada, das missões e da meta (bloco 7, docs/arquitetura-api.md, 22.8).
 * Os de acesso (`not-staff`, `no-section`) vêm do `readPanelActor`, e os das
 * conquistas, de achievements/errors.ts.
 */
export type GamePanelErrorReason =
  | 'invalid-request'
  | 'config-changed'
  | 'level-in-use'
  | 'season-id-locked'
  | 'season-id-used'
  | 'invalid-target'
  | 'target-not-found'
  | 'too-many-missions'
  | 'too-many-active'
  | 'mission-not-found'
  | 'mission-locked'
  | 'invalid-status'
  | 'no-season';

const ERRORS: Record<GamePanelErrorReason, [FunctionsErrorCode, string]> = {
  'invalid-request': ['invalid-argument', 'Pedido inválido.'],
  'config-changed': [
    'failed-precondition',
    'A configuração mudou enquanto você editava. Abra de novo e repita a mudança.',
  ],
  'level-in-use': [
    'failed-precondition',
    'Uma conquista ainda pede um nível que a régua nova não tem. Arquive a conquista antes.',
  ],
  'season-id-locked': [
    'failed-precondition',
    'A temporada já começou: o id não muda. Nome, fim e título continuam editáveis.',
  ],
  'season-id-used': ['already-exists', 'Esse id de temporada já foi usado. Escolha outro.'],
  'invalid-target': ['invalid-argument', 'Esse alvo não vale para esse tipo de missão.'],
  'target-not-found': ['not-found', 'O alvo da missão não existe.'],
  'too-many-missions': [
    'resource-exhausted',
    'O catálogo chegou ao limite de missões. Arquive alguma antes de criar outra.',
  ],
  'too-many-active': [
    'resource-exhausted',
    'Já há missões demais no ar. Arquive alguma antes de publicar outra.',
  ],
  'mission-not-found': ['not-found', 'Missão não encontrada.'],
  'mission-locked': [
    'failed-precondition',
    'A missão já começou: tipo, alvo, meta, período e início não mudam. Arquive e crie outra.',
  ],
  'invalid-status': ['invalid-argument', 'Status inválido: publicar ou arquivar.'],
  'no-season': ['failed-precondition', 'Não há temporada configurada para ter meta.'],
};

/** Erro das callables do jogo: código do Firebase, mensagem em pt-BR e `details: { reason, ... }`. */
export function gamePanelError(
  reason: GamePanelErrorReason,
  details: Record<string, unknown> = {},
): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason, ...details });
}
