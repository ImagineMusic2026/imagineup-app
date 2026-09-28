import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { assertNever } from '@/utils/assert-never';

import { hapticPatterns, type HapticEvent, type HapticStep } from './patterns';

const impactStyles = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
  soft: Haptics.ImpactFeedbackStyle.Soft,
  rigid: Haptics.ImpactFeedbackStyle.Rigid,
} as const;

const notificationTypes = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
} as const;

// O mesmo evento repetido em sequência (rolar chips, contador subindo) vira
// um toque só dentro desta janela.
const THROTTLE_MS = 40;

let enabled = true;
let lastEvent: HapticEvent | null = null;
let lastAt = 0;

async function playStep(step: HapticStep): Promise<void> {
  switch (step.kind) {
    case 'impact':
      return Haptics.impactAsync(impactStyles[step.style]);
    case 'notification':
      return Haptics.notificationAsync(notificationTypes[step.type]);
    case 'selection':
      return Haptics.selectionAsync();
    case 'pause':
      return new Promise((resolve) => setTimeout(resolve, step.ms));
    default:
      return assertNever(step);
  }
}

async function playSteps(steps: readonly HapticStep[]): Promise<void> {
  for (const step of steps) {
    await playStep(step);
  }
}

/**
 * Dispara o toque do evento. Nunca lança: falha de haptics não pode quebrar
 * uma ação do usuário.
 */
function trigger(event: HapticEvent): void {
  if (!enabled || Platform.OS === 'web') return;
  const now = Date.now();
  if (event === lastEvent && now - lastAt < THROTTLE_MS) return;
  lastEvent = event;
  lastAt = now;
  playSteps(hapticPatterns[event]).catch(() => undefined);
}

/** Ligado pela preferência do usuário (store de preferências). */
function setEnabled(value: boolean): void {
  enabled = value;
}

export const haptics = { trigger, setEnabled };

export type { HapticEvent } from './patterns';
