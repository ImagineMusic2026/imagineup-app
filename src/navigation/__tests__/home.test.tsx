import { FlashList } from '@shopify/flash-list';
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  testRouter,
  waitFor,
} from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Platform, Text } from 'react-native';

import HomeRoute from '@/app/(tabs)/(inicio)/index';
import { buildFanCentralsFixture } from '@/domains/artists/fixtures';
import {
  checkinFixture,
  checkinKeys,
  type CheckinResult,
  type CheckinState,
} from '@/domains/checkin';
import { missionKeys, type Mission } from '@/domains/missions';
import { buildDailyMissionFixture } from '@/domains/missions/fixtures';
import { buildFeedPageFixture } from '@/domains/posts/fixtures';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { dayPeriod } from '@/utils/date';

// O build do Firebase que o Jest resolve é ESM; a home só lê o perfil.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), request: jest.fn(), post: jest.fn() },
}));

// Sem .env no Jest: fixtures, e o aviso de configuração não polui a saída. Os
// testes de falha trocam para a API, com o axios falso respondendo por rota.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum. É o
// mesmo recurso do jestSetup.js do pacote: a lista acha que ocupa a tela toda.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 874 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 112, height: 126 })),
  };
});

const getDocMock = jest.mocked(getDoc);
const get = jest.mocked(api.get);
const post = jest.mocked(api.post);

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

/** As telas da pilha de uma aba (`(ranking)`...), de baixo para cima. */
const tabStack = (view: Router, tab: string): string[] => {
  const find = (node: StateNode | undefined): StateNode | undefined => {
    for (const route of node?.routes ?? []) {
      if (route.name === tab) return route.state;
      const found = find(route.state);
      if (found) return found;
    }
    return undefined;
  };
  return find(view.getRouterState() as StateNode | undefined)?.routes?.map((r) => r.name) ?? [];
};

const failure = () => Promise.reject(new Error('fora do ar'));

/** A API por rota: o que não vier em `overrides` responde como as fixtures. */
function mockApi(overrides: Partial<Record<string, () => Promise<unknown>>> = {}): void {
  mockDataSource = 'api';
  const now = new Date();
  const answers: Record<string, () => Promise<unknown>> = {
    '/missions/daily': async () => ({ mission: buildDailyMissionFixture(now) }),
    '/me/centrals': async () => buildFanCentralsFixture(),
    '/feed': async () => buildFeedPageFixture(now, null),
    '/me/rsvps': async () => ({ eventIds: [] }),
    '/me/invite': async () => ({ code: 'CAMILA12', pointsPerVisit: 2, pointsPerSignup: 10 }),
    ...overrides,
  };
  get.mockImplementation(async (url: string) => {
    const answer = answers[url];
    if (!answer) throw new Error(`rota sem resposta no teste: ${url}`);
    return { data: await answer() } as never;
  });
}

/** Promessa que o teste resolve quando quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const profileSnapshot = {
  exists: () => true,
  data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib', city: null }),
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

/** A árvore das abas com a home de verdade, pela própria rota, e as outras telas vazias. */
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
  '(tabs)/(inicio)/index': HomeRoute,
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(ranking)/missoes': label('missions'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  'post/[postId]': label('post'),
  convidar: label('invite'),
};

const greeting = () => t(`home.greeting.${dayPeriod(new Date())}`);
const headerLabel = (name: string) => t('home.greetingLabel', { greeting: greeting(), name });

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  // O check-in de exemplo volta ao padrão, desligado: o teste que conta com ele liga.
  checkinFixture.reset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: 'uid-camila',
      email: 'camila@teste.imagineup',
      displayName: 'Camila da Sessão',
      photoURL: null,
    },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: 'uid-camila',
  });
  jest.mocked(onSnapshot).mockReturnValue(() => undefined);
  getDocMock.mockResolvedValue(profileSnapshot as never);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

const announcements = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

afterEach(() => {
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  client.clear();
  jest.restoreAllMocks();
});

describe('home (1b)', () => {
  it('monta com as fixtures: missão do dia, centrais e o mural com o post de show', async () => {
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByText('Leve 5 pessoas para o clipe novo do Netto')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Netto Brito, você é o 12º' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Juninho Moraes, central nova' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Do seu fandom' })).toBeTruthy();
    expect(
      await screen.findByRole('button', {
        name: 'Netto Brito, artista verificado, há 2 horas. Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.',
      }),
    ).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Eu vou, Arrocha na Praia' })).toBeTruthy();
  });

  it('o nome do header vem do perfil e cai no da sessão enquanto ele não chega', async () => {
    const profile = deferred<typeof profileSnapshot>();
    getDocMock.mockReturnValue(profile.promise as never);

    renderRouter(appTree, { initialUrl: '/' });
    expect(screen.getByRole('header', { name: headerLabel('Camila da Sessão') })).toBeTruthy();

    await act(async () => profile.resolve(profileSnapshot));
    expect(await screen.findByRole('header', { name: headerLabel('Camila Ribeiro') })).toBeTruthy();
    expect(screen.getByText('CR', { includeHiddenElements: true })).toBeTruthy();
  });

  it('tocar numa central abre o artista dentro da aba Início', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    fireEvent.press(await screen.findByRole('button', { name: 'Netto Brito, você é o 12º' }));

    await waitFor(() => expect(screen.getByText('artist')).toBeTruthy());
    expect(view.getPathname()).toBe('/artista/nettobrito');
    expect(view.getSegments()).toEqual(['(tabs)', '(inicio)', 'artista', '[artistaId]']);
    // Na pilha da aba que já existe, sem empilhar outra árvore de abas.
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it.each([
    ['o avatar', t('home.openProfile')],
    ['"Ver todas" das centrais, que a 1e lista', t('home.centrals.seeAllLabel')],
  ])('%s abre o Perfil', async (_what, name) => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    fireEvent.press(screen.getByRole('button', { name }));
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it('"Ver missões" abre a 1g na pilha do Ranking, com a 1f embaixo', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    fireEvent.press(await screen.findByRole('button', { name: 'Ver missões' }));
    await waitFor(() => expect(view.getPathname()).toBe('/missoes'));
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'missoes']);
    expect(rootRoutes(view)).toEqual(['(tabs)']);
    expect(tabStack(view, '(ranking)')).toEqual(['ranking', 'missoes']);

    // Sem a 1f embaixo, o voltar caía no Início e a aba Ranking só mostrava a 1g.
    act(() => testRouter.back());
    expect(view.getPathname()).toBe('/ranking');
  });

  it('a missão do dia que conclui com a home fora de foco não vibra nem anuncia: quem festeja é a 1g', async () => {
    let daily: Mission = buildDailyMissionFixture(new Date());
    mockApi({ '/missions/daily': async () => ({ mission: daily }) });
    const view = renderRouter(appTree, { initialUrl: '/' });
    fireEvent.press(await screen.findByRole('button', { name: 'Ver missões' }));
    await waitFor(() => expect(view.getPathname()).toBe('/missoes'));

    // Na 1g, o puxar para atualizar manda a missão do dia buscar de novo, e ela concluiu.
    daily = {
      ...daily,
      status: 'completed',
      progress: { ...daily.progress, current: daily.progress.target },
      completedAt: new Date().toISOString(),
    };
    await act(async () => {
      await client.invalidateQueries({ queryKey: missionKeys.daily() });
    });
    // De volta ao Início pela aba: o voltar da 1g leva à 1f, na pilha da Ranking.
    fireEvent.press(screen.getByRole(Platform.OS === 'ios' ? 'button' : 'tab', { name: /inicio/ }));

    expect(
      await screen.findByLabelText(t('missions.daily.summaryCompleted', { points: '20 pontos' })),
    ).toBeTruthy();
    expect(haptics.trigger).not.toHaveBeenCalledWith('missionComplete');
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).not.toHaveBeenCalledWith(
      t('missions.daily.completedAnnouncement', { points: '20 pontos' }),
      expect.anything(),
    );
  });

  it('tocar no texto do post abre o post fora das abas, por cima delas', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Netto Brito, artista verificado, há 2 horas. Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.',
      }),
    );

    await waitFor(() => expect(view.getPathname()).toBe('/post/p-clipe'));
    expect(rootRoutes(view)).toEqual(['(tabs)', 'post/[postId]']);
  });
});

describe('home (1b) quando algo não carrega', () => {
  it('mural que não carregou mostra "Tentar de novo", anuncia uma vez e busca de novo', async () => {
    let feedCalls = 0;
    mockApi({
      '/feed': () => {
        feedCalls += 1;
        return feedCalls === 1
          ? failure()
          : Promise.resolve(buildFeedPageFixture(new Date(), null));
      },
    });
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByLabelText(t('home.feed.loadError'))).toBeTruthy();
    await waitFor(() => expect(announcements()).toEqual([t('home.feed.loadError')]));

    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(
      await screen.findByText('Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.'),
    ).toBeTruthy();
    expect(announcements()).toEqual([t('home.feed.loadError')]);
  });

  it('mural que falha ao buscar de novo, com os posts na tela, avisa no pé da lista', async () => {
    let feedCalls = 0;
    mockApi({
      '/feed': () => {
        feedCalls += 1;
        return feedCalls === 1
          ? Promise.resolve(buildFeedPageFixture(new Date(), null))
          : failure();
      },
    });
    renderRouter(appTree, { initialUrl: '/' });
    await screen.findByText('Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.');

    await act(async () => {
      await client.refetchQueries({ queryKey: ['posts', 'feed'] });
    });

    expect(await screen.findByLabelText(t('home.feed.updateError'))).toBeTruthy();
    // Os posts continuam, e o anúncio é o do que aparece: não o de mural vazio.
    expect(
      screen.getByText('Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.'),
    ).toBeTruthy();
    await waitFor(() => expect(announcements()).toEqual([t('home.feed.updateError')]));
  });

  it('centrais e missão que não carregaram mostram o erro e anunciam', async () => {
    mockApi({ '/me/centrals': failure, '/missions/daily': failure });
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByLabelText(t('home.centrals.loadError'))).toBeTruthy();
    expect(await screen.findByLabelText(t('missions.daily.loadError'))).toBeTruthy();
    await waitFor(() =>
      expect(announcements()).toEqual(
        expect.arrayContaining([t('home.centrals.loadError'), t('missions.daily.loadError')]),
      ),
    );
    expect(announcements()).toHaveLength(2);
  });

  it('sem nenhuma central, o card tracejado leva à aba Explorar', async () => {
    mockApi({ '/me/centrals': async () => [] });
    const view = renderRouter(appTree, { initialUrl: '/' });

    fireEvent.press(await screen.findByRole('button', { name: t('home.centrals.join') }));
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
  });
});

// O check-in diário (seção 39), entre o aviso da conta suspensa e a missão do
// dia: só com a chave do servidor ligada, e em silêncio quando não aparece.
describe('home (1b): o check-in diário', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const OPEN = 'Check-in diário. 4 dias seguidos. Termina em 4 horas.';
  const CLOSED = 'Check-in feito. 5 dias seguidos. Amanhã vale 6 pontos.';
  const ACTION = 'Fazer check-in, vale 5 pontos';
  const hidden = { includeHiddenElements: true } as const;

  /** A resposta do servidor com a chave ligada: 4 dias seguidos, o de hoje por fazer. */
  const pending = (): CheckinState => ({
    enabled: true,
    checkedInToday: false,
    streak: 4,
    best: 4,
    cycle: [3, 3, 4, 4, 5, 6, 15],
    cycleDay: 5,
    todayPoints: 5,
    // Daqui a 4 h e meia: "Termina em 4 h".
    resetsAt: new Date(Date.now() + 4.5 * HOUR_MS).toISOString(),
  });

  const callsTo = (url: string): number =>
    get.mock.calls.filter(([called]) => called === url).length;

  /** Os cabeçalhos da tela, na ordem em que o leitor passa por eles. */
  const headers = (): string[] =>
    screen.getAllByRole('header').map((node) => node.props.accessibilityLabel as string);

  it('nas fixtures, o check-in de exemplo nasce desligado, como a chave do servidor: nada dele aparece na Início', async () => {
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByText('Leve 5 pessoas para o clipe novo do Netto')).toBeTruthy();
    await screen.findByRole('button', { name: 'Netto Brito, você é o 12º' });
    // A resposta de exemplo chegou, com a chave desligada.
    await waitFor(() =>
      expect(client.getQueryData(checkinKeys.state())).toMatchObject({ enabled: false }),
    );
    expect(screen.queryByTestId('checkin-section', hidden)).toBeNull();
    expect(screen.queryByText(/check-in/i, hidden)).toBeNull();
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('nas fixtures, com o exemplo ligado (uma demonstração), o card vem com a sequência do seed', async () => {
    checkinFixture.setEnabled(true);
    renderRouter(appTree, { initialUrl: '/' });

    expect(
      await screen.findByRole('header', { name: /^Check-in diário\. 4 dias seguidos\./ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: ACTION })).toBeTruthy();
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('com a chave ligada, o card vem antes da missão do dia, sem anúncio e sem toque', async () => {
    mockApi({ '/me/checkin': async () => pending() });
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: OPEN })).toBeTruthy();
    await screen.findByRole('header', { name: /^Missão de hoje/ });
    const order = headers();
    const mission = order.findIndex((label) => /^Missão de hoje/.test(label));
    // Depois da saudação e antes da missão do dia.
    expect(order.indexOf(OPEN)).toBe(1);
    expect(mission).toBe(2);
    expect(screen.getByRole('button', { name: ACTION })).toBeEnabled();
    expect(
      screen.getByRole('progressbar', {
        name: 'Dia 5 de 7. O check-in de hoje vale 5 pontos. O dia 7 vale 15 pontos.',
      }),
    ).toBeTruthy();
    await screen.findByRole('button', { name: 'Netto Brito, você é o 12º' });
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('com a chave desligada, nada do check-in aparece, nada é anunciado e nada vibra', async () => {
    mockApi({
      '/me/checkin': async () => ({
        enabled: false,
        checkedInToday: false,
        streak: 0,
        best: 0,
        cycle: [],
        cycleDay: 0,
        todayPoints: 0,
        resetsAt: pending().resetsAt,
      }),
    });
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByText('Leve 5 pessoas para o clipe novo do Netto')).toBeTruthy();
    await screen.findByRole('button', { name: 'Netto Brito, você é o 12º' });
    await waitFor(() => expect(callsTo('/me/checkin')).toBe(1));
    expect(screen.queryByTestId('checkin-section', hidden)).toBeNull();
    expect(screen.queryByText(/check-in/i, hidden)).toBeNull();
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('com a api de antes do check-in (o 404), nada aparece, e nem o puxar para atualizar, nem a volta do app, nem a da rede perguntam de novo', async () => {
    mockApi({
      '/me/checkin': () =>
        Promise.reject(new ApiError('notFound', 'Rota não encontrada.', 404, 'not_found')),
    });
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByText('Leve 5 pessoas para o clipe novo do Netto')).toBeTruthy();
    await screen.findByText('Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.');
    await waitFor(() => expect(callsTo('/me/checkin')).toBe(1));
    expect(screen.queryByTestId('checkin-section', hidden)).toBeNull();
    expect(announcements()).toEqual([]);

    await act(async () => {
      await screen.UNSAFE_getByType(FlashList).props.refreshControl.props.onRefresh();
    });

    // A missão do dia e as centrais buscaram de novo; o check-in, depois do 404, não.
    expect(callsTo('/missions/daily')).toBe(2);
    expect(callsTo('/me/centrals')).toBe(2);
    expect(callsTo('/me/checkin')).toBe(1);

    // Nem na volta do app para a frente, nem na volta da rede, que levam as outras a buscar.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(callsTo('/missions/daily')).toBe(3));
    await waitFor(() => expect(callsTo('/me/centrals')).toBe(3));
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(callsTo('/missions/daily')).toBe(4));
    await waitFor(() => expect(callsTo('/me/centrals')).toBe(4));
    expect(callsTo('/me/checkin')).toBe(1);
    expect(screen.queryByTestId('checkin-section', hidden)).toBeNull();
    expect(announcements()).toEqual([]);
  });

  it('o puxar para atualizar busca o check-in de novo, e a chave ligada no servidor passa a aparecer', async () => {
    let state: CheckinState = { ...pending(), enabled: false, cycle: [], cycleDay: 0 };
    mockApi({ '/me/checkin': async () => state });
    renderRouter(appTree, { initialUrl: '/' });
    await screen.findByText('Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.');
    await waitFor(() => expect(callsTo('/me/checkin')).toBe(1));
    expect(screen.queryByTestId('checkin-section', hidden)).toBeNull();

    // O dono ligou a chave no painel.
    state = pending();
    await act(async () => {
      await screen.UNSAFE_getByType(FlashList).props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByRole('header', { name: OPEN })).toBeTruthy();
    expect(callsTo('/me/checkin')).toBe(2);
  });

  it('o toque em "Fazer check-in" troca o card pela linha do "Check-in feito" e sobe o "+N", sem mexer na missão do dia', async () => {
    const state = pending();
    const result: CheckinResult = {
      pointsAwarded: 5,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
      checkin: { ...state, checkedInToday: true, streak: 5, best: 5 },
    };
    mockApi({ '/me/checkin': async () => state });
    post.mockResolvedValue({ data: result });
    renderRouter(appTree, { initialUrl: '/' });

    fireEvent.press(await screen.findByRole('button', { name: ACTION }));

    expect(await screen.findByRole('header', { name: CLOSED })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ACTION })).toBeNull();
    expect(screen.queryByRole('header', { name: OPEN })).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/me/checkin', null, {
      headers: { 'Idempotency-Key': expect.stringMatching(/^checkin-/) },
    });
    expect(screen.getByTestId('checkin-points', hidden)).toHaveTextContent('+5');
    await waitFor(() =>
      expect(announcements()).toEqual(['Check-in feito. 5 dias seguidos. Mais 5 pontos.']),
    );
    expect(jest.mocked(haptics.trigger).mock.calls).toEqual([['confirm'], ['pointsEarned']]);
    // O estado veio da resposta do toque, e o check-in não anda missão.
    expect(callsTo('/me/checkin')).toBe(1);
    expect(callsTo('/missions/daily')).toBe(1);
    // A missão do dia segue embaixo, como estava.
    expect(screen.getByText('Leve 5 pessoas para o clipe novo do Netto')).toBeTruthy();
  });
});
