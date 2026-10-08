import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { layout } from '@/theme';

import { BackButton, goBack } from '..';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

const mockedRouter = jest.mocked(router);

beforeEach(() => jest.clearAllMocks());

describe('BackButton', () => {
  it('é um botão só para o leitor, com rótulo e alvo de 44', () => {
    render(<BackButton />);
    const [button, ...others] = screen.getAllByLabelText(t('common.back'));
    expect(others).toHaveLength(0);
    expect(button).toHaveProp('accessibilityRole', 'button');
    expect(button).toHaveStyle({ width: layout.minTouchTarget, height: layout.minTouchTarget });
  });

  it('desenha o círculo de 36 dentro do alvo, colado na margem', () => {
    render(<BackButton />);
    expect(screen.getByLabelText(t('common.back'))).toHaveStyle({ alignItems: 'flex-start' });
    const circles = screen.UNSAFE_getAllByType(View).filter((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.width === layout.headerButtonSize && style.height === layout.headerButtonSize;
    });
    expect(circles).toHaveLength(1);
  });

  it('sem ação própria, volta na pilha', () => {
    mockedRouter.canGoBack.mockReturnValue(true);
    render(<BackButton />);
    fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(mockedRouter.back).toHaveBeenCalled();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it('sem para onde voltar (link aberto a frio), vai ao início', () => {
    mockedRouter.canGoBack.mockReturnValue(false);
    render(<BackButton />);
    fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
  });

  it('desativado, não volta e diz ao leitor que está desativado', () => {
    const onPress = jest.fn();
    render(<BackButton onPress={onPress} disabled />);
    const button = screen.getByLabelText(t('common.back'));
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
  });

  it('a ação própria substitui a volta padrão', () => {
    const onPress = jest.fn();
    render(<BackButton onPress={onPress} />);
    fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(onPress).toHaveBeenCalled();
    expect(mockedRouter.back).not.toHaveBeenCalled();
  });

  it('no fechar, diz "Fechar" e cola o círculo no fim do alvo, junto da margem da direita', () => {
    mockedRouter.canGoBack.mockReturnValue(true);
    render(<BackButton variant="close" />);
    const button = screen.getByRole('button', { name: t('common.close') });
    expect(button).toHaveStyle({ alignItems: 'flex-end' });
    expect(screen.queryByLabelText(t('common.back'))).toBeNull();
    fireEvent.press(button);
    expect(mockedRouter.back).toHaveBeenCalled();
  });

  it('o fechar no começo da linha (a tela "Editar perfil") cola o círculo na margem da esquerda', () => {
    render(<BackButton variant="close" align="start" />);
    expect(screen.getByRole('button', { name: t('common.close') })).toHaveStyle({
      alignItems: 'flex-start',
    });
  });
});

describe('goBack', () => {
  it('volta na pilha quando há para onde voltar', () => {
    mockedRouter.canGoBack.mockReturnValue(true);
    goBack();
    expect(mockedRouter.back).toHaveBeenCalled();
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it('aberta a frio (a tela é a única da pilha), vai ao início', () => {
    mockedRouter.canGoBack.mockReturnValue(false);
    goBack();
    expect(mockedRouter.back).not.toHaveBeenCalled();
    expect(mockedRouter.replace).toHaveBeenCalledWith('/');
  });
});
