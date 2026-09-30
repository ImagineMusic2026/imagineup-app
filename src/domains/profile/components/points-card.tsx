import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { ProgressBar } from '@/components/progress-bar';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useCountedNumber } from '@/hooks/use-counted-number';
import { t } from '@/i18n';
import { colors, fonts, layout, radii, spacing, typography } from '@/theme';

import {
  levelFraction,
  nextLevelCaption,
  pointsCardLabel,
  weekEarnedText,
} from '../describe-profile';
import type { MyProgress } from '../types';

// Barras do esqueleto no tamanho do texto que vem: rótulo, saldo e legenda.
const LABEL_WIDTH = 80;
const BALANCE_WIDTH = 150;
const CAPTION_WIDTH = '70%';

export interface PointsCardProps {
  /** Saldo para resgatar: o mesmo número da pílula da loja (1h). */
  balance: number;
  /** Nível e XP de nível (a barra e o "Faltam ...") e os ganhos da semana. */
  progress: MyProgress;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Card de pontos da 1e. O número grande "SEUS PONTOS" é o saldo para resgatar
 * (decisão do dono, 9.4): cai no resgate e conta do valor antigo ao novo. A
 * barra e o "Faltam ... para o nível N" usam o XP de nível, que nunca cai, e a
 * barra anda junto com o anel do avatar (mesma duração e curva; na subida de
 * nível, as duas recomeçam do 0). Um elemento só para o leitor, lido como
 * progresso: "Seus pontos: 12.480. Esta semana: mais 840. Faltam 2.520 pontos
 * para o nível 8, Xodó."
 *
 * Algarismos tabulares só enquanto o saldo conta: parado, o "1" tabular da
 * Sora tem pé e alarga o número.
 */
export function PointsCard({ balance, progress, style, testID }: PointsCardProps) {
  const counted = useCountedNumber(balance);
  const fraction = levelFraction(progress);
  const caption = nextLevelCaption(progress);

  return (
    <Card
      variant="large"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={pointsCardLabel(balance, progress)}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      testID={testID}
      style={[styles.card, style]}
    >
      <View style={styles.top}>
        <View>
          <Text variant="overline" color={colors.textMuted}>
            {t('profile.points.title')}
          </Text>
          <Text
            variant="numberHero"
            color={colors.points}
            tabular={counted.counting}
            style={styles.value}
          >
            {counted.text}
          </Text>
        </View>
        <View style={styles.week}>
          <Text variant="overline" color={colors.textMuted} style={styles.end}>
            {t('profile.points.week')}
          </Text>
          <Text variant="numberSmall" style={[styles.value, styles.end]}>
            {weekEarnedText(progress.weekEarned)}
          </Text>
        </View>
      </View>
      <ProgressBar
        key={progress.level.number}
        value={fraction}
        style={styles.bar}
        testID={testID ? `${testID}-bar` : undefined}
      />
      <Text variant="caption" color={colors.textMuted}>
        {'text' in caption ? (
          caption.text
        ) : (
          <>
            {caption.before}
            <Text variant="caption" style={styles.amount}>
              {caption.amount}
            </Text>
            {caption.after}
          </>
        )}
      </Text>
    </Card>
  );
}

/**
 * O card enquanto o saldo ou o nível chegam, com as medidas do de verdade
 * (dentro do `SkeletonGroup` da tela, que diz o que carrega).
 */
export function PointsCardSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <Card variant="large" style={[styles.card, style]}>
      <Skeleton height={typography.overline.lineHeight} width={LABEL_WIDTH} tone="line" />
      <Skeleton
        height={typography.numberHero.lineHeight}
        width={BALANCE_WIDTH}
        tone="line"
        style={styles.value}
      />
      <Skeleton height={layout.progressBar.sm} radius={radii.pill} tone="line" style={styles.bar} />
      <Skeleton height={typography.caption.lineHeight} width={CAPTION_WIDTH} tone="line" />
    </Card>
  );
}

// A entrelinha do RN (1,1 a 1,2) deixa folga em cima e embaixo de cada texto,
// onde o protótipo usa 1. Os vãos daqui descontam essa folga, como o
// `LevelBadge`, para o que se vê bater com o protótipo (card de 125,5).
const styles = StyleSheet.create({
  // 16 em cima e 14 embaixo no protótipo, menos a folga do rótulo e da legenda.
  card: {
    paddingTop: spacing.cardPadding,
    paddingBottom: spacing.md,
  },
  // Com a fonte grande, "ESTA SEMANA" desce para baixo do saldo em vez de apertá-lo.
  top: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: spacing.md,
    rowGap: spacing.sm,
  },
  week: {
    alignItems: 'flex-end',
  },
  end: {
    textAlign: 'right',
  },
  // 8 do rótulo ao número no protótipo, menos a folga dos dois.
  value: {
    marginTop: spacing.xs,
  },
  // 15 do número à barra e 9 da barra à legenda (menos a folga dela).
  bar: {
    marginTop: spacing.titleToChips,
    marginBottom: spacing.sm,
  },
  amount: {
    fontFamily: fonts.manropeBold,
    color: colors.text,
  },
});
