import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { gradients, type ScrimPreset } from '@/theme';

import { Scrim } from '..';

const presets = Object.keys(gradients.scrims) as ScrimPreset[];

describe('Scrim', () => {
  it.each(presets)('o véu %s usa as cores e as paradas do protótipo', (preset) => {
    render(<Scrim preset={preset} />);
    const gradient = screen.UNSAFE_getByType(LinearGradient);
    expect(gradient.props.colors).toEqual(gradients.scrims[preset].colors);
    expect(gradient.props.locations).toEqual(gradients.scrims[preset].locations);
  });

  it('nenhum véu usa a string "transparent", que no iOS cria uma faixa cinza', () => {
    for (const preset of presets) {
      expect(gradients.scrims[preset].colors).not.toContain('transparent');
    }
  });

  it('cobre o pai, não recebe toque e fica oculto do leitor de tela', () => {
    render(<Scrim preset="cover" />);
    const gradient = screen.UNSAFE_getByType(LinearGradient);
    expect(gradient.props.pointerEvents).toBe('none');
    expect(StyleSheet.flatten(gradient.props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      bottom: 0,
    });
    expect(isHiddenFromAccessibility(gradient)).toBe(true);
  });

  it('aceita a caixa do rodapé fixo por cima do padrão', () => {
    render(<Scrim preset="bottomBar" style={{ top: 12 }} />);
    const gradient = screen.UNSAFE_getByType(LinearGradient);
    expect(StyleSheet.flatten(gradient.props.style)).toMatchObject({ top: 12 });
  });
});
