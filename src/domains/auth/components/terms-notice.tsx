import { Fragment } from 'react';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { t, type TranslationKey } from '@/i18n';
import { openWebPage } from '@/services/web-page';
import { colors } from '@/theme';

import { PRIVACY_URL, TERMS_URL } from '../consts';

/** `continue` na abertura (1k); `signUp` embaixo do botão do cadastro. */
export type TermsNoticeVariant = 'continue' | 'signUp';

export interface TermsNoticeProps {
  variant: TermsNoticeVariant;
  style?: StyleProp<TextStyle>;
}

const SENTENCE: Record<TermsNoticeVariant, TranslationKey> = {
  continue: 'auth.terms.continue',
  signUp: 'auth.terms.signUp',
};

const LINKS = {
  terms: { labelKey: 'auth.terms.termsLink', url: TERMS_URL },
  privacy: { labelKey: 'auth.terms.privacyLink', url: PRIVACY_URL },
} as const satisfies Record<string, { labelKey: TranslationKey; url: string }>;

type LinkName = keyof typeof LINKS;

const isLinkName = (name: string): name is LinkName => name in LINKS;

/**
 * "Ao continuar, você aceita os Termos de uso e a Política de privacidade...":
 * a frase vem inteira do `translations.json`, com `{{terms}}` e `{{privacy}}`
 * no lugar dos links, que viram trechos tocáveis dentro do texto (o leitor de
 * tela lista os dois pelo rotor, no iOS, e pelo menu de links, no Android).
 * As páginas abrem no navegador dentro do app.
 */
export function TermsNotice({ variant, style }: TermsNoticeProps) {
  const parts = t(SENTENCE[variant]).split(/\{\{(\w+)\}\}/);
  return (
    <Text variant="caption" color={colors.textMuted} style={[styles.text, style]}>
      {parts.map((part, index) => {
        // O split com grupo deixa os nomes dos links nas posições ímpares.
        if (index % 2 === 1 && isLinkName(part)) {
          const link = LINKS[part];
          return (
            <TextLink
              key={part}
              variant="inline"
              tone="text"
              // Manrope 700, com a mesma entrelinha (15) do texto em volta.
              textVariant="labelCompact"
              label={t(link.labelKey)}
              onPress={() => openWebPage(link.url)}
            />
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    textAlign: 'center',
  },
});
