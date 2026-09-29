import { render, screen } from '@testing-library/react-native';
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { blur, blurFallback, colors, radii } from '@/theme';
import { withAlpha } from '@/utils/color';

import { Glass } from '..';

/** Fundos pintados dentro do vidro (a camada de cor fica sob o conteúdo). */
function paintedBackgrounds(): unknown[] {
  return screen
    .UNSAFE_getAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style)?.backgroundColor)
    .filter(Boolean);
}

describe('Glass', () => {
  afterEach(() => jest.restoreAllMocks());

  it('no iOS desfoca com a intensidade do papel e tinge por cima', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(<Glass strength="badge" tone="darkStrong" />);

    const blurView = screen.UNSAFE_getByType(BlurView);
    expect(blurView.props.intensity).toBe(blur.badge);
    expect(blurView.props.tint).toBe('dark');
    expect(paintedBackgrounds()).toContain(colors.glassDarkStrong);
  });

  it.each([
    ['dark', blurFallback.glassDark],
    ['darkStrong', blurFallback.glassDarkStrong],
  ] as const)('no Android, sem blur, o vidro %s fica mais opaco', (tone, alpha) => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<Glass tone={tone} />);

    expect(screen.UNSAFE_queryByType(BlurView)).toBeNull();
    expect(paintedBackgrounds()).toContain(withAlpha(colors.background, alpha));
  });

  it('o vidro claro mantém o fundo nos dois sistemas', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    render(<Glass tone="light" />);
    expect(paintedBackgrounds()).toContain(colors.glass);
  });

  it.each([
    ['light', 'glass', colors.borderGlassStrong],
    ['darkStrong', 'badge', colors.borderOutline],
    ['dark', 'glass', colors.borderGlass],
  ] as const)('a borda padrão segue o papel (%s, %s)', (tone, strength, borderColor) => {
    render(<Glass tone={tone} strength={strength} testID="vidro" />);
    expect(screen.getByTestId('vidro')).toHaveStyle({ borderColor });
  });

  it('aceita raio e borda de quem chama', () => {
    render(<Glass radius={radii.sm} borderColor={colors.transparent} testID="vidro" />);
    expect(screen.getByTestId('vidro')).toHaveStyle({
      borderRadius: radii.sm,
      borderColor: colors.transparent,
    });
  });

  it('desfoque e cor não recebem toque; o conteúdo aparece por cima', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    render(
      <Glass>
        <Text>21 JUN</Text>
      </Glass>,
    );

    expect(screen.getByText('21 JUN')).toBeOnTheScreen();
    expect(screen.UNSAFE_getByType(BlurView).props.pointerEvents).toBe('none');
  });
});
