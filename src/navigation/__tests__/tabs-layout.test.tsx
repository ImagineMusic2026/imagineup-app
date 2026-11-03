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

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

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

// As abas fora de foco ficam fora do leitor de tela, e a busca padrão não as vê.
const HIDDEN = { includeHiddenElements: true };

/**
 * Um deslize do começo ao fim na base da aba (o dedo para a esquerda é
 * negativo), com a tela já assentada, como no aparelho: o foco de cada aba chega
 * à UI no quadro seguinte ao da troca, antes de o dedo pegar a tela.
 */
async function swipe(tab: string, translationX: number, velocityX = 0) {
  await settle();
  fireGestureHandler(getByGestureTestId(`tab-swipe-${tab}`), [
    { state: State.BEGAN, translationX: 0, velocityX: 0 },
    { state: State.ACTIVE, translationX: translationX / 2, velocityX },
    { state: State.END, translationX, velocityX },
  ]);
}

/**
 * O deslize que troca de aba vai ao JS pelo `queueMicrotask` (`scheduleOnRN`),
 * o foco vai à UI por um quadro (`scheduleOnUI`) e a vizinha monta por um
 * timer: o `renderRouter` finge tudo isso junto com os timers, e a fila anda
 * antes de dizer que nada mudou.
 */
async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

/** O grupo das abas, que entra do fundo escuro em fade. */
function tabsGroup() {
  const group = screen
    .UNSAFE_getAllByType(View)
    .find((node) => node.props.needsOffscreenAlphaCompositing === true);
  if (!group) throw new Error('abas sem o grupo que entra em fade');
  return group;
}

/**
 * As abas aparecem na tela e terminam de entrar em fade: só então as vizinhas
 * montam por trás, um timer depois do outro.
 */
async function enterTabs() {
  fireEvent(tabsGroup(), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 874 } },
  });
  await settle();
  await settle();
}

afterEach(() => {
  mockReducedMotion = false;
  jest.restoreAllMocks();
  jest.mocked(haptics.trigger).mockClear();
});

describe('layout das abas', () => {
  it('as abas entram do fundo escuro em fade, como um grupo só', () => {
    // Segura a entrada no primeiro quadro, o que se vê quando o grupo troca.
    jest.spyOn(Reanimated, 'withTiming').mockImplementation((value) => (value === 1 ? 0 : value));

    renderRouter(appTree, { initialUrl: '/' });
    expect(screen.getByText('home')).toBeOnTheScreen();

    const group = tabsGroup();
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

    await enterTabs();
    await swipe('(inicio)', -FAR);
    await settle();
    expect(view.getPathname()).toBe('/artista/netto-brito');
    expect(haptics.trigger).not.toHaveBeenCalled();
    // Sem o deslize, a vizinha não precisa estar pronta por trás.
    expect(screen.queryByText('explore', HIDDEN)).not.toBeOnTheScreen();
  });

  it('a vizinha monta por trás um pouco depois, para o arraste já a encontrar desenhada', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    // Enquanto as abas entram em fade, nada monta por trás: no Android, a vizinha
    // que montava no meio dele deixava as abas apagadas.
    await settle();
    await settle();
    expect(screen.queryByText('explore', HIDDEN)).not.toBeOnTheScreen();

    await enterTabs();
    expect(screen.getByText('explore', HIDDEN)).toBeOnTheScreen();
    // Por trás, fora do leitor de tela, e sem trocar de aba.
    expect(screen.queryByText('explore')).not.toBeOnTheScreen();
    expect(view.getPathname()).toBe('/');
    // Só a vizinha: a Ranking fica para quando o fã chegar perto dela.
    expect(screen.queryByText('ranking', HIDDEN)).not.toBeOnTheScreen();
  });

  it('no meio da barra, as duas vizinhas montam por trás', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ranking' });

    await enterTabs();
    expect(screen.getByText('explore', HIDDEN)).toBeOnTheScreen();
    expect(screen.getByText('profile', HIDDEN)).toBeOnTheScreen();
    expect(screen.queryByText('home', HIDDEN)).not.toBeOnTheScreen();
    expect(view.getPathname()).toBe('/ranking');
  });

  it('para a esquerda vai à aba da direita, e o "+" fica de fora', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    await swipe('(inicio)', -FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
    expect(haptics.trigger).toHaveBeenCalledWith('selection');

    // Da Explorar, o vizinho da direita é a Ranking, do outro lado do "+".
    await swipe('(explorar)', -FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/ranking'));

    await swipe('(ranking)', -FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
  });

  it('com reduzir movimento, a vizinha também monta por trás, à mostra para o arraste, e o deslize troca de aba', async () => {
    // A escala de transição do Android em 0 liga reduzir movimento: no aparelho
    // do dono, a página ficava parada e a troca saía seca depois do dedo andar.
    mockReducedMotion = true;
    const view = renderRouter(appTree, { initialUrl: '/' });
    await enterTabs();

    // O navegador não esconde a aba fora de foco: com `display: none`, ela
    // entraria em branco no arraste.
    let node = screen.getByText('explore', HIDDEN).parent;
    let display: unknown;
    while (node && display === undefined) {
      display = (StyleSheet.flatten(node.props.style) as ViewStyle | undefined)?.display;
      node = node.parent;
    }
    expect(display).toBe('flex');

    await swipe('(inicio)', -FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
  });

  it('a aba que abre em foco já nasce à vista, sem o fade na montagem', () => {
    renderRouter(appTree, { initialUrl: '/' });

    // A página é o primeiro pai com opacidade no estilo.
    let node = screen.getByText('home').parent;
    let opacity: unknown;
    while (node && opacity === undefined) {
      opacity = (StyleSheet.flatten(node.props.style) as ViewStyle | undefined)?.opacity;
      node = node.parent;
    }
    expect(opacity).toBe(1);
  });

  it('a barra destaca a aba de destino assim que a página assenta, antes de a troca chegar ao navegador', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    await swipe('(inicio)', -FAR);

    // A página assentou: só a barra redesenha, com o destaque na Explorar.
    await act(async () => {
      jest.runAllTicks();
    });
    expect(screen.getByLabelText('Explorar')).toBeSelected();
    expect(view.getPathname()).toBe('/');

    // A troca no navegador vem na volta seguinte, e a barra segue com ele.
    await settle();
    expect(view.getPathname()).toBe('/explorar');
    expect(screen.getByLabelText('Explorar')).toBeSelected();
    expect(screen.getByLabelText('Início')).not.toBeSelected();
  });

  it('para a direita volta à aba da esquerda', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ranking' });

    await swipe('(ranking)', FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));

    await swipe('(explorar)', FAR);
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });

  it('nas pontas, o deslize não sai da aba', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    await swipe('(inicio)', FAR);
    await settle();
    expect(view.getPathname()).toBe('/');

    view.unmount();
    const profile = renderRouter(appTree, { initialUrl: '/perfil' });
    await swipe('(perfil)', -FAR);
    await settle();
    expect(profile.getPathname()).toBe('/perfil');
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('o deslize curto e devagar devolve a tela ao lugar, e o rápido troca', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    await swipe('(inicio)', -60, -200);
    await settle();
    expect(view.getPathname()).toBe('/');

    await swipe('(inicio)', -60, -900);
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
  });
});
