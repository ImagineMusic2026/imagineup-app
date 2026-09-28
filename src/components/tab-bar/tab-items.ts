import type { BottomTabBarProps } from 'expo-router/js-tabs';
import type { ReactNode } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';

import { layout } from '@/theme';

export interface TabItem {
  key: string;
  label: string;
  accessibilityLabel: string;
  focused: boolean;
  renderIcon: (color: string) => ReactNode;
  onPress: () => void;
  onLongPress: () => void;
}

/**
 * Único ponto que conhece o navegador de abas: converte as props do navegador
 * em itens que a TabBar desenha. Na SDK 58 o `BottomTabBarProps` perde
 * `navigation` e ganha `emitter` e `navigateToTab`; a migração mexe só aqui.
 */
export function toTabItems({ state, descriptors, navigation }: BottomTabBarProps): TabItem[] {
  return state.routes
    .filter((route) => {
      // `href: null` no Tabs.Screen chega aqui como tabBarItemStyle display none.
      const itemStyle = StyleSheet.flatten(descriptors[route.key]?.options.tabBarItemStyle) as
        ViewStyle | undefined;
      return itemStyle?.display !== 'none';
    })
    .map((route) => {
      const options = descriptors[route.key]?.options;
      const focused = state.routes[state.index]?.key === route.key;
      const label =
        typeof options?.tabBarLabel === 'string'
          ? options.tabBarLabel
          : (options?.title ?? route.name);

      return {
        key: route.key,
        label,
        accessibilityLabel: options?.tabBarAccessibilityLabel ?? label,
        focused,
        renderIcon: (color) =>
          options?.tabBarIcon?.({ focused, color, size: layout.tabBarIconSize }),
        onPress: () => {
          // O evento mantém o "tocar de novo volta ao topo" das pilhas aninhadas.
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        },
        onLongPress: () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        },
      };
    });
}
