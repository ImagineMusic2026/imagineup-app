import { renderHook } from '@testing-library/react-native';
import { Animated, StyleSheet } from 'react-native';

import { isAtStackRoot, neighborTab, swipeDirection, swipeFollow, useTabSwipe } from '../swipe';

const WIDTH = 400;

const tabs = [
  { key: 'inicio-1', name: '(inicio)' },
  { key: 'explorar-1', name: '(explorar)' },
  { key: 'ranking-1', name: '(ranking)' },
  { key: 'perfil-1', name: '(perfil)' },
];

describe('swipeDirection', () => {
  it.each([
    ['um quarto da largura para a esquerda traz a aba da direita', -100, 0, 'next'],
    ['um quarto da largura para a direita traz a aba da esquerda', 100, 0, 'previous'],
    ['curto e devagar volta ao lugar', -60, -200, null],
    ['curto e rápido troca', -40, -600, 'next'],
    ['rápido para a direita troca para a esquerda', 40, 600, 'previous'],
    ['longe, mas voltando rápido, volta ao lugar', -200, 700, null],
    ['longe e voltando devagar troca', -200, 300, 'next'],
    ['parado volta ao lugar', 0, 0, null],
  ] as const)('%s', (_name, translationX, velocityX, expected) => {
    expect(swipeDirection(translationX, velocityX, WIDTH)).toBe(expected);
  });
});

describe('swipeFollow', () => {
  it('acompanha o dedo na mesma direção, cada vez menos', () => {
    const near = swipeFollow(-50, true);
    const far = swipeFollow(-300, true);
    expect(near).toBeLessThan(0);
    expect(far).toBeLessThan(near);
    expect(far - near).toBeGreaterThan(-250);
  });

  it('não passa de 40 pt, nem de 12 na ponta', () => {
    expect(Math.abs(swipeFollow(-5000, true))).toBeLessThanOrEqual(40);
    expect(swipeFollow(5000, false)).toBeLessThanOrEqual(12);
    expect(swipeFollow(5000, false)).toBeGreaterThan(0);
  });

  it('parado fica no lugar', () => {
    expect(swipeFollow(0, true)).toBe(0);
  });
});

describe('neighborTab', () => {
  it.each([
    ['(inicio)', 'next', '(explorar)'],
    ['(explorar)', 'next', '(ranking)'],
    ['(ranking)', 'previous', '(explorar)'],
    ['(inicio)', 'previous', null],
    ['(perfil)', 'next', null],
  ] as const)('de %s para %s: %s', (from, direction, expected) => {
    const key = tabs.find((tab) => tab.name === from)?.key ?? '';
    expect(neighborTab(tabs, key, direction)).toBe(expected);
  });

  it('sem a aba no estado, não há vizinha', () => {
    expect(neighborTab(tabs, 'outra', 'next')).toBeNull();
  });
});

describe('isAtStackRoot', () => {
  it.each([
    ['sem pilha montada', undefined, true],
    ['na tela da base', { index: 0, routes: [{}] }, true],
    ['com uma tela empilhada', { index: 1, routes: [{}, {}] }, false],
    ['estado parcial de um link, com a base e o destino', { routes: [{}, {}] }, false],
    ['estado parcial só com a base', { routes: [{}] }, true],
  ] as const)('%s', (_name, state, expected) => {
    expect(isAtStackRoot([{ key: 'inicio-1', name: '(inicio)', state }], 'inicio-1')).toBe(
      expected,
    );
  });
});

describe('useTabSwipe', () => {
  type Swipe = ReturnType<typeof useTabSwipe>;
  type LayoutArgs = Parameters<Swipe['screenLayout']>[0];

  /** O estilo da cena com o `progress` parado (-1 à esquerda, 0 na tela, 1 à direita). */
  function sceneAt(swipe: Swipe, progress: number) {
    const interpolate = swipe.sceneStyleInterpolator;
    if (!interpolate) throw new Error('sem interpolador');
    const { sceneStyle } = interpolate({ current: { progress: new Animated.Value(progress) } });
    const style = StyleSheet.flatten(sceneStyle) as {
      opacity: Animated.AnimatedNode;
      transform: { translateX: Animated.AnimatedNode }[];
    };
    const translateX = (
      style.transform[0]?.translateX as unknown as { __getValue: () => number }
    ).__getValue();
    return {
      opacity: (style.opacity as unknown as { __getValue: () => number }).__getValue(),
      // O -50 vezes 0 dá -0, que o toEqual separa do 0.
      translateX: translateX + 0,
    };
  }

  function swipeFrom(swipe: Swipe) {
    const element = swipe.screenLayout({ children: <></> } as unknown as LayoutArgs);
    (element.props as { onSwipe: () => void }).onSwipe();
  }

  it('no toque, a cena só faz o fade, sem andar', () => {
    const { result } = renderHook(() => useTabSwipe());
    expect(sceneAt(result.current, 0)).toEqual({ opacity: 1, translateX: 0 });
    expect(sceneAt(result.current, -1)).toEqual({ opacity: 0, translateX: 0 });
    expect(sceneAt(result.current, 1)).toEqual({ opacity: 0, translateX: 0 });
  });

  it('na troca pelo deslize, a cena anda 50 pt para o lado, e volta ao fade no fim', () => {
    const { result } = renderHook(() => useTabSwipe());

    swipeFrom(result.current);
    expect(sceneAt(result.current, -1)).toEqual({ opacity: 0, translateX: -50 });
    expect(sceneAt(result.current, 1)).toEqual({ opacity: 0, translateX: 50 });
    expect(sceneAt(result.current, 0)).toEqual({ opacity: 1, translateX: 0 });

    const listeners = result.current.screenListeners as { transitionEnd: () => void };
    listeners.transitionEnd();
    expect(sceneAt(result.current, -1)).toEqual({ opacity: 0, translateX: 0 });
  });
});
