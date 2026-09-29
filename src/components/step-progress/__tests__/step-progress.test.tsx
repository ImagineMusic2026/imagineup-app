import { render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { t } from '@/i18n';
import { colors, motion } from '@/theme';

import { StepProgress } from '..';

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

const fillsCurrentStep = () =>
  expect(timing).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ duration: motion.duration.slow, easing: motion.easing.out }),
  );

describe('StepProgress', () => {
  it('o leitor ouve um elemento só, com a etapa e o total', () => {
    render(<StepProgress total={3} current={2} />);
    const bar = screen.getByRole('progressbar', {
      name: t('components.stepProgress.label', { current: 2, total: 3 }),
    });
    expect(bar).toHaveAccessibilityValue({ min: 0, max: 3, now: 2 });
  });

  it('a etapa feita fica cheia em rosa, a atual enche e a seguinte fica vazia', () => {
    render(<StepProgress testID="steps" total={3} current={2} />);
    expect(screen.getByTestId('steps-step-1')).toHaveStyle({
      width: '100%',
      backgroundColor: colors.accent,
    });
    expect(screen.getByTestId('steps-step-2')).toHaveStyle({ width: '0%' });
    expect(screen.queryByTestId('steps-step-3')).toBeNull();
    fillsCurrentStep();
  });

  it('a etapa nova enche de novo quando o fã avança', () => {
    const { rerender } = render(<StepProgress total={3} current={1} />);
    timing.mockClear();
    rerender(<StepProgress total={3} current={2} />);
    fillsCurrentStep();
  });

  it('com reduzir movimento, a etapa atual já nasce cheia', () => {
    mockReducedMotion = true;
    render(<StepProgress testID="steps" total={2} current={2} />);
    expect(screen.getByTestId('steps-step-2')).toHaveStyle({ width: '100%' });
    expect(timing).not.toHaveBeenCalled();
  });

  it('etapa além do total fica no limite', () => {
    render(<StepProgress total={3} current={5} />);
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ now: 3, max: 3 });
  });
});
