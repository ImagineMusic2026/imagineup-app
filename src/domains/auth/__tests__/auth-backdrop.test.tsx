import { act, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { StaticPhotoFallback } from '@/components/remote-image';
import { createStackEntrance, type StackEntranceTrigger } from '@/hooks/use-stack-fade';
import { motion } from '@/theme';

import { AuthBackdrop } from '../components/auth-backdrop';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

/**
 * A escala da camada da foto. O mock do Reanimated cria o valor de novo a cada
 * render: o estilo mostra o valor inicial, e o efeito se confere pela animação.
 */
function photoScale(): number | undefined {
  const layer = screen.UNSAFE_getByType(StaticPhotoFallback).parent;
  const { transform } = StyleSheet.flatten(layer?.props.style) ?? {};
  const [first] = Array.isArray(transform) ? transform : [];
  return (first as { scale?: number } | undefined)?.scale;
}

let entrance: StackEntranceTrigger;

beforeEach(() => {
  entrance = createStackEntrance();
});

function backdrop() {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <AuthBackdrop entrance={entrance} />
    </SafeAreaProvider>
  );
}

describe('fundo da 1k', () => {
  afterEach(() => {
    mockReducedMotion = false;
    jest.restoreAllMocks();
  });

  it('a foto nasce um pouco maior e espera a pilha começar a aparecer', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(backdrop());
    expect(photoScale()).toBe(1.04);
    // A pilha ainda está apagada: assentar agora seria escondido.
    expect(timing).not.toHaveBeenCalled();
  });

  it('quando a pilha aparece, a foto assenta até 1, devagar', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(backdrop());

    act(() => entrance.enter());
    expect(timing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.duration.settle, easing: motion.easing.out }),
    );
  });

  it('com reduzir movimento, a foto já nasce parada no tamanho dela', () => {
    mockReducedMotion = true;
    render(backdrop());
    expect(photoScale()).toBe(1);
  });

  it('o placeholder do fundo vem sem as listras do site: as da 1k vão por cima', () => {
    render(backdrop());
    expect(screen.UNSAFE_getByType(StaticPhotoFallback).props).toMatchObject({
      stripes: null,
      width: 402,
      height: 874,
    });
  });
});
