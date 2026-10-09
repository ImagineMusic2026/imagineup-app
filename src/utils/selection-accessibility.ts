import { Platform, type AccessibilityRole, type AccessibilityState } from 'react-native';

/**
 * - `single`: um escolhido por vez, numa fileira de abas (escopo do ranking
 *   1f, mês da agenda 1m);
 * - `multiple`: cada um liga e desliga sozinho (artistas da 1l);
 * - `radio`: um escolhido por vez numa lista de opções que não é de abas (o
 *   gênero da tela "Editar perfil").
 */
export type SelectionMode = 'single' | 'multiple' | 'radio';

export interface SelectionAccessibility {
  role: AccessibilityRole;
  state: AccessibilityState;
}

/**
 * Papel e estado de uma peça que se escolhe tocando (chip, card de artista,
 * opção de uma lista). O iOS não tem papel "tab", "checkbox" nem "radio" que o
 * VoiceOver anuncie como tocável: lá ela é botão com "selecionado", como a tab
 * bar. No Android, aba (dentro da `tablist`) na seleção única, caixa de marcar
 * na múltipla e rádio marcado na lista de opções (a aba fora de uma lista de
 * abas seria anunciada errado).
 */
export function selectionAccessibility(
  mode: SelectionMode,
  selected: boolean,
): SelectionAccessibility {
  if (Platform.OS !== 'android') return { role: 'button', state: { selected } };
  if (mode === 'single') return { role: 'tab', state: { selected } };
  return { role: mode === 'radio' ? 'radio' : 'checkbox', state: { checked: selected } };
}
