/**
 * Cada interação do app tem um nome de evento, e o evento decide o toque. Assim
 * a sensação é a mesma em toda tela e muda num lugar só.
 */
export type HapticEvent =
  | 'tap'
  | 'selection'
  | 'toggle'
  | 'like'
  | 'commentSent'
  | 'pointsEarned'
  | 'missionComplete'
  | 'levelUp'
  | 'rankUp'
  | 'redeem'
  | 'insufficientPoints'
  | 'locked'
  | 'confirm'
  | 'refresh'
  | 'success'
  | 'warning'
  | 'error';

export type HapticStep =
  | { kind: 'impact'; style: 'light' | 'medium' | 'heavy' | 'soft' | 'rigid' }
  | { kind: 'notification'; type: 'success' | 'warning' | 'error' }
  | { kind: 'selection' }
  | { kind: 'pause'; ms: number };

export const hapticPatterns: Record<HapticEvent, readonly HapticStep[]> = {
  tap: [{ kind: 'impact', style: 'light' }],
  selection: [{ kind: 'selection' }],
  toggle: [{ kind: 'impact', style: 'rigid' }],
  like: [{ kind: 'impact', style: 'light' }],
  commentSent: [{ kind: 'notification', type: 'success' }],
  pointsEarned: [{ kind: 'impact', style: 'soft' }],
  missionComplete: [{ kind: 'notification', type: 'success' }],
  levelUp: [
    { kind: 'notification', type: 'success' },
    { kind: 'pause', ms: 140 },
    { kind: 'impact', style: 'heavy' },
  ],
  rankUp: [{ kind: 'impact', style: 'medium' }],
  redeem: [{ kind: 'notification', type: 'success' }],
  insufficientPoints: [{ kind: 'notification', type: 'warning' }],
  locked: [{ kind: 'notification', type: 'warning' }],
  confirm: [{ kind: 'impact', style: 'medium' }],
  refresh: [{ kind: 'impact', style: 'light' }],
  success: [{ kind: 'notification', type: 'success' }],
  warning: [{ kind: 'notification', type: 'warning' }],
  error: [{ kind: 'notification', type: 'error' }],
};
