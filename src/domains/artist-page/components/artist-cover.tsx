import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

import { BrandBars } from '@/components/brand-bars';
import { Glass } from '@/components/glass';
import { Logo } from '@/components/logo';
import { RemoteImage } from '@/components/remote-image';
import { Scrim } from '@/components/scrim';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Stripes } from '@/components/stripes';
import { Text } from '@/components/text';
import { VerifiedBadge } from '@/components/verified-badge';
import type { ArtistDetails } from '@/domains/artists';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { colors, motion, spacing, textShadows, typography } from '@/theme';

import { COVER_PARALLAX } from '../consts';
import { artistHeadingLabel, splitCoverName } from '../describe';

// Logo da pílula "gestão oficial": 9 de altura, um pouco apagado (.9).
const PILL_LOGO_HEIGHT = 9;
const PILL_LOGO_OPACITY = 0.9;
// O selo e as barras encostam no pé da última linha do nome.
const BADGE_BOTTOM = 7;
const BARS_BOTTOM = spacing.tileGap;
// Esqueleto do nome enquanto a central chega.
const NAME_SKELETON_WIDTH = 180;
// O nome entra em fade no lugar do esqueleto, e as barras da marca acendem
// uma depois da outra logo atrás dele.
const IDENTITY_ENTERING = FadeIn.duration(motion.duration.base);
const BARS_LIGHT_UP_DELAY = motion.duration.fast;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

export interface ArtistCoverProps {
  /** Escolhe o placeholder de marca da capa antes (e sem) foto. */
  artistId: string;
  /** `undefined` enquanto a central chega: a capa aparece, o nome fica em esqueleto. */
  artist: ArtistDetails | undefined;
  /** A área segura mais 234: a capa cresce além disso só quando o nome não cabe (fonte grande). */
  height: number;
  /** O nome nunca sobe para baixo do header compacto: a capa cresce antes disso. */
  topClearance: number;
  /** Rolagem da página, para o parallax da foto. */
  scrollY: SharedValue<number>;
  /** A altura de verdade, quando a capa cresce com o nome. */
  onHeightChange?: (height: number) => void;
}

/** "gestão oficial": logo da Imagine e o texto, no vidro escuro. Decorativa: o nome já diz. */
function ManagedPill() {
  return (
    <Glass tone="darkStrong" strength="badge" style={styles.pill} {...hiddenFromReader}>
      <Logo height={PILL_LOGO_HEIGHT} opacity={PILL_LOGO_OPACITY} />
      <Text variant="micro" color={colors.textSecondary}>
        {t('artist.managed')}
      </Text>
    </Glass>
  );
}

/**
 * Capa da página do artista (1d): a foto (placeholder de marca pelo id sem
 * ela), o véu escuro, as listras e, no pé, a pílula "gestão oficial" e o nome
 * com o selo e as barras da marca. A foto rola na metade da velocidade da
 * página e, puxada para baixo no iOS, estica presa no topo; com reduzir
 * movimento, fica parada. Os botões ficam no header compacto, por cima; com
 * a fonte grande, a capa cresce para o nome não subir para baixo deles.
 *
 * Para o leitor, a capa é um título só: "Netto Brito, artista verificado,
 * gestão oficial Imagine".
 */
export function ArtistCover({
  artistId,
  artist,
  height,
  topClearance,
  scrollY,
  onHeightChange,
}: ArtistCoverProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [measured, setMeasured] = useState(height);
  const size = Math.max(height, measured);
  // A capa vai de ponta a ponta: o placeholder da foto sai junto com a tela.
  const frame = useSafeAreaFrame();

  const photoStyle = useAnimatedStyle(() => {
    if (reducedMotion) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    const y = scrollY.get();
    if (y < 0) {
      // Esticando: cresce pelo centro e sobe metade, então o topo fica preso no da tela.
      return { transform: [{ translateY: y / 2 }, { scale: 1 - y / size }] };
    }
    return { transform: [{ translateY: Math.min(y, size) * COVER_PARALLAX }, { scale: 1 }] };
  });

  const handleLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.height;
    setMeasured(next);
    onHeightChange?.(next);
  };

  return (
    <View
      onLayout={handleLayout}
      style={[styles.cover, { minHeight: height, paddingTop: topClearance }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, photoStyle]} {...hiddenFromReader}>
        <RemoteImage
          uri={artist?.coverUrl}
          fallback={{ kind: 'brand', seed: artistId, stripes: null }}
          fallbackSize={{ width: frame.width, height: size }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
      <Scrim preset="cover" />
      <Stripes preset="photo" />
      <View style={styles.identity}>
        {artist ? (
          <Animated.View entering={IDENTITY_ENTERING}>
            {artist.managedByImagine ? <ManagedPill /> : null}
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel={artistHeadingLabel(artist)}
              testID="artist-heading"
              style={styles.nameRow}
            >
              <Text variant="displayLg" style={[styles.name, textShadows.hero]}>
                {splitCoverName(artist.name)}
              </Text>
              {artist.verified ? (
                <View style={styles.badge}>
                  <VerifiedBadge size={20} />
                </View>
              ) : null}
              <BrandBars
                size="title"
                lightUp
                lightUpDelay={BARS_LIGHT_UP_DELAY}
                style={styles.bars}
              />
            </View>
          </Animated.View>
        ) : (
          <SkeletonGroup accessibilityLabel={t('artist.loading')} style={styles.nameSkeleton}>
            <Skeleton
              tone="line"
              width={NAME_SKELETON_WIDTH}
              height={typography.displayLg.fontSize}
              radius={spacing.xs}
            />
          </SkeletonGroup>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A foto que sobe no parallax e a que estica não passam da capa. O nome fica
  // no pé; com a fonte grande, a capa cresce para cima dele em vez de cortá-lo.
  cover: {
    justifyContent: 'flex-end',
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  identity: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.cardPadding,
  },
  pill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: spacing.metaGap,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.chipGap,
    paddingRight: spacing.listGap,
    marginBottom: spacing.listGap,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.tileGap,
  },
  name: {
    flexShrink: 1,
  },
  badge: {
    marginBottom: BADGE_BOTTOM,
  },
  bars: {
    marginBottom: BARS_BOTTOM,
  },
  nameSkeleton: {
    paddingBottom: spacing.xs,
  },
});
