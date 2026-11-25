import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';

import { AppleButton } from './apple-button';
import { GoogleButton } from './google-button';
import { offstage } from './step-field';
import { TermsNotice } from './terms-notice';

/** Um provedor à vista: o toque e se a entrada por ele está em curso. */
export interface ProviderButton {
  onPress: () => void;
  loading: boolean;
}

export interface SocialEntryButtonsProps {
  /** O Google, só no Android; `null` sem o botão. */
  google: ProviderButton | null;
  /** A Apple, só no iPhone; `null` sem o botão. */
  apple: ProviderButton | null;
  /** Outro envio da tela em curso (o e-mail e a senha): nenhum provedor recebe toque. */
  disabled: boolean;
  /**
   * Mostra embaixo dos botões, uma vez só, o aviso de que criar a conta aceita
   * os Termos e a Política. Vale sempre no cadastro. No entrar, só quando a tela
   * abriu sem a abertura embaixo (por um link do app): pela abertura, o aviso
   * dela ("Ao continuar, você aceita...") já cobre quem cria a conta por um
   * provedor ali, e a tela fica mais limpa (pedido do dono de 24/11/2026).
   */
  showTerms: boolean;
}

/**
 * Os botões de provedor da pergunta do e-mail de entrar e de criar conta (seção
 * 39 de docs/arquitetura-api.md): a Apple, no iPhone, antes do Google, no
 * Android. Com um provedor em curso, o outro fica desligado, e o aviso dos
 * Termos sai do toque e dos leitores de tela. Sem provedor nenhum, nada.
 */
export function SocialEntryButtons({
  google,
  apple,
  disabled,
  showTerms,
}: SocialEntryButtonsProps) {
  if (!google && !apple) return null;
  const pending = !!google?.loading || !!apple?.loading;
  const inactive = disabled || pending;

  return (
    <View style={styles.group}>
      {apple ? (
        <AppleButton
          onPress={apple.onPress}
          loading={apple.loading}
          disabled={disabled || (pending && !apple.loading)}
        />
      ) : null}
      {google ? (
        <GoogleButton
          onPress={google.onPress}
          loading={google.loading}
          disabled={disabled || (pending && !google.loading)}
        />
      ) : null}
      {showTerms ? (
        <View {...offstage(inactive)} testID="social-entry-terms">
          <TermsNotice variant="signUp" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.xs },
});
