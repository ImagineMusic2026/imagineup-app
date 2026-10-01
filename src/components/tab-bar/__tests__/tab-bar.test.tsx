import { render, screen } from '@testing-library/react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { blur, blurFallback, colors, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { TabBar, type TabItem } from '..';

let mockPathname = '/';
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  usePathname: () => mockPathname,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

function item(key: string, label: string, focused = false): TabItem {
  return {
    key,
    label,
    accessibilityLabel: label,
    focused,
    renderIcon: () => null,
    onPress: jest.fn(),
    onLongPress: jest.fn(),
  };
}

const items = [item('inicio', 'Início', true), item('ranking', 'Ranking')];

function renderBar() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <TabBar items={items} />
    </SafeAreaProvider>,
  );
}

describe('TabBar', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockPathname = '/';
  });

  it('no iOS desfoca com a intensidade do tema, e só o desfoque é recortado', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    renderBar();
    const blurView = screen.UNSAFE_getByType(BlurView);
    expect(blurView.props.intensity).toBe(blur.tabBar);
    expect(StyleSheet.flatten(blurView.props.style)).toMatchObject({ overflow: 'hidden' });
    // A barra não recorta: o brilho do "+" passa da borda de cima.
    const bar = screen.root.find(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'tablist',
    );
    expect(StyleSheet.flatten(bar.props.style).overflow).toBeUndefined();
  });

  it('no iOS o degradê começa no .4 do protótipo, por cima do desfoque, e fecha aos 45%', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    renderBar();
    const gradient = screen.UNSAFE_getByType(LinearGradient);
    expect(gradient.props.colors[0]).toBe(withAlpha(colors.background, 0.4));
    expect(gradient.props.locations).toEqual([0, 0.45]);
  });

  it('no Android, que não desfoca, o degradê começa mais fechado para o conteúdo não vazar', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    renderBar();
    expect(screen.UNSAFE_queryByType(BlurView)).toBeNull();
    const gradient = screen.UNSAFE_getByType(LinearGradient);
    expect(gradient.props.colors).toEqual([
      withAlpha(colors.background, blurFallback.tabBar),
      colors.background,
    ]);
    // Sólido antes da linha dos ícones: o texto de baixo não aparece entre eles.
    expect(gradient.props.locations).toEqual([0, 0.2]);
  });

  it('no Ranking a barra fica sólida, sem desfoque', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockPathname = '/ranking';
    renderBar();
    expect(screen.UNSAFE_queryByType(BlurView)).toBeNull();
  });

  it('o rótulo da aba tem a entrelinha colada no corpo, como no protótipo', () => {
    renderBar();
    // 10 para o corpo de 9,5: a barra fica na altura do desenho.
    const lineHeight = Math.ceil(typography.tabLabel.fontSize);
    expect(typography.tabLabel.lineHeight).toBe(lineHeight);
    expect(typography.tabLabelActive.lineHeight).toBe(lineHeight);
    expect(screen.getByText('Início')).toHaveStyle({ lineHeight });
    expect(screen.getByText('Ranking')).toHaveStyle({ lineHeight });
  });

  it('a aba ativa segue marcada como selecionada', () => {
    renderBar();
    expect(screen.getByLabelText('Início')).toBeSelected();
    expect(screen.getByLabelText('Ranking')).not.toBeSelected();
  });
});
