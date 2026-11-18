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

  it('com delay, a etapa atual espera antes de encher (a entrada da pilha, na 1l)', () => {
    const delayed = jest.spyOn(Reanimated, 'withDelay');
    render(<StepProgress total={2} current={2} delay={motion.duration.slow} />);
    expect(delayed).toHaveBeenCalledWith(motion.duration.slow, expect.anything());
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

/**
 * O caminho do enchimento: tudo o que o valor animado recebeu, na ordem. O
 * mock do Reanimated cria o valor de novo a cada render; aqui ele é um só
 * enquanto o teste dura, como no app, e o `withTiming` do mock devolve o
 * destino na hora.
 */
function recordFill(): number[] {
  const path: number[] = [];
  let value: number | undefined;
  const shared = {
    get: () => value,
    set: (next: number) => {
      value = next;
      path.push(next);
    },
  } as unknown as Reanimated.SharedValue<unknown>;
  jest.spyOn(Reanimated, 'useSharedValue').mockImplementation((initial) => {
    value ??= initial as number;
    return shared;
  });
  return path;
}

describe('StepProgress com a etapa enchendo aos poucos (as perguntas do cadastro)', () => {
  it('a etapa atual enche só até o pedido, e a seguinte continua vazia', () => {
    render(<StepProgress testID="steps" total={2} current={1} currentFill={1 / 3} />);
    expect(screen.getByTestId('steps-step-1')).toHaveStyle({
      width: '0%',
      backgroundColor: colors.accent,
    });
    expect(screen.queryByTestId('steps-step-2')).toBeNull();
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(
      1 / 3,
      expect.objectContaining({ duration: motion.duration.slow, easing: motion.easing.out }),
    );
  });

  it('o leitor continua ouvindo só a etapa e o total', () => {
    render(<StepProgress total={2} current={1} currentFill={1 / 3} />);
    const bar = screen.getByRole('progressbar', {
      name: t('components.stepProgress.label', { current: 1, total: 2 }),
    });
    expect(bar).toHaveAccessibilityValue({ min: 0, max: 2, now: 1 });
  });

  it('pergunta nova na mesma etapa: segue de onde está, sem voltar a zero nem esperar de novo', () => {
    const path = recordFill();
    const delayed = jest.spyOn(Reanimated, 'withDelay');
    const { rerender } = render(
      <StepProgress total={2} current={1} currentFill={1 / 3} delay={motion.duration.slow} />,
    );
    expect(path).toEqual([0, 1 / 3]);
    expect(delayed).toHaveBeenCalledTimes(1);

    rerender(
      <StepProgress total={2} current={1} currentFill={2 / 3} delay={motion.duration.slow} />,
    );
    expect(path).toEqual([0, 1 / 3, 2 / 3]);
    expect(delayed).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenLastCalledWith(
      2 / 3,
      expect.objectContaining({ duration: motion.duration.slow, easing: motion.easing.out }),
    );
  });

  it('o fã volta uma pergunta: o enchimento recua de onde está', () => {
    const path = recordFill();
    const { rerender } = render(<StepProgress total={2} current={1} currentFill={1} />);
    rerender(<StepProgress total={2} current={1} currentFill={2 / 3} />);
    expect(path).toEqual([0, 1, 2 / 3]);
  });

  it('a tela redesenhada com os mesmos valores (o fã digitando) não mexe no enchimento', () => {
    const path = recordFill();
    const { rerender } = render(<StepProgress total={2} current={1} currentFill={1 / 3} />);
    rerender(<StepProgress total={2} current={1} currentFill={1 / 3} />);
    expect(path).toEqual([0, 1 / 3]);
  });

  it('etapa nova enche do zero, mesmo com o enchimento mudando junto', () => {
    const path = recordFill();
    const { rerender } = render(<StepProgress total={2} current={1} currentFill={1} />);
    rerender(<StepProgress total={2} current={2} currentFill={0.5} />);
    expect(path).toEqual([0, 1, 0, 0.5]);
  });

  it('só o enchimento novo continua de onde está: a espera trocada recomeça do zero, como sempre', () => {
    const path = recordFill();
    const { rerender } = render(<StepProgress total={2} current={1} currentFill={0.5} />);
    rerender(<StepProgress total={2} current={1} currentFill={0.5} delay={motion.duration.slow} />);
    expect(path).toEqual([0, 0.5, 0, 0.5]);
  });

  it('sem o valor, tudo como sempre: a etapa enche inteira, e a nova recomeça do zero depois da espera', () => {
    const path = recordFill();
    const delayed = jest.spyOn(Reanimated, 'withDelay');
    const { rerender } = render(
      <StepProgress total={2} current={1} delay={motion.duration.slow} />,
    );
    rerender(<StepProgress total={2} current={2} delay={motion.duration.slow} />);
    expect(path).toEqual([0, 1, 0, 1]);
    expect(delayed.mock.calls.map(([wait]) => wait)).toEqual([
      motion.duration.slow,
      motion.duration.slow,
    ]);
  });

  it('com reduzir movimento, nasce no enchimento pedido e troca sem animar', () => {
    mockReducedMotion = true;
    const { rerender } = render(
      <StepProgress testID="steps" total={2} current={1} currentFill={0.5} />,
    );
    expect(screen.getByTestId('steps-step-1')).toHaveStyle({ width: '50%' });

    rerender(<StepProgress testID="steps" total={2} current={1} currentFill={0.75} />);
    expect(screen.getByTestId('steps-step-1')).toHaveStyle({ width: '75%' });
    expect(timing).not.toHaveBeenCalled();
  });

  it.each([
    [1.4, 1],
    [-0.2, 0],
  ])('enchimento fora de 0 a 1 (%s) fica no limite', (value, limit) => {
    render(<StepProgress total={2} current={1} currentFill={value} />);
    expect(timing).toHaveBeenCalledWith(limit, expect.anything());
  });
});
