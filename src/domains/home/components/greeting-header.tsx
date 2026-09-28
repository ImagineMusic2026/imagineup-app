import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';
import { dayPeriod } from '@/utils/date';

/** Saudação da home (1b): "Boa noite," e o nome do fã. */
export function GreetingHeader() {
  const user = useSessionStore((state) => state.user);
  const firstName = user?.displayName?.split(' ')[0] ?? t('home.fallbackName');

  return (
    <View style={styles.container} accessible accessibilityRole="header">
      <Text variant="caption" color={colors.textMuted}>
        {t(`home.greeting.${dayPeriod()}`)}
      </Text>
      <Text variant="titleGreeting">{firstName}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: 2,
  },
});
