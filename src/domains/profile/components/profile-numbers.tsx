import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useCountedNumber } from '@/hooks/use-counted-number';
import { t } from '@/i18n';
import { colors, layout, spacing, typography } from '@/theme';
import { formatNumber } from '@/utils/number';

import { statLabel, statSpoken, type StatKind } from '../describe-profile';
import type { FanStats } from '../types';

const FAN_STATS = ['peopleBrought', 'seasons'] as const satisfies readonly StatKind[];
const SKELETON_CELLS: readonly StatKind[] = ['points', ...FAN_STATS];
// O número e o rótulo do esqueleto, no tamanho do que vem.
const NUMBER_SKELETON_WIDTH = 48;
const LABEL_SKELETON_WIDTH = 44;

export interface ProfileNumbersProps {
  /** Saldo para resgatar: o mesmo número da pílula da loja (1h). */
  balance: number;
  stats: FanStats;
  /** O número de pontos abre o extrato (bloco 7). */
  onPointsPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function NumberText({
  children,
  color,
  tabular,
}: {
  children: string | null;
  color?: string;
  tabular?: boolean;
}) {
  return (
    <Text variant="titleHeader" color={color} tabular={tabular}>
      {children}
    </Text>
  );
}

function NumberLabel({ kind, value }: { kind: StatKind; value: number }) {
  return (
    <Text variant="caption" color={colors.textSecondary} style={styles.label}>
      {statLabel(kind, value)}
    </Text>
  );
}

/**
 * Os três números do topo da 1e, ao lado do avatar e embaixo do nome, como no
 * perfil do Instagram: o saldo em lima (lima é só para pontos), que conta do
 * valor antigo ao novo e abre o extrato, os convidados (as pessoas trazidas
 * pelo convite) e as temporadas, alinhados à esquerda. Cada número é um foco
 * só ("12.480 pontos"), e só o de pontos é botão, com a dica "Abre o extrato
 * de pontos." e nada tocável dentro.
 *
 * Cada coluna fica da largura do que mostra, e as três se espalham pela
 * largura. Com o vão mínimo de 12, cabem ao lado do avatar num aparelho de 360
 * de largura com a fonte padrão e num de 412 com a fonte em 1,3; nenhuma
 * palavra quebra no meio, e a coluna que não cabe desce para a linha de baixo,
 * ainda ao lado do avatar.
 *
 * Algarismos tabulares só enquanto o saldo conta: parado, o "1" tabular da
 * Sora tem pé e alarga o número.
 */
export function ProfileNumbers({
  balance,
  stats,
  onPointsPress,
  style,
  testID,
}: ProfileNumbersProps) {
  const counted = useCountedNumber(balance);

  return (
    <View testID={testID} style={[styles.row, style]}>
      <PressableScale
        onPress={onPointsPress}
        haptic="tap"
        accessibilityRole="button"
        accessibilityLabel={statSpoken('points', balance)}
        accessibilityHint={t('profile.points.hint')}
        testID="profile-stat-points"
        style={styles.cell}
      >
        <NumberText color={colors.points} tabular={counted.counting}>
          {counted.text}
        </NumberText>
        <NumberLabel kind="points" value={balance} />
      </PressableScale>
      {FAN_STATS.map((kind) => (
        <View
          key={kind}
          accessible
          accessibilityLabel={statSpoken(kind, stats[kind])}
          testID={`profile-stat-${kind}`}
          style={styles.cell}
        >
          <NumberText>{formatNumber(stats[kind])}</NumberText>
          <NumberLabel kind={kind} value={stats[kind]} />
        </View>
      ))}
    </View>
  );
}

/** Os três números enquanto chegam (dentro do `SkeletonGroup` da tela, que diz o que carrega). */
export function ProfileNumbersSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, style]}>
      {SKELETON_CELLS.map((kind) => (
        <View key={kind} style={styles.cell}>
          <Skeleton height={typography.titleHeader.lineHeight} width={NUMBER_SKELETON_WIDTH} />
          <Skeleton
            height={typography.caption.lineHeight}
            width={LABEL_SKELETON_WIDTH}
            style={styles.label}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // As colunas se espalham pela largura ao lado do avatar, como no Instagram;
  // o vão de 12 é o mínimo, e a coluna que não cabe desce.
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: spacing.md,
    rowGap: spacing.sm,
  },
  // O número de pontos é botão: o alvo de 44 por 44 vale para os três, que
  // ficam iguais ("0 pontos" é mais estreito que o alvo).
  cell: {
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'flex-start',
  },
  label: {
    marginTop: spacing.xxs,
  },
});
