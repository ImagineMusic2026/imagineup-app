import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { Pill } from '@/components/pill';
import { haptics } from '@/services/haptics';
import { colors, layout } from '@/theme';

import { PillButton } from '..';

describe('PillButton', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a pílula desenha pequena dentro de um alvo de 44', () => {
    render(<PillButton label="4.812" onPress={jest.fn()} accessibilityLabel="4.812 curtidas" />);

    expect(screen.getByRole('button', { name: '4.812 curtidas' })).toHaveStyle({
      minHeight: layout.minTouchTarget,
      minWidth: layout.minTouchTarget,
    });
  });

  it('é um elemento só para o leitor: o rótulo é de quem chama e a pílula não tem papel', () => {
    render(
      <PillButton
        label="Compartilhar +2"
        tone="points"
        onPress={jest.fn()}
        accessibilityLabel="Compartilhar, vale 2 pontos por visita"
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Compartilhar, vale 2 pontos por visita' }),
    ).toBeTruthy();
    const pill = screen.UNSAFE_getByType(Pill);
    expect(pill.props.accessibilityLabel).toBeUndefined();
  });

  it('sem rótulo, o leitor ouve o texto da pílula', () => {
    render(<PillButton label="Eu vou" onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Eu vou' })).toBeTruthy();
  });

  it('passa tom, tamanho e peça da esquerda para a pílula', () => {
    render(
      <PillButton
        label="4.813"
        size="md"
        leading={<View testID="coracao" />}
        onPress={jest.fn()}
        accessibilityLabel="Descurtir, 4.813 curtidas"
      />,
    );

    expect(screen.getByText('4.813')).toHaveStyle({ color: colors.textSecondary });
    expect(screen.getByTestId('coracao', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('coracao')).toBeNull();
  });

  it('o estado ligado chega ao leitor, como o curtir', () => {
    render(<PillButton label="4.813" selected onPress={jest.fn()} accessibilityLabel="Curtido" />);
    expect(screen.getByRole('button', { name: 'Curtido' })).toBeSelected();
  });

  it('o toque dispara a ação com o haptic pedido', () => {
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    const onPress = jest.fn();
    render(<PillButton label="327" haptic="selection" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: '327' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('selection');
  });

  it('desativado: apaga e não dispara', () => {
    const onPress = jest.fn();
    render(<PillButton label="Compartilhar +2" disabled onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Compartilhar +2' });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
