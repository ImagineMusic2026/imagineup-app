import { fireEvent, render, screen } from '@testing-library/react-native';

import { Text } from '@/components/text';
import { t } from '@/i18n';
import { layout } from '@/theme';

import { BackHeader } from '..';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

describe('BackHeader', () => {
  it('fica com a altura do alvo de toque, com o título central como header', () => {
    render(<BackHeader title="Post" />);
    const title = screen.getByRole('header', { name: 'Post' });
    expect(title).toHaveStyle({ textAlign: 'center' });
    expect(screen.getByLabelText(t('common.back'))).toHaveStyle({
      height: layout.minTouchTarget,
    });
  });

  it('o voltar usa a ação da tela quando ela passa uma', () => {
    const onBack = jest.fn();
    render(<BackHeader onBack={onBack} />);
    fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(onBack).toHaveBeenCalled();
  });

  it('com leading="close", o "×" de fechar fica à esquerda, colado na margem, e a ação à direita', () => {
    const onBack = jest.fn();
    render(
      <BackHeader
        title="Editar perfil"
        leading="close"
        onBack={onBack}
        right={<Text>ação</Text>}
      />,
    );
    expect(screen.queryByLabelText(t('common.back'))).toBeNull();
    const close = screen.getByRole('button', { name: t('common.close') });
    expect(close).toHaveStyle({ alignItems: 'flex-start' });
    // O "Fechar" vem antes do título e da ação na ordem de leitura.
    const order = screen.root.findAll(
      (node) =>
        node.props.accessibilityLabel === t('common.close') ||
        node.props.children === 'Editar perfil' ||
        node.props.children === 'ação',
      { deep: true },
    );
    expect(order.map((node) => node.props.accessibilityLabel ?? node.props.children)[0]).toBe(
      t('common.close'),
    );
    fireEvent.press(close);
    expect(onBack).toHaveBeenCalled();
  });

  it('backDisabled desliga o botão da esquerda, para o leitor também', () => {
    const onBack = jest.fn();
    render(<BackHeader title="Editar perfil" leading="close" onBack={onBack} backDisabled />);
    const close = screen.getByRole('button', { name: t('common.close') });
    expect(close).toBeDisabled();
    fireEvent.press(close);
    expect(onBack).not.toHaveBeenCalled();
  });
});
