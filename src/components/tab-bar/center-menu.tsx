import type { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, radii, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';

export interface CenterMenuAction {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Cor do ícone: rosa para ação, lima para o que vale pontos. */
  color: string;
  onPress: () => void;
}

export interface CenterMenuProps {
  open: boolean;
  /** De 0 (fechado) a 1 (aberto), animado pela TabBar junto com o giro do "+". */
  progress: SharedValue<number>;
  actions: CenterMenuAction[];
  /** Distância do fundo da tela, para os atalhos nascerem logo acima da barra. */
  bottomOffset: number;
  onClose: () => void;
  onSelect: (action: CenterMenuAction) => void;
}

// Cada atalho começa um pouco depois do anterior, do mais perto do "+" para o
// mais longe, para o menu subir como um leque e não aparecer de uma vez.
const STAGGER = 0.14;
const RISE = 18;

function MenuItem({
  action,
  order,
  count,
  progress,
  onSelect,
}: {
  action: CenterMenuAction;
  order: number;
  count: number;
  progress: SharedValue<number>;
  onSelect: (action: CenterMenuAction) => void;
}) {
  const delay = order * STAGGER;
  const span = 1 - (count - 1) * STAGGER;

  const animatedStyle = useAnimatedStyle(() => {
    const local = interpolate(progress.get(), [delay, delay + span], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: local,
      transform: [{ translateY: (1 - local) * RISE }, { scale: 0.92 + 0.08 * local }],
    };
  });

  return (
    <Animated.View style={animatedStyle}>
      <PressableScale
        onPress={() => onSelect(action)}
        accessibilityLabel={action.label}
        style={styles.item}
      >
        <View style={[styles.iconBadge, { backgroundColor: withAlpha(action.color, 0.14) }]}>
          <Icon icon={action.icon} size={18} color={action.color} strokeWidth={2} />
        </View>
        <Text variant="buttonSmall">{action.label}</Text>
      </PressableScale>
    </Animated.View>
  );
}

/**
 * Menu que sai do "+" da tab bar: escurece a tela e sobe os atalhos em leque.
 * Para o leitor de tela, vira uma área modal enquanto está aberto (o gesto de
 * voltar fecha), e some por completo quando fechado.
 */
export function CenterMenu({
  open,
  progress,
  actions,
  bottomOffset,
  onClose,
  onSelect,
}: CenterMenuProps) {
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={open ? 'box-none' : 'none'}
      accessibilityViewIsModal={open}
      onAccessibilityEscape={onClose}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('tabs.menu.close')}
        />
      </Animated.View>
      <View style={[styles.stack, { bottom: bottomOffset }]} pointerEvents="box-none">
        {actions.map((action, index) => (
          <MenuItem
            key={action.key}
            action={action}
            // O último da lista fica colado no "+" e aparece primeiro.
            order={actions.length - 1 - index}
            count={actions.length}
            progress={progress}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: withAlpha(colors.background, 0.78),
  },
  stack: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.listGap,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: layout.minTouchTarget + 4,
    minWidth: 200,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xl,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
