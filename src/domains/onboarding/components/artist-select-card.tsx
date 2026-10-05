import { Check } from 'lucide-react-native';
import { useEffect, useRef, type Ref } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { Scrim } from '@/components/scrim';
import { Text } from '@/components/text';
import type { Artist } from '@/domains/artists';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { borderWidths, colors, gradients, layout, motion, radii, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';
import { selectionAccessibility } from '@/utils/selection-accessibility';

import { useArtistSelection, useIsArtistSelected } from '../hooks/use-artist-selection';
import { artistCardLabel, fansText } from '../selection';

export interface ArtistSelectCardProps {
  artist: Artist;
  selected: boolean;
  onToggle: (artistId: string) => void;
  /** Enquanto a escolha é salva, os cards travam. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Para levar o foco do leitor de tela ao card (a lista que voltou depois de um erro). */
  ref?: Ref<View>;
}

// A marca de escolha fica a 9 da borda de dentro, que chega a 2 no card escolhido.
const MARK_INSET = spacing.tileGap + borderWidths.strong;
// Contorno da marca desligada (1,5 no protótipo), fundo de tinta a .35 sobre a foto.
const MARK_OUTLINE = 1.5;
const MARK_SHADE = withAlpha(colors.background, 0.35);
// O check do protótipo (M6 12.5l4 4L18 8, numa caixa de 13) ocupa 12 das 24
// unidades; o do lucide ocupa 16. Em 10, o desenho fica com os ~8 pt do
// protótipo, e o traço de 3,9 mantém a linha de ~1,6 pt (3 unidades em 13).
const CHECK_SIZE = 10;
const CHECK_STROKE = 3.9;
// A marca enche de .6 a 1 e o check entra logo depois dela.
const MARK_START_SCALE = 0.6;
const CHECK_DELAY_MS = 80;

// O nome quebra em até 2 linhas com a fonte grande (a 200%, "Juninho Moraes"
// não cabe numa). Acima do texto, o véu do próprio bloco escurece a foto que o
// `artistTile` ainda deixa ver; com a fonte padrão, ele cai na faixa já escura.
const NAME_LINES = 2;
const COPY_FADE = spacing.xl;
const COPY_VEIL = gradients.scrims.artistTileCopy.colors[1];

/**
 * Borda e marca que andam juntas com a escolha: a borda rosa entra em fade
 * sobre a neutra (250 ms), a marca enche com mola e o check entra depois dela.
 * Com reduzir movimento, troca na hora. Nasce no estado atual, sem animar.
 *
 * Na sheet, a FlashList reaproveita o card de um artista para outro: quando o
 * artista muda, a marca e a borda vão direto para o estado dele, sem tocar a
 * animação de marcar ou desmarcar num card que ninguém tocou.
 */
function useSelectionMotion(artistId: string, selected: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const border = useSharedValue(selected ? 1 : 0);
  const mark = useSharedValue(selected ? 1 : 0);
  const check = useSharedValue(selected ? 1 : 0);
  const shownArtist = useRef(artistId);

  useEffect(() => {
    const target = selected ? 1 : 0;
    const recycled = shownArtist.current !== artistId;
    shownArtist.current = artistId;
    if (reducedMotion || recycled) {
      border.set(target);
      mark.set(target);
      check.set(target);
      return;
    }
    border.set(withTiming(target, { duration: motion.duration.base, easing: motion.easing.out }));
    mark.set(withSpring(target, motion.spring.gentle));
    const checkTiming = { duration: motion.duration.fast, easing: motion.easing.out };
    check.set(
      selected ? withDelay(CHECK_DELAY_MS, withTiming(1, checkTiming)) : withTiming(0, checkTiming),
    );
  }, [artistId, selected, reducedMotion, border, mark, check]);

  const borderStyle = useAnimatedStyle(() => ({ opacity: border.get() }));
  const markStyle = useAnimatedStyle(() => {
    const progress = mark.get();
    return {
      opacity: Math.min(1, Math.max(0, progress)),
      transform: [{ scale: MARK_START_SCALE + (1 - MARK_START_SCALE) * progress }],
    };
  });
  const checkStyle = useAnimatedStyle(() => ({ opacity: check.get() }));

  return { borderStyle, markStyle, checkStyle };
}

/**
 * Card de artista da escolha (1l) e da sheet de todos os artistas. O card
 * inteiro é um pressável só, que liga e desliga a escolha: caixa de marcar no
 * Android, botão com "selecionado" no iOS. Foto, véu, marca e textos ficam
 * dentro dele, sem papel próprio. A altura é fixa: a borda de 2 do escolhido é
 * uma camada por cima, e nada pula no toque.
 */
export function ArtistSelectCard({
  artist,
  selected,
  onToggle,
  disabled = false,
  style,
  ref,
}: ArtistSelectCardProps) {
  const { role, state } = selectionAccessibility('multiple', selected);
  const { borderStyle, markStyle, checkStyle } = useSelectionMotion(artist.id, selected);

  return (
    <PressableScale
      ref={ref}
      onPress={() => onToggle(artist.id)}
      haptic="selection"
      disabled={disabled}
      accessibilityRole={role}
      accessibilityState={state}
      accessibilityLabel={artistCardLabel(artist)}
      style={[styles.card, style]}
    >
      <RemoteImage
        uri={artist.photoURL}
        fallback={{ kind: 'brand', seed: artist.id }}
        contentPosition="top"
        style={StyleSheet.absoluteFill}
      />
      <Scrim preset="artistTile" />

      <View style={styles.copy}>
        <View pointerEvents="none" style={styles.copyVeil} />
        <Scrim preset="artistTileCopy" style={styles.copyFade} />
        <Text variant="buttonSmall" numberOfLines={NAME_LINES}>
          {artist.name}
        </Text>
        <Text variant="micro" color={colors.textSubtle} numberOfLines={1} style={styles.fans}>
          {fansText(artist.fanCount)}
        </Text>
      </View>

      <View pointerEvents="none" style={styles.mark}>
        <Animated.View style={[styles.markFill, markStyle]}>
          <Animated.View style={checkStyle}>
            <Icon icon={Check} size={CHECK_SIZE} strokeWidth={CHECK_STROKE} color={colors.text} />
          </Animated.View>
        </Animated.View>
      </View>

      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.restBorder]} />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.selectedBorder, borderStyle]}
      />
    </PressableScale>
  );
}

export interface SelectableArtistCardProps {
  artist: Artist;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  ref?: Ref<View>;
}

/**
 * O card ligado à escolha compartilhada entre a 1l e a sheet de todos os
 * artistas: cada card só renderiza de novo quando a escolha dele muda.
 */
export function SelectableArtistCard({ artist, disabled, style, ref }: SelectableArtistCardProps) {
  const selected = useIsArtistSelected(artist.id);
  const toggle = useArtistSelection((state) => state.toggle);
  return (
    <ArtistSelectCard
      ref={ref}
      artist={artist}
      selected={selected}
      onToggle={toggle}
      disabled={disabled}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    height: layout.artistTileHeight,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  copy: {
    position: 'absolute',
    left: spacing.gridGap,
    right: spacing.gridGap,
    bottom: spacing.listGap,
  },
  // Do topo do texto até o pé do card, de borda a borda.
  copyVeil: {
    position: 'absolute',
    top: 0,
    left: -spacing.gridGap,
    right: -spacing.gridGap,
    bottom: -spacing.listGap,
    backgroundColor: COPY_VEIL,
  },
  // A faixa logo acima do texto, do transparente ao véu.
  copyFade: {
    top: -COPY_FADE,
    bottom: '100%',
    left: -spacing.gridGap,
    right: -spacing.gridGap,
  },
  fans: {
    marginTop: spacing.xs,
  },
  mark: {
    position: 'absolute',
    top: MARK_INSET,
    right: MARK_INSET,
    width: layout.selectMark,
    height: layout.selectMark,
    borderRadius: layout.selectMark / 2,
    borderWidth: MARK_OUTLINE,
    borderColor: colors.textSecondary,
    backgroundColor: MARK_SHADE,
  },
  // Cobre o contorno da marca desligada, do mesmo tamanho dela (sai de dentro da borda).
  markFill: {
    position: 'absolute',
    top: -MARK_OUTLINE,
    left: -MARK_OUTLINE,
    width: layout.selectMark,
    height: layout.selectMark,
    borderRadius: layout.selectMark / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restBorder: {
    borderRadius: radii.lg,
    borderWidth: borderWidths.default,
    borderColor: colors.borderStrong,
  },
  selectedBorder: {
    borderRadius: radii.lg,
    borderWidth: borderWidths.strong,
    borderColor: colors.accent,
  },
});
