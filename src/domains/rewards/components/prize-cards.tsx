import type { RefObject } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Card } from '@/components/card';
import { Pill } from '@/components/pill';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { redemptionStatusSpoken, redemptionStatusText } from '../describe-reward';
import { useMutedProgress } from '../hooks/use-muted-progress';
import type { FanClubPrize } from '../types';
import { RewardIcon } from './reward-icon';
import { RewardMedia } from './reward-media';

// O card da fileira: a largura de quase duas colunas da grade, para o título caber.
const PRIZE_CARD_WIDTH = 168;

/** O prêmio ainda pede as instruções (a retirada ou o contato): o aprovado (e o solicitado, se vier). */
function isOpenPrize(prize: FanClubPrize): boolean {
  return prize.status === 'requested' || prize.status === 'approved';
}

/**
 * Um prêmio na fileira: o quadro do tipo (ou a foto), o título e o status com
 * a data, num botão só, que abre o detalhe em modo prêmio.
 */
function PrizeCard({
  prize,
  onPress,
}: {
  prize: FanClubPrize;
  onPress: (prize: FanClubPrize) => void;
}) {
  const progress = useMutedProgress(prize.id, false);
  return (
    <Card
      onPress={() => onPress(prize)}
      accessibilityLabel={t('rewards.prizes.cardLabel', {
        title: prize.reward.title,
        status: redemptionStatusSpoken(prize),
      })}
      accessibilityHint={t('rewards.prizes.cardHint')}
      style={styles.card}
      testID={`reward-prize-${prize.id}`}
    >
      <RewardIcon reward={prize.reward} progress={progress} />
      <Text variant="labelCompact" style={styles.cardTitle}>
        {prize.reward.title}
      </Text>
      <Text variant="caption" color={colors.textSecondary}>
        {redemptionStatusText(prize)}
      </Text>
    </Card>
  );
}

export interface PrizesRowProps {
  prizes: readonly FanClubPrize[];
  onOpen: (prize: FanClubPrize) => void;
}

/**
 * "Seus prêmios" (seção 34, decisão 51): os prêmios de fã-clube do fã, no topo
 * da loja, entre o título e o destaque, numa fileira que rola de lado, de
 * ponta a ponta. Sem prêmio (ou com a `api` de antes, sem o campo), nada
 * aparece.
 */
export function PrizesRow({ prizes, onOpen }: PrizesRowProps) {
  if (prizes.length === 0) return null;
  return (
    <View testID="reward-prizes">
      <SectionLabel>{t('rewards.prizes.title')}</SectionLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.row}
        contentContainerStyle={styles.rowContent}
      >
        {prizes.map((prize) => (
          <PrizeCard key={prize.id} prize={prize} onPress={onOpen} />
        ))}
      </ScrollView>
    </View>
  );
}

export interface PrizeBodyProps {
  prize: FanClubPrize;
  headingRef: RefObject<View | null>;
}

/**
 * O detalhe em modo prêmio (decisão 51): a foto ou o quadro do tipo, o selo
 * "Prêmio do fã-clube", o título, o código com o status (um foco só), o cupom
 * (selecionável), a mensagem da equipe e, no prêmio aberto, as instruções; no
 * recusado, o motivo da equipe. Sem custo e sem Resgatar: ninguém resgata um
 * prêmio.
 */
export function PrizeBody({ prize, headingRef }: PrizeBodyProps) {
  const { reward } = prize;
  return (
    <View testID="reward-prize-details">
      <RewardMedia reward={reward} outOfReach={false} />
      <View style={styles.titleBlock}>
        <Pill
          label={t('rewards.prizes.badge')}
          tone="neutral"
          size="xs"
          caps
          style={styles.badge}
        />
        <View ref={headingRef} accessible accessibilityRole="header">
          <Text variant="titleCard">{reward.title}</Text>
        </View>
      </View>
      <Card
        accessible
        accessibilityLabel={t('rewards.prizes.codeLabel', {
          code: prize.code,
          status: redemptionStatusSpoken(prize),
        })}
        style={styles.block}
      >
        <Text variant="overline" color={colors.textMuted}>
          {t('rewards.prizes.code')}
        </Text>
        <Text variant="titleEvent" selectable style={styles.code}>
          {prize.code}
        </Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.meta}>
          {redemptionStatusText(prize)}
        </Text>
      </Card>
      {prize.coupon ? (
        <>
          <SectionLabel spacing="tight">{t('rewards.prizes.coupon')}</SectionLabel>
          <Text
            variant="titleEvent"
            selectable
            accessibilityLabel={t('rewards.prizes.couponLabel', { coupon: prize.coupon })}
            testID="reward-prize-coupon"
          >
            {prize.coupon}
          </Text>
        </>
      ) : null}
      {prize.message ? (
        <>
          <SectionLabel spacing="tight">{t('rewards.prizes.message')}</SectionLabel>
          <Text variant="body" color={colors.textBody} testID="reward-prize-message">
            {prize.message}
          </Text>
        </>
      ) : null}
      {prize.status === 'refused' && prize.refusalReason ? (
        <Text variant="body" color={colors.textBody} style={styles.block}>
          {t('rewards.redeemed.reason', { reason: prize.refusalReason })}
        </Text>
      ) : null}
      {isOpenPrize(prize) ? (
        <>
          <SectionLabel spacing="tight">{t('rewards.prizes.howTo')}</SectionLabel>
          <Text variant="body" color={colors.textBody} testID="reward-prize-instructions">
            {reward.instructions}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // A fileira vai de ponta a ponta da tela e rola por baixo da margem, como as
  // outras fileiras do app (o gutter fica dentro dela).
  row: {
    marginHorizontal: -spacing.gutter,
  },
  rowContent: {
    gap: spacing.gridGap,
    paddingHorizontal: spacing.gutter,
  },
  card: {
    width: PRIZE_CARD_WIDTH,
    gap: spacing.xs,
  },
  cardTitle: {
    marginTop: spacing.xs,
  },
  titleBlock: {
    marginTop: spacing.lg,
  },
  badge: {
    alignSelf: 'flex-start',
    marginBottom: spacing.listGap,
  },
  block: {
    marginTop: spacing.blockGap,
  },
  code: {
    marginTop: spacing.metaGap,
  },
  meta: {
    marginTop: spacing.metaGap,
  },
});
