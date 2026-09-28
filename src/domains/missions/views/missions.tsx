import { StyleSheet, View } from 'react-native';

import { BackHeader, LargeTitleHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { ProgressRing } from '@/components/progress-ring';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

// Valores do protótipo ("12/20" na meta da temporada), só para ver o anel.
const SAMPLE_DONE = 12;
const SAMPLE_TOTAL = 20;

/** 1g. Os valores de cada missão vêm da API: a régua é configurável no painel. */
export function MissionsScreen() {
  const bottomInset = useTabBarInset();
  const progressLabel = t('missions.progressLabel', { done: SAMPLE_DONE, total: SAMPLE_TOTAL });

  return (
    <Screen scroll bottomInset={bottomInset}>
      <BackHeader />
      <LargeTitleHeader title={t('missions.title')} subtitle={t('missions.subtitle')} />
      <View style={styles.season}>
        <ProgressRing progress={SAMPLE_DONE / SAMPLE_TOTAL} accessibilityLabel={progressLabel}>
          <Text variant="points" color={colors.points} tabular>
            {`${SAMPLE_DONE}/${SAMPLE_TOTAL}`}
          </Text>
        </ProgressRing>
        <Placeholder designRef="1g" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  season: {
    gap: spacing.lg,
  },
});
