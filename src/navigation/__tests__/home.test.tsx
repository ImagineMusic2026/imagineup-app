import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Text } from 'react-native';

import HomeRoute from '@/app/(tabs)/(inicio)/index';
import { buildFanCentralsFixture } from '@/domains/artists/fixtures';
import { buildDailyMissionFixture } from '@/domains/missions/fixtures';
import { buildFeedPageFixture } from '@/domains/posts/fixtures';
import { t } from '@/i18n';
import { api } from '@/services/api';
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
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));

// Sem .env no Jest: fixtures, e o aviso de configuração não polui a saída. Os
// testes de falha trocam para a API, com o axios falso respondendo por rota.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  get dataSource() {
    return mockDataSource;
  },
  firebaseEmulatorHost: undefined,
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

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
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
  '(tabs)/(inicio,explorar,perfil)/artista/[artistaId]': label('artist'),
  'post/[postId]': label('post'),
  convidar: label('invite'),
};

const greeting = () => t(`home.greeting.${dayPeriod(new Date())}`);
const headerLabel = (name: string) => t('home.greetingLabel', { greeting: greeting(), name });

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
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
    expect(view.getPathname()).toBe('/artista/netto-brito');
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

  it('"Ver missões" abre a 1g na pilha do Ranking', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });

    fireEvent.press(await screen.findByRole('button', { name: 'Ver missões' }));
    await waitFor(() => expect(view.getPathname()).toBe('/missoes'));
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'missoes']);
    expect(rootRoutes(view)).toEqual(['(tabs)']);
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
