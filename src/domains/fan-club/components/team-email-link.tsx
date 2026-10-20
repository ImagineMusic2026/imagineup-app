import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { SUPPORT_EMAIL } from '@/config/links';
import { t, type TranslationKey } from '@/i18n';
import { openSupportEmail } from '@/services/web-page';
import { colors, spacing } from '@/theme';

export interface TeamEmailLinkProps {
  label: TranslationKey;
  hint: TranslationKey;
  /** O assunto do e-mail, sem dado do fã. */
  subject: TranslationKey;
  testID?: string;
}

/**
 * Um link que abre o app de e-mail para a equipe, com o assunto: "Falar com a
 * equipe" do card Prêmios e "Quero encerrar meu fã-clube" (decisão 13). Sem
 * app de e-mail, o endereço aparece embaixo, selecionável, e é anunciado,
 * como o "Fale com a equipe" dos Ajustes.
 */
export function TeamEmailLink({ label, hint, subject, testID }: TeamEmailLinkProps) {
  const [failed, setFailed] = useState(false);
  const fallback = t('settings.contactError', { email: SUPPORT_EMAIL });

  const write = async (): Promise<void> => {
    const opened = await openSupportEmail(t(subject));
    setFailed(!opened);
    if (!opened) AccessibilityInfo.announceForAccessibility(fallback);
  };

  return (
    <View style={styles.root}>
      <TextLink
        label={t(label)}
        role="link"
        variant="standalone"
        accessibilityHint={t(hint)}
        onPress={() => void write()}
        testID={testID}
      />
      {failed ? (
        <Text variant="caption" color={colors.textSecondary} selectable style={styles.fallback}>
          {fallback}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
  },
  fallback: {
    marginTop: spacing.xs,
  },
});
