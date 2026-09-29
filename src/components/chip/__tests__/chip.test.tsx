import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { haptics } from '@/services/haptics';
import { colors, layout } from '@/theme';

import { Chip } from '..';

jest.mock('@/services/haptics', () => ({ haptics: { trigger: jest.fn() } }));

describe('Chip', () => {
  beforeEach(() => {
    jest.mocked(haptics.trigger).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('no iOS é botão com "selecionado" e o texto visível como nome', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(<Chip label="Geral" selected onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Geral', selected: true })).toBeOnTheScreen();
  });

  it('no Android, na seleção única, é aba', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<Chip label="Nenho" selected={false} onPress={jest.fn()} />);
    expect(screen.getByRole('tab', { name: 'Nenho', selected: false })).toBeOnTheScreen();
  });

  it('no Android, na seleção múltipla, é caixa de marcar', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<Chip label="Nenho" selected mode="multiple" onPress={jest.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'Nenho', checked: true })).toBeOnTheScreen();
  });

  it('as duas camadas do rótulo viram um nome só, com a dica de quem chama', () => {
    render(
      <Chip
        testID="chip"
        label="Junho"
        selected={false}
        onPress={jest.fn()}
        accessibilityHint="Mostra os shows de junho"
      />,
    );
    const chip = screen.getByTestId('chip');
    expect(screen.getAllByText('Junho')).toHaveLength(2);
    expect(chip).toHaveAccessibleName('Junho');
    expect(chip).toHaveProp('accessibilityHint', 'Mostra os shows de junho');
  });

  it('o alvo de toque tem 44 mesmo com o desenho de 28', () => {
    render(<Chip testID="chip" label="Pop" selected={false} onPress={jest.fn()} />);
    expect(screen.getByTestId('chip')).toHaveStyle({
      minHeight: layout.minTouchTarget,
      minWidth: layout.minTouchTarget,
    });
  });

  it('escolhido acende o fundo branco e apaga o rótulo cinza; o outro, o contrário', () => {
    const { rerender } = render(
      <Chip testID="chip" label="Geral" selected={false} onPress={jest.fn()} />,
    );
    expect(screen.getByTestId('chip-fill')).toHaveStyle({
      opacity: 0,
      backgroundColor: colors.inverse,
    });
    expect(screen.getByTestId('chip-rest-label')).toHaveStyle({ opacity: 1 });

    rerender(<Chip testID="chip" label="Geral" selected onPress={jest.fn()} />);
    expect(screen.getByTestId('chip-fill')).toHaveStyle({ opacity: 1 });
    expect(screen.getByTestId('chip-rest-label')).toHaveStyle({ opacity: 0 });
  });

  it('tocar avisa quem chama, com o toque de seleção', () => {
    const onPress = jest.fn();
    render(<Chip label="Nenho" selected={false} onPress={onPress} />);
    fireEvent.press(screen.getByRole('button', { name: 'Nenho' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
  });

  it('na seleção única, tocar no escolhido não vibra', () => {
    render(<Chip label="Geral" selected onPress={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Geral' }));
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('na seleção múltipla, desmarcar também vibra', () => {
    render(<Chip label="Nenho" selected mode="multiple" onPress={jest.fn()} />);
    fireEvent.press(screen.getByRole('button', { name: 'Nenho' }));
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
  });
});
