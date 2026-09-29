import { Platform, type AccessibilityRole, type AccessibilityState } from 'react-native';

/**
 * - `single`: um escolhido por vez (escopo do ranking 1f, mês da agenda 1m).
 * - `multiple`: cada um liga e desliga sozinho (artistas da 1l).
 */
export type SelectionMode = 'single' | 'multiple';

export interface SelectionAccessibility {
  role: AccessibilityRole;
  state: AccessibilityState;
}

/**
 * Papel e estado de uma peça que se escolhe tocando (chip, card de artista).
 * O iOS não tem papel "tab" nem "checkbox" que o VoiceOver anuncie como
 * tocável: lá ela é botão com "selecionado", como a tab bar. No Android, aba
 * (dentro da `tablist`) na seleção única e caixa de marcar na múltipla.
 */
export function selectionAccessibility(
  mode: SelectionMode,
  selected: boolean,
): SelectionAccessibility {
  if (Platform.OS !== 'android') return { role: 'button', state: { selected } };
  return mode === 'single'
    ? { role: 'tab', state: { selected } }
    : { role: 'checkbox', state: { checked: selected } };
}
