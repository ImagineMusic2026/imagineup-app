import { StyleSheet, View } from 'react-native';

import { Placeholder } from '@/components/placeholder';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

/**
 * Sheet "Gerar meu link". Aberta pelo botão central da tab bar: no protótipo
 * ele criava post de fã (fora do contrato), e virar "Convidar" é proposta que
 * precisa de aprovação da cliente por escrito.
 */
export function InviteSheetScreen() {
  return (
    <View style={styles.container}>
      <Text variant="titleCard" accessibilityRole="header">
        {t('invite.title')}
      </Text>
      <Text variant="body" color={colors.textTertiary}>
        {t('invite.subtitle')}
      </Text>
      <Placeholder designRef="convite" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
});
