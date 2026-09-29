import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { usePathname } from 'expo-router';
import { BottomTabBarHeightCallbackContext } from 'expo-router/js-tabs';
import { Plus } from 'lucide-react-native';
import { useContext, useEffect, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { blur, colors, layout, motion, radii, shadows, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';

import { CenterMenu, type CenterMenuAction } from './center-menu';
import type { TabItem } from './tab-items';

export { type CenterMenuAction } from './center-menu';
export { toTabItems, type TabItem } from './tab-items';

export interface TabBarProps {
  items: TabItem[];
  /** Atalhos do "+" no meio da barra. Sem eles, a barra fica só com as abas. */
  centerMenu?: CenterMenuAction[];
}

// No Ranking (1f) o card "Você" flutua sobre a barra, então ela fica sólida.
const SOLID_ON = ['/ranking'];

// O espaço de cima da barra fica dentro de cada item, para contar como área de
// toque. hitSlop não serve aqui: no Fabric do iOS, toque fora do pai não chega.
const ITEM_PADDING_TOP = 11;

// Os atalhos nascem um pouco acima da barra.
const MENU_GAP = spacing.lg;

// No iOS o papel "tab" não vira nenhum trait e o VoiceOver não diz que é
// tocável; o React Navigation dentro do expo-router usa "button" pelo mesmo motivo.
const TAB_ROLE = Platform.OS === 'ios' ? 'button' : 'tab';

function TabButton({ item, onPress }: { item: TabItem; onPress: () => void }) {
  const color = item.focused ? colors.accent : colors.textMuted;
  return (
    <PressableScale
      onPress={onPress}
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
 *
 * O "+" do meio não é aba: gira até virar um "×" e abre os atalhos em leque
 * (`CenterMenu`), no mesmo movimento e com a mesma curva.
 */
export function TabBar({ items, centerMenu }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const solid = SOLID_ON.includes(usePathname());
  const [barHeight, setBarHeight] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(
      withTiming(menuOpen ? 1 : 0, {
        duration: menuOpen ? motion.duration.slow : motion.duration.base,
        easing: motion.easing.out,
      }),
    );
  }, [menuOpen, progress]);

  // Voltar do Android fecha o menu antes de sair da tela.
  useEffect(() => {
    if (!menuOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setMenuOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [menuOpen]);

  const plusStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.get() * 45}deg` }],
  }));

  const handleLayout = (event: LayoutChangeEvent): void => {
    const { height } = event.nativeEvent.layout;
    setBarHeight(height);
    onHeightChange?.(height);
  };

  const closeMenu = (): void => setMenuOpen(false);

  const selectAction = (action: CenterMenuAction): void => {
    setMenuOpen(false);
    action.onPress();
  };

  const pressTab = (item: TabItem): void => {
    setMenuOpen(false);
    item.onPress();
  };

  const hasMenu = !!centerMenu && centerMenu.length > 0;
  const middle = Math.ceil(items.length / 2);
  const left = hasMenu ? items.slice(0, middle) : items;
  const right = hasMenu ? items.slice(middle) : [];

  return (
    <>
      {hasMenu ? (
        <CenterMenu
          open={menuOpen}
          progress={progress}
          actions={centerMenu}
          bottomOffset={barHeight + MENU_GAP}
          onClose={closeMenu}
          onSelect={selectAction}
        />
      ) : null}
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
          <BlurView
            intensity={blur.tabBar}
            tint="dark"
            style={[StyleSheet.absoluteFill, styles.blur]}
          />
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
            <TabButton key={item.key} item={item} onPress={() => pressTab(item)} />
          ))}
          {hasMenu ? (
            <PressableScale
              onPress={() => setMenuOpen((open) => !open)}
              haptic="tap"
              accessibilityLabel={t(menuOpen ? 'tabs.menu.close' : 'tabs.menu.open')}
              accessibilityState={{ expanded: menuOpen }}
              style={styles.item}
            >
              <View style={styles.centerButton}>
                <Animated.View style={plusStyle}>
                  <Icon icon={Plus} size={20} strokeWidth={2.4} color={colors.onAccent} />
                </Animated.View>
              </View>
            </PressableScale>
          ) : null}
          {right.map((item) => (
            <TabButton key={item.key} item={item} onPress={() => pressTab(item)} />
          ))}
        </View>
      </View>
    </>
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
  },
  // Só o desfoque é recortado: a barra toda recortada cortava o brilho do "+".
  blur: {
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
