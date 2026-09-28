import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { LargeTitleHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { spacing } from '@/theme';

/**
 * 1f. A aba Ranking também abriga Missões (1g) e Resgatar (1h). Como elas se
 * alternam (controle segmentado ou atalhos) ainda não foi desenhado.
 */
export function RankingScreen() {
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader title={t('ranking.title')}>
        <View style={styles.shortcuts}>
          <Button
            label={t('ranking.sections.missions')}
            variant="secondary"
            size="md"
            haptic="selection"
            onPress={() => router.push('/missoes')}
          />
          <Button
            label={t('ranking.sections.rewards')}
            variant="secondary"
            size="md"
            haptic="selection"
            onPress={() => router.push('/recompensas')}
          />
        </View>
      </LargeTitleHeader>
      <Placeholder designRef="1f" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  shortcuts: {
    flexDirection: 'row',
    gap: spacing.chipGap,
  },
});
