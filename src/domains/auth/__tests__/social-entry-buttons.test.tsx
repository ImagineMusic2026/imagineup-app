import { act, fireEvent, render, screen } from '@testing-library/react-native';
import {
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';

import { t } from '@/i18n';

import { SocialEntryButtons } from '../components/social-entry-buttons';

/**
 * Os botões de provedor da pergunta do e-mail (seção 39 de
 * docs/arquitetura-api.md): o botão nativo da Apple, com o rótulo do sistema e
 * um foco só, o do Google de antes, o aviso dos Termos uma vez só e os estados
 * de desligado e de ocupado. O botão da Apple é o falso do `jest.setup.js`, com
 * o rótulo que o sistema escreveria.
 */

const APPLE_LABEL = 'Continuar com a Apple';
const GOOGLE_LABEL = t('auth.google.continue');

const appleButton = () => screen.getByRole('button', { name: APPLE_LABEL });
const termsLinks = () => [
  ...screen.queryAllByRole('link', { name: t('auth.terms.termsLink') }),
  ...screen.queryAllByRole('link', { name: t('auth.terms.privacyLink') }),
];
const termsBox = () => screen.getByTestId('social-entry-terms', { includeHiddenElements: true });

function provider(loading = false) {
  return { onPress: jest.fn(), loading };
}

/** Desenha e espera a fonte do Google (o `useFonts` do botão muda o estado depois). */
async function show(element: ReactElement) {
  const view = render(element);
  await act(async () => undefined);
  return view;
}

describe('a Apple', () => {
  it('um botão só, o nativo, com o Continuar, o branco, o raio do pé e 50 de altura', () => {
    render(
      <SocialEntryButtons google={null} apple={provider()} disabled={false} showTerms={false} />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    const button = appleButton();
    expect(button.props.buttonType).toBe(AppleAuthenticationButtonType.CONTINUE);
    expect(button.props.buttonStyle).toBe(AppleAuthenticationButtonStyle.WHITE);
    expect(button.props.cornerRadius).toBe(15);
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ height: 50 });
    // A caixa de fora não é um segundo foco para a mesma ação.
    const wrapper = screen.getByTestId('apple-button');
    expect(wrapper.props.accessible).toBeUndefined();
    expect(wrapper.props.accessibilityRole).toBeUndefined();
    expect(wrapper.props.accessibilityLabel).toBeUndefined();
  });

  it('o toque entra pela Apple', () => {
    const apple = provider();
    render(<SocialEntryButtons google={null} apple={apple} disabled={false} showTerms={false} />);

    fireEvent.press(appleButton());
    expect(apple.onPress).toHaveBeenCalledTimes(1);
  });

  it('desligada (outro envio em curso), o toque não faz nada, nem o que chega pelo leitor de tela', () => {
    const apple = provider();
    render(<SocialEntryButtons google={null} apple={apple} disabled showTerms={false} />);

    // A caixa tira o toque do dedo.
    expect(screen.getByTestId('apple-button').props.pointerEvents).toBe('none');
    // O botão nativo não desliga: o toque do VoiceOver chega direto a ele. (O
    // `fireEvent.press` do Testing Library, com o toque tirado, sobe até a prop
    // `onPress` do componente de fora, o que o aparelho nunca faz: por isso o
    // toque vai à prop do botão nativo.)
    appleButton().props.onPress();
    expect(apple.onPress).not.toHaveBeenCalled();
  });

  it('ocupada: a roda fica fora do leitor de tela, e o toque não faz nada', () => {
    const apple = provider(true);
    render(<SocialEntryButtons google={null} apple={apple} disabled={false} showTerms />);

    const overlay = screen.getByTestId('apple-button-loading', { includeHiddenElements: true });
    expect(overlay.props).toMatchObject({
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
      pointerEvents: 'none',
    });
    appleButton().props.onPress();
    expect(apple.onPress).not.toHaveBeenCalled();
  });
});

describe('o aviso dos Termos', () => {
  it('aparece só com o showTerms, uma vez', () => {
    const { rerender } = render(
      <SocialEntryButtons google={null} apple={provider()} disabled={false} showTerms={false} />,
    );
    expect(termsLinks()).toHaveLength(0);

    rerender(<SocialEntryButtons google={null} apple={provider()} disabled={false} showTerms />);
    expect(termsLinks()).toHaveLength(2);
  });

  it.each([
    ['com o envio do e-mail em curso', { disabled: true, appleLoading: false }],
    ['com outro provedor em curso', { disabled: false, appleLoading: true }],
  ])('%s, sai do toque e dos dois leitores de tela', async (_, { disabled, appleLoading }) => {
    const google = provider();
    await show(
      <SocialEntryButtons
        google={google}
        apple={provider(appleLoading)}
        disabled={disabled}
        showTerms
      />,
    );

    expect(termsBox().props).toMatchObject({
      pointerEvents: 'none',
      accessible: false,
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    fireEvent.press(screen.getByRole('button', { name: GOOGLE_LABEL }));
    expect(google.onPress).not.toHaveBeenCalled();
  });
});

describe('os provedores juntos', () => {
  it('a Apple antes do Google, e o aviso dos Termos uma vez só', async () => {
    await show(
      <SocialEntryButtons google={provider()} apple={provider()} disabled={false} showTerms />,
    );

    const labels = screen
      .getAllByRole('button')
      .map((button) => button.props.accessibilityLabel as string);
    expect(labels).toEqual([APPLE_LABEL, GOOGLE_LABEL]);
    expect(screen.getAllByRole('link', { name: t('auth.terms.termsLink') })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: t('auth.terms.privacyLink') })).toHaveLength(1);
  });

  it('sem provedor nenhum, nada', () => {
    render(<SocialEntryButtons google={null} apple={null} disabled={false} showTerms />);
    expect(screen.toJSON()).toBeNull();
  });

  it('só o Google (o Android): o rótulo e o ocupado de antes, e a Apple de fora', async () => {
    const google = provider();
    const { rerender } = await show(
      <SocialEntryButtons google={google} apple={null} disabled={false} showTerms />,
    );

    const button = screen.getByRole('button', { name: GOOGLE_LABEL });
    expect(button).not.toBeBusy();
    expect(screen.queryByTestId('apple-button')).toBeNull();
    fireEvent.press(button);
    expect(google.onPress).toHaveBeenCalledTimes(1);
    expect(termsBox().props.pointerEvents).toBe('auto');

    rerender(
      <SocialEntryButtons google={provider(true)} apple={null} disabled={false} showTerms />,
    );
    expect(screen.getByRole('button', { name: GOOGLE_LABEL })).toBeBusy();
    expect(termsBox().props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
