import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Text } from 'react-native';

import LedgerRoute from '@/app/(tabs)/(perfil)/extrato';
import ProfileRoute from '@/app/(tabs)/(perfil)/perfil';
import { buildFanCentralsFixture, followFixture } from '@/domains/artists/fixtures';
import type { LedgerEntry, LedgerPage } from '@/domains/profile';
import { buildMyAchievementsFixture, buildMyProgressFixture } from '@/domains/profile/fixtures';
import { api } from '@/services/api';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// O build do Firebase que o Jest resolve é ESM; o perfil só lê users/{uid}.
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
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

// Sem .env no Jest: fixtures. Os testes da paginação e das falhas trocam para a API.
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

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 2400 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 64 })),
  };
});

// Relógio fixo, nas fixtures e na tela: terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const mockNow = NOW;
jest.mock('@/hooks/use-now', () => ({ useNow: () => mockNow }));

const get = jest.mocked(api.get);
const hidden = { includeHiddenElements: true } as const;

const profileSnapshot = {
  exists: () => true,
  data: () => ({
    displayName: 'Camila Ribeiro',
    username: 'camilarib',
    city: 'Feira de Santana, BA',
    photoURL: null,
  }),
  metadata: { fromCache: false },
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

/** As abas com a 1e e o extrato de verdade, pelas próprias rotas, e as outras telas vazias. */
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
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': ProfileRoute,
  '(tabs)/(perfil)/extrato': LedgerRoute,
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
};

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

const POINTS_CARD =
  'Seus pontos: 12.480. Esta semana: mais 840. Faltam 2.520 pontos para o nível 8, Xodó.';

const announcements = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

const at = (daysAgo: number, hours: number, minutes: number): string =>
  new Date(2026, 8, 29 - daysAgo, hours, minutes).toISOString();

function entry(id: string, fields: Partial<LedgerEntry>): LedgerEntry {
  return {
    id,
    kind: 'earn',
    source: 'like',
    points: 0,
    xpDelta: 0,
    seasonDelta: 0,
    artistId: null,
    centralSeasonDelta: 0,
    centralTotalDelta: 0,
    subject: null,
    createdAt: at(0, 19, 30),
    artistName: null,
    subjectTitle: null,
    ...fields,
  };
}

const LIKE = entry('like:p-nenho-4', {
  points: 10,
  xpDelta: 10,
  seasonDelta: 10,
  artistId: 'nenho',
  artistName: 'Nenho',
  centralSeasonDelta: 10,
  centralTotalDelta: 10,
});
// Só a central mexeu: a tela esconde, e a página fica sem linha visível.
const CENTRAL_ONLY = entry('seed:camila-base-netto', {
  kind: 'adjust',
  source: 'seed',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  centralSeasonDelta: 3_620,
  centralTotalDelta: 3_620,
  createdAt: at(1, 12, 0),
});
const REDEEM = entry('redeem:r-1', {
  kind: 'spend',
  source: 'redeem',
  points: -1_000,
  createdAt: at(1, 9, 5),
});

/**
 * A API por rota: o extrato pela função dada (com o cursor), o resto do
 * perfil (a 1e embaixo na pilha) como nas fixtures.
 */
function mockApi(ledger: (cursor: string | null) => LedgerPage | Promise<LedgerPage>): void {
  mockDataSource = 'api';
  const answers: Record<string, () => unknown> = {
    '/me/wallet': () => fixtureWallet.get(),
    '/me/progress': () => buildMyProgressFixture(),
    '/me/achievements': () => buildMyAchievementsFixture(NOW),
    '/me/centrals': () => buildFanCentralsFixture(),
  };
  get.mockImplementation(async (url, config) => {
    if (url === '/me/ledger') {
      const cursor = (config?.params as { cursor?: string } | undefined)?.cursor ?? null;
      return { data: await ledger(cursor) } as never;
    }
    const answer = answers[url];
    if (!answer) throw new Error(`rota sem resposta no teste: ${url}`);
    return { data: answer() } as never;
  });
}

const ledgerCursors = () =>
  get.mock.calls
    .filter(([url]) => url === '/me/ledger')
    .map(([, config]) => (config as { params?: { cursor?: string } } | undefined)?.params?.cursor);

beforeEach(() => {
  jest.clearAllMocks();
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  fixtureWallet.reset();
  followFixture.reset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, networkMode: 'always' } },
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
  jest.mocked(getDoc).mockResolvedValue(profileSnapshot as never);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  setFixtureNow(null);
  jest.restoreAllMocks();
});

describe('extrato de pontos (bloco 7, provisório)', () => {
  it('o card de pontos da 1e é um botão que abre o extrato na pilha do Perfil', async () => {
    const view = renderRouter(appTree, { initialUrl: '/perfil' });

    const card = await screen.findByRole('button', { name: POINTS_CARD });
    expect(card).toHaveProp('accessibilityHint', 'Abre o extrato de pontos.');
    fireEvent.press(card);

    await waitFor(() => expect(view.getPathname()).toBe('/extrato'));
    // Dentro das abas, com a tab bar, e não por cima delas.
    expect(view.getSegments()).toEqual(['(tabs)', '(perfil)', 'extrato']);
    expect(rootRoutes(view)).toEqual(['(tabs)']);
    expect(await screen.findByRole('header', { name: 'Extrato' })).toBeTruthy();

    // O voltar devolve o fã ao perfil.
    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
  });

  it('nas fixtures, cada linha diz a origem, o contexto, o valor e a hora, agrupadas por dia', async () => {
    renderRouter(appTree, { initialUrl: '/extrato' });

    const mission = await screen.findByTestId('ledger-mission:seed-camila-4');
    expect(mission).toHaveProp(
      'accessibilityLabel',
      'Missão concluída, Curta 5 posts do Nenho, mais 100 pontos, ontem às 12:00.',
    );
    expect(within(mission).getByText('Missão concluída', hidden)).toBeTruthy();
    expect(within(mission).getByText('Curta 5 posts do Nenho · 12:00', hidden)).toBeTruthy();
    expect(within(mission).getByText('+100', hidden)).toBeTruthy();
    // Sem contexto (o saldo do seed), só a hora; e a data por extenso para o leitor.
    expect(screen.getByTestId('ledger-seed:camila-base')).toHaveProp(
      'accessibilityLabel',
      'Ajuste, mais 11.240 pontos, em 21 de setembro às 12:00.',
    );
    // Uma sobrelinha por dia: ontem, domingo e a segunda do saldo do seed.
    expect(screen.getByText('Ontem', hidden)).toBeTruthy();
    expect(screen.getByText('dom., 27 set', hidden)).toBeTruthy();
    expect(screen.getByText('seg., 21 set', hidden)).toBeTruthy();
    expect(screen.getAllByText(/^\p{L}+\., \d+ set$/u, hidden)).toHaveLength(12);
    // Os ajustes só de central (saldo, XP e temporada em 0) ficam de fora.
    expect(screen.queryByTestId('ledger-seed:camila-base-netto')).toBeNull();
    expect(screen.queryByTestId('ledger-seed:camila-base-nenho')).toBeNull();
    // As temporadas passadas do seed (bloco 8): ajustes só de temporada, que aparecem,
    // e o extrato fica com os 17 lançamentos do servidor.
    expect(screen.getByTestId('ledger-seed:camila-carnaval')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Ajuste, mais 290 pontos, em 5 de agosto às 12:00\.$/),
    );
    expect(screen.getByTestId('ledger-seed:camila-verao')).toHaveProp(
      'accessibilityLabel',
      expect.stringMatching(/^Ajuste, mais 510 pontos, em 26 de junho às 12:00\.$/),
    );
  });

  it('com a API, a página sem linha visível pede a seguinte sozinha, uma vez cada', async () => {
    const pages: Record<string, LedgerPage> = {
      first: { items: [LIKE], nextCursor: 'p2' },
      p2: { items: [CENTRAL_ONLY], nextCursor: 'p3' },
      p3: { items: [REDEEM], nextCursor: null },
    };
    mockApi((cursor) => pages[cursor ?? 'first']);
    renderRouter(appTree, { initialUrl: '/extrato' });

    expect(await screen.findByTestId('ledger-like:p-nenho-4')).toHaveProp(
      'accessibilityLabel',
      'Curtida, Nenho, mais 10 pontos, hoje às 19:30.',
    );
    // O resgate desconta: "-1.000" no texto padrão, "menos" para o leitor.
    expect(await screen.findByTestId('ledger-redeem:r-1')).toHaveProp(
      'accessibilityLabel',
      'Resgate, menos 1.000 pontos, ontem às 09:05.',
    );
    expect(screen.getByText('-1.000', hidden)).toBeTruthy();
    expect(screen.getByText('Hoje', hidden)).toBeTruthy();
    expect(screen.getByText('Ontem', hidden)).toBeTruthy();
    expect(screen.queryByTestId('ledger-seed:camila-base-netto')).toBeNull();
    await waitFor(() => expect(ledgerCursors()).toEqual([undefined, 'p2', 'p3']));
  });

  it('sem lançamento, diz de onde vêm os pontos', async () => {
    mockApi(() => ({ items: [], nextCursor: null }));
    renderRouter(appTree, { initialUrl: '/extrato' });

    expect(
      await screen.findByText(
        'Seus pontos aparecem aqui quando você curte, comenta, entra numa central ou conclui uma missão.',
      ),
    ).toBeTruthy();
  });

  it('a falha sem nada carregado mostra o erro, anunciado, e o "Tentar de novo" que dá certo avisa', async () => {
    let fail = true;
    mockApi(() => {
      if (fail) throw new Error('fora do ar');
      return { items: [LIKE], nextCursor: null };
    });
    renderRouter(appTree, { initialUrl: '/extrato' });

    expect(await screen.findByText('Não deu para carregar o extrato.')).toBeTruthy();
    await waitFor(() => expect(announcements()).toContain('Não deu para carregar o extrato.'));

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByTestId('ledger-like:p-nenho-4')).toBeTruthy();
    await waitFor(() => expect(announcements()).toContain('Extrato carregado.'));
    expect(screen.queryByText('Não deu para carregar o extrato.')).toBeNull();
  });

  it('a página seguinte que falha tem aviso próprio, anunciado, e o "Tentar de novo" busca só ela', async () => {
    let fail = true;
    mockApi((cursor) => {
      if (cursor === null) return { items: [LIKE], nextCursor: 'p2' };
      if (fail) throw new Error('fora do ar');
      return { items: [REDEEM], nextCursor: null };
    });
    renderRouter(appTree, { initialUrl: '/extrato' });

    expect(await screen.findByText('Não deu para carregar mais lançamentos.')).toBeTruthy();
    await waitFor(() =>
      expect(announcements()).toContain('Não deu para carregar mais lançamentos.'),
    );
    expect(screen.queryByText('Não deu para atualizar o extrato.')).toBeNull();
    // A lista que já veio fica, e o fim da lista não insiste sozinho.
    expect(screen.getByTestId('ledger-like:p-nenho-4')).toBeTruthy();
    expect(ledgerCursors()).toEqual([undefined, 'p2']);

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByTestId('ledger-redeem:r-1')).toBeTruthy();
    await waitFor(() => expect(announcements()).toContain('Mais lançamentos carregados.'));
    // Só a página que faltou: as já carregadas não foram buscadas de novo.
    expect(ledgerCursors()).toEqual([undefined, 'p2', 'p2']);
    expect(announcements()).not.toContain('Extrato carregado.');
    expect(screen.queryByText('Não deu para carregar mais lançamentos.')).toBeNull();
  });
});
