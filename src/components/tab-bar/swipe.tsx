import type { BottomTabNavigationOptions, Tabs } from 'expo-router/js-tabs';
import { useNavigationState } from 'expo-router/react-navigation';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Animated as SceneAnimated, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useHaptics } from '@/hooks/use-haptics';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion } from '@/theme';

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
// A tela acompanha o dedo de leve, cada vez menos, até 40 pt; na ponta (a Início
// para a direita, o Perfil para a esquerda), até 12, como um elástico.
const FOLLOW_RATE = 0.3;
const FOLLOW_MAX = 40;
const EDGE_FOLLOW_MAX = 12;
// Na troca pelo deslize, as cenas andam 50 pt para o lado, como o `shift` das abas.
const SCENE_SHIFT = 50;

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

/** Quanto a tela anda junto com o dedo. */
export function swipeFollow(translationX: number, hasTarget: boolean): number {
  'worklet';
  const max = hasTarget ? FOLLOW_MAX : EDGE_FOLLOW_MAX;
  const distance = max * (1 - Math.exp((-Math.abs(translationX) * FOLLOW_RATE) / max));
  return Math.sign(translationX) * distance;
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

interface TabSwipeAreaProps {
  route: TabScreenLayoutProps['route'];
  navigation: TabScreenLayoutProps['navigation'];
  onSwipe: () => void;
  children: ReactNode;
}

function TabSwipeArea({ route, navigation, onSwipe, children }: TabSwipeAreaProps) {
  const { width } = useWindowDimensions();
  const reducedMotion = usePrefersReducedMotion();
  const playHaptic = useHaptics();
  const previous = useNavigationState((state) => neighborTab(state.routes, route.key, 'previous'));
  const next = useNavigationState((state) => neighborTab(state.routes, route.key, 'next'));
  // Com uma tela empilhada na aba (a central, os Ajustes), o deslize fica para
  // ela e para o voltar por gesto do sistema.
  const atRoot = useNavigationState((state) => isAtStackRoot(state.routes, route.key));
  const offset = useSharedValue(0);

  // A tela que sai pelo deslize some onde o dedo a deixou, e volta ao lugar
  // quando a aba é aberta de novo, ainda sem aparecer.
  useEffect(() => navigation.addListener('focus', () => offset.set(0)), [navigation, offset]);

  const goTo = (name: string): void => {
    onSwipe();
    playHaptic('selection');
    navigation.navigate(name);
  };

  const pan = Gesture.Pan()
    .enabled(atRoot && (previous !== null || next !== null))
    .activeOffsetX([-ACTIVE_OFFSET_X, ACTIVE_OFFSET_X])
    .failOffsetY([-FAIL_OFFSET_Y, FAIL_OFFSET_Y])
    .onUpdate((event) => {
      if (reducedMotion) return;
      const target = event.translationX < 0 ? next : previous;
      offset.set(swipeFollow(event.translationX, target !== null));
    })
    .onEnd((event) => {
      const direction = swipeDirection(event.translationX, event.velocityX, width);
      const target = direction === 'next' ? next : direction === 'previous' ? previous : null;
      if (target !== null) {
        scheduleOnRN(goTo, target);
      } else {
        offset.set(withSpring(0, motion.spring.gentle));
      }
    })
    .onFinalize((_event, success) => {
      if (!success) offset.set(withSpring(0, motion.spring.gentle));
    })
    .withTestId(`tab-swipe-${route.name}`);

  const followStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.get() }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.fill, followStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}

/**
 * Deslizar para os lados troca para a aba vizinha, na ordem da barra (Início,
 * Explorar, Ranking, Perfil). O "+" do meio fica fora: ele só abre no toque.
 * Vale só na tela da base de cada aba; a barra continua sendo o caminho de
 * sempre, e o leitor de tela fica com os próprios gestos.
 *
 * A troca pelo deslize anda para o lado, na direção do dedo; a do toque
 * continua no fade de sempre. O `sceneStyleInterpolator` é um só para as duas,
 * e o lado entra pelo `sideways` (1 da troca pelo deslize até o fim dela, 0 no
 * resto). Trocar o `animation` entre `shift` e `fade` deixava a cena presa 50 pt
 * para o lado: sem o `transform` no estilo, o driver nativo não devolve o
 * `translateX` que já tinha posto na tela (Android, Expo Go).
 */
export function useTabSwipe() {
  const [sideways] = useState(() => new SceneAnimated.Value(0));

  const sceneStyleInterpolator: BottomTabNavigationOptions['sceneStyleInterpolator'] = ({
    current,
  }) => ({
    sceneStyle: {
      opacity: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
      transform: [
        {
          translateX: SceneAnimated.multiply(
            current.progress.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: [-SCENE_SHIFT, 0, SCENE_SHIFT],
            }),
            sideways,
          ),
        },
      ],
    },
  });

  const screenListeners: TabsProps['screenListeners'] = {
    transitionEnd: () => sideways.setValue(0),
  };

  const screenLayout = ({ route, navigation, children }: TabScreenLayoutProps) => (
    <TabSwipeArea route={route} navigation={navigation} onSwipe={() => sideways.setValue(1)}>
      {children}
    </TabSwipeArea>
  );

  return { sceneStyleInterpolator, screenListeners, screenLayout };
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
