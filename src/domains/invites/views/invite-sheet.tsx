import { StyleSheet, View } from 'react-native';

import { Placeholder } from '@/components/placeholder';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

/**
 * Sheet "Gerar meu link", aberta pelo atalho Convidar do "+" da tab bar
 * (aprovado em 2026-09-28; no protótipo o "+" criava post de fã, fora do contrato).
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
