import { render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Reanimated from 'react-native-reanimated';

import { colors, gradients, layout, motion } from '@/theme';
import { withAlpha } from '@/utils/color';

import { ProgressBar } from '..';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

let timing: jest.SpyInstance;

beforeEach(() => {
  mockReducedMotion = false;
  timing = jest.spyOn(Reanimated, 'withTiming');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProgressBar', () => {
  it('com rótulo, o leitor ouve uma barra de progresso com a porcentagem', () => {
    render(<ProgressBar value={0.685} accessibilityLabel="Nível 7" />);
    const bar = screen.getByRole('progressbar', { name: 'Nível 7' });
    expect(bar).toHaveAccessibilityValue({ min: 0, max: 100, now: 69 });
  });

  it('o valor lido pode vir nas unidades da missão', () => {
    render(
      <ProgressBar
        value={3 / 5}
        accessibilityLabel="3 de 5 pessoas"
        accessibilityValue={{ min: 0, max: 5, now: 3 }}
      />,
    );
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 5, now: 3 });
  });

  it('sem rótulo, fica calada para o card em volta ler tudo num elemento só', () => {
    render(<ProgressBar testID="bar" value={0.6} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('bar').props.accessible).toBeUndefined();
  });

  it.each([
    [1.4, 100],
    [-0.2, 0],
  ])('valor fora de 0 a 1 (%s) fica no limite', (value, now) => {
    render(<ProgressBar value={value} accessibilityLabel="Progresso" />);
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now });
  });

  it('nasce vazia e cresce até o valor no tempo do contador, como o anel', () => {
    render(<ProgressBar testID="bar" value={0.6} />);
    expect(screen.getByTestId('bar-fill')).toHaveStyle({ width: '0%' });
    expect(timing).toHaveBeenCalledWith(
      0.6,
      expect.objectContaining({ duration: motion.duration.counter, easing: motion.easing.out }),
    );
  });

  it('anda até o valor novo quando ele muda', () => {
    const { rerender } = render(<ProgressBar value={0.6} />);
    timing.mockClear();
    rerender(<ProgressBar value={0.8} />);
    expect(timing).toHaveBeenCalledWith(
      0.8,
      expect.objectContaining({ duration: motion.duration.counter }),
    );
  });

  it('com reduzir movimento, já nasce no valor, sem animar', () => {
    mockReducedMotion = true;
    const { rerender } = render(<ProgressBar testID="bar" value={0.6} />);
    expect(screen.getByTestId('bar-fill')).toHaveStyle({ width: '60%' });
    rerender(<ProgressBar testID="bar" value={0.8} />);
    expect(timing).not.toHaveBeenCalled();
  });

  it('o padrão é o da barra de nível: trilho claro e gradiente rosa para lima', () => {
    render(<ProgressBar testID="bar" value={0.6} />);
    expect(screen.getByTestId('bar')).toHaveStyle({
      backgroundColor: colors.track,
      height: layout.progressBar.sm,
    });
    expect(screen.UNSAFE_getByType(LinearGradient).props.colors).toEqual(gradients.progress.colors);
  });

  it('sobre o lima, pinta trilho e parte cheia com as cores passadas', () => {
    render(
      <ProgressBar
        testID="bar"
        value={0.6}
        size="md"
        track={withAlpha(colors.onPoints, 0.16)}
        fill={colors.onPoints}
      />,
    );
    expect(screen.getByTestId('bar')).toHaveStyle({
      backgroundColor: withAlpha(colors.onPoints, 0.16),
      height: layout.progressBar.md,
    });
    expect(screen.getByTestId('bar-fill')).toHaveStyle({ backgroundColor: colors.onPoints });
    expect(screen.UNSAFE_queryByType(LinearGradient)).toBeNull();
  });
});
