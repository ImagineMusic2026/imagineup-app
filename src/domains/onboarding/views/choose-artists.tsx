import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { usePreferencesStore } from '@/stores/preferences';
import { colors, spacing } from '@/theme';

/**
 * 1l. Ao concluir, o guard do layout raiz troca o onboarding pelas abas sozinho;
 * a tela não navega.
 */
export function ChooseArtistsScreen() {
  const completeOnboarding = usePreferencesStore((state) => state.completeOnboarding);

  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.header}>
        <Text variant="titleOnboarding" accessibilityRole="header">
          {t('onboarding.chooseArtists.title')}
        </Text>
        <Text variant="body" color={colors.textTertiary}>
          {t('onboarding.chooseArtists.subtitle')}
        </Text>
      </View>
      <View style={styles.body}>
        <Placeholder designRef="1l" />
      </View>
      <Button label={t('common.continue')} onPress={completeOnboarding} haptic="confirm" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.gutterOnboarding,
    paddingTop: spacing.xl,
    gap: spacing.xl,
  },
  header: {
    gap: spacing.sm,
  },
  body: {
    flex: 1,
  },
});
