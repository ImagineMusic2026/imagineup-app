import { FlashList } from '@shopify/flash-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Text } from 'react-native';

import AgendaRoute from '@/app/(tabs)/(explorar,ranking)/agenda';
import ExploreRoute from '@/app/(tabs)/(explorar)/explorar';
import { buildAgendaPageFixture, rsvpFixture } from '@/domains/agenda/fixtures';
import type { AgendaEvent, AgendaPage } from '@/domains/agenda/types';
import { artistKeys } from '@/domains/artists';
import { followFixture } from '@/domains/artists/fixtures';
import type { Artist, FanCentral } from '@/domains/artists/types';
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
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 201, height: 64 })),
  };
});

// Relógio fixo, nas fixtures e na tela: terça, 29 de setembro de 2026, 20 h.
// O São João de Irará (o destaque) fica em 21 de outubro, e o Arrocha na Praia no sábado, 3.
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

/** As abas com a Explorar e a 1m de verdade; a central e o convite como telas vazias. */
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
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
  convidar: label('convite'),
};

const FEATURED =
  'Show em destaque. 21 de outubro, São João de Irará, Netto Brito e Nenho, Irará, Bahia, 22 horas';
const ROWS = [
  '3 de outubro, Arrocha na Praia, Aracaju, Sergipe',
  '28 de outubro, Pra Encher e Derramar, Feira de Santana, Bahia',
  '12 de novembro, Festa do Vaqueiro, Serrinha, Bahia',
];

/** O rótulo de um card da grade, com a marca "Na central" quando é do fã. */
const tileName = (name: string, fans: string, member = false) => {
  const card = t('onboarding.chooseArtists.cardLabel', { name, fans });
  return member ? t('explore.memberLabel', { label: card }) : card;
};

const search = () => screen.getByPlaceholderText(t('explore.searchPlaceholder'));

/** A FlashList da vitrine (a primeira da árvore: a raiz da aba). */
const exploreList = () => screen.UNSAFE_getAllByType(FlashList)[0]!;

const announced = () => [
  ...jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text),
  ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text),
];

const event = (
  id: string,
  title: string,
  startsAt: Date,
  overrides: Partial<AgendaEvent> = {},
): AgendaEvent => ({
  id,
  title,
  artists: [{ id: 'nettobrito', name: 'Netto Brito' }],
  city: 'Salvador',
  state: 'BA',
  startsAt: startsAt.toISOString(),
  imageUrl: null,
  invitePointsPerSignup: null,
  ...overrides,
});

const ARTISTS: Artist[] = [
  { id: 'nettobrito', name: 'Netto Brito', photoURL: null, fanCount: 0, order: 0 },
  { id: 'nenho', name: 'Nenho', photoURL: null, fanCount: 5, order: 1 },
];

const MINE: FanCentral[] = [
  {
    artistId: 'nettobrito',
    name: 'Netto Brito',
    shortName: null,
    photoURL: null,
    fanCount: 1,
    fanRank: null,
    seasonPoints: 0,
  },
];

interface ApiRoutes {
  artists?: () => Promise<Artist[]>;
  centrals?: () => Promise<FanCentral[]>;
  agenda?: (cursor: string | null) => Promise<AgendaPage>;
}

/** A API responde a vitrine: artistas, centrais do fã, agenda e presenças. */
function mockApi({
  artists = async () => ARTISTS,
  centrals = async () => MINE,
  agenda = async (cursor) => buildAgendaPageFixture(NOW, cursor),
}: ApiRoutes = {}): void {
  mockDataSource = 'api';
  get.mockImplementation(async (url, config) => {
    const params = config?.params as { cursor?: string | null } | undefined;
    if (url === '/artists') return { data: await artists() } as never;
    if (url === '/me/centrals') return { data: await centrals() } as never;
    if (url === '/agenda') return { data: await agenda(params?.cursor ?? null) } as never;
    if (url === '/me/rsvps') return { data: { eventIds: [] } } as never;
    throw new Error(`rota sem resposta no teste: ${url}`);
  });
}

const callsTo = (url: string) => get.mock.calls.filter(([called]) => called === url).length;

beforeEach(() => {
  jest.clearAllMocks();
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  rsvpFixture.reset();
  missionsFixture.reset();
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
});

afterEach(() => {
  client.clear();
  setFixtureNow(null);
  jest.restoreAllMocks();
});

describe('Explorar: a vitrine das centrais (seção 29, frente G)', () => {
  it('nas fixtures: a busca, os próximos shows com o destaque e as centrais em grade', async () => {
    renderRouter(appTree, { initialUrl: '/explorar' });

    expect(screen.getByRole('header', { name: t('explore.title') })).toBeOnTheScreen();
    expect(search()).toHaveProp('accessibilityLabel', t('explore.searchLabel'));
    expect(screen.getByRole('header', { name: t('explore.shows') })).toBeOnTheScreen();

    // O destaque marcado e os três shows seguintes, sem repetir o destaque.
    expect(await screen.findByLabelText(FEATURED)).toBeOnTheScreen();
    for (const row of ROWS) expect(screen.getByLabelText(row)).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^Eu vou, / })).toHaveLength(4);
    expect(screen.queryByLabelText(/^13 de fevereiro, Carnaval do Nenho/)).toBeNull();

    // A grade, na ordem de destaque, com a marca nas centrais do fã.
    expect(screen.getByRole('header', { name: t('explore.centrals') })).toBeOnTheScreen();
    const netto = await screen.findByRole('button', {
      name: tileName('Netto Brito', '412 mil', true),
    });
    expect(netto).toHaveProp('accessibilityHint', t('explore.tileHint'));
    expect(
      screen.getByRole('button', { name: tileName('Rock Salles', '96 mil') }),
    ).toBeOnTheScreen();
    expect(screen.getAllByText(t('explore.member'))).toHaveLength(3);
    expect(screen.getByText('412 mil fãs')).toBeOnTheScreen();
  });

  it('a busca filtra pelo nome sem acento, tira os shows e fica com o foco no campo', async () => {
    renderRouter(appTree, { initialUrl: '/explorar' });
    await screen.findByLabelText(FEATURED);
    const field = search();

    fireEvent.changeText(field, 'ROCK SÁLLES');
    // O mesmo campo de antes: o cabeçalho não montou de novo, e o teclado fica.
    expect(search()).toBe(field);
    expect(
      await screen.findByRole('button', { name: tileName('Rock Salles', '96 mil') }),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: tileName('Netto Brito', '412 mil', true) }),
    ).toBeNull();
    expect(screen.queryByLabelText(FEATURED)).toBeNull();
    expect(screen.queryByRole('header', { name: t('explore.shows') })).toBeNull();

    // Sem resultado: a frase, anunciada uma vez só.
    fireEvent.changeText(field, 'ninguém');
    fireEvent.changeText(field, 'ninguém mesmo');
    expect(search()).toBe(field);
    expect(
      await screen.findByLabelText(t('explore.searchEmpty', { query: 'ninguém mesmo' })),
    ).toBeOnTheScreen();
    expect(
      announced().filter((text) => text === t('explore.searchEmpty', { query: 'ninguém' })),
    ).toHaveLength(1);

    // Busca vazia: os shows voltam.
    fireEvent.changeText(field, '');
    expect(await screen.findByLabelText(FEATURED)).toBeOnTheScreen();
  });

  it('o teclado fecha ao rolar, e um toque com ele aberto já vale', async () => {
    renderRouter(appTree, { initialUrl: '/explorar' });
    await screen.findByLabelText(FEATURED);
    expect(exploreList().props.keyboardShouldPersistTaps).toBe('handled');
    expect(exploreList().props.keyboardDismissMode).toBe('on-drag');
  });

  it('"Ver agenda" abre a 1m na pilha da Explorar, e o voltar devolve à vitrine', async () => {
    const view = renderRouter(appTree, { initialUrl: '/explorar' });
    const seeAgenda = await screen.findByRole('button', { name: t('explore.seeAgenda') });
    expect(seeAgenda).toHaveProp('accessibilityHint', t('explore.seeAgendaHint'));

    fireEvent.press(seeAgenda);
    await waitFor(() => expect(view.getPathname()).toBe('/agenda'));
    expect(view.getSegments()).toEqual(['(tabs)', '(explorar)', 'agenda']);
    expect(screen.getByRole('header', { name: t('agenda.title') })).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: t('common.back') }));
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
    expect(screen.getByRole('header', { name: t('explore.title') })).toBeOnTheScreen();
  });

  it('"Chamar amigos" do destaque abre o convite com o show', async () => {
    const view = renderRouter(appTree, { initialUrl: '/explorar' });
    fireEvent.press(await screen.findByRole('button', { name: /^Chamar amigos para São João/ }));
    await waitFor(() => expect(view.getPathname()).toBe('/convidar'));
    expect(view.getSearchParams()).toEqual({ eventId: 'sao-joao-irara' });
  });

  it('"Eu vou" na vitrine é o mesmo da 1m', async () => {
    renderRouter(appTree, { initialUrl: '/explorar' });
    fireEvent.press(await screen.findByRole('button', { name: 'Eu vou, Arrocha na Praia' }));
    expect(
      await screen.findByRole('button', { name: 'Confirmado, Arrocha na Praia' }),
    ).toBeSelected();
    await waitFor(() => expect(rsvpFixture.mine().eventIds).toEqual(['arrocha-na-praia']));

    fireEvent.press(screen.getByRole('button', { name: t('explore.seeAgenda') }));
    expect(
      await screen.findByRole('button', { name: 'Confirmado, Arrocha na Praia' }),
    ).toBeSelected();
    expect(screen.getByRole('button', { name: 'Eu vou, São João de Irará' })).toBeOnTheScreen();
  });

  it('tocar numa central abre a página dela na pilha da Explorar, e voltar devolve à vitrine', async () => {
    const view = renderRouter(appTree, { initialUrl: '/explorar' });
    fireEvent.press(await screen.findByRole('button', { name: tileName('Rock Salles', '96 mil') }));
    await waitFor(() => expect(view.getPathname()).toBe('/artista/rocksalles'));
    expect(view.getSegments()).toEqual(['(tabs)', '(explorar)', 'artista', '[artistaId]']);

    act(() => router.back());
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
    expect(
      screen.getByRole('button', { name: tileName('Rock Salles', '96 mil') }),
    ).toBeOnTheScreen();
  });

  it('pela API: a marca e o número de fãs das centrais do fã vêm do /me/centrals', async () => {
    mockApi();
    renderRouter(appTree, { initialUrl: '/explorar' });

    // O Netto conta o próprio fã pelo /me/centrals; o Nenho fica com o do /artists.
    expect(
      await screen.findByRole('button', {
        name: t('explore.memberLabel', { label: 'Netto Brito, 1 fã' }),
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('1 fã')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: tileName('Nenho', '5') })).toBeOnTheScreen();
    expect(screen.getAllByText(t('explore.member'))).toHaveLength(1);
    expect(await screen.findByLabelText(FEATURED)).toBeOnTheScreen();
  });

  it('sem destaque marcado, só as linhas', async () => {
    mockApi({
      agenda: async (cursor) => ({ ...buildAgendaPageFixture(NOW, cursor), featured: null }),
    });
    renderRouter(appTree, { initialUrl: '/explorar' });

    expect(await screen.findByLabelText(ROWS[0]!)).toBeOnTheScreen();
    // Sem o destaque, o São João é só mais uma linha, na data dele.
    expect(
      screen.getByLabelText('21 de outubro, São João de Irará, Irará, Bahia'),
    ).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: /^Eu vou, / })).toHaveLength(3);
    expect(screen.queryByLabelText(/^Show em destaque/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Chamar amigos/ })).toBeNull();
    expect(screen.queryByLabelText(t('explore.showsEmpty'))).toBeNull();
  });

  it('"Nenhum show" só sem nenhum show por vir: o destaque sozinho ainda aparece', async () => {
    const past = event('passado', 'Show que passou', new Date(2026, 8, 20, 22));
    const soon = event('logo', 'Show de Amanhã', new Date(2026, 8, 30, 21));
    let page: AgendaPage = { featured: soon, items: [past, soon], nextCursor: null };
    mockApi({ agenda: async () => page });
    renderRouter(appTree, { initialUrl: '/explorar' });

    expect(
      await screen.findByLabelText(/^Show em destaque\. 30 de setembro, Show de Amanhã/),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText(/Show que passou/)).toBeNull();
    expect(screen.queryByLabelText(t('explore.showsEmpty'))).toBeNull();

    // O cache que voltou com shows passados, o destaque inclusive: aí, o vazio.
    page = { featured: past, items: [past], nextCursor: null };
    await act(async () => {
      await exploreList().props.refreshControl.props.onRefresh();
    });
    expect(await screen.findByLabelText(t('explore.showsEmpty'))).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Eu vou, / })).toBeNull();
  });

  it('nenhuma central no ar é vazio, e não erro', async () => {
    mockApi({ artists: async () => [], centrals: async () => [] });
    renderRouter(appTree, { initialUrl: '/explorar' });

    expect(await screen.findByLabelText(t('explore.centralsEmpty'))).toBeOnTheScreen();
    expect(screen.queryByLabelText(t('explore.centralsError'))).toBeNull();
    // Os shows continuam.
    expect(await screen.findByLabelText(FEATURED)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull();
  });

  it('as centrais que não carregam têm o erro delas, com "Tentar de novo", e os shows ficam', async () => {
    let fail = true;
    mockApi({
      artists: async () => {
        if (fail) throw new ApiError('server', 'fora do ar', 500);
        return ARTISTS;
      },
    });
    renderRouter(appTree, { initialUrl: '/explorar' });

    expect(await screen.findByLabelText(t('explore.centralsError'))).toBeOnTheScreen();
    expect(await screen.findByLabelText(FEATURED)).toBeOnTheScreen();
    await waitFor(() => expect(announced()).toContain(t('explore.centralsError')));
    expect(announced()).not.toContain(t('explore.showsError'));

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('button', { name: tileName('Nenho', '5') })).toBeOnTheScreen();
    expect(screen.queryByLabelText(t('explore.centralsError'))).toBeNull();
  });

  it('os shows que não carregam têm o erro deles, com "Tentar de novo", e a grade fica', async () => {
    let fail = true;
    mockApi({
      agenda: async (cursor) => {
        if (fail) throw new ApiError('server', 'fora do ar', 500);
        return buildAgendaPageFixture(NOW, cursor);
      },
    });
    renderRouter(appTree, { initialUrl: '/explorar' });

    expect(await screen.findByLabelText(t('explore.showsError'))).toBeOnTheScreen();
    expect(await screen.findByRole('button', { name: tileName('Nenho', '5') })).toBeOnTheScreen();
    await waitFor(() => expect(announced()).toContain(t('explore.showsError')));
    expect(announced()).not.toContain(t('explore.centralsError'));

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByLabelText(FEATURED)).toBeOnTheScreen();
    expect(screen.queryByLabelText(t('explore.showsError'))).toBeNull();
  });

  it('embaixo da agenda, a vitrine que falha não fala por cima dela', async () => {
    mockApi({
      artists: async () => {
        throw new ApiError('server', 'fora do ar', 500);
      },
    });
    renderRouter(appTree, { initialUrl: '/agenda' });

    expect(await screen.findByLabelText(FEATURED)).toBeOnTheScreen();
    // A vitrine, montada embaixo, buscou e falhou, sem anunciar.
    await waitFor(() => expect(client.getQueryState(artistKeys.list())?.status).toBe('error'));
    expect(callsTo('/artists')).toBeGreaterThan(0);
    expect(announced()).not.toContain(t('explore.centralsError'));
  });

  it('puxar para atualizar busca de novo artistas, centrais, agenda e presenças', async () => {
    mockApi();
    renderRouter(appTree, { initialUrl: '/explorar' });
    await screen.findByLabelText(FEATURED);
    await screen.findByRole('button', { name: tileName('Nenho', '5') });
    const before = ['/artists', '/me/centrals', '/agenda', '/me/rsvps'].map(callsTo);

    await act(async () => {
      await exploreList().props.refreshControl.props.onRefresh();
    });

    const after = ['/artists', '/me/centrals', '/agenda', '/me/rsvps'].map(callsTo);
    after.forEach((count, index) => expect(count).toBeGreaterThan(before[index]!));
    expect(haptics.trigger).toHaveBeenCalledWith('refresh');
    await waitFor(() => expect(exploreList().props.refreshControl.props.refreshing).toBe(false));
  });
});
