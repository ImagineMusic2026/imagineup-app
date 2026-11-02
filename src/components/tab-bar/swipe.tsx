import type { BottomTabNavigationOptions, Tabs } from 'expo-router/js-tabs';
import { useNavigationState } from 'expo-router/react-navigation';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';

import { useHaptics } from '@/hooks/use-haptics';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
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
  children: ReactNode;
}

function TabSwipeArea({
  route,
  navigation,
  pager,
  mountedRef,
  entered,
  children,
}: TabSwipeAreaProps) {
  const { width } = useWindowDimensions();
  const reducedMotion = usePrefersReducedMotion();
  const playHaptic = useHaptics();
  const index = useNavigationState((state) => state.routes.findIndex((r) => r.key === route.key));
  const last = useNavigationState((state) => state.routes.length - 1);
  const focused = useNavigationState((state) => state.routes[state.index]?.key === route.key);
  const previous = useNavigationState((state) => neighborTab(state.routes, route.key, 'previous'));
  const next = useNavigationState((state) => neighborTab(state.routes, route.key, 'next'));
  // Com uma tela empilhada na aba (a central, os Ajustes), o deslize fica para
  // ela e para o voltar por gesto do sistema.
  const atRoot = useNavigationState((state) => isAtStackRoot(state.routes, route.key));
  // A aba que monta entra em fade, como no toque; a que monta por trás, apagada.
  const shown = useSharedValue(0);

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
    if (!entered || !focused || !atRoot || reducedMotion) return undefined;
    const timer = setTimeout(() => {
      for (const name of [previous, next]) {
        if (name !== null && !mountedRef.current.has(name)) navigation.preload(name);
      }
    }, PRELOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [entered, focused, atRoot, reducedMotion, previous, next, navigation, mountedRef]);

  const goTo = (page: number): void => {
    const state = navigation.getState();
    const target = state.routes[page];
    if (!target || page === state.index) return;
    playHaptic('selection');
    navigation.navigate(target.name);
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
      // Com reduzir movimento, a tela fica parada e a troca sai seca, como no toque.
      if (!reducedMotion) pager.phase.set(DRAGGING);
    })
    .onUpdate((event) => {
      if (reducedMotion) return;
      pager.position.set(dragPosition(pager.start.get(), event.translationX, width, last));
    })
    .onEnd((event, success) => {
      const start = pager.start.get();
      const to = success
        ? settlePage(start, event.translationX, event.velocityX, width, last)
        : Math.round(start);
      pager.target.set(to);
      // A aba troca ao soltar, e a barra acompanha enquanto a página assenta.
      scheduleOnRN(goTo, to);
      if (reducedMotion) {
        pager.position.set(to);
        return;
      }
      pager.phase.set(SETTLING);
      pager.position.set(
        withSpring(to, { ...motion.spring.page, velocity: -event.velocityX / width }, (done) => {
          if (!done || pager.phase.get() !== SETTLING) return;
          pager.phase.set(pager.focused.get() === pager.target.get() ? IDLE : ARRIVING);
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
 * `position` do arraste. Fora dele, as páginas ficam no lugar, e o toque na aba
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
    >
      {children}
    </TabSwipeArea>
  );

  return { sceneStyleInterpolator, screenLayout };
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
