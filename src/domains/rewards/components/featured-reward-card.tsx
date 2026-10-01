import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PhotoCard } from '@/components/photo-card';
import { Pill } from '@/components/pill';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, radii, spacing } from '@/theme';

import {
  featuredRewardLabel,
  missingText,
  priceText,
  rewardMeta,
  scarcityText,
  type RewardAvailability,
} from '../describe-reward';
import type { Reward } from '../types';

// O texto começa 100 abaixo do topo do card: só a metade de cima da foto
// aparece de fato, o resto fica sob a faixa escura do véu.
const CONTENT_TOP = 100;

export interface FeaturedRewardCardProps {
  reward: Reward;
  availability: RewardAvailability;
  onPress: (reward: Reward) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Custo em lima, o que falta apagado, ou nada quando esgotou (o selo já diz). */
function Price({ reward, availability }: Pick<FeaturedRewardCardProps, 'reward' | 'availability'>) {
  switch (availability.state) {
    case 'soldOut':
      return null;
    case 'short':
      return (
        <Text variant="labelSmall" color={colors.textMuted}>
          {missingText(availability.missing)}
        </Text>
      );
    default:
      return (
        <Text variant="button" color={colors.points}>
          {priceText(reward.cost)}
        </Text>
      );
  }
}

/**
 * Destaque do topo da 1h ("Meet & greet com o Netto"): foto de ponta a ponta
 * com o véu, o selo de escassez em `accentStrong` (o rosa do protótipo reprova
 * contraste com texto branco), título, show e custo. O card inteiro é o botão
 * que abre o detalhe do resgate, sem botão dentro. Sem foto, o placeholder de
 * marca pelo id. Cresce com a fonte do sistema em vez de cortar.
 */
export function FeaturedRewardCard({
  reward,
  availability,
  onPress,
  style,
  testID,
}: FeaturedRewardCardProps) {
  const scarcity = scarcityText(reward);
  // A loja põe o destaque entre as margens da tela.
  const fallbackSize = {
    width: useWindowDimensions().width - 2 * spacing.gutter,
    height: layout.rewardHeroMinHeight,
  };
  const badge =
    availability.state === 'soldOut' ? (
      <Pill label={t('rewards.soldOut')} tone="neutral" size="xs" caps style={styles.badge} />
    ) : scarcity ? (
      <Pill label={scarcity} tone="accentStrong" size="xs" caps style={styles.badge} />
    ) : null;

  return (
    <PhotoCard
      uri={reward.imageUrl}
      fallback={{ kind: 'brand', seed: reward.id }}
      fallbackSize={fallbackSize}
      scrim="rewardHero"
      minHeight={layout.rewardHeroMinHeight}
      radius={radii.xxl}
      onPress={() => onPress(reward)}
      accessibilityLabel={featuredRewardLabel(reward, availability)}
      accessibilityHint={t('rewards.hint')}
      testID={testID}
      style={[styles.card, style]}
    >
      {badge}
      <Text variant="titleGreeting">{reward.title}</Text>
      <View style={styles.bottom}>
        <Text variant="caption" color={colors.textSecondary} style={styles.meta}>
          {rewardMeta(reward)}
        </Text>
        <Price reward={reward} availability={availability} />
      </View>
    </PhotoCard>
  );
}

// Padding do protótipo: 16 dos lados e 14 embaixo; selo a 10 do título e a
// linha de baixo a 11 dele.
const styles = StyleSheet.create({
  card: {
    paddingTop: CONTENT_TOP,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.cardPadding,
  },
  badge: {
    alignSelf: 'flex-start',
    marginBottom: spacing.listGap,
  },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.gridGap,
  },
  meta: {
    flexShrink: 1,
  },
});
