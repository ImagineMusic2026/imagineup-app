import { router } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { t } from '@/i18n';
import { borderWidths, colors, layout, opacities } from '@/theme';

/**
 * - `back`: seta, no começo da linha (headers e formulários de conta);
 * - `close`: "×", para fechar uma sheet (no fim da linha) ou a tela "Editar
 *   perfil" (no começo, com `align="start"`).
 */
export type BackButtonVariant = 'back' | 'close';

/** A ponta do alvo de 44 em que o círculo encosta: a que fica junto da margem da tela. */
export type BackButtonAlign = 'start' | 'end';

export interface BackButtonProps {
  variant?: BackButtonVariant;
  /** Padrão: volta na pilha ou, sem para onde voltar (link aberto a frio), vai ao início. */
  onPress?: () => void;
  /** Enquanto uma ação não pode ser deixada no meio (a conta sendo criada). */
  disabled?: boolean;
  /** Padrão: `start` na seta e `end` no "×" das sheets. */
  align?: BackButtonAlign;
  style?: StyleProp<ViewStyle>;
}

const ICON_SIZE = 20;
const ICON_STROKE = 2.2;

const ICONS = { back: ChevronLeft, close: X } as const;
const LABELS = { back: 'common.back', close: 'common.close' } as const;

/** Folga entre o círculo de 36 e a borda de cima e de baixo do alvo de 44. */
export const BACK_BUTTON_SLACK = (layout.minTouchTarget - layout.headerButtonSize) / 2;

/**
 * Volta na pilha ou, sem para onde voltar (link aberto a frio, a tela é a
 * única da pilha raiz), vai ao início. Toda saída da tela "Editar perfil" (o
 * X, o "Descartar" e o sucesso do ✓) passa por aqui: um `router.back()` sem
 * tela embaixo deixaria o fã nela.
 */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Círculo de vidro de voltar, do `BackHeader`, do `LargeTitleHeader` e dos
 * formulários de conta, que não têm título; no `close`, o de fechar a sheet. O
 * alvo de 44 é o próprio pressável: no Fabric do iOS o hitSlop fora do pai não
 * recebe toque. O círculo fica colado na ponta do alvo que encosta na margem da
 * tela (por padrão, o começo no voltar e o fim no fechar), e a sobra vai para
 * dentro.
 */
export function BackButton({
  variant = 'back',
  onPress = goBack,
  disabled = false,
  align = variant === 'close' ? 'end' : 'start',
  style,
}: BackButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={t(LABELS[variant])}
      style={[
        styles.target,
        align === 'end' && styles.trailing,
        disabled && styles.inactive,
        style,
      ]}
    >
      <View style={styles.circle}>
        <Icon icon={ICONS[variant]} size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  target: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  trailing: {
    alignItems: 'flex-end',
  },
  inactive: {
    opacity: opacities.disabled,
  },
  circle: {
    width: layout.headerButtonSize,
    height: layout.headerButtonSize,
    borderRadius: layout.headerButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: borderWidths.default,
    borderColor: colors.borderGlass,
  },
});
