import { router } from 'expo-router';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { maxFontScaleOf, Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, layout, radii, spacing, typography } from '@/theme';
import { formatNumber, formatPointsSpoken } from '@/utils/number';

import type { FanCentral } from '../types';

// Com a fonte grande, o card alarga até 1,4 vez (a imagem junto) e o nome
// quebra em duas linhas, em vez de virar "Nett…". Com a fonte padrão, fica o
// card do protótipo: 112 de largura e o nome numa linha.
const MAX_WIDTH_GROWTH = 1.4;
const TWO_LINES_FROM = 1.3;

export interface CentralCardMetrics {
  width: number;
  imageWidth: number;
  imageHeight: number;
  nameLines: 1 | 2;
  /**
   * Altura do card com o nome numa linha (128 com a fonte padrão). Serve de
   * piso para o esqueleto e para a faixa do carrossel, que não pode nascer com
   * altura zero; com o nome em duas linhas, o card passa disso e a faixa cresce.
   */
  minHeight: number;
}

/** Medidas do card para a escala de fonte do aparelho. */
export function centralCardMetrics(fontScale: number): CentralCardMetrics {
  const scale = Math.max(fontScale, 1);
  const growth = Math.min(scale, MAX_WIDTH_GROWTH);
  const imageHeight = layout.centralCard.imageHeight * growth;
  const nameHeight =
    typography.labelCompact.lineHeight * Math.min(scale, maxFontScaleOf('labelCompact'));
  const rankHeight = typography.micro.lineHeight * Math.min(scale, maxFontScaleOf('micro'));
  return {
    width: layout.centralCard.width * growth,
    imageWidth: layout.centralCard.imageWidth * growth,
    imageHeight,
    nameLines: scale > TWO_LINES_FROM ? 2 : 1,
    minHeight:
      borderWidths.default * 2 +
      spacing.gridGap * 2 +
      imageHeight +
      spacing.tileGap +
      nameHeight +
      spacing.xxs +
      rankHeight,
  };
}

/** `centralCardMetrics` com a escala de fonte atual (muda com o ajuste do sistema). */
export function useCentralCardMetrics(): CentralCardMetrics {
  const { fontScale } = useWindowDimensions();
  return centralCardMetrics(fontScale);
}

export interface CentralCardProps {
  central: FanCentral;
  testID?: string;
}

/** O que o card mostra embaixo do nome: a posição, os pontos sem posição, ou "novo". */
function standingOf({ name, fanRank, seasonPoints }: FanCentral): {
  text: string;
  label: string;
  points: boolean;
} {
  if (fanRank !== null) {
    const rank = formatNumber(fanRank);
    return {
      text: t('artist.central.rank', { rank }),
      label: t('artist.central.rankLabel', { name, rank }),
      points: true,
    };
  }
  // Sem posição (o servidor, até o ranking por central do bloco 8): os pontos
  // do fã na central, em lima; "novo" só para quem ainda não pontuou nela.
  if (seasonPoints > 0) {
    return {
      text: t('artist.central.points', { points: formatNumber(seasonPoints) }),
      label: t('artist.central.pointsLabel', { name, points: formatPointsSpoken(seasonPoints) }),
      points: true,
    };
  }
  return {
    text: t('artist.central.new'),
    label: t('artist.central.newLabel', { name }),
    points: false,
  };
}

/**
 * Card de uma central que o fã segue, no carrossel da home (1b): foto do
 * artista (iniciais sobre a cor estável dele, sem foto), nome e a posição do
 * fã, em lima. Sem posição (até o bloco 8), os pontos dele na central, também
 * em lima, e "novo" quando ainda não pontuou nela: posição de exemplo nunca
 * aparece ao lado de número de verdade. O card inteiro é um alvo só, lido
 * como "Netto Brito, você é o 12º" ou "Netto Brito, 4.120 pontos na
 * temporada"; tocar abre o artista dentro da aba de onde veio.
 */
export function CentralCard({ central, testID }: CentralCardProps) {
  const { artistId, name } = central;
  const metrics = useCentralCardMetrics();
  const standing = standingOf(central);

  return (
    <PressableScale
      onPress={() =>
        router.push({ pathname: '/artista/[artistaId]', params: { artistaId: artistId } })
      }
      accessibilityLabel={standing.label}
      testID={testID}
      style={[styles.card, { width: metrics.width }]}
    >
      <RemoteImage
        uri={central.photoURL}
        fallback={{ kind: 'initials', seed: artistId, name }}
        style={[styles.image, { width: metrics.imageWidth, height: metrics.imageHeight }]}
      />
      <Text variant="labelCompact" numberOfLines={metrics.nameLines} style={styles.name}>
        {central.shortName ?? name}
      </Text>
      <Text variant="micro" color={standing.points ? colors.points : colors.textMuted}>
        {standing.text}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.gridGap,
    borderRadius: radii.lg,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  image: {
    borderRadius: radii.xs,
  },
  name: {
    marginTop: spacing.tileGap,
    marginBottom: spacing.xxs,
  },
});
