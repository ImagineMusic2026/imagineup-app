import { fireEvent, render, screen } from '@testing-library/react-native';
import { Check } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { layout, opacities } from '@/theme';

import { HeaderIconButton } from '..';

describe('HeaderIconButton', () => {
  it('é um botão só, com o rótulo de quem chama, alvo de 44 e o círculo de 36 colado no fim', () => {
    const onPress = jest.fn();
    render(<HeaderIconButton icon={Check} onPress={onPress} accessibilityLabel="Salvar" />);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toHaveStyle({
      width: layout.minTouchTarget,
      height: layout.minTouchTarget,
      alignItems: 'flex-end',
    });
    const circles = screen.UNSAFE_getAllByType(View).filter((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.width === layout.headerButtonSize && style.height === layout.headerButtonSize;
    });
    expect(circles).toHaveLength(1);
    // O ícone é decorativo: quem fala é o botão.
    expect(screen.UNSAFE_getByType(Check).props.accessibilityElementsHidden).toBe(true);
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('desligado: apagado, sem toque e dito desativado', () => {
    const onPress = jest.fn();
    render(
      <HeaderIconButton icon={Check} onPress={onPress} accessibilityLabel="Salvar" disabled />,
    );
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ opacity: opacities.disabled });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ocupado: o indicador no lugar do ícone, sem toque, e o leitor ouve que está ocupado', () => {
    const onPress = jest.fn();
    render(<HeaderIconButton icon={Check} onPress={onPress} accessibilityLabel="Salvar" busy />);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toBeBusy();
    expect(screen.UNSAFE_queryByType(Check)).toBeNull();
    expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    // Ocupado não fica apagado: o indicador é o retorno do toque.
    expect(StyleSheet.flatten(button.props.style).opacity).toBeUndefined();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
