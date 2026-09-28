import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname } from 'expo-router';
import { BottomTabBarHeightCallbackContext } from 'expo-router/js-tabs';
import type { LucideIcon } from 'lucide-react-native';
import { useContext } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { colors, layout, radii, shadows, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';

import type { TabItem } from './tab-items';

export { toTabItems, type TabItem } from './tab-items';

export interface TabBarCenterAction {
  icon: LucideIcon;
  accessibilityLabel: string;
  onPress: () => void;
}

export interface TabBarProps {
  items: TabItem[];
  /** Botão rosa no meio da barra, que não é aba: dispara uma ação. */
  centerAction?: TabBarCenterAction;
}

// No Ranking (1f) o card "Você" flutua sobre a barra, então ela fica sólida.
const SOLID_ON = ['/ranking'];

// O espaço de cima da barra fica dentro de cada item, para contar como área de
// toque. hitSlop não serve aqui: no Fabric do iOS, toque fora do pai não chega.
const ITEM_PADDING_TOP = 11;

// No iOS o papel "tab" não vira nenhum trait e o VoiceOver não diz que é
// tocável; o React Navigation dentro do expo-router usa "button" pelo mesmo motivo.
const TAB_ROLE = Platform.OS === 'ios' ? 'button' : 'tab';

function TabButton({ item }: { item: TabItem }) {
  const color = item.focused ? colors.accent : colors.textMuted;
  return (
    <PressableScale
      onPress={item.onPress}
      onLongPress={item.onLongPress}
      haptic={item.focused ? null : 'selection'}
      accessibilityRole={TAB_ROLE}
      accessibilityState={{ selected: item.focused }}
      accessibilityLabel={item.accessibilityLabel}
      // Rótulo de 9,5 px: segurar o toque mostra o item ampliado (iOS).
      accessibilityShowsLargeContentViewer
      accessibilityLargeContentTitle={item.label}
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
export function TabBar({ items, centerAction }: TabBarProps) {
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
          <PressableScale
            onPress={centerAction.onPress}
            haptic="tap"
            accessibilityLabel={centerAction.accessibilityLabel}
            style={styles.item}
          >
            <View style={styles.centerButton}>
              <Icon icon={centerAction.icon} size={20} strokeWidth={2.4} color={colors.onAccent} />
            </View>
          </PressableScale>
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
    paddingHorizontal: 10,
    // 1 pt como no protótipo; hairline some sobre o fundo escuro.
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    overflow: 'hidden',
  },
  solid: {
    backgroundColor: colors.background,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.iconLabelGap,
    paddingTop: ITEM_PADDING_TOP,
    minHeight: Math.max(layout.tabBarContentHeight, layout.minTouchTarget),
  },
  centerButton: {
    width: 46,
    height: 34,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    ...shadows.glowAccentSmall,
  },
});
