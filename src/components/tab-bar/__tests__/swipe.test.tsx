import { renderHook } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { ALREADY_ENTERED } from '@/hooks/use-stack-fade';

import {
  createSwipeHighlight,
  dragPosition,
  edgeFollow,
  isAtStackRoot,
  neighborTab,
  settleDuration,
  settleEasing,
  settlePage,
  swipeDirection,
  useTabSwipe,
} from '../swipe';

const WIDTH = 400;
const LAST = 3;

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

describe('edgeFollow', () => {
  it('anda com o dedo, cada vez menos, até 12 pt', () => {
    const near = edgeFollow(20);
    const far = edgeFollow(200);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(near);
    expect(far - near).toBeLessThan(180);
    expect(edgeFollow(5000)).toBeLessThanOrEqual(12);
  });

  it('parado fica no lugar', () => {
    expect(edgeFollow(0)).toBe(0);
  });
});

describe('dragPosition', () => {
  it.each([
    ['o dedo para a esquerda traz a aba da direita junto', 0, -100, 0.25],
    ['o dedo para a direita traz a da esquerda', 1, 200, 0.5],
    ['uma página de cada vez', 0, -600, 1],
    ['parado fica na página', 2, 0, 2],
    ['pegando a mola no meio, segue de onde ela estava', 0.7, 100, 0.45],
    ['pegando a mola no meio, fica entre as duas abas', 0.7, -300, 1],
  ] as const)('%s', (_name, start, translationX, expected) => {
    expect(dragPosition(start, translationX, WIDTH, LAST)).toBeCloseTo(expected);
  });

  it('antes da Início e depois do Perfil, só o elástico', () => {
    const beforeFirst = dragPosition(0, 100, WIDTH, LAST);
    expect(beforeFirst).toBeLessThan(0);
    expect(beforeFirst * WIDTH).toBeGreaterThanOrEqual(-12);

    const afterLast = dragPosition(LAST, -100, WIDTH, LAST);
    expect(afterLast).toBeGreaterThan(LAST);
    expect((afterLast - LAST) * WIDTH).toBeLessThanOrEqual(12);
  });
});

describe('settlePage', () => {
  it.each([
    ['um quarto para a esquerda vai à aba da direita', 0, -100, 0, 1],
    ['um quarto para a direita vai à da esquerda', 1, 100, 0, 0],
    ['curto e devagar volta à mesma', 0, -60, -200, 0],
    ['curto e rápido troca', 0, -40, -600, 1],
    ['longe, mas voltando rápido, volta à mesma', 0, -200, 700, 0],
    ['na Início, para a direita, fica nela', 0, 200, 0, 0],
    ['no Perfil, para a esquerda, fica nele', LAST, -200, 0, LAST],
    ['pegou a mola no meio e soltou: vai à mais à vista', 0.7, 0, 0, 1],
    ['pegou a mola no meio e voltou: vai à da esquerda', 0.7, 150, 0, 0],
    ['pegou a mola voltando e empurrou: vai à da direita', 0.3, -150, 0, 1],
  ] as const)('%s', (_name, start, translationX, velocityX, expected) => {
    expect(settlePage(start, translationX, velocityX, WIDTH, LAST)).toBe(expected);
  });
});

describe('settleDuration', () => {
  it.each([
    ['deslize rápido para o destino: sai na velocidade do dedo', 200, 2000, 200],
    ['tão rápido que passaria do mínimo: 140 ms', 100, 4000, 140],
    ['devagar: no máximo 280 ms', 200, 300, 280],
    ['o dedo parado: 280 ms', 200, 0, 280],
  ] as const)('%s', (_name, distance, speed, expected) => {
    expect(settleDuration(distance, speed)).toBeCloseTo(expected);
  });
});

describe('settleEasing', () => {
  it('desacelera, da metade a 75% no primeiro terço e a 95% no segundo, como no Instagram', () => {
    expect(settleEasing(0)).toBe(0);
    expect(settleEasing(1 / 3)).toBeCloseTo(0.556, 2);
    expect(settleEasing(2 / 3)).toBeCloseTo(0.889, 2);
    expect(settleEasing(1)).toBe(1);
  });

  it('o tempo negativo do primeiro quadro não leva a página para trás, nem o atraso para além do fim', () => {
    expect(settleEasing(-0.1)).toBe(0);
    expect(settleEasing(1.2)).toBe(1);
  });
});

describe('createSwipeHighlight', () => {
  it('guarda a aba destacada e avisa quem assina só quando ela muda', () => {
    const highlight = createSwipeHighlight();
    const listener = jest.fn();
    const unsubscribe = highlight.subscribe(listener);
    expect(highlight.get()).toBeNull();

    highlight.set(2);
    highlight.set(2);
    expect(highlight.get()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    highlight.set(null);
    expect(listener).toHaveBeenCalledTimes(1);
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
  it('o navegador não mexe no estilo das cenas, que fica com a página de cada aba', () => {
    const { result } = renderHook(() => useTabSwipe(ALREADY_ENTERED));
    for (const progress of [-1, -0.5, 0, 0.5, 1]) {
      expect(
        result.current.sceneStyleInterpolator({
          current: { progress: new Animated.Value(progress) },
        }),
      ).toEqual({ sceneStyle: {} });
    }
  });
});
