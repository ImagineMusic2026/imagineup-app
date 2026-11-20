import { act, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { onlineManager } from '@tanstack/react-query';
import { Dimensions, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { Scrim } from '@/components/scrim';
import { Stripes } from '@/components/stripes';
import { createStackEntrance, type StackEntranceTrigger } from '@/hooks/use-stack-fade';
import { motion } from '@/theme';

import { AuthBackdrop } from '../components/auth-backdrop';
import { PhotoWall } from '../components/photo-wall';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

// O Jest abre com a fonte do sistema a 200%, que já é a fonte grande: o véu de
// sempre só aparece na fonte padrão.
const window = Dimensions.get('window');
const setFontScale = (fontScale: number) => Dimensions.set({ window: { ...window, fontScale } });

/**
 * A escala da camada da parede. O mock do Reanimated cria o valor de novo a
 * cada render: o estilo mostra o valor inicial, e o efeito se confere pela animação.
 */
function wallScale(): number | undefined {
  const layer = screen.UNSAFE_getByType(PhotoWall).parent;
  const { transform } = StyleSheet.flatten(layer?.props.style) ?? {};
  const [first] = Array.isArray(transform) ? transform : [];
  return (first as { scale?: number } | undefined)?.scale;
}

/** As camadas do fundo, de baixo para cima. */
function layers(): string[] {
  const kinds = new Map<unknown, string>([
    [PhotoWall, 'parede'],
    [Scrim, 'véu'],
    [Stripes, 'listras'],
    [Logo, 'logo'],
  ]);
  return screen.root
    .findAll((node) => kinds.has(node.type))
    .map((node) => kinds.get(node.type) as string);
}

const scrimPreset = () => screen.UNSAFE_getByType(Scrim).props.preset as string;

let entrance: StackEntranceTrigger;

beforeEach(() => {
  entrance = createStackEntrance();
  setFontScale(1);
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
    act(() => {
      setFontScale(window.fontScale);
      onlineManager.setOnline(true);
    });
  });

  it('é a parede de fotos, na medida da tela, com as capas da lista dela', () => {
    render(backdrop());
    const wall = screen.UNSAFE_getByType(PhotoWall);
    expect(wall.props).toMatchObject({ width: 402, height: 874 });
    // Quem escolhe os cartões é a lista da própria parede, e não o fundo.
    expect(wall.props.cards).toBeUndefined();
  });

  it('por cima da parede vêm o véu, as listras da 1k e o logo, nesta ordem', () => {
    render(backdrop());
    expect(layers()).toEqual(['parede', 'véu', 'listras', 'logo']);
    expect(screen.UNSAFE_getByType(Stripes).props.preset).toBe('auth');
    expect(screen.UNSAFE_getByType(Logo).props).toMatchObject({ height: 17, opacity: 0.75 });
  });

  it('a parede nasce um pouco maior e espera a pilha começar a aparecer', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(backdrop());
    expect(wallScale()).toBe(1.04);
    // A pilha ainda está apagada: assentar agora seria escondido.
    expect(timing).not.toHaveBeenCalled();
  });

  it('quando a pilha aparece, a parede assenta até 1, devagar, e depois fica parada', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    const repeat = jest.spyOn(Reanimated, 'withRepeat');
    render(backdrop());

    act(() => entrance.enter());
    // Um movimento só, o de assentar: nada de laço.
    expect(timing.mock.calls).toEqual([
      [1, expect.objectContaining({ duration: motion.duration.settle, easing: motion.easing.out })],
    ]);
    expect(repeat).not.toHaveBeenCalled();
  });

  it('com reduzir movimento, a parede já nasce parada no tamanho dela', () => {
    mockReducedMotion = true;
    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(backdrop());
    expect(wallScale()).toBe(1);

    act(() => entrance.enter());
    expect(timing).not.toHaveBeenCalled();
  });

  it.each([1, 1.15])(
    'com a fonte a %sx, o véu deixa a parede à vista em cima e fecha antes do nome da abertura',
    (fontScale) => {
      setFontScale(fontScale);
      render(backdrop());
      expect(scrimPreset()).toBe('auth');
    },
  );

  it.each([
    1.3,
    // O preset "Grande" do Android chega como o float 1.3f, abaixo de 1,3.
    Math.fround(1.3),
    2,
  ])(
    'com a fonte grande (%sx), o texto da abertura sobe para cima da parede, e o véu fecha desde o topo',
    (fontScale) => {
      setFontScale(fontScale);
      render(backdrop());
      expect(scrimPreset()).toBe('authLarge');
    },
  );

  it('a fonte que muda com o fundo montado troca o véu', () => {
    render(backdrop());
    expect(scrimPreset()).toBe('auth');

    act(() => setFontScale(2));
    expect(scrimPreset()).toBe('authLarge');
  });

  it('o logo fica a 22 da área segura de cima, no centro', () => {
    render(backdrop());
    const logo = screen.UNSAFE_getByType(Logo).parent;
    expect(logo).toHaveStyle({ position: 'absolute', top: 47 + 22, left: 0, right: 0 });
    expect(logo).toHaveStyle({ alignItems: 'center' });
  });

  it('sem internet, o logo sai: o aviso de offline ocupa o topo', () => {
    render(backdrop());
    expect(screen.UNSAFE_queryByType(Logo)).not.toBeNull();

    act(() => onlineManager.setOnline(false));
    expect(screen.UNSAFE_queryByType(Logo)).toBeNull();
    // O resto do fundo segue no lugar.
    expect(layers()).toEqual(['parede', 'véu', 'listras']);
  });

  it('é decorativo: o leitor de tela não para nele, e o toque passa', () => {
    render(backdrop());
    // A caixa do fundo, em volta da camada da parede.
    let box = screen.UNSAFE_getByType(PhotoWall).parent?.parent;
    while (box && typeof box.type !== 'string') box = box.parent;
    expect(box).toHaveProp('pointerEvents', 'none');
    expect(box).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(box).toHaveProp('accessibilityElementsHidden', true);
    expect(isHiddenFromAccessibility(screen.UNSAFE_getByType(Logo))).toBe(true);
  });
});
