import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, renderRouter, testRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

/**
 * Reproduz a árvore de src/app com telas vazias, para travar o comportamento
 * das rotas compartilhadas: o artista e a agenda abrem dentro da aba de onde
 * vieram e, vindo de um link, a raiz da aba fica embaixo dele na pilha.
 */
const tabStackSettings = {
  inicio: { anchor: 'index' },
  explorar: { anchor: 'explorar' },
  ranking: { anchor: 'ranking' },
  perfil: { anchor: 'perfil' },
};

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

const appTree = {
  _layout: () => <Stack />,
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(inicio,explorar,ranking,perfil)/_layout': {
    default: () => <Stack />,
    unstable_settings: tabStackSettings,
  },
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(explorar,ranking)/agenda': label('agenda'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(ranking)/missoes': label('missions'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  'post/[postId]': label('post'),
  'fa/[fanId]': label('fan'),
  'editar-perfil': label('edit-profile'),
  'recompensa/[recompensaId]': label('reward'),
  'convite/[codigo]': label('invite'),
};

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

describe('rotas do app', () => {
  it('a raiz abre o Início', () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    expect(view.getPathname()).toBe('/');
    expect(view.getByText('home')).toBeTruthy();
  });

  it('um link de artista abre a página do artista', () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/nettobrito' });
    expect(view.getPathname()).toBe('/artista/nettobrito');
    expect(view.getByText('artist')).toBeTruthy();
    expect(view.getSegments()).toEqual(['(tabs)', '(inicio)', 'artista', '[artistaId]']);
  });

  it('vindo de um link, o voltar do artista leva à raiz da aba', () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/nettobrito' });
    expect(testRouter.canGoBack()).toBe(true);
    testRouter.back();
    // O Expo Router repassa os parâmetros do link para a âncora (/?artistaId=...).
    expect(view.getPathname()).toBe('/');
    expect(view.getByText('home')).toBeTruthy();
  });

  it('um link da agenda abre na aba Explorar, com a raiz dela embaixo', () => {
    const view = renderRouter(appTree, { initialUrl: '/agenda' });
    expect(view.getSegments()).toEqual(['(tabs)', '(explorar)', 'agenda']);
    testRouter.back();
    expect(view.getPathname()).toBe('/explorar');
  });

  it('as telas da aba Ranking têm endereço próprio', () => {
    const view = renderRouter(appTree, { initialUrl: '/missoes' });
    expect(view.getByText('missions')).toBeTruthy();
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'missoes']);
  });

  it('o post abre fora das abas, sem tab bar', () => {
    const view = renderRouter(appTree, { initialUrl: '/post/99' });
    expect(view.getByText('post')).toBeTruthy();
    expect(view.getSegments()).toEqual(['post', '[postId]']);
  });

  it('o perfil público de outro fã abre fora das abas, com o id no parâmetro', () => {
    const view = renderRouter(appTree, { initialUrl: '/fa/fa-rank-01' });
    expect(view.getByText('fan')).toBeTruthy();
    expect(view.getPathname()).toBe('/fa/fa-rank-01');
    expect(view.getSegments()).toEqual(['fa', '[fanId]']);
    expect(view.getSearchParams()).toEqual({ fanId: 'fa-rank-01' });
  });

  it('"Editar perfil" abre fora das abas, na pilha raiz, com o mesmo endereço de antes', () => {
    const view = renderRouter(appTree, { initialUrl: '/editar-perfil' });
    expect(view.getByText('edit-profile')).toBeTruthy();
    expect(view.getPathname()).toBe('/editar-perfil');
    expect(view.getSegments()).toEqual(['editar-perfil']);
  });

  it('o detalhe do resgate abre fora das abas, como a sheet do convite', () => {
    const view = renderRouter(appTree, { initialUrl: '/recompensa/videochamada' });
    expect(view.getByText('reward')).toBeTruthy();
    expect(view.getSegments()).toEqual(['recompensa', '[recompensaId]']);
    expect(view.getSearchParams()).toEqual({ recompensaId: 'videochamada' });
  });

  it('o convite tem rota própria, fora das abas', () => {
    const view = renderRouter(appTree, { initialUrl: '/convite/ABC123' });
    expect(view.getPathname()).toBe('/convite/ABC123');
    expect(view.getByText('invite')).toBeTruthy();
  });

  // Os links a frio ficam antes: o Jest guarda os segmentos da última
  // navegação, e o Expo Router escolhe a aba de uma rota compartilhada por eles.
  it('a agenda aberta pela Explorar fica na pilha da Explorar', () => {
    const view = renderRouter(appTree, { initialUrl: '/explorar' });
    act(() => router.push('/agenda'));
    expect(view.getSegments()).toEqual(['(tabs)', '(explorar)', 'agenda']);
    act(() => testRouter.back());
    expect(view.getPathname()).toBe('/explorar');
  });

  it('o perfil público aberto pelo ranking empilha por cima das abas, e o voltar devolve à 1f', () => {
    const view = renderRouter(appTree, { initialUrl: '/ranking' });
    act(() => router.push({ pathname: '/fa/[fanId]', params: { fanId: 'fa-rank-04' } }));
    expect(view.getByText('fan')).toBeTruthy();
    expect(rootRoutes(view)).toEqual(['(tabs)', 'fa/[fanId]']);
    act(() => testRouter.back());
    expect(view.getPathname()).toBe('/ranking');
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it('agenda e artista abertos pelas missões ficam na pilha do Ranking, e o voltar devolve às missões', () => {
    // Como o fã chega à 1g: pelo "+" ou pelo "Ver missões" da home.
    const view = renderRouter(appTree, { initialUrl: '/' });
    act(() => router.push('/missoes'));

    act(() => router.push('/agenda'));
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'agenda']);
    act(() => testRouter.back());
    expect(view.getPathname()).toBe('/missoes');

    act(() => router.push({ pathname: '/artista/[artistaId]', params: { artistaId: 'nenho' } }));
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'artista', '[artistaId]']);
    act(() => testRouter.back());
    expect(view.getPathname()).toBe('/missoes');
  });
});
