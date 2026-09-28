import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { spacing } from '@/theme';

export default function NotFoundScreen() {
  return (
    <Screen contentStyle={styles.content}>
      <View style={styles.body}>
        <Text variant="titlePage" accessibilityRole="header">
          {t('notFound.title')}
        </Text>
        <Button label={t('notFound.action')} onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    justifyContent: 'center',
  },
  body: {
    gap: spacing.xl,
  },
});
