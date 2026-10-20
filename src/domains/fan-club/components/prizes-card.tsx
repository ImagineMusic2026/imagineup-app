import { router } from 'expo-router';
import { Gift } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IconTile } from '@/components/icon-tile';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';
import { formatDate } from '@/utils/date';

import type { FanClubLastReward } from '../types';
import { TeamEmailLink } from './team-email-link';

/** O último reconhecimento: "+200 pontos em 18/10/2026", o prêmio, ou os dois. */
export function lastRewardText(reward: FanClubLastReward | null): string {
  const date = reward?.at ? formatDate(reward.at) : '';
  if (!reward || !date) return t('fanClub.mine.prizes.none');
  const points = reward.points ?? 0;
  if (points > 0 && reward.prize) return t('fanClub.mine.prizes.both', { points, date });
  if (points === 1) return t('fanClub.mine.prizes.pointsOne', { date });
  if (points > 0) return t('fanClub.mine.prizes.points', { points, date });
  if (reward.prize) return t('fanClub.mine.prizes.prize', { date });
  return t('fanClub.mine.prizes.none');
}

export interface PrizesCardProps {
  lastReward: FanClubLastReward | null;
  /** O texto do reconhecimento (`notice`, decisão 47), ou null desligado. */
  notice: string | null;
}

/**
 * O card Prêmios do "Meu fã-clube" (34.9, item 5, e decisão 51): o último
 * reconhecimento da equipe (do `lastReward`, a data e os pontos), o texto do
 * reconhecimento quando o servidor o manda e, ao lado, as condições de conduta
 * (18+, ativo, sem suspensão, decisão 47), "Ver meus prêmios", que abre a
 * loja (a fileira "Seus prêmios" chega com a etapa 8), e "Falar com a
 * equipe", para quem não quer ou não pode usar um prêmio. Nunca mostra
 * prêmio prometido nem ranking (decisão 47).
 */
export function PrizesCard({ lastReward, notice }: PrizesCardProps) {
  return (
    <Card variant="compact" style={styles.card} testID="fan-club-prizes">
      <View style={styles.head}>
        <IconTile icon={Gift} tone="points" />
        <View style={styles.texts}>
          <Text variant="label" accessibilityRole="header">
            {t('fanClub.mine.prizes.title')}
          </Text>
          <Text variant="body" color={colors.textSecondary} testID="fan-club-last-reward">
            {lastRewardText(lastReward)}
          </Text>
        </View>
      </View>
      {notice ? (
        <Text variant="caption" color={colors.textMuted} testID="fan-club-prizes-notice">
          {notice}
        </Text>
      ) : null}
      <Text variant="caption" color={colors.textMuted} testID="fan-club-prizes-conditions">
        {t('fanClub.mine.prizes.conditions')}
      </Text>
      {/* Numa fileira, o botão fica da altura do conteúdo, como no
          `EmptyState`: direto na coluna e alinhado ao começo, o desenho do
          Button, que cresce para ocupar a altura que o pai der, esticava sem
          fim dentro da rolagem (visto no emulador Android na etapa 10). */}
      <View style={styles.openRow} testID="fan-club-prizes-open-row">
        <Button
          label={t('fanClub.mine.prizes.open')}
          variant="pointsTinted"
          size="md"
          onPress={() => router.navigate('/recompensas', { withAnchor: true })}
          accessibilityHint={t('fanClub.mine.prizes.openHint')}
          style={styles.open}
          testID="fan-club-prizes-open"
        />
      </View>
      <TeamEmailLink
        label="fanClub.mine.prizes.contact"
        hint="fanClub.mine.prizes.contactHint"
        subject="fanClub.mine.prizes.contactSubject"
        testID="fan-club-prizes-contact"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  openRow: {
    flexDirection: 'row',
  },
  // Com a fonte grande, o rótulo quebra dentro da largura do card.
  open: {
    flexShrink: 1,
  },
});
