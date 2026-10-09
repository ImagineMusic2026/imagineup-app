import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, layout } from '@/theme';

import { Switch } from '..';

const TRAVEL = layout.switch.width - layout.switch.height;

function styleOf(testID: string) {
  return StyleSheet.flatten(
    screen.getByTestId(testID, { includeHiddenElements: true }).props.style,
  );
}

describe('Switch', () => {
  it('é só o desenho: fica fora do leitor e não recebe toque (quem fala é a linha em volta)', () => {
    render(<Switch value={false} testID="switch" />);
    const track = screen.getByTestId('switch', { includeHiddenElements: true });
    expect(isHiddenFromAccessibility(track)).toBe(true);
    expect(track).toHaveProp('pointerEvents', 'none');
    expect(track).toHaveStyle({
      width: layout.switch.width,
      height: layout.switch.height,
      backgroundColor: colors.trackStrong,
    });
  });

  it('desligado: o rosa apagado e o polegar na esquerda', () => {
    render(<Switch value={false} testID="switch" />);
    expect(styleOf('switch-on')).toMatchObject({
      opacity: 0,
      backgroundColor: colors.accentStrong,
    });
    expect(styleOf('switch-thumb').transform).toEqual([{ translateX: 0 }]);
  });

  it('ligado: o trilho rosa e o polegar na direita, a 2 da borda', () => {
    render(<Switch value testID="switch" />);
    expect(styleOf('switch-on')).toMatchObject({ opacity: 1 });
    expect(styleOf('switch-thumb').transform).toEqual([{ translateX: TRAVEL }]);
  });
});
