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
}

/**
 * O card da aba Prêmios do modo gestor (34.9, item 5, decisão 51 e 34.24): o
 * último reconhecimento da equipe (do `lastReward`, a data e os pontos), "Ver
 * meus prêmios", que abre a loja, e "Falar com a equipe", para quem não quer
 * ou não pode usar um prêmio. As "Regras do fã-clube" (a sheet com as
 * condições e o texto do reconhecimento) moram na aba Conta desde 34.24. O
 * texto do reconhecimento saiu do card a pedido do dono (20/10/2026, 34.22):
 * o gestor já o leu na apresentação, e ele continua a um toque. Nunca mostra
 * prêmio prometido nem ranking (decisão 47).
 */
export function PrizesCard({ lastReward }: PrizesCardProps) {
  const text = lastRewardText(lastReward);
  return (
    <Card variant="compact" style={styles.card} testID="fan-club-prizes">
      <View
        accessible
        accessibilityLabel={t('fanClub.mine.numberLabel', {
          label: t('fanClub.manager.prizes.last'),
          value: text,
        })}
        style={styles.head}
      >
        <IconTile icon={Gift} tone="points" />
        <View style={styles.texts}>
          <Text variant="overline" color={colors.textMuted}>
            {t('fanClub.manager.prizes.last')}
          </Text>
          <Text variant="label" testID="fan-club-last-reward">
            {text}
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
