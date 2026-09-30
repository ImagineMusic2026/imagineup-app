import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import type { ArtistDetails } from '@/domains/artists';
import { t, type TranslationKey } from '@/i18n';
import { colors, spacing, typography } from '@/theme';

import { statLabel, statValue, type ArtistStat } from '../describe';

// Colunas de 114 / 114 / 137 no protótipo: a de pontos é 20% mais larga.
const COLUMNS: readonly { stat: ArtistStat; flex: number; label: TranslationKey }[] = [
  { stat: 'fans', flex: 1, label: 'artist.stats.fans' },
  { stat: 'posts', flex: 1, label: 'artist.stats.posts' },
  { stat: 'points', flex: 1.2, label: 'artist.stats.points' },
];

const VALUE_SKELETON_WIDTH = 64;
const LABEL_SKELETON_WIDTH = 40;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

function valueOf(artist: ArtistDetails, stat: ArtistStat): number {
  switch (stat) {
    case 'fans':
      return artist.fanCount;
    case 'posts':
      return artist.postCount;
    case 'points':
      return artist.centralPoints;
  }
}

export interface ArtistStatsProps {
  /** `undefined` enquanto a central chega. */
  artist: ArtistDetails | undefined;
}

/**
 * Barra de esqueleto do tamanho da letra, no meio da linha do texto que vai
 * chegar: a coluna carregando tem a altura da carregada, e nada abaixo pula.
 */
function SkeletonLine({
  variant,
  width,
  style,
}: {
  variant: 'numberStat' | 'statLabel';
  width: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { fontSize, lineHeight } = typography[variant];
  return (
    <View style={[styles.skeletonLine, { height: lineHeight }, style]}>
      <Skeleton tone="line" width={width} height={fontSize} />
    </View>
  );
}

/**
 * Os três números da central (1d): fãs, posts e os pontos da central, este em
 * lima (lima é só para pontos). Cada coluna é um elemento só para o leitor:
 * "412 mil fãs", "1.284 posts", "8,4 milhões de pontos da central".
 *
 * Com a fonte grande, o número quebra linha em vez de sair cortado ("412" e
 * "mil"), e o rótulo vem em caixa alta no próprio texto: no Android, o
 * `textTransform` mede a linha em minúsculas e corta o fim dela.
 */
export function ArtistStats({ artist }: ArtistStatsProps) {
  if (!artist) {
    // O leitor ouve "Carregando a central" uma vez só, na capa.
    return (
      <View {...hiddenFromReader}>
        <SkeletonGroup style={styles.row}>
          {COLUMNS.map(({ stat, flex }) => (
            <View key={stat} style={{ flex }}>
              <SkeletonLine variant="numberStat" width={VALUE_SKELETON_WIDTH} />
              <SkeletonLine variant="statLabel" width={LABEL_SKELETON_WIDTH} style={styles.label} />
            </View>
          ))}
        </SkeletonGroup>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      {COLUMNS.map(({ stat, flex, label }) => {
        const value = valueOf(artist, stat);
        return (
          <View
            key={stat}
            accessible
            accessibilityLabel={statLabel(stat, value)}
            testID={`artist-stat-${stat}`}
            style={{ flex }}
          >
            <Text variant="numberStat" color={stat === 'points' ? colors.points : colors.text}>
              {statValue(stat, value)}
            </Text>
            <Text
              variant="statLabel"
              color={colors.textMuted}
              style={[styles.label, styles.upperInText]}
            >
              {t(label).toUpperCase()}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingTop: spacing.xxs,
    paddingHorizontal: spacing.gutter,
  },
  label: {
    marginTop: spacing.iconLabelGap,
  },
  // A caixa alta já vem no texto.
  upperInText: {
    textTransform: 'none',
  },
  skeletonLine: {
    justifyContent: 'center',
  },
});
