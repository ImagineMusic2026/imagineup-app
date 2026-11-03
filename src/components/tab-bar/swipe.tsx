import type { BottomTabNavigationOptions, Tabs } from 'expo-router/js-tabs';
import { useNavigationState } from 'expo-router/react-navigation';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { useHaptics } from '@/hooks/use-haptics';
import type { StackEntrance } from '@/hooks/use-stack-fade';
import { colors, motion } from '@/theme';

type TabsProps = ComponentProps<typeof Tabs>;
type TabScreenLayoutProps = Parameters<NonNullable<TabsProps['screenLayout']>>[0];

export type SwipeDirection = 'previous' | 'next';

interface TabRoute {
  key: string;
  name: string;
  state?: { index?: number; routes: readonly unknown[] };
}

// O deslize só começa depois de 20 pt na horizontal. As listas horizontais (os
// carrosséis da Início, os chips da 1f) pegam o dedo antes, com 8 dp no Android
// e uns 10 pt no iOS, e rolam sem trocar de aba.
const ACTIVE_OFFSET_X = 20;
// O dedo que sobe ou desce 15 pt antes disso está rolando a tela.
const FAIL_OFFSET_Y = 15;
// Ao soltar, troca de aba depois de um quarto da largura ou num deslize rápido.
const COMMIT_FRACTION = 0.25;
const FLING_VELOCITY = 500;
// Na ponta (a Início para a direita, o Perfil para a esquerda), a tela anda até
// 12 pt, cada vez menos, como um elástico.
const EDGE_FOLLOW_RATE = 0.3;
const EDGE_FOLLOW_MAX = 12;
// As vizinhas da aba em foco montam um pouco depois de ela assentar: o arraste
// já as encontra desenhadas, sem pesar na troca. Na abertura, só depois de as
// abas terminarem de entrar em fade: a vizinha que montava no meio dele deixava
// as abas apagadas, só com o fundo escuro, até recarregar (emulador Android,
// Expo Go).
const PRELOAD_DELAY_MS = 600;
// O toque na aba e os links trocam com o fade, sem as páginas andarem.
const FADE = { duration: motion.duration.fast, easing: motion.easing.out };
// Ao soltar, a página assenta como no Instagram: da metade da tela a 75%, 95% e
// 100% a cada 50 ms, a curva quadrática que desacelera, sem passar do lugar. A
// mola crítica de antes, e a `motion.easing.out`, mais forte, arrastavam os
// últimos pixels por 200 a 300 ms.
const SETTLE_MIN_MS = 140;
const SETTLE_MAX_MS = 280;
// A inclinação da curva no começo: com ela, a página sai com a velocidade que
// o dedo deixou.
const SETTLE_START_SLOPE = 2;

// As fases do arraste. Fora da `IDLE`, as abas ficam lado a lado, como páginas.
const IDLE = 0;
const DRAGGING = 1;
const SETTLING = 2;
// A mola assentou, e a aba de destino ainda não ganhou o foco no navegador.
const ARRIVING = 3;

/** As abas lado a lado: o arraste e a mola movem todas juntas. */
interface Pager {
  /** A página na tela, contada em abas: 1,5 é meio caminho entre a 2ª e a 3ª. */
  position: SharedValue<number>;
  /** Onde a página estava quando o dedo pegou a tela. */
  start: SharedValue<number>;
  /** A página para onde a mola vai. */
  target: SharedValue<number>;
  /** A aba em foco no navegador, do lado da UI. */
  focused: SharedValue<number>;
  phase: SharedValue<number>;
}

/** Para onde vai o deslize que terminou, ou null quando a tela volta ao lugar. */
export function swipeDirection(
  translationX: number,
  velocityX: number,
  width: number,
): SwipeDirection | null {
  'worklet';
  if (translationX === 0) return null;
  const sameWay = Math.sign(velocityX) === Math.sign(translationX);
  // Arrastou e voltou rápido: o fã desistiu.
  if (!sameWay && Math.abs(velocityX) >= FLING_VELOCITY) return null;
  const far = Math.abs(translationX) >= width * COMMIT_FRACTION;
  const flung = sameWay && Math.abs(velocityX) >= FLING_VELOCITY;
  if (!far && !flung) return null;
  // O dedo para a esquerda traz a aba da direita, como numa página.
  return translationX < 0 ? 'next' : 'previous';
}

/** Quanto a tela anda além da ponta com o dedo `distance` pt para fora. */
export function edgeFollow(distance: number): number {
  'worklet';
  if (distance <= 0) return 0;
  return EDGE_FOLLOW_MAX * (1 - Math.exp((-distance * EDGE_FOLLOW_RATE) / EDGE_FOLLOW_MAX));
}

/**
 * A página que o arraste mostra. O dedo para a esquerda traz a aba da direita,
 * uma de cada vez; o dedo que pega a mola no meio, entre duas abas, fica entre
 * as duas. Antes da primeira e depois da última, o elástico.
 */
export function dragPosition(
  start: number,
  translationX: number,
  width: number,
  last: number,
): number {
  'worklet';
  const raw = start - translationX / width;
  const page = Math.min(Math.max(raw, Math.ceil(start) - 1), Math.floor(start) + 1);
  if (page < 0) return -edgeFollow(-page * width) / width;
  if (page > last) return last + edgeFollow((page - last) * width) / width;
  return page;
}

/**
 * A página em que o arraste assenta: a vizinha, na direção do dedo, ou a que
 * estava mais à vista quando ele pegou a tela, se o fã desistiu.
 */
export function settlePage(
  start: number,
  translationX: number,
  velocityX: number,
  width: number,
  last: number,
): number {
  'worklet';
  const direction = swipeDirection(translationX, velocityX, width);
  const to =
    direction === 'next'
      ? Math.floor(start) + 1
      : direction === 'previous'
        ? Math.ceil(start) - 1
        : Math.round(start);
  return Math.min(Math.max(to, 0), last);
}

/**
 * Quanto a página leva para assentar, em ms: o bastante para sair com a
 * velocidade do dedo, quando ele a leva para o destino, entre 140 e 280 ms.
 */
export function settleDuration(distance: number, speedTowardTarget: number): number {
  'worklet';
  if (speedTowardTarget <= 0) return SETTLE_MAX_MS;
  const matched = ((SETTLE_START_SLOPE * distance) / speedTowardTarget) * 1000;
  return Math.min(Math.max(matched, SETTLE_MIN_MS), SETTLE_MAX_MS);
}

/**
 * A curva da página que assenta, presa entre 0 e 1. A animação que começa fora
 * de um quadro (no fim do gesto) pega um tempo negativo no primeiro, e a curva
 * solta levava a página de 13 a 33 px para trás (emulador Android).
 */
export function settleEasing(progress: number): number {
  'worklet';
  const t = Math.min(Math.max(progress, 0), 1);
  return 1 - (1 - t) * (1 - t);
}

/** A aba ao lado na ordem da barra, ou null na ponta. O "+" não é aba. */
export function neighborTab(
  routes: readonly TabRoute[],
  routeKey: string,
  direction: SwipeDirection,
): string | null {
  const index = routes.findIndex((route) => route.key === routeKey);
  if (index === -1) return null;
  return routes[direction === 'next' ? index + 1 : index - 1]?.name ?? null;
}

/**
 * A aba mostra a tela da base da pilha dela. A pilha que ainda não montou (o
 * estado parcial de um link) está na última rota.
 */
export function isAtStackRoot(routes: readonly TabRoute[], routeKey: string): boolean {
  const stack = routes.find((route) => route.key === routeKey)?.state;
  if (!stack) return true;
  return (stack.index ?? stack.routes.length - 1) <= 0;
}

/**
 * O destaque da barra fora do navegador, que só a barra assina: a aba de
 * destino acende assim que a página assenta, e a troca no navegador, que
 * redesenha as abas e chega à tela bem depois, vem em seguida.
 */
export interface SwipeHighlight {
  get: () => number | null;
  set: (index: number | null) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createSwipeHighlight(): SwipeHighlight {
  let current: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (index) => {
      if (index === current) return;
      current = index;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A aba que o arraste destaca na barra agora, ou null para seguir o navegador. */
export function useSwipeHighlight(highlight: SwipeHighlight): number | null {
  return useSyncExternalStore(highlight.subscribe, highlight.get);
}

/**
 * A aba ganhou ou perdeu o foco no navegador. A troca que veio do arraste já
 * está na tela; a do toque na aba (ou de um link) é o fade, com as páginas no
 * lugar.
 */
function syncFocus(pager: Pager, shown: SharedValue<number>, index: number, focused: boolean) {
  'worklet';
  if (focused) pager.focused.set(index);
  const phase = pager.phase.get();
  if (phase !== IDLE && pager.target.get() === pager.focused.get()) {
    shown.set(focused ? 1 : 0);
    if (phase === ARRIVING) pager.phase.set(IDLE);
    return;
  }
  if (focused) {
    cancelAnimation(pager.position);
    pager.phase.set(IDLE);
    pager.position.set(index);
  }
  shown.set(withTiming(focused ? 1 : 0, FADE));
}

interface TabSwipeAreaProps {
  route: TabScreenLayoutProps['route'];
  navigation: TabScreenLayoutProps['navigation'];
  pager: Pager;
  mountedRef: RefObject<Set<string>>;
  /** As abas já entraram: a vizinha pode montar por trás. */
  entered: boolean;
  highlight: SwipeHighlight;
  children: ReactNode;
}

function TabSwipeArea({
  route,
  navigation,
  pager,
  mountedRef,
  entered,
  highlight,
  children,
}: TabSwipeAreaProps) {
  const { width } = useWindowDimensions();
  const playHaptic = useHaptics();
  const index = useNavigationState((state) => state.routes.findIndex((r) => r.key === route.key));
  const last = useNavigationState((state) => state.routes.length - 1);
  const focused = useNavigationState((state) => state.routes[state.index]?.key === route.key);
  const previous = useNavigationState((state) => neighborTab(state.routes, route.key, 'previous'));
  const next = useNavigationState((state) => neighborTab(state.routes, route.key, 'next'));
  // Com uma tela empilhada na aba (a central, os Ajustes), o deslize fica para
  // ela e para o voltar por gesto do sistema.
  const atRoot = useNavigationState((state) => isAtStackRoot(state.routes, route.key));
  // A aba que monta em foco já nasce à vista, e a que monta por trás, apagada.
  // Com o fade na montagem, por cima de tudo o que montava junto, a página ou o
  // card da missão do dia ficavam apagados de vez (emulador Android, Expo Go).
  const shown = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    scheduleOnUI(syncFocus, pager, shown, index, focused);
  }, [pager, shown, index, focused]);

  useEffect(() => {
    const mounted = mountedRef.current;
    mounted.add(route.name);
    return () => {
      mounted.delete(route.name);
    };
  }, [mountedRef, route.name]);

  useEffect(() => {
    if (!entered || !focused || !atRoot) return undefined;
    const timer = setTimeout(() => {
      for (const name of [previous, next]) {
        if (name !== null && !mountedRef.current.has(name)) navigation.preload(name);
      }
    }, PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [entered, focused, atRoot, previous, next, navigation, mountedRef]);

  const goTo = (page: number): void => {
    const state = navigation.getState();
    const target = state.routes[page];
    if (!target || page === state.index) return;
    playHaptic('selection');
    // O destaque da barra vem antes e sozinho: só a barra redesenha, num quadro.
    // A troca no navegador, que redesenha as abas, vem na volta seguinte.
    highlight.set(page);
    setTimeout(() => navigation.navigate(target.name), 0);
  };

  const pan = Gesture.Pan()
    .enabled(atRoot && (previous !== null || next !== null))
    .activeOffsetX([-ACTIVE_OFFSET_X, ACTIVE_OFFSET_X])
    .failOffsetY([-FAIL_OFFSET_Y, FAIL_OFFSET_Y])
    .onStart(() => {
      cancelAnimation(pager.position);
      const start = pager.position.get();
      pager.start.set(start);
      pager.target.set(Math.round(start));
      // Com reduzir movimento, a página também acompanha o dedo: é o dedo que a
      // move, como nos pagers do sistema. Parada, com a troca seca depois de o
      // dedo andar, ela parecia travada no aparelho do dono, que tinha a escala
      // de transição do Android em 0.
      pager.phase.set(DRAGGING);
    })
    .onUpdate((event) => {
      pager.position.set(dragPosition(pager.start.get(), event.translationX, width, last));
    })
    .onEnd((event, success) => {
      const start = pager.start.get();
      const to = success
        ? settlePage(start, event.translationX, event.velocityX, width, last)
        : Math.round(start);
      pager.target.set(to);
      pager.phase.set(SETTLING);
      const from = pager.position.get();
      // O dedo para a esquerda leva a página para a aba de índice maior.
      const towardTarget = (to - from) * -event.velocityX > 0 ? Math.abs(event.velocityX) : 0;
      // A volta ao soltar anima também com reduzir movimento, a única exceção do
      // app (decisão do dono de 03/11/2026): ela continua o gesto do fã, como o
      // pager do sistema e a rolagem com impulso, que não seguem a escala de
      // animação do Android. Seca, a página pulava até o fim num quadro ao
      // soltar, e o Instagram, no mesmo aparelho, desacelerava por 300 a 700 ms
      // (vídeo do dono de 03/11/2026).
      const settle = {
        duration: settleDuration(Math.abs(to - from) * width, towardTarget),
        easing: settleEasing,
        reduceMotion: ReduceMotion.Never,
      };
      pager.position.set(
        withTiming(to, settle, (done) => {
          if (!done || pager.phase.get() !== SETTLING) return;
          if (pager.focused.get() === to) {
            pager.phase.set(IDLE);
            return;
          }
          // A aba troca (a barra e o navegador) só com a página assentada:
          // trocada ao soltar, a troca chegava à tela no meio da volta da página
          // e a segurava uns 180 ms, com um tranco no fim; e o destaque sozinho,
          // no meio dela, ainda a parava de 30 a 65 ms (emulador Android, Expo Go).
          pager.phase.set(ARRIVING);
          scheduleOnRN(goTo, to);
        }),
      );
    })
    .withTestId(`tab-swipe-${route.name}`);

  const pageStyle = useAnimatedStyle(() => {
    const paging = pager.phase.get() !== IDLE;
    return {
      opacity: paging ? 1 : shown.get(),
      transform: [{ translateX: paging ? (index - pager.position.get()) * width : 0 }],
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.page, pageStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}

// O navegador não muda o estilo das cenas: quem desenha cada aba, no fade e no
// arraste, é a página dela (`TabSwipeArea`).
const sceneStyleInterpolator: NonNullable<
  BottomTabNavigationOptions['sceneStyleInterpolator']
> = () => ({ sceneStyle: {} });

/**
 * Deslizar para os lados troca para a aba vizinha, na ordem da barra (Início,
 * Explorar, Ranking, Perfil), com a tela acompanhando o dedo e a vizinha
 * entrando do lado, já desenhada. O "+" do meio fica fora: ele só abre no toque.
 * Vale só na tela da base de cada aba; a barra continua sendo o caminho de
 * sempre, e o leitor de tela fica com os próprios gestos.
 *
 * Cada aba é uma página (`TabSwipeArea`, no `screenLayout`), posta pela
 * `position` do arraste, como no Instagram: as duas páginas encostadas, presas
 * ao dedo, sem fade nem escala, e a aba troca no navegador quando a página
 * assenta. Fora do arraste, as páginas ficam no lugar, e o toque na aba
 * troca com o fade. O layout liga as Tabs com `detachInactiveScreens={false}`:
 * sem isso, a aba que não está em foco sai da tela e não aparece no arraste.
 * A `entrance` é a do fade de entrada das abas, que segura as vizinhas.
 */
export function useTabSwipe(entrance: StackEntrance) {
  const position = useSharedValue(0);
  const start = useSharedValue(0);
  const target = useSharedValue(0);
  const focused = useSharedValue(-1);
  const phase = useSharedValue(IDLE);
  // Um objeto só, o mesmo a vida toda: cada aba sincroniza o foco quando ele
  // muda, e uma troca do objeto no meio do arraste o desfaria.
  const [pager] = useState<Pager>(() => ({ position, start, target, focused, phase }));
  const mountedRef = useRef(new Set<string>());
  const [entered, setEntered] = useState(false);
  const [highlight] = useState(createSwipeHighlight);

  // O fade de entrada das abas (`useStackFade`) dura o `slow`.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = entrance.onEnter(() => {
      timer = setTimeout(() => setEntered(true), motion.duration.slow);
    });
    return () => {
      cancel();
      clearTimeout(timer);
    };
  }, [entrance]);

  const screenLayout = ({ route, navigation, children }: TabScreenLayoutProps) => (
    <TabSwipeArea
      route={route}
      navigation={navigation}
      pager={pager}
      mountedRef={mountedRef}
      entered={entered}
      highlight={highlight}
    >
      {children}
    </TabSwipeArea>
  );

  return { sceneStyleInterpolator, screenLayout, highlight };
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
