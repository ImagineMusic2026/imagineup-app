import { fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import type { TextInput as NativeTextInput } from 'react-native';

import { TextInput } from '@/components/text-input';
import { t } from '@/i18n';

import { PasswordField } from '../components/password-field';

jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

const LABEL = t('auth.password');
const SHOW = t('auth.showPassword');
const HIDE = t('auth.hidePassword');

/** A variante com que o campo compartilhado é desenhado. */
const variant = () => screen.UNSAFE_getByType(TextInput).props.variant;

describe('campo de senha das telas de conta', () => {
  it('sem dizer a variante, sai no vidro (trocar e-mail, trocar senha, excluir a conta)', () => {
    render(<PasswordField label={LABEL} />);
    expect(variant()).toBe('glass');
  });

  it('nas perguntas da entrada, sai na variante hero, com o olho e o resto do campo iguais', () => {
    render(
      <PasswordField
        label={LABEL}
        labelHidden
        variant="hero"
        placeholder={t('auth.passwordPlaceholder')}
        autoComplete="new-password"
      />,
    );
    expect(variant()).toBe('hero');
    expect(screen.getByLabelText(LABEL).props).toMatchObject({
      secureTextEntry: true,
      autoCapitalize: 'none',
      autoCorrect: false,
      autoComplete: 'new-password',
      placeholder: t('auth.passwordPlaceholder'),
    });
    expect(screen.getByRole('button', { name: SHOW })).toBeOnTheScreen();
  });

  it('a variante que a tela manda vazia não tira o vidro', () => {
    render(<PasswordField label={LABEL} variant={undefined} />);
    expect(variant()).toBe('glass');
  });

  it.each(['glass', 'hero'] as const)(
    '%s: o olho mostra e esconde a senha, e o rótulo dele diz o que o toque faz',
    (shape) => {
      render(<PasswordField label={LABEL} variant={shape} />);
      expect(screen.getByLabelText(LABEL)).toHaveProp('secureTextEntry', true);

      fireEvent.press(screen.getByRole('button', { name: SHOW }));
      expect(screen.getByLabelText(LABEL)).toHaveProp('secureTextEntry', false);

      fireEvent.press(screen.getByRole('button', { name: HIDE }));
      expect(screen.getByLabelText(LABEL)).toHaveProp('secureTextEntry', true);
    },
  );

  it('o ref chega ao campo nativo nas duas variantes, para o envio inválido levar o foco a ele', () => {
    const glass = createRef<NativeTextInput>();
    const hero = createRef<NativeTextInput>();
    render(
      <>
        <PasswordField ref={glass} label="Senha atual" />
        <PasswordField ref={hero} label="Senha nova" variant="hero" />
      </>,
    );
    expect(glass.current).toBeTruthy();
    expect(hero.current).toBeTruthy();
  });
});
