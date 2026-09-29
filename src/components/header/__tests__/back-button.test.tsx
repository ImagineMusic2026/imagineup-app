import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { t } from '@/i18n';
import { layout } from '@/theme';

import { BackButton } from '..';

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

  it('a ação própria substitui a volta padrão', () => {
    const onPress = jest.fn();
    render(<BackButton onPress={onPress} />);
    fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(onPress).toHaveBeenCalled();
    expect(mockedRouter.back).not.toHaveBeenCalled();
  });
});
