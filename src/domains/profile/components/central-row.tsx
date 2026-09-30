import { router } from 'expo-router';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import type { FanCentral } from '@/domains/artists';
import { t } from '@/i18n';
import { colors, layout, spacing, typography } from '@/theme';
import { formatNumber } from '@/utils/number';

import { centralLabel, centralMeta } from '../describe-profile';

const SKELETON_ROWS = 2;
// Nome, meta e pontos do esqueleto, no tamanho do que vem.
const NAME_WIDTH = 96;
const META_WIDTH = 132;
const POINTS_WIDTH = 32;

export interface CentralRowProps {
  central: FanCentral;
  testID?: string;
}

/**
 * Uma central do fã em "Suas centrais" (1e): foto do artista (iniciais na
 * cor estável dele, sem foto), nome, a posição do fã entre os fãs da central
 * e os pontos da temporada nela, em lima. São os mesmos números do ranking da
 * central (1f). A linha toda abre a página do artista na pilha do Perfil.
 */
export function CentralRow({ central, testID }: CentralRowProps) {
  const ranked = central.fanRank !== null;
  return (
    <ListRow
      variant="compact"
      leading={
        <Avatar name={central.name} id={central.artistId} photoUrl={central.photoURL} size="sm" />
      }
      title={central.name}
      meta={centralMeta(central)}
      trailing={
        ranked ? (
          // Sora 800 12 no protótipo: `chip` (11,5). Sem tabular, que alarga o "1".
          <Text variant="chip" color={colors.points}>
            {formatNumber(central.seasonPoints)}
          </Text>
        ) : undefined
      }
      onPress={() =>
        router.push({ pathname: '/artista/[artistaId]', params: { artistaId: central.artistId } })
      }
      accessibilityLabel={centralLabel(central)}
      accessibilityHint={t('profile.centrals.hint')}
      testID={testID}
    />
  );
}

/** Linhas de central enquanto a lista chega (dentro de um `SkeletonGroup`). */
export function CentralRowsSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.list, style]}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Card key={index} variant="compact" style={styles.row}>
          <Skeleton circle tone="raised" height={layout.avatar.sm.size} />
          <View style={styles.texts}>
            <Skeleton tone="line" width={NAME_WIDTH} height={typography.label.fontSize} />
            <Skeleton tone="line" width={META_WIDTH} height={typography.metaSmall.fontSize} />
          </View>
          <Skeleton tone="line" width={POINTS_WIDTH} height={typography.chip.fontSize} />
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.tileGap,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gridGap,
  },
  texts: {
    flex: 1,
    gap: spacing.metaGap,
  },
});
