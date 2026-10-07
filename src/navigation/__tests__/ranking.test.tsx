import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { AccessibilityInfo, ScrollView, Text } from 'react-native';

import RankingRoute from '@/app/(tabs)/(ranking)/ranking';
import { followFixture } from '@/domains/artists/fixtures';
import { GLOBAL_SCOPE, rankingKeys } from '@/domains/ranking';
import { buildSeasonFixture } from '@/domains/ranking/fixtures';
import type { LeaderboardEntry, MyRank, Season } from '@/domains/ranking';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { motion } from '@/theme';

// O build do Firebase que o Jest resolve é ESM; o card "Você" lê o nome do
// perfil, que vem do Firestore.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

// Sem .env no Jest: fixtures. Os testes de resposta do servidor trocam para a API;
// os do modo misto põem só um domínio nela (`mockDomainSources`).
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
let mockDomainSources: Record<string, 'api' | 'fixtures'> = {};
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => mockDomainSources[domain] ?? mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
// A tela é baixa: a linha do fã (12º) começa fora dela, embaixo do card "Você".
const SCREEN_HEIGHT = 420;
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 420 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 59 })),
  };
});

// Relógio fixo, nas fixtures e na tela: terça, 29 de setembro de 2026, 20 h.
// O teste pode andar com ele com a tela aberta (`tickClockTo`), como o
// `useNow` de verdade anda a cada minuto.
const NOW = new Date(2026, 8, 29, 20, 0);
let mockNow = NOW;
const mockNowListeners = new Set<() => void>();
jest.mock('@/hooks/use-now', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const subscribe = (listener: () => void) => {
    mockNowListeners.add(listener);
    return () => {
      mockNowListeners.delete(listener);
    };
  };
  return { useNow: () => useSyncExternalStore(subscribe, () => mockNow) };
});

function tickClockTo(next: Date): void {
  act(() => {
    mockNow = next;
    mockNowListeners.forEach((listener) => listener());
  });
}

const get = jest.mocked(api.get);
const hidden = { includeHiddenElements: true } as const;

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

/** As abas com a 1f de verdade e as outras telas vazias. */
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
  '(tabs)/(ranking)/ranking': RankingRoute,
  '(tabs)/(ranking)/missoes': label('missions'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
};

const PODIUM = [
  '1º lugar, Thalita S., 9.140 pontos, Líder da temporada',
  '2º lugar, Davi L., 7.902 pontos',
  '3º lugar, Jean P., 7.318 pontos',
];
const ME_GLOBAL = 'Você, 12º lugar, 4.120 pontos. Faltam 840 pontos para entrar no top 10.';
const ME_NENHO = /^Você, 41º lugar, 2\.980 pontos\. Faltam [\d.]+ pontos para entrar no top 10\.$/;
const ME_UNRANKED = 'Você. Ganhe pontos para entrar no ranking.';
const ME_NOT_MEMBER = 'Você. Entre na central para aparecer no ranking.';

const announced = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

/** Os chips do ranking, pela dica que só eles têm. */
const chips = () => screen.getAllByHintText(/^Mostra o ranking/);
const selectedChip = () =>
  chips()
    .filter((chip) => chip.props.accessibilityState?.selected)
    .map((chip) => chip.props.accessibilityLabel as string);

/** O card "Você", à vista ou não. */
const meCard = () => screen.getByTestId('ranking-me', hidden);

/**
 * Rola a lista da 1f: o evento vai à rolagem de dentro da FlashList, que
 * desenha as linhas daquele trecho e repassa o evento à tela.
 */
function scrollListTo(y: number): void {
  const [scroller] = screen
    .UNSAFE_getByType(FlashList)
    .findAll((node) => node.type === ScrollView && node.props.horizontal !== true);
  if (!scroller) throw new Error('lista sem rolagem');
  fireEvent.scroll(scroller, scrollEvent(y));
}

/** Até onde a lista rolou (a FlashList chama o scrollTo do ScrollView). */
const scrolledTo = () =>
  jest
    .mocked(ScrollView.prototype.scrollTo)
    .mock.calls.map(([options]) => options)
    .filter(
      (options): options is { y: number; animated?: boolean } =>
        typeof options === 'object' && options !== null && 'y' in options,
    );

/** Um evento de rolagem da lista. */
const scrollEvent = (y: number) => ({
  nativeEvent: {
    contentOffset: { x: 0, y },
    contentSize: { width: 402, height: 5000 },
    layoutMeasurement: { width: 402, height: SCREEN_HEIGHT },
  },
});

/** O que recebeu o foco do leitor de tela. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, event]) => event === 'focus')
    .map(
      ([node]) =>
        (node as unknown as { props: { accessibilityLabel?: string } }).props.accessibilityLabel,
    );

const NAMES = ['Ana Lima', 'Bia Costa', 'Caio Rocha', 'Duda Reis', 'Enzo Melo'];

function entry(position: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    position,
    userId: `fa-${position}`,
    displayName: NAMES[position - 1] ?? null,
    photoURL: null,
    city: null,
    points: 10_000 - position * 100,
    change: 0,
    isMe: false,
    ...overrides,
  };
}

interface ApiAnswers {
  season: Season | null;
  items?: LeaderboardEntry[];
  /** Com ele, o ranking vem em páginas desse tamanho; o cursor é a posição de onde a página começa. */
  pageSize?: number;
  myRank?: MyRank;
  failBoard?: (cursor: string | null) => boolean;
  /** Segura a resposta de uma página até o teste soltar. */
  holdBoard?: (cursor: string | null) => Promise<void> | undefined;
}

const cursorOf = (config: unknown): string | null =>
  (config as { params?: { cursor?: string | null } } | undefined)?.params?.cursor ?? null;

/** A API responde a temporada, o ranking (numa página só ou em várias) e a posição do fã. */
function mockApi({ season, items = [], pageSize, myRank, failBoard, holdBoard }: ApiAnswers): void {
  mockDataSource = 'api';
  get.mockImplementation(async (url, config) => {
    if (url === '/ranking/season') return { data: { season } } as never;
    if (url === '/ranking') {
      const cursor = cursorOf(config);
      await holdBoard?.(cursor);
      if (failBoard?.(cursor)) throw new Error('fora do ar');
      const start = cursor ? Number(cursor) : 0;
      const end = pageSize ? start + pageSize : items.length;
      const nextCursor = end < items.length ? String(end) : null;
      return { data: { items: items.slice(start, end), nextCursor } } as never;
    }
    if (url === '/me/rank') {
      return { data: myRank ?? { position: null, points: 0, target: null } } as never;
    }
    if (url === '/me/centrals') return { data: [] } as never;
    if (url === '/artists') return { data: [] } as never;
    throw new Error(`rota sem resposta no teste: ${url}`);
  });
}

/** Os cursores pedidos ao ranking, em ordem (o primeiro é `null`). */
const boardCalls = () =>
  get.mock.calls.filter(([url]) => url === '/ranking').map(([, config]) => cursorOf(config));

/** Quantas vezes a tela pediu cada rota. */
const callsTo = (url: string) => get.mock.calls.filter(([called]) => called === url).length;

/** Páginas do ranking geral no cache. */
const globalPages = () =>
  client.getQueryData<{ pages: unknown[] }>(rankingKeys.leaderboard(GLOBAL_SCOPE))?.pages.length;

/** 34 posições com nomes de exemplo (do 6º em diante, "Fã"). */
const THIRTY_FOUR = Array.from({ length: 34 }, (_, index) => entry(index + 1));

beforeEach(() => {
  jest.clearAllMocks();
  mockNow = NOW;
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  mockDomainSources = {};
  mockReducedMotion = false;
  fixtureWallet.reset();
  followFixture.reset();
  // Como no app no modo fixtures: consulta não pausa offline.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, networkMode: 'always' } },
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  setFixtureNow(null);
  jest.restoreAllMocks();
});

describe('ranking (1f)', () => {
  it('monta com as fixtures: chips das centrais, temporada, pódio, lista e o card "Você"', async () => {
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(screen.getByRole('header', { name: 'Ranking' })).toBeTruthy();
    expect(screen.getByLabelText(t('ranking.loading'))).toBeTruthy();

    expect(await screen.findByLabelText(PODIUM[0] ?? '')).toBeTruthy();
    // O leitor lê o pódio em ordem: 1º, 2º e 3º.
    expect(
      screen.getAllByLabelText(/^\dº lugar/).map((node) => node.props.accessibilityLabel),
    ).toEqual(PODIUM);
    expect(screen.getByText('Temporada de São João · encerra em 12 dias')).toBeTruthy();
    // "Geral" e as centrais que o fã segue, na ordem dele; nada de "Amigos".
    expect(chips().map((chip) => chip.props.accessibilityLabel)).toEqual([
      'Geral',
      'Netto Brito',
      'Nenho',
      'Juninho Moraes',
    ]);
    expect(selectedChip()).toEqual(['Geral']);
    expect(screen.queryByText('Amigos', hidden)).toBeNull();
    expect(
      screen.getByLabelText('4º, Maria Clara Souza, Salvador, BA, 6.844 pontos, subiu 3 posições'),
    ).toBeTruthy();

    // A linha do fã ainda não está à vista: o card fica, e diz quanto falta.
    expect(await screen.findByRole('button', { name: ME_GLOBAL })).toBeTruthy();
    expect(meCard().props.accessibilityElementsHidden).toBe(false);
  });

  it('trocar de chip busca o ranking daquela central, com o toque de seleção', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ranking' });
    await screen.findByRole('button', { name: ME_GLOBAL });

    fireEvent.press(screen.getByRole('button', { name: 'Nenho' }));

    expect(haptics.trigger).toHaveBeenCalledWith('selection');
    await waitFor(() => expect(view.getSearchParams()).toEqual({ artista: 'nenho' }));
    expect(selectedChip()).toEqual(['Nenho']);
    expect(await screen.findByRole('button', { name: ME_NENHO })).toBeTruthy();
    const scope = { kind: 'artist', artistId: 'nenho' } as const;
    expect(client.getQueryData(rankingKeys.leaderboard(scope))).toBeDefined();
    expect(client.getQueryData(rankingKeys.myRank(scope))).toBeDefined();
    // Outro pódio: o do Nenho.
    expect(screen.queryByLabelText(PODIUM[0] ?? '')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Geral' }));
    await waitFor(() => expect(view.getSearchParams().artista).toBeUndefined());
    expect(await screen.findByRole('button', { name: ME_GLOBAL })).toBeTruthy();
  });

  it('pelo parâmetro de rota, abre com o chip da central escolhido (pronto para o "Ver ranking" da 1d)', async () => {
    renderRouter(appTree, { initialUrl: '/ranking?artista=nettobrito' });

    // 12º no Netto, como o "você é #12" da home.
    expect(
      await screen.findByRole('button', {
        name: /^Você, 12º lugar, 4\.120 pontos\. Faltam [\d.]+ pontos para entrar no top 10\.$/,
      }),
    ).toBeTruthy();
    expect(selectedChip()).toEqual(['Netto Brito']);
  });

  it('central que o fã não segue ganha o chip no fim, e o card chama para entrar nela', async () => {
    renderRouter(appTree, { initialUrl: '/ranking?artista=rocksalles' });

    // O ranking da central é só dos membros (bloco 8).
    expect(await screen.findByLabelText(ME_NOT_MEMBER)).toBeTruthy();
    await waitFor(() =>
      expect(chips().map((chip) => chip.props.accessibilityLabel)).toEqual([
        'Geral',
        'Netto Brito',
        'Nenho',
        'Juninho Moraes',
        'Rock Salles',
      ]),
    );
    expect(selectedChip()).toEqual(['Rock Salles']);
    // Sem posição, o card só informa: não há linha para onde rolar.
    expect(screen.queryByRole('button', { name: ME_NOT_MEMBER })).toBeNull();
  });

  it('membro sem pontos na central (o Juninho): o card pede pontos', async () => {
    renderRouter(appTree, { initialUrl: '/ranking?artista=juninhomoraes' });

    expect(await screen.findByLabelText(ME_UNRANKED)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ME_UNRANKED })).toBeNull();
  });

  it('artista que não existe cai no Geral', async () => {
    renderRouter(appTree, { initialUrl: '/ranking?artista=ninguem' });

    expect(await screen.findByRole('button', { name: ME_GLOBAL })).toBeTruthy();
    expect(selectedChip()).toEqual(['Geral']);
  });

  it('tocar no card traz as páginas que faltam, rola até a linha do fã e leva o foco a ela', async () => {
    renderRouter(appTree, { initialUrl: '/ranking?artista=nenho' });

    fireEvent.press(await screen.findByRole('button', { name: ME_NENHO }));

    // 41º, com 20 por página: a terceira página. O fã ouve que a busca começou.
    expect(announced()).toEqual([t('ranking.me.seeking')]);
    await waitFor(() => expect(scrolledTo()).toHaveLength(1));
    const scope = { kind: 'artist', artistId: 'nenho' } as const;
    expect(
      client.getQueryData<{ pages: unknown[] }>(rankingKeys.leaderboard(scope))?.pages,
    ).toHaveLength(3);
    const [destination] = scrolledTo();
    expect(destination?.y).toBeGreaterThan(0);

    // A lista chega lá: a linha aparece, recebe o foco, e o card sai.
    act(() => scrollListTo(destination?.y ?? 0));
    const mine = await screen.findByLabelText('41º, Você, 2.980 pontos');
    await waitFor(() => expect(focused()).toEqual([mine.props.accessibilityLabel]));
    expect(meCard().props.accessibilityElementsHidden).toBe(true);

    // Rolando de volta para cima, o card volta.
    act(() => scrollListTo(0));
    expect(meCard().props.accessibilityElementsHidden).toBe(false);
  });

  it('com reduzir movimento, o foco espera a linha do fã montar depois da rolagem', async () => {
    mockReducedMotion = true;
    renderRouter(appTree, { initialUrl: '/ranking?artista=nenho' });

    fireEvent.press(await screen.findByRole('button', { name: ME_NENHO }));

    await waitFor(() => expect(scrolledTo()).toHaveLength(1));
    const [destination] = scrolledTo();
    expect(destination?.animated).toBe(false);
    // A linha ainda não foi desenhada (a lista só desenha o trecho novo quando a
    // rolagem volta), e o tempo do foco sem animação já passou.
    // (O `renderRouter` liga os relógios falsos do Jest.)
    act(() => jest.advanceTimersByTime(motion.duration.fast));
    expect(screen.queryByLabelText('41º, Você, 2.980 pontos')).toBeNull();
    expect(focused()).toEqual([]);

    act(() => scrollListTo(destination?.y ?? 0));
    const mine = await screen.findByLabelText('41º, Você, 2.980 pontos');
    await waitFor(() => expect(focused()).toEqual([mine.props.accessibilityLabel]));
  });

  it('ganhar pontos da temporada muda o card quando o ranking busca de novo', async () => {
    renderRouter(appTree, { initialUrl: '/ranking' });
    await screen.findByRole('button', { name: ME_GLOBAL });

    await act(async () => {
      fixtureWallet.earn(900);
      await client.invalidateQueries({ queryKey: rankingKeys.all });
    });

    // A meta é a diferença mais 1: no empate, quem chegou primeiro fica na frente.
    expect(
      await screen.findByRole('button', {
        name: 'Você, 10º lugar, 5.020 pontos. Faltam 19 pontos para o 9º lugar.',
      }),
    ).toBeTruthy();
    // Subiu com a tela aberta, no mesmo recorte.
    expect(haptics.trigger).toHaveBeenCalledWith('rankUp');
  });

  it('subir com a 1f fora de foco (missões por cima) só festeja quando o fã volta a ela', async () => {
    renderRouter(appTree, { initialUrl: '/ranking' });
    await screen.findByRole('button', { name: ME_GLOBAL });

    act(() => router.push('/missoes'));
    expect(await screen.findByText('missions')).toBeTruthy();
    await act(async () => {
      fixtureWallet.earn(900);
      await client.invalidateQueries({ queryKey: rankingKeys.all });
    });
    // O ranking buscou de novo e o card mudou embaixo das missões, sem vibrar nem falar.
    expect(
      await screen.findByLabelText(
        'Você, 10º lugar, 5.020 pontos. Faltam 19 pontos para o 9º lugar.',
        hidden,
      ),
    ).toBeTruthy();
    expect(haptics.trigger).not.toHaveBeenCalledWith('rankUp');
    expect(announced()).toEqual([]);

    act(() => router.back());
    await waitFor(() => expect(haptics.trigger).toHaveBeenCalledWith('rankUp'));
    expect(announced()).toEqual(['Você subiu para o 10º lugar.']);
  });
});

describe('ranking (1f) do servidor (bloco 8)', () => {
  const season = buildSeasonFixture(NOW);

  it('o ranking do servidor não leva aviso de exemplo; o card fora do membro chama para entrar na central', async () => {
    mockApi({
      season,
      items: [entry(1), entry(2), entry(3), entry(4)],
      myRank: { position: null, points: 750, target: null, member: false },
    });
    renderRouter(appTree, { initialUrl: '/ranking?artista=nettobrito' });

    expect(await screen.findByLabelText(ME_NOT_MEMBER)).toBeTruthy();
    expect(
      within(meCard()).getByText('Entre na central para aparecer no ranking', hidden),
    ).toBeTruthy();
    // Os pontos de antes, que voltam a contar se ele entrar de novo.
    expect(within(meCard()).getByText('750', hidden)).toBeTruthy();
    expect(screen.queryByTestId('ranking-example-notice')).toBeNull();
    expect(screen.queryByText(/Ranking de exemplo/, hidden)).toBeNull();
  });

  it('abaixo da posição 200, o card só informa: sem toque e sem dica (buscaria páginas demais)', async () => {
    mockApi({
      season,
      items: [entry(1), entry(2), entry(3), entry(4)],
      myRank: {
        position: 201,
        points: 900,
        target: { kind: 'top', position: 10, pointsLeft: 9_000 },
      },
    });
    renderRouter(appTree, { initialUrl: '/ranking' });

    const card = await screen.findByLabelText(
      'Você, 201º lugar, 900 pontos. Faltam 9.000 pontos para entrar no top 10.',
    );
    expect(screen.queryByRole('button', { name: /^Você, 201º lugar/ })).toBeNull();
    expect(card.props.accessibilityHint).toBeUndefined();
  });

  it('na posição 200, o card ainda rola até a linha', async () => {
    mockApi({
      season,
      items: [entry(1), entry(2), entry(3), entry(4)],
      myRank: {
        position: 200,
        points: 900,
        target: { kind: 'top', position: 10, pointsLeft: 9_000 },
      },
    });
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(await screen.findByRole('button', { name: /^Você, 200º lugar/ })).toHaveProp(
      'accessibilityHint',
      t('ranking.me.hint'),
    );
  });
});

describe('ranking (1f) com a resposta do servidor', () => {
  const season = buildSeasonFixture(NOW);

  it('rolando até o fim, as páginas chegam uma por vez, cada cursor pedido uma vez, e param no fim', async () => {
    mockApi({ season, items: THIRTY_FOUR, pageSize: 10 });
    renderRouter(appTree, { initialUrl: '/ranking' });
    expect(await screen.findByLabelText('4º, Duda Reis, 9.600 pontos')).toBeTruthy();

    act(() => scrollListTo(5_000));

    await waitFor(() => expect(globalPages()).toBe(4));
    expect(boardCalls()).toEqual([null, '10', '20', '30']);
    // Sem próxima página, rolar de novo não pede nada.
    act(() => scrollListTo(5_100));
    expect(boardCalls()).toHaveLength(4);
  });

  it('o card tocado com uma página a caminho espera por ela, sem pedir o mesmo cursor de novo', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const items = THIRTY_FOUR.map((item) =>
      item.position === 31
        ? { ...item, userId: 'eu', displayName: 'Camila Ribeiro', isMe: true }
        : item,
    );
    mockApi({
      season,
      items,
      pageSize: 10,
      myRank: {
        position: 31,
        points: 6_900,
        target: { kind: 'top', position: 10, pointsLeft: 2_100 },
      },
      holdBoard: (cursor) => (cursor === '10' ? held : undefined),
    });
    renderRouter(appTree, { initialUrl: '/ranking' });
    const card = await screen.findByRole('button', { name: /^Você, 31º lugar/ });

    // O fim da primeira página pediu a segunda, que ainda não chegou.
    act(() => scrollListTo(400));
    await waitFor(() => expect(boardCalls()).toEqual([null, '10']));
    fireEvent.press(card);
    await act(async () => release());

    await waitFor(() => expect(scrolledTo()).toHaveLength(1));
    expect(boardCalls()).toEqual([null, '10', '20', '30']);
  });

  it('chegar ao fim durante uma busca de fundo espera por ela, sem cancelá-la, e depois segue', async () => {
    let release: () => void = () => undefined;
    let hold: Promise<void> | undefined;
    mockApi({
      season,
      items: THIRTY_FOUR,
      pageSize: 10,
      holdBoard: (cursor) => (cursor === null ? hold : undefined),
    });
    renderRouter(appTree, { initialUrl: '/ranking' });
    expect(await screen.findByLabelText('4º, Duda Reis, 9.600 pontos')).toBeTruthy();
    act(() => scrollListTo(400));
    await waitFor(() => expect(globalPages()).toBe(2));

    // O "Eu vou" da agenda invalidou o ranking: a busca de fundo começa pela primeira página.
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    act(() => void client.invalidateQueries({ queryKey: rankingKeys.all }));
    await waitFor(() => expect(boardCalls()).toEqual([null, '10', null]));

    // A lista chega ao fim no meio da busca: a página seguinte espera.
    await act(async () => {
      screen.UNSAFE_getByType(FlashList).props.onEndReached();
    });
    expect(boardCalls()).toEqual([null, '10', null]);

    await act(async () => release());
    await waitFor(() => expect(boardCalls()).toContain('20'));
    // A busca de fundo terminou (as duas páginas) antes de a terceira sair.
    expect(boardCalls().slice(0, 5)).toEqual([null, '10', null, '10', '20']);
    await waitFor(() => expect(globalPages()).toBeGreaterThanOrEqual(3));
  });

  it('a página seguinte que não veio: aviso no pé, anúncio uma vez, e o "Tentar de novo" traz as posições', async () => {
    let failing = true;
    mockApi({
      season,
      items: THIRTY_FOUR.slice(0, 14),
      pageSize: 10,
      failBoard: (cursor) => failing && cursor !== null,
    });
    renderRouter(appTree, { initialUrl: '/ranking' });
    expect(await screen.findByLabelText('4º, Duda Reis, 9.600 pontos')).toBeTruthy();

    act(() => scrollListTo(400));
    expect(await screen.findByLabelText(t('ranking.moreError'))).toBeTruthy();
    await waitFor(() => expect(announced()).toEqual([t('ranking.moreError')]));

    failing = false;
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByLabelText('11º, Fã, 8.900 pontos')).toBeTruthy();
    await waitFor(() =>
      expect(announced()).toEqual([t('ranking.moreError'), t('ranking.moreLoaded')]),
    );
    expect(screen.queryByLabelText(t('ranking.moreError'))).toBeNull();
  });

  it('puxar para atualizar vibra e busca de novo a temporada, o ranking, a posição do fã e "Suas centrais"', async () => {
    mockApi({ season, items: [entry(1), entry(2), entry(3), entry(4)] });
    renderRouter(appTree, { initialUrl: '/ranking' });
    expect(await screen.findByLabelText('4º, Duda Reis, 9.600 pontos')).toBeTruthy();
    await waitFor(() => expect(callsTo('/me/rank')).toBe(1));
    await waitFor(() => expect(callsTo('/me/centrals')).toBe(1));
    // "Suas centrais" (o "você é #12" da 1b e da 1e) sai da mesma conta do card.
    const routes = ['/ranking/season', '/ranking', '/me/rank', '/me/centrals'];
    const before = routes.map(callsTo);

    await act(async () => {
      screen.UNSAFE_getByType(FlashList).props.refreshControl.props.onRefresh();
    });

    expect(haptics.trigger).toHaveBeenCalledWith('refresh');
    await waitFor(() => expect(routes.map(callsTo)).toEqual(before.map((count) => count + 1)));
  });

  it('a atualização que falha aparece no topo, acima do pódio, onde o fã puxou', async () => {
    let failing = false;
    mockApi({ season, items: [entry(1), entry(2), entry(3), entry(4)], failBoard: () => failing });
    renderRouter(appTree, { initialUrl: '/ranking' });
    expect(await screen.findByLabelText('4º, Duda Reis, 9.600 pontos')).toBeTruthy();

    failing = true;
    await act(async () => {
      screen.UNSAFE_getByType(FlashList).props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByLabelText(t('ranking.updateError'))).toBeTruthy();
    await waitFor(() => expect(announced()).toEqual([t('ranking.updateError')]));
    // Na ordem da tela: o aviso, depois o pódio.
    expect(
      screen
        .getAllByLabelText(/^(Não deu para atualizar o ranking\.|1º lugar)/)
        .map((node) => node.props.accessibilityLabel as string),
    ).toEqual([t('ranking.updateError'), '1º lugar, Ana L., 9.900 pontos, Líder da temporada']);

    // O "Tentar de novo" busca de novo; o fã ouve que o ranking chegou.
    failing = false;
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    await waitFor(() =>
      expect(announced()).toEqual([t('ranking.updateError'), t('ranking.loaded')]),
    );
  });

  it('o fã no pódio: com o pódio à vista o card sai; rolando, volta; tocado, leva ao pódio', async () => {
    mockApi({
      season,
      items: [
        entry(1),
        entry(2, { userId: 'eu', displayName: 'Camila Ribeiro', points: 7_902, isMe: true }),
        entry(3),
        entry(4),
      ],
      myRank: {
        position: 2,
        points: 7_902,
        target: { kind: 'position', position: 1, pointsLeft: 20 },
      },
    });
    renderRouter(appTree, { initialUrl: '/ranking' });
    await screen.findByLabelText('2º lugar, Você, 7.902 pontos');

    // O pódio mede onde ficou: no topo da tela, à vista.
    fireEvent(screen.getByTestId('ranking-podium-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 150, width: 402, height: 200 } },
    });
    expect(meCard().props.accessibilityElementsHidden).toBe(true);

    act(() => scrollListTo(600));
    expect(meCard().props.accessibilityElementsHidden).toBe(false);

    fireEvent.press(screen.getByRole('button', { name: /^Você, 2º lugar/ }));
    await waitFor(() => expect(scrolledTo()).toEqual([expect.objectContaining({ y: 0 })]));
    await waitFor(() => expect(focused()).toEqual(['2º lugar, Você, 7.902 pontos']));
  });

  it('o fã no pódio: o card diz isso e, tocado, volta ao topo', async () => {
    mockApi({
      season,
      items: [
        entry(1),
        entry(2, { userId: 'eu', displayName: 'Camila Ribeiro', points: 7_902, isMe: true }),
        entry(3),
        entry(4),
      ],
      myRank: {
        position: 2,
        points: 7_902,
        target: { kind: 'position', position: 1, pointsLeft: 20 },
      },
    });
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(await screen.findByLabelText('2º lugar, Você, 7.902 pontos')).toBeTruthy();
    const card = await screen.findByRole('button', {
      name: 'Você, 2º lugar, 7.902 pontos. No pódio da temporada.',
    });
    expect(card).toHaveProp('accessibilityHint', t('ranking.me.podiumHint'));

    fireEvent.press(card);
    await waitFor(() => expect(scrolledTo()).toEqual([expect.objectContaining({ y: 0 })]));
    await waitFor(() => expect(focused()).toEqual(['2º lugar, Você, 7.902 pontos']));
  });

  it('o título do 1º vem do painel quando existe', async () => {
    mockApi({ season: { ...season, leaderTitle: 'Rainha do São João' }, items: [entry(1)] });
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(
      await screen.findByLabelText('1º lugar, Ana L., 9.900 pontos, Rainha do São João'),
    ).toBeTruthy();
  });

  it('ninguém pontuou: pódio vago e "Ver missões"', async () => {
    mockApi({ season });
    const view = renderRouter(appTree, { initialUrl: '/ranking' });

    expect(await screen.findByLabelText(t('ranking.empty'))).toBeTruthy();
    expect(screen.getByLabelText('1º lugar, vago')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: t('ranking.seeMissions') }));
    await waitFor(() => expect(view.getPathname()).toBe('/missoes'));
  });

  it('sem temporada: a linha diz isso e o card "Você" não aparece', async () => {
    mockApi({ season: null });
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(await screen.findByText('Nenhuma temporada em andamento')).toBeTruthy();
    expect(await screen.findByLabelText(t('ranking.emptyNoSeason'))).toBeTruthy();
    expect(screen.queryByTestId('ranking-me', hidden)).toBeNull();
  });

  it('temporada encerrada: a linha e o card falam do resultado final', async () => {
    mockApi({
      season: { ...season, status: 'ended' },
      items: [entry(1), entry(2), entry(3), entry(4)],
      myRank: { position: 12, points: 4_120, target: null },
    });
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(await screen.findByText('Temporada de São João encerrada')).toBeTruthy();
    expect(
      await screen.findByRole('button', {
        name: 'Você, 12º lugar, 4.120 pontos. Terminou em 12º.',
      }),
    ).toBeTruthy();
  });

  it('temporada encerrada sem ninguém no recorte: o resultado fechado, sem "ainda" e sem "Ver missões"', async () => {
    mockApi({ season: { ...season, status: 'ended' } });
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(await screen.findByLabelText(t('ranking.emptyEnded'))).toBeTruthy();
    expect(screen.queryByLabelText(t('ranking.empty'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('ranking.seeMissions') })).toBeNull();
  });

  it('a temporada que acaba com a tela aberta: as setas somem na hora e o ranking busca de novo', async () => {
    const endsAt = new Date(NOW.getTime() + 60_000);
    const items = [entry(1), entry(2), entry(3), entry(4, { change: 2 })];
    mockApi({ season: { ...season, endsAt: endsAt.toISOString() }, items });
    renderRouter(appTree, { initialUrl: '/ranking' });
    expect(
      await screen.findByLabelText('4º, Duda Reis, 9.600 pontos, subiu 2 posições'),
    ).toBeTruthy();
    await waitFor(() => expect(callsTo('/me/rank')).toBe(1));
    const before = ['/ranking/season', '/ranking', '/me/rank'].map(callsTo);

    // O servidor já responde a temporada encerrada, e o resultado sem setas.
    mockApi({
      season: { ...season, endsAt: endsAt.toISOString(), status: 'ended' },
      items: items.map((item) => ({ ...item, change: 0 })),
    });
    tickClockTo(new Date(endsAt.getTime() + 60_000));

    // Na hora, pelo relógio, sem esperar a resposta.
    expect(screen.getByText('Temporada de São João encerrada')).toBeTruthy();
    expect(screen.getByLabelText('4º, Duda Reis, 9.600 pontos')).toBeTruthy();
    await waitFor(() =>
      expect(['/ranking/season', '/ranking', '/me/rank'].map(callsTo)).toEqual(
        before.map((count) => count + 1),
      ),
    );
    // Com a encerrada do servidor no cache, não busca de novo a cada minuto.
    tickClockTo(new Date(endsAt.getTime() + 2 * 60_000));
    await act(async () => undefined);
    expect(callsTo('/ranking/season')).toBe(before[0]! + 1);
  });

  it('ranking que não carregou mostra "Tentar de novo", anuncia uma vez e busca de novo', async () => {
    let failing = true;
    mockApi({
      season,
      items: [entry(1), entry(2), entry(3), entry(4)],
      myRank: {
        position: 12,
        points: 4_120,
        target: { kind: 'top', position: 10, pointsLeft: 840 },
      },
      failBoard: () => failing,
    });
    renderRouter(appTree, { initialUrl: '/ranking' });

    expect(await screen.findByLabelText(t('ranking.loadError'))).toBeTruthy();
    await waitFor(() => expect(announced()).toEqual([t('ranking.loadError')]));
    // Sem a lista, não há para onde rolar: o card só informa.
    expect(await screen.findByLabelText(ME_GLOBAL)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ME_GLOBAL })).toBeNull();

    failing = false;
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByLabelText('4º, Duda Reis, 9.600 pontos')).toBeTruthy();
    await waitFor(() => expect(announced()).toEqual([t('ranking.loadError'), t('ranking.loaded')]));
    expect(await screen.findByRole('button', { name: ME_GLOBAL })).toBeTruthy();
  });

  it('o ranking geral não guarda o fã de outro recorte: a chave muda com o chip', () => {
    expect(rankingKeys.leaderboard(GLOBAL_SCOPE)).not.toEqual(
      rankingKeys.leaderboard({ kind: 'artist', artistId: 'global' }),
    );
  });
});
