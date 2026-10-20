import { router } from 'expo-router';
import { Gift } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IconTile } from '@/components/icon-tile';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
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
}

/**
 * O card Prêmios do "Meu fã-clube" (34.9, item 5, e decisão 51): o último
 * reconhecimento da equipe (do `lastReward`, a data e os pontos), "Ver meus
 * prêmios", que abre a loja, "Falar com a equipe", para quem não quer ou não
 * pode usar um prêmio, e "Regras do fã-clube", a sheet com as condições e o
 * texto do reconhecimento (o `notice`, com a linha da Apple). O texto saiu do
 * card a pedido do dono (20/10/2026, 34.22): o gestor já o leu na
 * apresentação, e ele continua a um toque. Nunca mostra prêmio prometido nem
 * ranking (decisão 47).
 */
export function PrizesCard({ lastReward }: PrizesCardProps) {
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
      {/* Os dois links lado a lado; com a fonte grande, o segundo desce. */}
      <View style={styles.links}>
        <TeamEmailLink
          label="fanClub.mine.prizes.contact"
          hint="fanClub.mine.prizes.contactHint"
          subject="fanClub.mine.prizes.contactSubject"
          testID="fan-club-prizes-contact"
        />
        <TextLink
          label={t('fanClub.mine.prizes.rules')}
          accessibilityHint={t('fanClub.mine.prizes.rulesHint')}
          onPress={() => router.push('/meu-fa-clube/regras')}
          testID="fan-club-prizes-rules"
        />
      </View>
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
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: spacing.xl,
  },
});
