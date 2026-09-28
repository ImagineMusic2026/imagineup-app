import { router } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { LargeTitleHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { spacing } from '@/theme';

/** Raiz da aba Explorar. Não existe no protótipo: precisa de design. */
export function ExploreScreen() {
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader title={t('explore.title')} />
      <View style={styles.body}>
        <Placeholder designRef="explorar" />
        <Button
          label={t('explore.agenda')}
          icon={CalendarDays}
          variant="secondary"
          size="md"
          onPress={() => router.push('/agenda')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.listGap,
  },
});
