import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import { t, type TranslationKey } from '@/i18n';
import { colors, layout, radii, spacing } from '@/theme';

import type { PasswordStrength } from '../password-strength';
import { PASSWORD_MIN_LENGTH } from '../schemas';

export interface PasswordMeterProps {
  strength: PasswordStrength;
  /** Vai na caixa do medidor (a folga até o campo). */
  style?: StyleProp<ViewStyle>;
}

// Quantos dos três traços cada força acende.
const SEGMENT_COUNT = 3;
const FILLED: Record<PasswordStrength, number> = { empty: 0, short: 1, good: 2, strong: 3 };

const LABELS: Record<Exclude<PasswordStrength, 'empty'>, TranslationKey> = {
  short: 'auth.signUp.strength.short',
  good: 'auth.signUp.strength.good',
  strong: 'auth.signUp.strength.strong',
};

const rule = (): string => t('auth.signUp.passwordHint', { min: PASSWORD_MIN_LENGTH });

/**
 * O que o medidor mostra, numa frase para o leitor de tela: a regra e, com
 * senha digitada, a força ("Pelo menos 6 caracteres. Força da senha: Boa.").
 * Vai no `accessibilityStatus` do campo da senha, porque o medidor não fala.
 */
export function passwordMeterStatus(strength: PasswordStrength): string {
  if (strength === 'empty') return rule();
  return `${rule()} ${t('auth.signUp.strength.status', { level: t(LABELS[strength]) })}`;
}

/**
 * Medidor da senha do cadastro, embaixo do campo: três traços que acendem em
 * rosa (lima é só para pontos, e não há verde no app) e, na linha de baixo, a
 * regra do formulário à esquerda e a força em texto à direita. É só um apoio
 * visual: a regra continua sendo o mínimo de caracteres, e o texto é a mesma
 * informação dos traços, para quem não distingue a cor.
 *
 * Fica fora do leitor de tela: o mesmo texto chega pela dica do campo
 * (`passwordMeterStatus`), e lido aqui seria dito duas vezes.
 */
export function PasswordMeter({ strength, style }: PasswordMeterProps) {
  const filled = FILLED[strength];
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.container, style]}
    >
      <View style={styles.segments}>
        {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
          <View key={index} style={[styles.segment, index < filled && styles.segmentFilled]} />
        ))}
      </View>
      <View style={styles.caption}>
        <Text variant="caption" color={colors.textSecondary} style={styles.rule}>
          {rule()}
        </Text>
        {strength === 'empty' ? null : <Text variant="labelCompact">{t(LABELS[strength])}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  segments: {
    flexDirection: 'row',
    gap: spacing.iconLabelGap,
  },
  segment: {
    flex: 1,
    height: layout.progressBar.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.trackStrong,
  },
  segmentFilled: {
    backgroundColor: colors.accent,
  },
  // A regra e a força na mesma linha de base, cada uma numa ponta.
  caption: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // Com a fonte grande, a regra quebra e a força segue inteira à direita.
  rule: {
    flexShrink: 1,
  },
});
