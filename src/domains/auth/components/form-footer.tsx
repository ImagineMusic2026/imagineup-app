import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { colors, spacing } from '@/theme';

export interface FormFooterProps {
  /** "Ainda não tem conta?" */
  question: string;
  /** "Criar conta", em rosa, com alvo de 44. */
  actionLabel: string;
  onAction: () => void;
  /** Enquanto a conta está sendo criada, a troca de tela fica parada. */
  disabled?: boolean;
}

/**
 * Rodapé das telas de conta, que troca entre entrar e criar conta. A ação é um
 * link avulso (alvo de 44) ao lado da pergunta, e não um trecho dentro do
 * texto, que ficaria pequeno demais para o dedo.
 */
export function FormFooter({ question, actionLabel, onAction, disabled }: FormFooterProps) {
  return (
    <View style={styles.row}>
      {/* Manrope 500 13 na proposta: o token de mesmo peso a 0,5 pt (regra 1.2 do plano). */}
      <Text variant="inputCompact" color={colors.textSecondary}>
        {question}
      </Text>
      <TextLink label={actionLabel} onPress={onAction} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    // O espaço entre a pergunta e a ação, como o espaço da frase no protótipo.
    columnGap: spacing.xs,
  },
});
