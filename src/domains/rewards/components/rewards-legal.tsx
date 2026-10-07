import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { t } from '@/i18n';
import { colors } from '@/theme';

export interface RewardsLegalProps {
  /** O endereço do regulamento da loja (`rulesUrl`); `null` esconde o link (UP-45). */
  rulesUrl: string | null;
  style?: StyleProp<TextStyle>;
}

function openRules(url: string): void {
  WebBrowser.openBrowserAsync(url, {
    toolbarColor: colors.background,
    controlsColor: colors.accent,
    // No Android, na mesma tarefa do app, como os termos do cadastro.
    createTask: false,
  }).catch(() => undefined);
}

/**
 * Pé da 1h (bloco 10, 25.1, decisão 19): o aviso da regra 5.3 da Apple (a
 * Apple não patrocina nem participa das recompensas), texto provisório até a
 * cliente entregar o definitivo, e o link "Regulamento", só quando a loja
 * manda o endereço. Discreto, no visual das outras telas: um texto só, lido
 * como uma frase, com o link dentro dele (como os termos do cadastro).
 */
export function RewardsLegal({ rulesUrl, style }: RewardsLegalProps) {
  return (
    <Text variant="bodyXs" color={colors.textTertiary} style={[styles.text, style]}>
      {t('rewards.legal.notice')}
      {rulesUrl ? (
        <>
          {' '}
          <TextLink
            variant="inline"
            tone="text"
            textVariant="bodyXs"
            label={t('rewards.legal.rules')}
            accessibilityHint={t('rewards.legal.rulesHint')}
            onPress={() => openRules(rulesUrl)}
          />
        </>
      ) : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    textAlign: 'center',
  },
});
