import { render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { t } from '@/i18n';
import { colors, motion } from '@/theme';

import { PointsPill } from '..';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

let timing: jest.SpyInstance;
let cancel: jest.SpyInstance;

beforeEach(() => {
  mockReducedMotion = false;
  timing = jest.spyOn(Reanimated, 'withTiming');
  cancel = jest.spyOn(Reanimated, 'cancelAnimation');
});

afterEach(() => {
  jest.restoreAllMocks();
});

const balance = (points: string) => t('components.pointsPill.label', { points });

describe('PointsPill', () => {
  it('mostra o saldo formatado em ink sobre o lima', () => {
    render(<PointsPill testID="pill" value={12480} />);
    expect(screen.getByTestId('pill')).toHaveStyle({ backgroundColor: colors.points });
    expect(screen.getByText('12.480')).toHaveStyle({ color: colors.onPoints });
  });

  it('o leitor ouve um elemento só com o saldo, sem papel próprio', () => {
    render(<PointsPill testID="pill" value={12480} />);
    const pill = screen.getByLabelText(balance('12.480'));
    expect(pill).toHaveProp('accessible', true);
    expect(pill.props.accessibilityRole).toBeUndefined();
  });

  it('saldo de 1 ponto usa o singular', () => {
    render(<PointsPill value={1} />);
    expect(screen.getByLabelText(t('components.pointsPill.labelOne'))).toBeTruthy();
  });

  it('carregando, mostra reticências e avisa o leitor que está ocupado', () => {
    render(<PointsPill testID="pill" value={null} />);
    expect(screen.getByText('…')).toBeTruthy();
    const pill = screen.getByTestId('pill');
    expect(pill).toHaveProp('accessibilityLabel', t('components.pointsPill.loading'));
    expect(pill).toBeBusy();
  });

  it('o saldo que chega depois do carregamento aparece direto', () => {
    const { rerender } = render(<PointsPill value={null} />);
    rerender(<PointsPill value={12480} />);
    expect(screen.getByText('12.480')).toBeTruthy();
  });

  it('o leitor ouve o saldo novo na hora, enquanto o número ainda conta', () => {
    const { rerender } = render(<PointsPill testID="pill" value={12480} />);
    rerender(<PointsPill testID="pill" value={6480} />);
    expect(screen.getByTestId('pill')).toHaveProp('accessibilityLabel', balance('6.480'));
  });

  it('quando o saldo muda, o número conta até o novo no tempo do contador', () => {
    const { rerender } = render(<PointsPill value={12480} />);
    timing.mockClear();
    rerender(<PointsPill value={6480} />);
    expect(timing).toHaveBeenCalledWith(
      6480,
      expect.objectContaining({ duration: motion.duration.counter, easing: motion.easing.out }),
    );
  });

  it('com reduzir movimento, o número troca direto, sem contar', () => {
    mockReducedMotion = true;
    const { rerender } = render(<PointsPill value={12480} />);
    rerender(<PointsPill value={6480} />);
    expect(screen.getByText('6.480')).toBeTruthy();
    expect(screen.queryByText('12.480')).toBeNull();
    expect(timing).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });
});
