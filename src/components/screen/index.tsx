import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfflineBanner } from '@/components/offline-banner';
import { colors, spacing } from '@/theme';

const isIOS = Platform.OS === 'ios';

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
  /**
   * Camada presa ao y 0 da tela (sob a barra de status), atrás do conteúdo e
   * parada quando ele rola, como o brilho do Perfil e do Ranking (`PageGlow`).
   * Não recebe toque.
   */
  backdrop?: ReactNode;
  /**
   * Onde o aviso de offline flutua, medido do topo da tela. Com ela, ou com
   * `safeTop={false}` (1k, capa da 1d), o aviso sai do fluxo, onde empurraria a
   * foto, e flutua por cima do conteúdo; por padrão, logo abaixo da barra de status.
   * Flutuando, o toque passa por ele até o que está embaixo (abas grudadas,
   * botões da capa); mesmo assim, ponha-o onde não esconda esses controles.
   */
  bannerTop?: number;
  /**
   * Sem fundo próprio, para aparecer o que o navegador desenha atrás da pilha
   * (a foto da 1k, que fica parada enquanto as telas de conta trocam).
   */
  transparent?: boolean;
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
  backdrop,
  bannerTop,
  transparent = false,
  contentStyle,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const floatingBanner = !safeTop || bannerTop !== undefined;
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
    <View style={[styles.root, transparent && styles.transparent, frame]}>
      {backdrop ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {backdrop}
        </View>
      ) : null}
      {floatingBanner ? null : <OfflineBanner />}
      {scroll ? (
        // Android: com edge-to-edge (obrigatório) a janela não encolhe com o
        // teclado; o 'padding' encolhe a rolagem, que leva sozinha o campo
        // focado para a vista. iOS: a própria rolagem ganha o espaço do teclado
        // e rola até o campo focado, o que só acontece com
        // `automaticallyAdjustKeyboardInsets` (os dois juntos somariam o espaço).
        <KeyboardAvoidingView style={styles.fill} behavior="padding" enabled={!isIOS}>
          <ScrollView
            style={styles.fill}
            contentContainerStyle={[styles.grow, inner]}
            automaticallyAdjustKeyboardInsets={isIOS}
            keyboardShouldPersistTaps="handled"
            // No iOS, arrastar leva o teclado junto com o dedo, e rolar até um
            // campo escondido não fecha o teclado de cara.
            keyboardDismissMode={isIOS ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.fill, inner]}>{children}</View>
      )}
      {floatingBanner ? (
        // Depois do conteúdo, para ficar por cima dele. O aviso não tem ação: o
        // toque atravessa, e o leitor de tela continua lendo o texto.
        <View
          pointerEvents="none"
          style={[
            styles.floatingBanner,
            { top: bannerTop ?? insets.top, left: insets.left, right: insets.right },
          ]}
        >
          <OfflineBanner />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  transparent: {
    backgroundColor: colors.transparent,
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
  floatingBanner: {
    position: 'absolute',
  },
});
