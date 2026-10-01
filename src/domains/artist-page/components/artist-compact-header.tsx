import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { GlassIconButton } from '@/components/glass-icon-button';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { blur, borderWidths, colors, layout, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';

import { COMPACT_FADE_DISTANCE, COMPACT_NAME_RISE } from '../consts';

// O fundo do header compacto: tinta a .92 com desfoque no iOS. O Android não
// desfoca, e o botão da capa aparecia através dele: lá o fundo é cheio.
const BACKDROP_ALPHA = Platform.OS === 'ios' ? 0.92 : 1;
// O círculo de 38 fica no meio do alvo de 44: o alvo começa 3 antes dele.
const TARGET_SLACK = (layout.minTouchTarget - layout.coverButtonSize) / 2;
// Os círculos ficam a 14 da borda da tela.
const BUTTONS_INSET = spacing.cardPadding - TARGET_SLACK;
// O Android ordena os irmãos para o leitor de tela pela posição (esquerda,
// depois topo, depois o mais alto antes): a lista vinha antes dos botões, e
// voltar e compartilhar eram lidos depois do último post. Começando 1 pt
// acima da tela (fora da vista), o header vem primeiro. O
// `experimental_accessibilityOrder` do RN 0.86 não serve: a flag dele só está
// ligada no canal experimental.
const READING_ORDER_LIFT = 1;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export interface ArtistCompactHeaderProps {
  /** Some enquanto a central chega. */
  name: string | null;
  height: number;
  /** Topo do círculo dos botões. */
  buttonsTop: number;
  /** Onde a capa acaba de sumir embaixo do header: o fundo e o nome chegam inteiros aqui. */
  revealAt: number;
  scrollY: SharedValue<number>;
  /** Sem ela (a central não chegou), o compartilhar fica desligado. */
  onShare: (() => void) | null;
}

/**
 * Header compacto da página do artista (1d), preso no topo por cima da lista.
 * Os botões da capa (voltar e compartilhar) ficam nele o tempo todo; o fundo
 * escuro e o nome aparecem com a rolagem, nos últimos 40 pt antes de a capa
 * sumir embaixo dele, e o nome sobe 6 pt no mesmo trecho (parado com reduzir
 * movimento). As abas grudam logo abaixo dele. Sem menu "mais" até a cliente
 * definir as opções.
 *
 * O nome daqui não é lido: o título da página é o da capa.
 */
export function ArtistCompactHeader({
  name,
  height,
  buttonsTop,
  revealAt,
  scrollY,
  onShare,
}: ArtistCompactHeaderProps) {
  const reducedMotion = usePrefersReducedMotion();
  const start = revealAt - COMPACT_FADE_DISTANCE;

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [start, revealAt], [0, 1], Extrapolation.CLAMP),
  }));

  const nameStyle = useAnimatedStyle(() => {
    const progress = interpolate(scrollY.get(), [start, revealAt], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: progress,
      transform: [{ translateY: reducedMotion ? 0 : (1 - progress) * COMPACT_NAME_RISE }],
    };
  });

  return (
    <View
      pointerEvents="box-none"
      // Uma view de verdade, e não achatada: é ela que o TalkBack compara com a lista.
      collapsable={false}
      style={[styles.header, { height: height + READING_ORDER_LIFT }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={blur.glass} tint="dark" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.tint]} />
      </Animated.View>
      <View
        pointerEvents="box-none"
        style={[styles.buttons, { top: buttonsTop - TARGET_SLACK + READING_ORDER_LIFT }]}
      >
        <GlassIconButton
          icon={ChevronLeft}
          onPress={goBack}
          accessibilityLabel={t('common.back')}
          testID="artist-back"
        />
        {name ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.name, nameStyle]}
            {...hiddenFromReader}
          >
            <Text variant="titleHeader" numberOfLines={1}>
              {name}
            </Text>
          </Animated.View>
        ) : null}
        <GlassIconButton
          glyph="share"
          onPress={() => onShare?.()}
          disabled={!onShare}
          accessibilityLabel={t('artist.share')}
          accessibilityHint={t('artist.shareHint')}
          testID="artist-share"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: -READING_ORDER_LIFT,
    left: 0,
    right: 0,
  },
  backdrop: {
    borderBottomWidth: borderWidths.default,
    borderBottomColor: colors.divider,
  },
  tint: {
    backgroundColor: withAlpha(colors.background, BACKDROP_ALPHA),
  },
  buttons: {
    position: 'absolute',
    left: BUTTONS_INSET,
    right: BUTTONS_INSET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  name: {
    flex: 1,
    alignItems: 'center',
  },
});
