import { Mail, Pencil } from 'lucide-react-native';
import { TextInput as NativeTextInput, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, layout, opacities, radii, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';

export interface EmailPillProps {
  email: string;
  /** Volta à pergunta do e-mail. */
  onPress: () => void;
  /** Enquanto a senha está sendo enviada. */
  disabled?: boolean;
}

// A pílula desenhada, no meio do alvo de 44.
const PILL_HEIGHT = 32;
const MAIL_ICON_SIZE = 14;
const PENCIL_ICON_SIZE = 13;

// O texto do campo escondido: quase transparente, e não transparente. Com alfa
// zero o React Native trata a cor como "sem cor" (`isColorMeaningful`) e o
// Android desenha o campo desativado no cinza do tema: o e-mail aparecia
// dobrado atrás do texto da pílula (visto no emulador). A 1%, a cor vale e
// não se enxerga.
const HIDDEN_FIELD_ALPHA = 0.01;

/**
 * O e-mail da pergunta anterior, em cima da pergunta da senha: o fã confere com
 * que e-mail está entrando (ou criando a conta), e um toque volta para trocá-lo.
 *
 * Por baixo do texto vai um campo nativo só de leitura com o mesmo e-mail,
 * marcado como o nome de usuário: assim o gerenciador de senhas do aparelho
 * enxerga e-mail e senha na mesma tela e guarda (ou sugere) a senha com o
 * e-mail certo, mesmo com as duas perguntas em telas separadas. O campo não
 * aparece (texto quase transparente, e não opacidade zero nem fora da tela:
 * para o sistema, ele continua um campo à vista), não recebe toque nem foco e
 * some para o leitor de tela, que ouve o rótulo do botão ("Trocar o e-mail ...").
 *
 * Quem desenha o e-mail é o `Text`: cresce com a fonte e, sem caber, quebra a
 * linha em vez de cortar, e a pílula cresce junto. O campo de uma linha
 * cortaria o fim do e-mail.
 */
export function EmailPill({ email, onPress, disabled = false }: EmailPillProps) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={t('auth.emailPill', { email })}
      style={[styles.target, disabled && styles.inactive]}
    >
      <View style={styles.pill}>
        <Icon icon={Mail} size={MAIL_ICON_SIZE} color={colors.textBody} />
        <View style={styles.email}>
          <View
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={StyleSheet.absoluteFill}
          >
            <NativeTextInput
              value={email}
              editable={false}
              autoComplete="username"
              textContentType="username"
              style={styles.field}
            />
          </View>
          <Text variant="tabItem" color={colors.textBody} style={styles.label}>
            {email}
          </Text>
        </View>
        <Icon icon={Pencil} size={PENCIL_ICON_SIZE} color={colors.textSubtle} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // O alvo de 44 é o próprio pressável: no Fabric do iOS, o hitSlop fora do
  // pai não recebe toque. Nunca passa da largura da pergunta.
  target: {
    minHeight: layout.minTouchTarget,
    maxWidth: '100%',
    justifyContent: 'center',
  },
  inactive: {
    opacity: opacities.disabled,
  },
  // Altura mínima, e não fixa: com a fonte grande ou o e-mail em duas linhas,
  // a pílula cresce, com uma folga entre o texto e a borda.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.chipGap,
    minHeight: PILL_HEIGHT,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.rowGap,
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
    borderColor: colors.borderGlass,
    backgroundColor: colors.glass,
  },
  // E-mail mais largo que a pergunta: o texto encolhe e quebra, e os ícones ficam inteiros.
  email: {
    flexShrink: 1,
  },
  // Do tamanho do texto que ele acompanha, sem a folga que o tema do Android põe em todo campo.
  field: {
    flex: 1,
    padding: 0,
    color: withAlpha(colors.text, HIDDEN_FIELD_ALPHA),
  },
  label: {
    textAlign: 'center',
  },
});
