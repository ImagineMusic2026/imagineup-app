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
  'convite/[codigo]': label('invite'),
};

describe('rotas do app', () => {
  it('a raiz abre o Início', () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    expect(view.getPathname()).toBe('/');
    expect(view.getByText('home')).toBeTruthy();
  });

  it('um link de artista abre a página do artista', () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/netto-brito' });
    expect(view.getPathname()).toBe('/artista/netto-brito');
    expect(view.getByText('artist')).toBeTruthy();
    expect(view.getSegments()).toEqual(['(tabs)', '(inicio)', 'artista', '[artistaId]']);
  });

  it('vindo de um link, o voltar do artista leva à raiz da aba', () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/netto-brito' });
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
