import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/https';

/**
 * Motivos que o painel recebe em `details.reason` nas callables das
 * conquistas (bloco 7, docs/arquitetura-api.md, 22.8), além dos comuns da
 * configuração (`invalid-request`, `config-changed`, de missions/errors.ts) e
 * dos de acesso do `readPanelActor`.
 */
export type AchievementPanelErrorReason =
  | 'too-many-achievements'
  | 'achievement-not-found'
  | 'achievement-locked'
  | 'invalid-status'
  | 'rule-not-available';

const ERRORS: Record<AchievementPanelErrorReason, [FunctionsErrorCode, string]> = {
  'too-many-achievements': ['resource-exhausted', 'O catálogo chegou ao limite de conquistas.'],
  'achievement-not-found': ['not-found', 'Conquista não encontrada.'],
  'achievement-locked': [
    'failed-precondition',
    'A conquista já foi publicada: a regra não muda. Título, ícone e cor continuam editáveis.',
  ],
  'invalid-status': ['invalid-argument', 'Status inválido: publicar ou arquivar.'],
  'rule-not-available': [
    'failed-precondition',
    'Essa regra ainda não vale: a conquista por posição no ranking chega com o ranking.',
  ],
};

export function achievementPanelError(
  reason: AchievementPanelErrorReason,
  details: Record<string, unknown> = {},
): HttpsError {
  const [code, message] = ERRORS[reason];
  return new HttpsError(code, message, { reason, ...details });
}
