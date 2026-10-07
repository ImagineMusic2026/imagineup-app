import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` nas callables da régua, da
 * temporada, das missões e da meta (bloco 7, docs/arquitetura-api.md, 22.8) e,
 * desde o bloco 8, nas da temporada (23.10). Os de acesso (`not-staff`,
 * `no-section`) vêm do `readPanelActor`, e os das conquistas, de
 * achievements/errors.ts.
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
  | 'no-season'
  | 'season-started'
  | 'season-ended'
  | 'season-end-in-past'
  | 'season-overlap'
  | 'season-closing'
  | 'has-next'
  | 'season-not-active'
  | 'season-not-due';

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
  'no-season': ['failed-precondition', 'Não há temporada atual configurada.'],
  'season-started': [
    'failed-precondition',
    'A temporada já começou: ela não sai nem muda de início. Para encerrar antes da hora, use Encerrar temporada.',
  ],
  'season-ended': [
    'failed-precondition',
    'A temporada já terminou: só o nome, o título do 1º lugar e o top do card mudam.',
  ],
  'season-end-in-past': [
    'invalid-argument',
    'O fim da temporada já passou. Para encerrar agora, use Encerrar temporada.',
  ],
  'season-overlap': [
    'failed-precondition',
    'As datas batem com outra temporada: uma começa depois do fim da anterior.',
  ],
  'season-closing': [
    'failed-precondition',
    'A temporada está sendo fechada agora. Tente de novo em alguns minutos.',
  ],
  'has-next': [
    'failed-precondition',
    'Há uma próxima temporada cadastrada. Tire a próxima antes de ficar sem temporada.',
  ],
  'season-not-active': [
    'failed-precondition',
    'Essa temporada não está em andamento. Abra de novo e confira a temporada atual.',
  ],
  'season-not-due': [
    'failed-precondition',
    'A temporada ainda não terminou. Para encerrar antes da hora, use Encerrar temporada.',
  ],
};

/** Erro das callables do jogo: código do Firebase, mensagem em pt-BR e `details: { reason, ... }`. */
export function gamePanelError(
  reason: GamePanelErrorReason,
  details: Record<string, unknown> = {},
): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason, ...details });
}
