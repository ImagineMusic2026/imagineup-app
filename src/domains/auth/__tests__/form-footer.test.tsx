import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { t } from '@/i18n';
import { colors, layout, typography } from '@/theme';

import { FormFooter, type FormFooterProps } from '../components/form-footer';

const QUESTION = t('auth.signIn.noAccount');
const ACTION = t('auth.signIn.createAccount');

function footer(props: Partial<FormFooterProps> = {}) {
  return <FormFooter question={QUESTION} actionLabel={ACTION} onAction={jest.fn()} {...props} />;
}

const action = () => screen.getByRole('button', { name: ACTION });

/** O sublinhado do rótulo da ação, se houver. */
const underline = () =>
  StyleSheet.flatten(screen.getByText(ACTION).props.style)?.textDecorationLine;

describe('rodapé que troca entre entrar e criar conta', () => {
  it('a pergunta em cinza e, ao lado, a ação num link avulso com alvo de 44', () => {
    render(footer());
    expect(screen.getByText(QUESTION)).toHaveStyle({ color: colors.textSecondary });
    expect(action()).toHaveStyle({ minHeight: layout.minTouchTarget });
  });

  it('sem dizer a cor, a ação sai em rosa, sem sublinhado', () => {
    render(footer());
    expect(screen.getByText(ACTION)).toHaveStyle({ ...typography.label, color: colors.accent });
    expect(underline()).toBeUndefined();
  });

  it('com o tom de texto, a ação sai em branco e negrito, também sem sublinhado', () => {
    render(footer({ linkTone: 'text' }));
    expect(screen.getByText(ACTION)).toHaveStyle({ ...typography.label, color: colors.text });
    expect(underline()).toBeUndefined();
  });

  it('o toque troca de tela', () => {
    const onAction = jest.fn();
    render(footer({ onAction, linkTone: 'text' }));
    fireEvent.press(action());
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('desativado (a conta sendo criada), não troca de tela', () => {
    const onAction = jest.fn();
    render(footer({ onAction, disabled: true }));
    fireEvent.press(action());
    expect(onAction).not.toHaveBeenCalled();
    expect(action()).toBeDisabled();
  });
});
