import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import Animated, * as Reanimated from 'react-native-reanimated';

import { motion } from '@/theme';

import { playStackExit, useStackFade, type FadingStack } from '../use-stack-fade';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

function FadingGroup({ stack }: { stack: FadingStack }) {
  const fade = useStackFade(stack);
  return (
    <Animated.View testID="group" onLayout={fade.onLayout} style={fade.style}>
      <View />
    </Animated.View>
  );
}

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 874 } } };

let timing: jest.SpyInstance;

beforeEach(() => {
  mockReducedMotion = false;
  timing = jest.spyOn(Reanimated, 'withTiming');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useStackFade', () => {
  it.each<FadingStack>(['auth', 'onboarding', 'tabs'])(
    'o grupo %s nasce apagado e entra do fundo escuro quando aparece na tela',
    (stack) => {
      render(<FadingGroup stack={stack} />);
      // Montado, mas ainda sem layout: a entrada espera, para não acontecer escondida.
      expect(screen.getByTestId('group')).toHaveStyle({ opacity: 0 });
      expect(timing).not.toHaveBeenCalled();

      fireEvent(screen.getByTestId('group'), 'layout', layout);
      expect(timing).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ duration: motion.duration.slow, easing: motion.easing.out }),
      );
    },
  );

  it('entra uma vez só, mesmo com outro layout (rotação, teclado)', () => {
    render(<FadingGroup stack="tabs" />);
    fireEvent(screen.getByTestId('group'), 'layout', layout);
    fireEvent(screen.getByTestId('group'), 'layout', layout);
    expect(timing).toHaveBeenCalledTimes(1);
  });

  it('a saída apaga a pilha montada e só resolve quando ela some', async () => {
    jest.useFakeTimers();
    render(<FadingGroup stack="onboarding" />);
    fireEvent(screen.getByTestId('group'), 'layout', layout);
    timing.mockClear();

    let done = false;
    void playStackExit('onboarding').then(() => {
      done = true;
    });
    expect(timing).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ duration: motion.duration.base }),
    );
    await act(async () => {
      jest.advanceTimersByTime(motion.duration.base - 1);
    });
    expect(done).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(done).toBe(true);
  });

  it('com reduzir movimento, nasce inteira e sai na hora', async () => {
    mockReducedMotion = true;
    render(<FadingGroup stack="tabs" />);
    expect(screen.getByTestId('group')).toHaveStyle({ opacity: 1 });
    fireEvent(screen.getByTestId('group'), 'layout', layout);
    expect(timing).not.toHaveBeenCalled();
    await expect(playStackExit('tabs')).resolves.toBeUndefined();
  });

  it('sem a pilha montada, a saída resolve na hora', async () => {
    await expect(playStackExit('auth')).resolves.toBeUndefined();
  });
});
