import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { colors, spacing } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Rola o conteúdo. Listas longas usam FlashList dentro de um Screen sem scroll. */
  scroll?: boolean;
  /** Margem lateral do design (18 nas telas com tab). `false` para conteúdo de ponta a ponta. */
  padded?: boolean;
  /** Espaço extra embaixo, por exemplo a altura da tab bar, que fica por cima do conteúdo. */
  bottomInset?: number;
  /** Respeita a área segura de cima. Desligue quando a tela começa com imagem sob a barra de status. */
  safeTop?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Casca de toda tela: fundo, área segura e aviso de offline. Os headers do
 * design ficam dentro do conteúdo, então cada tela desenha o seu.
 */
export function Screen({
  children,
  scroll = false,
  padded = true,
  bottomInset = 0,
  safeTop = true,
  contentStyle,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const frame = {
    paddingTop: safeTop ? insets.top : 0,
    paddingLeft: insets.left,
    paddingRight: insets.right,
  };
  const inner = [
    padded && styles.padded,
    { paddingBottom: bottomInset + spacing.xl },
    contentStyle,
  ];

  return (
    <View style={[styles.root, frame]}>
      <OfflineBanner />
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[styles.grow, inner]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, inner]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  grow: {
    flexGrow: 1,
  },
  padded: {
    paddingHorizontal: spacing.gutter,
  },
});
