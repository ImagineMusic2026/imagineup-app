import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { AccessibilityInfo, ScrollView, Text } from 'react-native';

import AgendaRoute from '@/app/(tabs)/(explorar,ranking)/agenda';
import ExploreRoute from '@/app/(tabs)/(explorar)/explorar';
import { buildAgendaPageFixture, rsvpFixture } from '@/domains/agenda/fixtures';
import type { AgendaListItem } from '@/domains/agenda/group-by-month';
import type { AgendaPage } from '@/domains/agenda/types';
import { missionsFixture } from '@/domains/missions';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

// O build do Firebase que o Jest resolve é ESM; a presença invalida a carteira
// do domínio de perfil, que lê o Firestore.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));

// Sem .env no Jest: fixtures. Os testes de resposta do servidor trocam para a API.
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
// O São João de Irará fica em 21 de outubro, e o Arrocha na Praia no sábado, 3.
const NOW = new Date(2026, 8, 29, 20, 0);
const mockNow = NOW;
jest.mock('@/hooks/use-now', () => ({ useNow: () => mockNow }));

const get = jest.mocked(api.get);

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

/** As abas com a Explorar e a 1m de verdade, o convite como tela vazia. */
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
  '(tabs)/(explorar)/explorar': ExploreRoute,
  '(tabs)/(explorar,ranking)/agenda': AgendaRoute,
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
  convidar: label('convite'),
};

const announced = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

/** Os chips de mês, pela dica que só eles têm (as duas cópias, se o leitor vê as duas). */
const monthChips = () => screen.getAllByHintText(/^Mostra os shows de /);

/** Os meses escolhidos, sem repetir o das duas cópias. */
const selectedMonths = () => [
  ...new Set(
    monthChips()
      .filter((chip) => chip.props.accessibilityState?.selected)
      .map((chip) => chip.props.accessibilityLabel as string),
  ),
];

/** Um chip da cópia da lista (a que fica embaixo do título). */
const listChip = (name: string) =>
  within(screen.getByTestId('agenda-months')).getByRole('button', { name });

const FEATURED =
  'Show em destaque. 21 de outubro, São João de Irará, Netto Brito e Nenho, Irará, Bahia, 22 horas';

/** A FlashList da 1m e os itens que ela mostra. */
function agendaList() {
  const list = screen.UNSAFE_getByType(FlashList);
  const items = list.props.data as AgendaListItem[];
  return {
    props: list.props,
    /** O que a FlashList diria que está à vista. */
    viewable: (...keys: string[]) => ({
      viewableItems: keys.map((key) => {
        const index = items.findIndex((item) => item.key === key);
        return { item: items[index], index, isViewable: true, key };
      }),
      changed: [],
    }),
  };
}

/** Um evento de rolagem da lista, numa lista bem mais alta que a tela. */
const scrollEvent = (y: number) => ({
  nativeEvent: {
    contentOffset: { x: 0, y },
    contentSize: { width: 402, height: 5000 },
    layoutMeasurement: { width: 402, height: 800 },
  },
});

/** Até onde a lista rolou (a FlashList chama o scrollTo do ScrollView). */
const scrolledTo = () =>
  jest
    .mocked(ScrollView.prototype.scrollTo)
    .mock.calls.map(([options]) => options)
    .filter(
      (options): options is { y: number; animated?: boolean } =>
        typeof options === 'object' && options !== null && 'y' in options,
    );

/** O que recebeu o foco do leitor de tela: o texto do cabeçalho ou o rótulo. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, event]) => event === 'focus')
    .map(([node]) => {
      const { props } = node as unknown as {
        props: { accessibilityLabel?: string; children?: unknown };
      };
      return props.accessibilityLabel ?? props.children;
    });

/** A API responde a agenda pedida e as presenças vazias. */
function mockApi(agenda: (cursor: string | null) => Promise<AgendaPage>): void {
  mockDataSource = 'api';
  get.mockImplementation(async (url, config) => {
    const params = config?.params as { cursor?: string | null } | undefined;
    if (url === '/agenda') return { data: await agenda(params?.cursor ?? null) } as never;
    if (url === '/me/rsvps') return { data: { eventIds: [] } } as never;
    throw new Error(`rota sem resposta no teste: ${url}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  rsvpFixture.reset();
  missionsFixture.reset();
  fixtureWallet.reset();
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

describe('agenda de shows (1m)', () => {
  it('abre pela Explorar, com o voltar na linha do título, e o voltar devolve à Explorar', async () => {
    const view = renderRouter(appTree, { initialUrl: '/explorar' });

    fireEvent.press(screen.getByRole('button', { name: t('explore.agenda') }));
    await waitFor(() => expect(view.getPathname()).toBe('/agenda'));
    expect(view.getSegments()).toEqual(['(tabs)', '(explorar)', 'agenda']);
    expect(screen.getByRole('header', { name: 'Agenda' })).toBeTruthy();
    expect(screen.getByLabelText(t('agenda.loading'))).toBeTruthy();
    expect(await screen.findByLabelText(FEATURED)).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: t('common.back') }));
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
  });

  it('monta com as fixtures: chips dos meses, destaque, sobrelinha por mês e as linhas', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });

    expect(await screen.findByLabelText(FEATURED)).toBeTruthy();
    // Só o destaque tem os artistas e a hora; as linhas, data, título e lugar.
    expect(screen.getByLabelText('3 de outubro, Arrocha na Praia, Aracaju, Sergipe')).toBeTruthy();
    expect(
      screen.getByLabelText('28 de outubro, Pra Encher e Derramar, Feira de Santana, Bahia'),
    ).toBeTruthy();
    // O destaque não se repete na lista.
    expect(screen.queryByLabelText(/^21 de outubro, São João de Irará/)).toBeNull();

    // Um chip por mês com show, o primeiro escolhido. (No Jest o título não
    // tem altura, e a cópia grudada dos chips aparece junto da lista.)
    const months = [...new Set(monthChips().map((chip) => chip.props.accessibilityLabel))];
    expect(months).toEqual(['Outubro', 'Novembro', 'Dezembro']);
    expect(selectedMonths()).toEqual(['Outubro']);
    const monthHeaders = screen
      .getAllByRole('header')
      .map((node) => node.props.children as string)
      .filter((text) => text !== 'Agenda');
    expect(monthHeaders).toEqual(['Outubro', 'Novembro', 'Dezembro']);

    expect(screen.getAllByRole('button', { name: /^Eu vou, / })).toHaveLength(6);
    expect(screen.getByRole('button', { name: t('agenda.seeAll') })).toBeTruthy();
  });

  it('tocar num mês escolhe o chip dele', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    await screen.findByLabelText(FEATURED);

    fireEvent.press(listChip('Novembro'));
    expect(listChip('Novembro')).toBeSelected();
    expect(listChip('Outubro')).not.toBeSelected();
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
  });

  it('rolar a lista troca o chip pelo mês em vista, e voltar ao topo volta ao primeiro', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    await screen.findByLabelText(FEATURED);
    const list = agendaList();

    act(() =>
      list.props.onViewableItemsChanged?.(
        list.viewable('month-2026-11', 'event-festa-do-vaqueiro', 'month-2026-12'),
      ),
    );
    expect(selectedMonths()).toEqual(['Novembro']);

    act(() => list.props.onViewableItemsChanged?.(list.viewable('featured-sao-joao-irara')));
    expect(selectedMonths()).toEqual(['Outubro']);
  });

  it('tocar num mês rola até a sobrelinha dele, e o primeiro mês, até o topo', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    await screen.findByLabelText(FEATURED);
    const items = agendaList().props.data as AgendaListItem[];
    const indexOf = (key: string) => items.findIndex((item) => item.key === key);

    fireEvent.press(listChip('Novembro'));
    fireEvent.press(listChip('Dezembro'));
    fireEvent.press(listChip('Outubro'));
    const [november, december, october] = scrolledTo();
    if (!november || !december || !october) throw new Error('a lista não rolou');

    // No Jest toda célula mede 64: a distância é a das sobrelinhas na lista.
    expect(december.y - november.y).toBe(
      (indexOf('month-2026-12') - indexOf('month-2026-11')) * 64,
    );
    // Outubro é o mês do topo: rola até o destaque.
    expect(november.y - october.y).toBe(
      (indexOf('month-2026-11') - indexOf('featured-sao-joao-irara')) * 64,
    );
    expect(december.animated).toBe(true);
  });

  it('depois do toque, o chip fica no mês até a lista chegar, o foco vai ao mês, e a rolagem seguinte solta', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    await screen.findByLabelText(FEATURED);
    const list = agendaList();

    fireEvent.press(listChip('Dezembro'));
    const [destination] = scrolledTo();
    if (!destination) throw new Error('a lista não rolou');

    // No caminho, os meses do meio passam pela tela sem trocar o chip.
    act(() => list.props.onScroll?.(scrollEvent(destination.y / 2) as never));
    act(() =>
      list.props.onViewableItemsChanged?.(
        list.viewable('month-2026-11', 'event-festa-do-vaqueiro'),
      ),
    );
    expect(selectedMonths()).toEqual(['Dezembro']);
    expect(focused()).toEqual([]);

    // Chegou: o foco do leitor de tela vai à sobrelinha de dezembro.
    act(() => list.props.onScroll?.(scrollEvent(destination.y) as never));
    await waitFor(() => expect(focused()).toEqual(['Dezembro']));
    expect(selectedMonths()).toEqual(['Dezembro']);

    // A rolagem seguinte (um gesto do leitor de tela, sem arrasto) solta a
    // trava, e o chip volta a ser o do mês em vista.
    act(() => list.props.onScroll?.(scrollEvent(destination.y - 120) as never));
    expect(selectedMonths()).toEqual(['Novembro']);
  });

  it('arrastar a lista solta a trava na hora, e o primeiro mês leva o foco ao destaque', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    await screen.findByLabelText(FEATURED);
    const list = agendaList();

    fireEvent.press(listChip('Novembro'));
    act(() => list.props.onScrollBeginDrag?.({} as never));
    act(() => list.props.onViewableItemsChanged?.(list.viewable('month-2026-12')));
    expect(selectedMonths()).toEqual(['Dezembro']);

    // Com a lista no topo, o primeiro mês não rola: o foco vai direto ao destaque.
    fireEvent.press(listChip('Outubro'));
    await waitFor(() => expect(focused()).toContain(FEATURED));
  });

  it('com a agenda inteira na tela, tocar num mês não rola e leva o foco direto ao mês', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    await screen.findByLabelText(FEATURED);
    const list = agendaList();
    // O conteúdo (500) cabe na tela (a do Jest tem 2400): a lista não tem para onde rolar.
    act(() => list.props.onContentSizeChange?.(402, 500));

    fireEvent.press(listChip('Dezembro'));
    await waitFor(() => expect(focused()).toEqual(['Dezembro']));
    expect(selectedMonths()).toEqual(['Dezembro']);
  });

  it('com a lista rolada, a cópia dos chips da lista sai do leitor de tela e fica a grudada', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    await screen.findByLabelText(FEATURED);
    const copies = monthChips().length;

    act(() => agendaList().props.onScroll?.(scrollEvent(400) as never));
    expect(screen.getByTestId('agenda-months', { includeHiddenElements: true })).toHaveProp(
      'importantForAccessibility',
      'no-hide-descendants',
    );
    expect(monthChips()).toHaveLength(copies / 2);

    // De volta ao topo. (No Jest o título não tem altura, e os chips grudam
    // já no 0: o topo fica um ponto acima.)
    act(() => agendaList().props.onScroll?.(scrollEvent(-1) as never));
    expect(monthChips()).toHaveLength(copies);
  });

  it('"Chamar amigos" abre a sheet do convite com o show', async () => {
    const view = renderRouter(appTree, { initialUrl: '/agenda' });
    fireEvent.press(await screen.findByRole('button', { name: /^Chamar amigos para São João/ }));
    await waitFor(() => expect(view.getPathname()).toBe('/convidar'));
    expect(view.getSearchParams()).toEqual({ eventId: 'sao-joao-irara' });
  });

  it('"Eu vou" no destaque confirma na hora e rende a missão de presença', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    fireEvent.press(await screen.findByRole('button', { name: 'Eu vou, São João de Irará' }));
    expect(
      await screen.findByRole('button', { name: 'Confirmado, São João de Irará' }),
    ).toBeSelected();
    await waitFor(() => expect(rsvpFixture.mine().eventIds).toEqual(['sao-joao-irara']));
    expect(fixtureWallet.get().balance).toBe(12_480 + 15);
  });

  it('"Ver agenda completa" traz os meses seguintes, some e avisa o leitor de tela', async () => {
    renderRouter(appTree, { initialUrl: '/agenda' });
    fireEvent.press(await screen.findByRole('button', { name: t('agenda.seeAll') }));

    expect(
      await screen.findByLabelText('13 de fevereiro, Carnaval do Nenho, Recife, Pernambuco'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Eu vou, / })).toHaveLength(9);
    expect(screen.queryByRole('button', { name: t('agenda.seeAll') })).toBeNull();
    expect(announced()).toContain(t('agenda.moreLoaded'));
  });

  it('sem shows marcados, diz isso, sem chips nem destaque', async () => {
    mockApi(async () => ({ featured: null, items: [], nextCursor: null }));
    renderRouter(appTree, { initialUrl: '/agenda' });

    expect(await screen.findByLabelText(t('agenda.empty'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Eu vou/ })).toBeNull();
    expect(screen.getAllByRole('header').map((node) => node.props.children)).toEqual(['Agenda']);
  });

  it('se a agenda não carregar, mostra o erro com "Tentar de novo", e a volta é anunciada', async () => {
    let fail = true;
    mockApi(async (cursor) => {
      if (fail) throw new ApiError('server', 'fora do ar', 500);
      return buildAgendaPageFixture(NOW, cursor);
    });
    renderRouter(appTree, { initialUrl: '/agenda' });

    expect(await screen.findByLabelText(t('agenda.loadError'))).toBeTruthy();
    await waitFor(() => expect(announced()).toContain(t('agenda.loadError')));

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByLabelText(FEATURED)).toBeTruthy();
    await waitFor(() => expect(announced()).toContain(t('agenda.loaded')));
  });

  it('se o resto da agenda não carregar, o erro fica no pé e tenta de novo', async () => {
    let failMore = true;
    mockApi(async (cursor) => {
      if (cursor && failMore) throw new ApiError('server', 'fora do ar', 500);
      return buildAgendaPageFixture(NOW, cursor);
    });
    renderRouter(appTree, { initialUrl: '/agenda' });

    fireEvent.press(await screen.findByRole('button', { name: t('agenda.seeAll') }));
    expect(await screen.findByLabelText(t('agenda.moreError'))).toBeTruthy();
    // O que já estava na tela continua.
    expect(screen.getByLabelText(FEATURED)).toBeTruthy();

    failMore = false;
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(
      await screen.findByLabelText('13 de fevereiro, Carnaval do Nenho, Recife, Pernambuco'),
    ).toBeTruthy();
    expect(screen.queryByLabelText(t('agenda.moreError'))).toBeNull();
  });
});
