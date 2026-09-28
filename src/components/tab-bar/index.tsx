import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname } from 'expo-router';
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/js-tabs';
import type { LucideIcon } from 'lucide-react-native';
import { useContext } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { colors, layout, radii, shadows, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';

import { useTabItems, type TabItem } from './use-tab-items';

export interface TabBarCenterAction {
  icon: LucideIcon;
  accessibilityLabel: string;
  onPress: () => void;
}

export interface TabBarProps extends BottomTabBarProps {
  /** Botão rosa no meio da barra, que não é aba: dispara uma ação. */
  centerAction?: TabBarCenterAction;
}

// No Ranking (1f) o card "Você" flutua sobre a barra, então ela fica sólida.
const SOLID_ON = ['/ranking'];

const CENTER_WIDTH = 46;
const CENTER_HEIGHT = 34;
const CENTER_HIT_SLOP = {
  top: (layout.minTouchTarget - CENTER_HEIGHT) / 2,
  bottom: (layout.minTouchTarget - CENTER_HEIGHT) / 2,
  left: 4,
  right: 4,
};

function TabButton({ item }: { item: TabItem }) {
  const color = item.focused ? colors.accent : colors.textMuted;
  return (
    <PressableScale
      onPress={item.onPress}
      onLongPress={item.onLongPress}
      haptic={item.focused ? null : 'selection'}
      accessibilityRole="tab"
      accessibilityState={{ selected: item.focused }}
      accessibilityLabel={item.accessibilityLabel}
      style={styles.item}
    >
      {item.renderIcon(color)}
      <Text variant={item.focused ? 'tabLabelActive' : 'tabLabel'} color={color} numberOfLines={1}>
        {item.label}
      </Text>
    </PressableScale>
  );
}

/**
 * Tab bar do protótipo (1b): ancorada no rodapé, gradiente do fundo com blur no
 * iOS, ícones só em contorno e o ativo em rosa. Fica por cima do conteúdo, então
 * as telas somam `useTabBarInset()` ao espaço de baixo.
 */
export function TabBar({ centerAction, ...props }: TabBarProps) {
  const items = useTabItems(props);
  const insets = useSafeAreaInsets();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const solid = SOLID_ON.includes(usePathname());

  const handleLayout = (event: LayoutChangeEvent): void => {
    onHeightChange?.(event.nativeEvent.layout.height);
  };

  const middle = Math.ceil(items.length / 2);
  const left = centerAction ? items.slice(0, middle) : items;
  const right = centerAction ? items.slice(middle) : [];

  return (
    <View
      onLayout={handleLayout}
      accessibilityRole="tablist"
      style={[
        styles.container,
        solid && styles.solid,
        { paddingBottom: Math.max(insets.bottom, spacing.md) },
      ]}
    >
      {!solid && Platform.OS === 'ios' ? (
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      {!solid ? (
        <LinearGradient
          colors={[withAlpha(colors.background, 0.4), colors.background]}
          locations={[0, 0.45]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={styles.row}>
        {left.map((item) => (
          <TabButton key={item.key} item={item} />
        ))}
        {centerAction ? (
          <View style={styles.item}>
            <PressableScale
              onPress={centerAction.onPress}
              haptic="tap"
              accessibilityLabel={centerAction.accessibilityLabel}
              hitSlop={CENTER_HIT_SLOP}
              style={styles.centerButton}
            >
              <Icon icon={centerAction.icon} size={20} strokeWidth={2.4} color={colors.onAccent} />
            </PressableScale>
          </View>
        ) : null}
        {right.map((item) => (
          <TabButton key={item.key} item={item} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 11,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    overflow: 'hidden',
  },
  solid: {
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.iconLabelGap,
    minHeight: layout.tabBarContentHeight - 11,
  },
  centerButton: {
    width: CENTER_WIDTH,
    height: CENTER_HEIGHT,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    ...shadows.glowAccentSmall,
  },
});
