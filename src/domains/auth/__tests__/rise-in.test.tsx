import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { createStackEntrance, type StackEntranceTrigger } from '@/hooks/use-stack-fade';
import { motion } from '@/theme';

import { RiseIn } from '../components/rise-in';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

let entrance: StackEntranceTrigger;

beforeEach(() => {
  entrance = createStackEntrance();
});

function block(order: number) {
  return (
    <RiseIn order={order} entrance={entrance}>
      <Text>bloco</Text>
    </RiseIn>
  );
}

// O mock do Reanimated cria o valor de novo a cada render: o estilo mostra o
// valor inicial, e o efeito da entrada se confere pelas animações que ele pede.
const shown = () => screen.root;

afterEach(() => {
  mockReducedMotion = false;
  jest.restoreAllMocks();
});

describe('entrada em sequência da 1k', () => {
  it('o bloco fica apagado e 12 pt abaixo enquanto a pilha não aparece', () => {
    const delay = jest.spyOn(Reanimated, 'withDelay');
    render(block(2));
    expect(shown()).toHaveStyle({ opacity: 0, transform: [{ translateY: motion.stagger.rise }] });
    expect(delay).not.toHaveBeenCalled();
  });

  it.each([0, 1, 4])(
    'quando a pilha aparece, o bloco %i espera a vez dele (60 ms por posição) e sobe',
    (order) => {
      const delay = jest.spyOn(Reanimated, 'withDelay');
      const timing = jest.spyOn(Reanimated, 'withTiming');
      render(block(order));

      // No mesmo layout que começa o fade da pilha, sem esperar um render.
      act(() => entrance.enter());
      expect(delay).toHaveBeenCalledWith(order * motion.stagger.step, expect.anything());
      expect(timing).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ duration: motion.duration.slow, easing: motion.easing.out }),
      );
    },
  );

  it('com reduzir movimento, o bloco já nasce no lugar, sem esperar a pilha', () => {
    mockReducedMotion = true;
    const delay = jest.spyOn(Reanimated, 'withDelay');
    render(block(3));
    expect(shown()).toHaveStyle({ opacity: 1, transform: [{ translateY: 0 }] });
    expect(delay).not.toHaveBeenCalled();
  });
});
