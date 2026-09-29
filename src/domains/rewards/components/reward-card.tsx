import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import {
  missingText,
  priceText,
  rewardCardLabel,
  type RewardAvailability,
} from '../describe-reward';
import { useMutedProgress } from '../hooks/use-muted-progress';
import type { Reward } from '../types';
import { RewardIcon } from './reward-icon';
import { RewardPrice } from './reward-price';

export interface RewardCardProps {
  reward: Reward;
  availability: RewardAvailability;
  /** Abre o detalhe do resgate (o toque vale em qualquer estado, até esgotado). */
  onPress: (reward: Reward) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function outlineLabelOf(reward: Reward, availability: RewardAvailability): string {
  switch (availability.state) {
    case 'short':
      return missingText(availability.missing);
    case 'soldOut':
      return t('rewards.soldOut');
    default:
      return priceText(reward.cost);
  }
}

/**
 * Card da grade da 1h, nos dois estados do protótipo: dá para resgatar
 * (quadro na cor do tipo e preço lima) e ainda não dá (vidro e "faltam N" em
 * contorno), mais esgotado. O card inteiro é um botão só, com o rótulo
 * completo; o preço é só visual. Cresce com a linha da grade: o preço fica
 * sempre no pé, na mesma altura do vizinho, mesmo com a fonte grande.
 */
export function RewardCard({ reward, availability, onPress, style, testID }: RewardCardProps) {
  const outOfReach = availability.state === 'short' || availability.state === 'soldOut';
  const tileProgress = useMutedProgress(reward.id, outOfReach);
  const outlined = availability.state !== 'redeemable';
  const priceProgress = useMutedProgress(reward.id, outlined);

  return (
    <Card
      padding="md"
      variant={outOfReach ? 'locked' : 'default'}
      onPress={() => onPress(reward)}
      accessibilityLabel={rewardCardLabel(reward, availability)}
      accessibilityHint={t('rewards.hint')}
      testID={testID}
      style={[styles.card, style]}
    >
      <RewardIcon reward={reward} progress={tileProgress} />
      <Text variant="label" style={styles.title}>
        {reward.title}
      </Text>
      <Text variant="metaSmall" color={colors.textMuted} style={styles.subtitle}>
        {reward.subtitle}
      </Text>
      <View style={styles.push} />
      <RewardPrice
        progress={priceProgress}
        outlined={outlined}
        priceLabel={priceText(reward.cost)}
        outlineLabel={outlineLabelOf(reward, availability)}
        outlineTone={availability.state === 'unknown' ? 'neutral' : 'muted'}
      />
    </Card>
  );
}

// Vãos do protótipo: quadro até o título 11, título até o subtítulo 6 e
// subtítulo até o preço 10.
const styles = StyleSheet.create({
  card: {
    flex: 1,
  },
  title: {
    marginTop: spacing.gridGap,
  },
  subtitle: {
    marginTop: spacing.metaGap,
    marginBottom: spacing.listGap,
  },
  // Empurra o preço para o pé quando o vizinho da linha é mais alto.
  push: {
    flexGrow: 1,
  },
});
