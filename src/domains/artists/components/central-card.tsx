import { router } from 'expo-router';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { maxFontScaleOf, Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, layout, radii, spacing, typography } from '@/theme';
import { formatNumber } from '@/utils/number';

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

/**
 * Card de uma central que o fã segue, no carrossel da home (1b): foto do
 * artista (iniciais sobre a cor estável dele, sem foto), nome e a posição do
 * fã, em lima, ou "novo". O card inteiro é um alvo só, lido como "Netto Brito,
 * você é o 12º"; tocar abre o artista dentro da aba de onde veio.
 */
export function CentralCard({ central, testID }: CentralCardProps) {
  const { artistId, name, fanRank } = central;
  const metrics = useCentralCardMetrics();
  const rank = fanRank === null ? null : formatNumber(fanRank);
  const label =
    rank === null
      ? t('artist.central.newLabel', { name })
      : t('artist.central.rankLabel', { name, rank });

  return (
    <PressableScale
      onPress={() =>
        router.push({ pathname: '/artista/[artistaId]', params: { artistaId: artistId } })
      }
      accessibilityLabel={label}
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
      <Text variant="micro" color={rank === null ? colors.textMuted : colors.points}>
        {rank === null ? t('artist.central.new') : t('artist.central.rank', { rank })}
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
