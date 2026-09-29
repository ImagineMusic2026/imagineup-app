import { fireEvent, render, screen } from '@testing-library/react-native';

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
});
