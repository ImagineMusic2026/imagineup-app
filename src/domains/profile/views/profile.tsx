import { LogOut } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { signOut } from '@/domains/auth';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { spacing } from '@/theme';

/** 1e. Ajustes com exclusão de conta são exigência da Apple e do Google. */
export function ProfileScreen() {
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <View style={styles.header}>
        <Text variant="titleHeader" accessibilityRole="header">
          {t('profile.title')}
        </Text>
      </View>
      <View style={styles.body}>
        <Placeholder designRef="1e" />
        <Button
          label={t('profile.signOut')}
          icon={LogOut}
          variant="ghost"
          size="md"
          onPress={() => {
            signOut().catch(() => undefined);
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  body: {
    gap: spacing.listGap,
  },
});
