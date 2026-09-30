import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  testRouter,
  waitFor,
} from 'expo-router/testing-library';
import { AccessibilityInfo, Text } from 'react-native';

import MissionsRoute from '@/app/(tabs)/(ranking)/missoes';
import { missionKeys, missionsFixture } from '@/domains/missions';
import { buildMissionsFixture, RSVP_MISSION_POINTS } from '@/domains/missions/fixtures';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

// O axios do app puxa o Firebase, que no Jest é ESM; a 1g só lê pela API.
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

// Sem .env no Jest: fixtures. Os testes de falha trocam para a API.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  get dataSource() {
    return mockDataSource;
  },
  firebaseEmulatorHost: undefined,
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
// Com a tela alta, todas as missões cabem na primeira janela; um teste baixa a
// tela para deixar as últimas fora da janela que a lista desenha.
let mockScreenHeight = 2400;
let mockItemHeight = 68;
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = () => ({ x: 0, y: 0, width: 402, height: mockScreenHeight });
  return {
    ...actual,
    measureParentSize: jest.fn(screenSize),
    measureFirstChildLayout: jest.fn(screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 366, height: mockItemHeight })),
  };
});

const get = jest.mocked(api.get);
const hidden = { includeHiddenElements: true } as const;

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

let client: QueryClient;

function RootLayout() {
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

/** A árvore das abas com a 1g de verdade, pela própria rota, e as outras telas vazias. */
const appTree = {
  _layout: RootLayout,
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(inicio,explorar,ranking,perfil)/_layout': {
    default: () => <Stack screenOptions={{ headerShown: false }} />,
    unstable_settings: {
      inicio: { anchor: 'index' },
      explorar: { anchor: 'explorar' },
      ranking: { anchor: 'ranking' },
      perfil: { anchor: 'perfil' },
    },
  },
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(explorar,ranking)/agenda': label('agenda'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(ranking)/missoes': MissionsRoute,
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  'post/[postId]': label('post'),
  convidar: label('invite'),
};

const FEATURED =
  'Leve 5 pessoas para o clipe novo do Netto. 3 de 5. Vale 20 pontos, 2 por visita e 10 por cadastro.';
const LIKE = 'Curta 5 posts do Nenho. Você tem 2 de 5. Vale 10 pontos.';
const COMMENT = /^Comente em 3 posts da central\. Concluída às \d\d:\d\d\. Rendeu 20 pontos\.$/;
const FLASH =
  'Missão relâmpago do show. Bloqueada. Abre quando o Netto subir no palco. Vale 50 pontos.';
const INVITE = 'Traga 3 amigos novos pro app. 1 de 3 cadastrados. Vale 30 pontos.';
const RSVP = /^Confirme presença em um show\. São João de Irará, 21 de \p{L}+\. Vale 15 pontos\.$/u;
const RSVP_DONE = /^Confirme presença em um show\. Concluída às \d\d:\d\d\. Rendeu 15 pontos\.$/;
const SEASON = (done: number) =>
  `Semana do arrocha. ${done} de 20 concluídas. Complete 20 missões e garanta um lote de ingressos do São João.`;

const announcements = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  mockScreenHeight = 2400;
  mockItemHeight = 68;
  missionsFixture.reset();
  fixtureWallet.reset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('missões (1g)', () => {
  it('monta com as fixtures: meta da temporada, "Hoje" com o card lima e "Esta semana"', async () => {
    renderRouter(appTree, { initialUrl: '/missoes' });

    expect(screen.getByRole('header', { name: 'Missões' })).toBeTruthy();
    expect(screen.getByLabelText(t('missions.loading'))).toBeTruthy();

    expect(await screen.findByRole('progressbar', { name: SEASON(12) })).toBeTruthy();
    const sections = screen.getAllByRole('header').map((node) => node.props.children);
    expect(sections).toEqual(['Missões', 'Hoje', 'Esta semana']);
    expect(screen.getByRole('button', { name: FEATURED })).toBeTruthy();
    expect(screen.getByRole('button', { name: LIKE })).toBeTruthy();
    expect(screen.getByLabelText(COMMENT)).toBeTruthy();
    expect(screen.getByRole('button', { name: FLASH })).toBeTruthy();
    expect(screen.getByRole('button', { name: INVITE })).toBeTruthy();
    expect(screen.getByRole('button', { name: RSVP })).toBeTruthy();
    // Nada de playlist, que está fora do contrato.
    expect(screen.queryByText(/playlist/i, hidden)).toBeNull();
  });

  it('o voltar vem na linha do título, antes dele, e volta para o Ranking', async () => {
    const view = renderRouter(appTree, { initialUrl: '/missoes' });
    await screen.findByRole('button', { name: FEATURED });

    const order = screen
      .getAllByRole(/button|header/)
      .slice(0, 2)
      .map((node) => node.props.accessibilityLabel ?? node.props.children);
    expect(order).toEqual([t('common.back'), 'Missões']);

    fireEvent.press(screen.getByRole('button', { name: t('common.back') }));
    await waitFor(() => expect(view.getPathname()).toBe('/ranking'));
  });

  it.each([
    [
      'o card lima de compartilhar abre o link de convite com o post, como o "Gerar meu link" da home',
      FEATURED,
      '/convidar',
      { missionId: 'm-clipe-netto', postId: 'p-clipe' },
    ],
    ['convidar abre o link de convite', INVITE, '/convidar', { missionId: 'm-trazer-amigos' }],
    ['presença em show abre a agenda', RSVP, '/agenda', {}],
    ['curtir abre a central do artista', LIKE, '/artista/nenho', {}],
  ])('%s', async (_what, name, pathname, params) => {
    const view = renderRouter(appTree, { initialUrl: '/missoes' });

    fireEvent.press(await screen.findByRole('button', { name }));

    await waitFor(() => expect(view.getPathname()).toBe(pathname));
    expect(view.getSearchParams()).toEqual(expect.objectContaining(params));
    // Sem empilhar outra árvore de abas.
    expect(rootRoutes(view)[0]).toBe('(tabs)');
    expect(rootRoutes(view).filter((route) => route === '(tabs)')).toHaveLength(1);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });

  it('agenda e central do artista abrem por cima da 1g, na aba Ranking, e o voltar devolve a ela', async () => {
    // Como o fã chega: da home, pelo "+" ou pelo "Ver missões".
    const view = renderRouter(appTree, { initialUrl: '/' });
    act(() => router.push('/missoes'));

    fireEvent.press(await screen.findByRole('button', { name: RSVP }));
    await waitFor(() => expect(view.getPathname()).toBe('/agenda'));
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'agenda']);
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/missoes'));

    fireEvent.press(await screen.findByRole('button', { name: LIKE }));
    await waitFor(() => expect(view.getPathname()).toBe('/artista/nenho'));
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'artista', '[artistaId]']);
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/missoes'));
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it('a bloqueada não navega: vibra "bloqueada" e diz quando abre', async () => {
    const view = renderRouter(appTree, { initialUrl: '/missoes' });

    fireEvent.press(await screen.findByRole('button', { name: FLASH }));

    expect(haptics.trigger).toHaveBeenCalledWith('locked');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Bloqueada. Abre quando o Netto subir no palco',
    );
    expect(view.getPathname()).toBe('/missoes');
  });

  it('a missão concluída em outra tela festeja quando o fã volta: check, "+15" e um toque só', async () => {
    const view = renderRouter(appTree, { initialUrl: '/missoes' });

    // O fã sai da 1g (abre o convite, por cima das abas) e confirma presença
    // num show: o servidor conclui a missão, e a lista busca de novo com a
    // tela por baixo.
    fireEvent.press(await screen.findByRole('button', { name: INVITE }));
    await waitFor(() => expect(view.getPathname()).toBe('/convidar'));
    await act(async () => {
      expect(missionsFixture.record('rsvp')).toBe(RSVP_MISSION_POINTS);
      await client.invalidateQueries({ queryKey: missionKeys.all });
    });
    expect(haptics.trigger).not.toHaveBeenCalledWith('missionComplete');
    expect(announcements()).toEqual([]);

    act(() => testRouter.back());

    await waitFor(() => expect(haptics.trigger).toHaveBeenCalledWith('missionComplete'));
    expect(screen.getByText('+15', hidden)).toBeTruthy();
    expect(screen.getByLabelText(RSVP_DONE)).toBeTruthy();
    // "Rendeu", e não "Mais": o "Eu vou" já anunciou o ganho quando o fã agiu.
    expect(announcements()).toEqual([
      'Missão concluída: Confirme presença em um show. Rendeu 15 pontos',
    ]);
    expect(screen.getByRole('progressbar', { name: SEASON(13) })).toBeTruthy();
    expect(
      jest.mocked(haptics.trigger).mock.calls.filter(([event]) => event === 'missionComplete'),
    ).toHaveLength(1);
  });

  it('a missão concluída fora da janela que a lista desenha também toca e é anunciada', async () => {
    // Tela baixa (fonte grande, aparelho pequeno): "Esta semana" fica fora da
    // janela da FlashList, e a linha de presença nem chega a ser montada.
    mockScreenHeight = 120;
    mockItemHeight = 200;
    const view = renderRouter(appTree, { initialUrl: '/missoes' });

    fireEvent.press(await screen.findByRole('button', { name: FEATURED }));
    await waitFor(() => expect(view.getPathname()).toBe('/convidar'));
    await act(async () => {
      missionsFixture.record('rsvp');
      await client.invalidateQueries({ queryKey: missionKeys.all });
    });
    act(() => testRouter.back());

    await waitFor(() => expect(haptics.trigger).toHaveBeenCalledWith('missionComplete'));
    expect(screen.queryByLabelText(RSVP_DONE, hidden)).toBeNull();
    expect(announcements()).toEqual([
      'Missão concluída: Confirme presença em um show. Rendeu 15 pontos',
    ]);
  });

  it('a primeira carga, com missões já concluídas, não festeja', async () => {
    missionsFixture.record('rsvp');
    renderRouter(appTree, { initialUrl: '/missoes' });
    await screen.findByRole('button', { name: FEATURED });

    expect(haptics.trigger).not.toHaveBeenCalledWith('missionComplete');
    expect(screen.queryByText('+15', hidden)).toBeNull();
  });
});

describe('missões (1g) quando algo não carrega', () => {
  it('lista que não carregou mostra "Tentar de novo", anuncia uma vez e busca de novo', async () => {
    mockDataSource = 'api';
    get
      .mockRejectedValueOnce(new Error('fora do ar'))
      .mockResolvedValue({ data: buildMissionsFixture(new Date()) });
    renderRouter(appTree, { initialUrl: '/missoes' });

    expect(await screen.findByLabelText(t('missions.loadError'))).toBeTruthy();
    await waitFor(() => expect(announcements()).toEqual([t('missions.loadError')]));
    expect(get).toHaveBeenCalledWith('/missions');

    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('button', { name: FEATURED })).toBeTruthy();
    // O botão (com o foco do leitor) sumiu com o erro: o fã ouve que a lista chegou.
    await waitFor(() =>
      expect(announcements()).toEqual([t('missions.loadError'), t('missions.loaded')]),
    );
  });

  it('a falha de atualizar com a 1g fora de foco só é anunciada quando o fã volta', async () => {
    mockDataSource = 'api';
    get.mockResolvedValueOnce({ data: buildMissionsFixture(new Date()) });
    const view = renderRouter(appTree, { initialUrl: '/missoes' });
    fireEvent.press(await screen.findByRole('button', { name: INVITE }));
    await waitFor(() => expect(view.getPathname()).toBe('/convidar'));

    // Outra tela manda as missões buscarem de novo (o "Eu vou"), e a busca falha.
    get.mockRejectedValue(new Error('fora do ar'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: missionKeys.all });
    });
    expect(announcements()).toEqual([]);

    act(() => testRouter.back());
    await waitFor(() => expect(announcements()).toEqual([t('missions.updateError')]));
    expect(screen.getByLabelText(t('missions.updateError'))).toBeTruthy();
  });

  it('com a lista em mãos e nenhuma missão, a falha diz "atualizar", como o anúncio', async () => {
    mockDataSource = 'api';
    get
      .mockResolvedValueOnce({ data: { season: null, missions: [] } })
      .mockRejectedValue(new Error('fora do ar'));
    renderRouter(appTree, { initialUrl: '/missoes' });
    expect(await screen.findByLabelText(t('missions.empty'))).toBeTruthy();

    await act(async () => {
      await client.invalidateQueries({ queryKey: missionKeys.all });
    });

    expect(await screen.findByLabelText(t('missions.updateError'))).toBeTruthy();
    expect(screen.queryByLabelText(t('missions.loadError'))).toBeNull();
    await waitFor(() => expect(announcements()).toEqual([t('missions.updateError')]));
  });

  it('sem temporada e sem missões, diz que não há missões por agora', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { season: null, missions: [] } });
    renderRouter(appTree, { initialUrl: '/missoes' });

    expect(await screen.findByLabelText(t('missions.empty'))).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('header', { name: 'Hoje' })).toBeNull();
  });
});
