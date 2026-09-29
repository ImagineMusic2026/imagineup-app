import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { t } from '@/i18n';
import { borderWidths, colors, layout } from '@/theme';

export interface BackButtonProps {
  /** Padrão: volta na pilha ou, sem para onde voltar (link aberto a frio), vai ao início. */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

const ICON_SIZE = 20;
const ICON_STROKE = 2.2;

/** Folga entre o círculo de 36 e a borda de cima e de baixo do alvo de 44. */
export const BACK_BUTTON_SLACK = (layout.minTouchTarget - layout.headerButtonSize) / 2;

function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Círculo de vidro de voltar, do `BackHeader`, do `LargeTitleHeader` e dos
 * formulários de conta, que não têm título. O alvo de 44 é o próprio pressável:
 * no Fabric do iOS o hitSlop fora do pai não recebe toque. O círculo fica colado
 * no começo do alvo, para alinhar com a margem da tela; a sobra vai para a direita.
 */
export function BackButton({ onPress = goBack, style }: BackButtonProps) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={t('common.back')}
      style={[styles.target, style]}
    >
      <View style={styles.circle}>
        <Icon icon={ChevronLeft} size={ICON_SIZE} strokeWidth={ICON_STROKE} />
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
