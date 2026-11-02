import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import * as Reanimated from 'react-native-reanimated';

import TabsLayout from '@/app/(tabs)/_layout';
import { haptics } from '@/services/haptics';
import { motion } from '@/theme';

jest.mock('@/services/haptics', () => ({ haptics: { trigger: jest.fn() } }));

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

/** O layout das abas de verdade, com telas vazias. */
const appTree = {
  _layout: () => <Stack />,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/(inicio,explorar,ranking,perfil)/_layout': {
    default: () => <Stack />,
    unstable_settings: {
      inicio: { anchor: 'index' },
      explorar: { anchor: 'explorar' },
      ranking: { anchor: 'ranking' },
      perfil: { anchor: 'perfil' },
    },
  },
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
};

// A largura da tela no Jest é 750: um quarto dela troca de aba.
const FAR = 300;

/** Um deslize do começo ao fim na base da aba (o dedo para a esquerda é negativo). */
function swipe(tab: string, translationX: number, velocityX = 0) {
  fireGestureHandler(getByGestureTestId(`tab-swipe-${tab}`), [
    { state: State.BEGAN, translationX: 0, velocityX: 0 },
    { state: State.ACTIVE, translationX: translationX / 2, velocityX },
    { state: State.END, translationX, velocityX },
  ]);
}

/**
 * O deslize que troca de aba vai ao JS pelo `queueMicrotask` (`scheduleOnRN`),
 * que o `renderRouter` finge junto com os timers: antes de dizer que nada
 * mudou, a fila anda.
 */
async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(haptics.trigger).mockClear();
});

describe('layout das abas', () => {
  it('as abas entram do fundo escuro em fade, como um grupo só', () => {
    // Segura a entrada no primeiro quadro, o que se vê quando o grupo troca.
    jest.spyOn(Reanimated, 'withTiming').mockImplementation((value) => (value === 1 ? 0 : value));

    renderRouter(appTree, { initialUrl: '/' });
    expect(screen.getByText('home')).toBeOnTheScreen();

    const group = screen
      .UNSAFE_getAllByType(View)
      .find((node) => node.props.needsOffscreenAlphaCompositing === true);
    if (!group) throw new Error('abas sem o grupo que entra em fade');
    expect(StyleSheet.flatten(group.props.style) as ViewStyle).toMatchObject({ opacity: 0 });

    // A entrada começa quando o grupo aparece na tela.
    fireEvent(group, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 874 } },
    });
    expect(Reanimated.withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.duration.slow }),
    );
  });
});

describe('deslizar entre as abas', () => {
  // Link a frio antes dos testes que trocam de aba: no Jest, os segmentos da
  // última navegação passam para o teste seguinte, e a central abriria em outra aba.
  it('com uma tela empilhada na aba, o deslize fica com ela e com o voltar', async () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/netto-brito' });
    expect(screen.getByText('artist')).toBeOnTheScreen();

    swipe('(inicio)', -FAR);
    await settle();
    expect(view.getPathname()).toBe('/artista/netto-brito');
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('para a esquerda vai à aba da direita, e o "+" fica de fora', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    swipe('(inicio)', -FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
    expect(haptics.trigger).toHaveBeenCalledWith('selection');

    // Da Explorar, o vizinho da direita é a Ranking, do outro lado do "+".
    swipe('(explorar)', -FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/ranking'));

    swipe('(ranking)', -FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
  });

  it('para a direita volta à aba da esquerda', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ranking' });

    swipe('(ranking)', FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));

    swipe('(explorar)', FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });

  it('nas pontas, o deslize não sai da aba', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    swipe('(inicio)', FAR);
    await settle();
    expect(view.getPathname()).toBe('/');

    view.unmount();
    const profile = renderRouter(appTree, { initialUrl: '/perfil' });
    swipe('(perfil)', -FAR);
    await settle();
    expect(profile.getPathname()).toBe('/perfil');
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('o deslize curto e devagar devolve a tela ao lugar, e o rápido troca', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    swipe('(inicio)', -60, -200);
    await settle();
    expect(view.getPathname()).toBe('/');

    swipe('(inicio)', -60, -900);
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
  });
});
