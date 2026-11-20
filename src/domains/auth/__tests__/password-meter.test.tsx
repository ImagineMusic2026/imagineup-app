import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { t } from '@/i18n';
import { colors, layout, spacing, typography } from '@/theme';

import { PasswordMeter, passwordMeterStatus } from '../components/password-meter';
import type { PasswordStrength } from '../password-strength';
import { PASSWORD_MIN_LENGTH } from '../schemas';

const RULE = t('auth.signUp.passwordHint', { min: PASSWORD_MIN_LENGTH });
const LABELS = ['Curta', 'Boa', 'Forte'];

const ON = colors.accent;
const OFF = colors.trackStrong;

/** A cor de cada traço, da esquerda para a direita. */
function segments(): unknown[] {
  return screen.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        StyleSheet.flatten(node.props.style)?.height === layout.progressBar.xs,
    )
    .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor);
}

/** Os textos do medidor, que o leitor de tela não vê. */
const hidden = (text: string) => screen.queryByText(text, { includeHiddenElements: true });

describe('medidor da senha do cadastro', () => {
  it.each<[PasswordStrength, unknown[], string | null]>([
    ['empty', [OFF, OFF, OFF], null],
    ['short', [ON, OFF, OFF], 'Curta'],
    ['good', [ON, ON, OFF], 'Boa'],
    ['strong', [ON, ON, ON], 'Forte'],
  ])('%s: os traços acesos e a força em texto', (strength, lit, label) => {
    render(<PasswordMeter strength={strength} />);
    expect(segments()).toEqual(lit);
    for (const text of LABELS) {
      if (text === label) expect(hidden(text)).toBeTruthy();
      else expect(hidden(text)).toBeNull();
    }
  });

  it('acende em rosa: lima é só para pontos', () => {
    render(<PasswordMeter strength="strong" />);
    expect(segments()).not.toContain(colors.points);
  });

  it('a regra do formulário fica escrita à esquerda, em toda força, e a força em negrito à direita', () => {
    const { rerender } = render(<PasswordMeter strength="empty" />);
    expect(hidden(RULE)).toHaveStyle({ ...typography.caption, color: colors.textSecondary });

    rerender(<PasswordMeter strength="good" />);
    expect(hidden(RULE)).toBeTruthy();
    expect(hidden('Boa')).toHaveStyle({ ...typography.labelCompact, color: colors.text });
  });

  it('fica fora do leitor de tela: o texto chega pela dica do campo', () => {
    render(<PasswordMeter strength="good" />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
    expect(screen.queryByText(RULE)).toBeNull();
    expect(screen.queryByText('Boa')).toBeNull();
  });

  it('a folga até o campo vai na caixa do medidor', () => {
    render(<PasswordMeter strength="good" style={{ marginTop: spacing.md }} />);
    expect(screen.root).toHaveStyle({ marginTop: spacing.md });
  });
});

describe('o medidor na dica do campo da senha', () => {
  it('sem senha, só a regra', () => {
    expect(passwordMeterStatus('empty')).toBe('Pelo menos 6 caracteres.');
  });

  it.each<[PasswordStrength, string]>([
    ['short', 'Pelo menos 6 caracteres. Força da senha: Curta.'],
    ['good', 'Pelo menos 6 caracteres. Força da senha: Boa.'],
    ['strong', 'Pelo menos 6 caracteres. Força da senha: Forte.'],
  ])('%s: a regra e a força, o mesmo que o medidor mostra', (strength, status) => {
    expect(passwordMeterStatus(strength)).toBe(status);
  });
});
