import {
  act,
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { useState } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { createStackEntrance, type StackEntranceTrigger } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { colors, motion, typography } from '@/theme';

import { Tagline, TaglinePart, type TaglinePartState } from '../components/tagline';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

const FOLLOW = t('auth.welcome.tagline.follow');
const COMMENT = t('auth.welcome.tagline.comment');
const EARN = t('auth.welcome.tagline.earn');
const POINTS = t('auth.welcome.tagline.points');
const EARN_POINTS = `${EARN} ${POINTS}`;
/** As partes, na ordem em que aparecem. */
const PARTS = [FOLLOW, COMMENT, EARN_POINTS];
const LABEL = t('auth.welcome.tagline.label');

// As partes ficam fora do leitor de tela: só aparecem pedindo os escondidos.
const hidden = { includeHiddenElements: true } as const;
const text = (value: string) => screen.getByText(value, hidden);

type Node = ReturnType<typeof text>;

/** Caixa (em host) mais próxima acima do nó. */
function hostParent(node: Node): Node {
  let current = node.parent;
  while (current && typeof current.type !== 'string') current = current.parent;
  if (!current) throw new Error('nó sem caixa em volta');
  return current;
}

/** A caixa que entra e sai com a parte. */
const part = (value: string) => hostParent(text(value));

/** O que cada parte está fazendo, na ordem em que aparecem. */
function states(): TaglinePartState[] {
  const parts = screen.UNSAFE_getAllByType(TaglinePart);
  return PARTS.map((value) => {
    const owner = parts.find((candidate) => within(candidate).queryByText(value, hidden));
    if (!owner) throw new Error(`parte sem bloco: ${value}`);
    return owner.props.state as TaglinePartState;
  });
}

// O Jest abre com a fonte do sistema a 200%: as medidas são conferidas na fonte padrão.
const window = Dimensions.get('window');
const setFontScale = (fontScale: number) => Dimensions.set({ window: { ...window, fontScale } });

// As duas animam também com reduzir movimento (decisão do dono de 17/11/2026).
const FIRST = {
  duration: motion.duration.slow,
  easing: motion.easing.out,
  reduceMotion: Reanimated.ReduceMotion.Never,
};
const ROLL = {
  duration: motion.duration.slow,
  easing: motion.easing.inOut,
  reduceMotion: Reanimated.ReduceMotion.Never,
};
// "Siga" entra no lugar 2 da 1k (120 ms), sobe em 400 ms e fica 1,2 s.
const FIRST_TURN = 2 * motion.stagger.step + 400 + 1200;
// De uma troca à seguinte: 400 ms rolando e 1,2 s parada.
const TURN = 400 + 1200;

let entrance: StackEntranceTrigger;

beforeEach(() => {
  entrance = createStackEntrance();
  jest.useFakeTimers();
});

afterEach(() => {
  mockReducedMotion = false;
  jest.useRealTimers();
  jest.restoreAllMocks();
  act(() => setFontScale(window.fontScale));
});

const tagline = (props: { firstOrder?: number; active?: boolean } = {}) => (
  <Tagline entrance={entrance} firstOrder={props.firstOrder ?? 2} active={props.active} />
);

const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms));

/** A frase depois do fade da pilha. */
function enter(): void {
  act(() => entrance.enter());
}

describe('frase da abertura', () => {
  it('são três partes, sem ponto final: "Siga", "Comente" e "Ganhe pontos"', () => {
    expect(PARTS).toEqual(['Siga', 'Comente', 'Ganhe pontos']);
    render(tagline());
    for (const value of PARTS) expect(text(value)).toBeTruthy();
  });

  it('as três ficam no mesmo lugar: "Ganhe pontos" dá a altura, e as outras duas ficam por cima, no meio dela', () => {
    render(tagline());
    const box = hostParent(part(EARN_POINTS));
    for (const value of [FOLLOW, COMMENT]) {
      expect(hostParent(part(value))).toBe(box);
      expect(part(value)).toHaveStyle({
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        justifyContent: 'center',
      });
    }
    expect(StyleSheet.flatten(part(EARN_POINTS).props.style).position).toBeUndefined();
  });

  it('todas no tamanho do título das perguntas, em branco e no centro, com o "pontos" em lima', () => {
    render(tagline());
    for (const value of PARTS) {
      expect(text(value)).toHaveStyle({
        ...typography.titleOnboarding,
        color: colors.text,
        textAlign: 'center',
      });
    }
    // Lima é a cor de pontos, e só deles.
    expect(text(POINTS)).toHaveStyle({ ...typography.titleOnboarding, color: colors.points });
  });

  it('antes do fade da pilha, as três esperam apagadas, uma linha (30 pt) abaixo, e nada roda', () => {
    act(() => setFontScale(1));
    const delay = jest.spyOn(Reanimated, 'withDelay');
    render(tagline());
    expect(states()).toEqual(['waiting', 'waiting', 'waiting']);
    for (const value of PARTS) {
      expect(part(value)).toHaveStyle({ opacity: 0, transform: [{ translateY: 30 }] });
    }
    advance(10_000);
    expect(states()).toEqual(['waiting', 'waiting', 'waiting']);
    expect(delay).not.toHaveBeenCalled();
  });

  it('no fade da pilha, "Siga" sobe e assenta na vez dela, como os outros blocos da 1k', () => {
    render(tagline());
    const delay = jest.spyOn(Reanimated, 'withDelay');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    enter();

    expect(states()).toEqual(['shown', 'waiting', 'waiting']);
    expect(delay.mock.calls.map(([wait]) => wait)).toEqual([120]);
    expect(timing.mock.calls).toEqual([[0, FIRST]]);
    expect(timing.mock.calls[0]![1]!.easing).toBe(motion.easing.out);
  });

  it('em laço: a primeira troca depois de "Siga" assentar, as outras a cada 1,6 s, e depois de "Ganhe pontos" volta "Siga"', () => {
    render(tagline());
    enter();

    advance(FIRST_TURN - 1);
    expect(states()).toEqual(['shown', 'waiting', 'waiting']);
    const delay = jest.spyOn(Reanimated, 'withDelay');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    advance(1);
    // A que sai sobe sumindo e a que entra sobe de baixo, no mesmo compasso e sem espera.
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);
    expect(timing.mock.calls).toEqual(
      expect.arrayContaining([
        [-1, ROLL],
        [0, ROLL],
      ]),
    );
    expect(timing).toHaveBeenCalledTimes(2);
    for (const [, config] of timing.mock.calls) expect(config!.easing).toBe(motion.easing.inOut);
    expect(delay).not.toHaveBeenCalled();

    advance(TURN - 1);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);
    advance(1);
    expect(states()).toEqual(['waiting', 'leaving', 'shown']);

    // A volta a "Siga" rola como as outras trocas: sem espera e no mesmo compasso.
    delay.mockClear();
    timing.mockClear();
    advance(TURN);
    expect(states()).toEqual(['shown', 'waiting', 'leaving']);
    expect(delay).not.toHaveBeenCalled();
    expect(timing).toHaveBeenCalledTimes(2);
    for (const [, config] of timing.mock.calls) expect(config!.easing).toBe(motion.easing.inOut);
    advance(TURN);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);
  });

  it('coberta por uma pergunta, a abertura para a frase onde ela está; de volta, a frase retoma', () => {
    render(tagline());
    enter();
    advance(FIRST_TURN);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);

    screen.rerender(tagline({ active: false }));
    // Coberta, nada fica agendado (e a espera não é múltiplo de uma volta inteira).
    expect(jest.getTimerCount()).toBe(0);
    advance(5_000);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);

    screen.rerender(tagline({ active: true }));
    advance(1200 - 1);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);
    advance(1);
    expect(states()).toEqual(['waiting', 'leaving', 'shown']);
  });

  it('coberta antes da primeira troca, a frase retoma depois do tempo parada (1,2 s), e não da espera da entrada', () => {
    render(tagline());
    enter();
    advance(300);
    screen.rerender(tagline({ active: false }));
    advance(5_000);
    screen.rerender(tagline({ active: true }));

    advance(1200 - 1);
    expect(states()).toEqual(['shown', 'waiting', 'waiting']);
    advance(1);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);
  });

  it('a primeira parte segue o lugar que a tela pede', () => {
    render(tagline({ firstOrder: 5 }));
    const delay = jest.spyOn(Reanimated, 'withDelay');
    enter();
    expect(delay.mock.calls.map(([wait]) => wait)).toEqual([5 * motion.stagger.step]);
    advance(5 * motion.stagger.step + 400 + 1200 - 1);
    expect(states()).toEqual(['shown', 'waiting', 'waiting']);
    advance(1);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);
  });

  it('desmontada no meio do laço, não deixa troca agendada', () => {
    const view = render(tagline());
    enter();
    advance(FIRST_TURN);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('com reduzir movimento, a frase anima do mesmo jeito, por decisão do dono: "Siga" sobe na vez dela e o laço roda', () => {
    mockReducedMotion = true;
    render(tagline());
    const delay = jest.spyOn(Reanimated, 'withDelay');
    const timing = jest.spyOn(Reanimated, 'withTiming');
    expect(states()).toEqual(['waiting', 'waiting', 'waiting']);

    enter();
    expect(states()).toEqual(['shown', 'waiting', 'waiting']);
    // A espera e a subida pedem para animar mesmo com o ajuste ligado.
    expect(delay.mock.calls).toEqual([[120, 0, Reanimated.ReduceMotion.Never]]);
    expect(timing.mock.calls).toEqual([[0, FIRST]]);

    timing.mockClear();
    advance(FIRST_TURN);
    expect(states()).toEqual(['leaving', 'shown', 'waiting']);
    for (const [, config] of timing.mock.calls) {
      expect(config).toMatchObject({ reduceMotion: Reanimated.ReduceMotion.Never });
    }
    advance(TURN);
    expect(states()).toEqual(['waiting', 'leaving', 'shown']);
  });

  it('para o leitor de tela, a frase é um foco só, lida inteira, com as pausas entre as partes', () => {
    render(tagline());
    const block = screen.getByLabelText(LABEL);
    expect(block).toHaveProp('accessible', true);
    expect(block).toHaveProp('accessibilityLabel', 'Siga. Comente. Ganhe pontos.');
    // O rótulo é a frase que passa na tela, parte por parte.
    expect(LABEL).toBe(PARTS.map((value) => `${value}.`).join(' '));
  });

  it('as partes ficam fora do leitor de tela, para ele não ouvir cada troca', () => {
    render(tagline());
    for (const value of PARTS) {
      expect(isHiddenFromAccessibility(text(value))).toBe(true);
      expect(screen.queryByText(value)).toBeNull();
    }
    // Quem esconde é a caixa de dentro: a de fora, com o rótulo, segue à vista.
    expect(isHiddenFromAccessibility(screen.getByLabelText(LABEL))).toBe(false);
  });

  it('sem pausa, por decisão do dono: a frase não é tocável e não tem botão nenhum', () => {
    render(tagline());
    enter();
    expect(screen.queryAllByRole('button', hidden)).toHaveLength(0);
    expect(screen.getByLabelText(LABEL).props.onPress).toBeUndefined();
  });

  it('mede a altura do bloco em "Ganhe pontos": dela sai o caminho das partes', () => {
    render(tagline());
    // No Android 14 em diante, com a fonte a 1,3, a linha sai com 30, e não com 39.
    fireEvent(part(EARN_POINTS), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 200, height: 30 } },
    });
    for (const value of PARTS) {
      expect(StyleSheet.flatten(part(value).props.style).transform).toEqual([{ translateY: 30 }]);
    }
  });

  it.each([
    // Tela de 375 menos as margens da 1k: "Ganhe pontos" cabe numa linha até uns 1,63x.
    [327, (327 * 0.94) / 188],
    // Larga: até os 200% de sempre.
    [600, 2],
    // Estreita demais: a frase não fica menor que o tamanho padrão.
    [150, 1],
  ])(
    'numa fileira de %s, a frase cresce até %sx: "Ganhe pontos", a parte mais larga, sempre numa linha',
    (width, scale) => {
      render(tagline());
      fireEvent(screen.getByLabelText(LABEL), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 44 } },
      });
      for (const value of [...PARTS, POINTS]) {
        expect(text(value).props.maxFontSizeMultiplier).toBeCloseTo(scale, 5);
      }
    },
  );

  it('nenhuma parte é cortada nem resumida', () => {
    render(tagline());
    for (const value of [...PARTS, POINTS]) {
      expect(text(value).props.numberOfLines).toBeUndefined();
    }
  });

  it.each([
    [1, 30],
    [1.3, 39],
    [2, 60],
    // O texto para de crescer em 200%, e o caminho para com ele.
    [3, 60],
  ])(
    'antes da medida, com a fonte do sistema a %sx, a parte anda %s pt: uma linha do texto',
    (fontScale, travel) => {
      act(() => setFontScale(fontScale));
      render(tagline());
      for (const value of PARTS) {
        const [move] = StyleSheet.flatten(part(value).props.style).transform as [
          { translateY: number },
        ];
        expect(move.translateY).toBeCloseTo(travel, 5);
      }
    },
  );
});

describe('frase da abertura: onde cada parte está de fato', () => {
  // O mock do Reanimated cria um valor animado novo a cada render, e os testes
  // de cima só veem o estado de cada parte. Aqui o valor dura entre renders,
  // como no aparelho, e o fim de cada animação vale na hora.
  beforeEach(() => {
    jest.spyOn(Reanimated, 'useSharedValue').mockImplementation(((initial: unknown) => {
      const [box] = useState(() => {
        let current = initial;
        return {
          get value() {
            return current;
          },
          set value(next: unknown) {
            current = next;
          },
          get: () => current,
          set: (next: unknown) => {
            current =
              typeof next === 'function' ? (next as (value: unknown) => unknown)(current) : next;
          },
        };
      });
      return box;
    }) as unknown as typeof Reanimated.useSharedValue);
    act(() => setFontScale(1));
  });

  /** Depois de um render, opacidade e deslocamento de cada parte, na ordem em que aparecem. */
  function where(props: { active?: boolean } = {}): { opacity: number; y: number }[] {
    screen.rerender(tagline(props));
    // A parte mexe no valor animado num efeito, depois do render (no aparelho, o
    // Reanimated desenha na hora): o render seguinte mostra onde ela ficou.
    screen.rerender(tagline(props));
    return PARTS.map((value) => {
      const style = StyleSheet.flatten(part(value).props.style);
      const [move] = style.transform as [{ translateY: number }];
      return { opacity: style.opacity as number, y: move.translateY };
    });
  }
  const visible = (props: { active?: boolean } = {}) => where(props).map(({ opacity }) => opacity);

  it('uma parte à vista por vez: a que sai fica apagada uma linha acima e, na vez dela de novo, entra de baixo', () => {
    render(tagline());
    expect(visible()).toEqual([0, 0, 0]);
    enter();
    expect(visible()).toEqual([1, 0, 0]);

    advance(FIRST_TURN);
    expect(where()).toEqual([
      { opacity: 0, y: -30 },
      { opacity: 1, y: 0 },
      { opacity: 0, y: 30 },
    ]);
    advance(TURN);
    // "Siga" foi esperar a vez embaixo, apagada.
    expect(where()).toEqual([
      { opacity: 0, y: 30 },
      { opacity: 0, y: -30 },
      { opacity: 1, y: 0 },
    ]);
    advance(TURN);
    expect(visible()).toEqual([1, 0, 0]);
  });

  it('ligar reduzir movimento com a frase na tela não muda nada: a parte à vista segue, e o laço também', () => {
    render(tagline());
    enter();
    advance(FIRST_TURN);
    expect(visible()).toEqual([0, 1, 0]);

    mockReducedMotion = true;
    expect(visible()).toEqual([0, 1, 0]);
    advance(TURN);
    expect(visible()).toEqual([0, 0, 1]);
    advance(TURN);
    expect(visible()).toEqual([1, 0, 0]);
  });
});
