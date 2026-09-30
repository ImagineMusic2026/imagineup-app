import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Text } from 'react-native';

import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import ProfileRoute from '@/app/(tabs)/(perfil)/perfil';
import { buildFanCentralsFixture, followFixture } from '@/domains/artists/fixtures';
import { profileKeys } from '@/domains/profile';
import { buildMyAchievementsFixture, buildMyProgressFixture } from '@/domains/profile/fixtures';
import { buildMyRankFixture } from '@/domains/ranking/fixtures';
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

// Terça, 29 de setembro de 2026, 20 h: as datas das conquistas saem daqui.
const NOW = new Date(2026, 8, 29, 20, 0);

const getDocMock = jest.mocked(getDoc);
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

/** As abas com a 1e de verdade, pela própria rota, e as outras telas vazias. */
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
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
};

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

const HERO = 'Camila Ribeiro, @camilarib, Feira de Santana, BA. Nível 7, Purainha.';
const pointsCard = (balance: string, week: string, left: string) =>
  `Seus pontos: ${balance}. Esta semana: mais ${week}. Faltam ${left} pontos para o nível 8, Xodó.`;

type SnapshotCallback = (snapshot: typeof profileSnapshot) => void;

/** O que a escuta do Firestore (`onSnapshot`) recebe a cada mudança de users/{uid}. */
function profileListener(): SnapshotCallback {
  const call = jest.mocked(onSnapshot).mock.calls.at(-1);
  if (!call) throw new Error('escuta do perfil não registrada');
  return call[1] as unknown as SnapshotCallback;
}

const withCity = (city: string) => ({
  ...profileSnapshot,
  data: () => ({ ...profileSnapshot.data(), city }),
});

const announcements = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

/** A API por rota: o que não vier em `failing` responde como as fixtures. */
function mockApi(failing: readonly string[]): void {
  mockDataSource = 'api';
  const answers: Record<string, () => unknown> = {
    '/me/wallet': () => fixtureWallet.get(),
    '/me/progress': () => buildMyProgressFixture(),
    '/me/achievements': () => buildMyAchievementsFixture(NOW),
    '/me/centrals': () => buildFanCentralsFixture(),
  };
  get.mockImplementation(async (url: string) => {
    if (failing.includes(url)) throw new Error('fora do ar');
    const answer = answers[url];
    if (!answer) throw new Error(`rota sem resposta no teste: ${url}`);
    return { data: answer() } as never;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  fixtureWallet.reset();
  followFixture.reset();
  // Como no app no modo fixtures: consulta não pausa offline.
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
  getDocMock.mockResolvedValue(profileSnapshot as never);
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

describe('perfil (1e)', () => {
  it('o perfil básico vem do Firestore e o progresso das fixtures', async () => {
    renderRouter(appTree, { initialUrl: '/perfil' });

    expect(await screen.findByLabelText(HERO)).toBeTruthy();
    expect(getDocMock).toHaveBeenCalled();
    expect(
      await screen.findByRole('progressbar', { name: pointsCard('12.480', '840', '2.520') }),
    ).toBeTruthy();
    expect(screen.getByLabelText('63 links criados')).toBeTruthy();
    expect(screen.getByLabelText('418 pessoas trazidas')).toBeTruthy();
    // No lugar das playlists (fora do contrato).
    expect(screen.getByLabelText('3 temporadas')).toBeTruthy();
    expect(
      await screen.findByRole('header', { name: 'Conquistas, 14 de 32 conquistadas' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Fã de show, conquistada')).toBeTruthy();
    expect(screen.getByLabelText('Backstage, bloqueada')).toBeTruthy();
  });

  it('o título e o Ajustes (engrenagem) ficam no topo; "14 de 32" não é tocável', async () => {
    renderRouter(appTree, { initialUrl: '/perfil' });

    expect(screen.getByRole('header', { name: 'Meu perfil' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajustes' })).toHaveProp(
      'accessibilityHint',
      'Abre os ajustes da conta',
    );
    await screen.findByText('14 de 32', hidden);
    expect(screen.queryByRole('button', { name: /14 de 32/ })).toBeNull();
    // As peças de conquista também não, por enquanto.
    expect(screen.queryByRole('button', { name: /conquistada|bloqueada/ })).toBeNull();
  });

  it('as centrais são todas as do fã, com a posição e os pontos do ranking da central', async () => {
    renderRouter(appTree, { initialUrl: '/perfil' });

    for (const artistId of ['netto-brito', 'nenho']) {
      const { position, points } = buildMyRankFixture({ kind: 'artist', artistId });
      const row = await screen.findByTestId(`profile-central-${artistId}`);
      expect(row.props.accessibilityLabel).toContain(`${position}º lugar`);
      expect(row.props.accessibilityLabel).toContain(`${points.toLocaleString('pt-BR')} pontos`);
    }
    expect(
      screen.getByRole('button', {
        name: 'Netto Brito, 12º lugar entre 412 mil fãs, 4.120 pontos na temporada.',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Nenho, 41º lugar entre 298 mil fãs, 2.980 pontos na temporada.',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Juninho Moraes, ainda sem posição, entre 141 mil fãs.' }),
    ).toBeTruthy();
    // Lista curta, sem "Ver todas".
    expect(screen.queryByRole('button', { name: /Ver todas/ })).toBeNull();
  });

  it('a linha de central abre o artista na pilha do Perfil', async () => {
    const view = renderRouter(appTree, { initialUrl: '/perfil' });

    fireEvent.press(await screen.findByTestId('profile-central-netto-brito'));

    await waitFor(() => expect(screen.getByText('artist')).toBeTruthy());
    expect(view.getPathname()).toBe('/artista/netto-brito');
    expect(view.getSegments()).toEqual(['(tabs)', '(perfil)', 'artista', '[artistaId]']);
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it('a engrenagem abre os Ajustes na pilha do Perfil', async () => {
    const view = renderRouter(appTree, { initialUrl: '/perfil' });

    fireEvent.press(screen.getByRole('button', { name: 'Ajustes' }));

    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    expect(view.getSegments()).toEqual(['(tabs)', '(perfil)', 'ajustes']);
    expect(rootRoutes(view)).toEqual(['(tabs)']);

    // O voltar dos Ajustes devolve o fã ao perfil.
    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
    expect(await screen.findByLabelText(HERO)).toBeTruthy();
  });

  it('o perfil que ainda não nasceu cai na espera, sem erro, e aparece quando a escuta o traz', async () => {
    // A função de cadastro leva segundos para criar users/{uid}.
    getDocMock.mockResolvedValue({ exists: () => false, metadata: { fromCache: false } } as never);
    renderRouter(appTree, { initialUrl: '/perfil' });

    // O nome da sessão, sem @ nem cidade, e nada de erro.
    expect(await screen.findByLabelText('Camila da Sessão. Nível 7, Purainha.')).toBeTruthy();
    expect(screen.queryByText(/Não deu para/)).toBeNull();
    expect(announcements()).not.toContain('Não deu para atualizar o perfil.');

    act(() => profileListener()(profileSnapshot));

    expect(await screen.findByLabelText(HERO)).toBeTruthy();
    expect(announcements()).not.toContain('Não deu para atualizar o perfil.');
  });

  it('a escuta do Firestore mantém o hero em dia (a cidade que o fã trocou)', async () => {
    renderRouter(appTree, { initialUrl: '/perfil' });
    expect(await screen.findByLabelText(HERO)).toBeTruthy();

    act(() => profileListener()(withCity('Salvador, BA')));

    expect(
      await screen.findByLabelText('Camila Ribeiro, @camilarib, Salvador, BA. Nível 7, Purainha.'),
    ).toBeTruthy();
    expect(screen.getByText('@camilarib · Salvador, BA', hidden)).toBeTruthy();
  });

  it('o resgate da loja desconta o saldo grande; a barra e o "Faltam" seguem no XP', async () => {
    renderRouter(appTree, { initialUrl: '/perfil' });
    await screen.findByRole('progressbar', { name: pointsCard('12.480', '840', '2.520') });

    // O que o resgate da 1h faz: desconta no servidor e invalida o perfil.
    fixtureWallet.spend(6_000);
    await act(() => client.invalidateQueries({ queryKey: profileKeys.all }));

    const card = await screen.findByRole('progressbar', {
      name: pointsCard('6.480', '840', '2.520'),
    });
    expect(card).toHaveProp('accessibilityValue', { min: 0, max: 100, now: 69 });
  });

  it('ganho que invalida só a carteira (o "Eu vou") também atualiza a semana e o nível', async () => {
    renderRouter(appTree, { initialUrl: '/perfil' });
    await screen.findByRole('progressbar', { name: pointsCard('12.480', '840', '2.520') });

    fixtureWallet.earn(15);
    await act(() => client.invalidateQueries({ queryKey: profileKeys.wallet() }));

    expect(
      await screen.findByRole('progressbar', { name: pointsCard('12.495', '855', '2.505') }),
    ).toBeTruthy();
    expect(haptics.trigger).not.toHaveBeenCalledWith('levelUp');
  });

  it('subir de nível com a 1e na tela vibra levelUp e anuncia o nível novo', async () => {
    renderRouter(appTree, { initialUrl: '/perfil' });
    await screen.findByLabelText(HERO);
    await screen.findByText('Nível 7 · Purainha', hidden);

    fixtureWallet.earn(2_520);
    await act(() => client.invalidateQueries({ queryKey: profileKeys.wallet() }));

    expect(await screen.findByText('Nível 8 · Xodó', hidden)).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('levelUp');
    expect(announcements()).toContain('Você subiu para o nível 8, Xodó.');
  });

  it('sem o nível e o saldo, o card vira erro com "Tentar de novo", anunciado uma vez', async () => {
    mockApi(['/me/progress']);
    renderRouter(appTree, { initialUrl: '/perfil' });

    expect(await screen.findByText('Não deu para carregar seus pontos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    await waitFor(() =>
      expect(
        announcements().filter((text) => text === 'Não deu para carregar seus pontos.'),
      ).toHaveLength(1),
    );
    // O resto da tela segue: conquistas e centrais chegaram.
    expect(await screen.findByLabelText('Top 20, conquistada')).toBeTruthy();
    expect(await screen.findByTestId('profile-central-netto-brito')).toBeTruthy();

    get.mockImplementation(async (url: string) => {
      if (url === '/me/progress') return { data: buildMyProgressFixture() } as never;
      if (url === '/me/wallet') return { data: fixtureWallet.get() } as never;
      throw new Error(`rota sem resposta no teste: ${url}`);
    });
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(
      await screen.findByRole('progressbar', { name: pointsCard('12.480', '840', '2.520') }),
    ).toBeTruthy();
    // O botão que tinha o foco sumiu com o erro: o fã ouve que os pontos chegaram.
    await waitFor(() => expect(announcements()).toContain('Pontos carregados.'));
  });

  it('centrais e conquistas que não vieram mostram o erro no lugar delas', async () => {
    mockApi(['/me/centrals', '/me/achievements']);
    renderRouter(appTree, { initialUrl: '/perfil' });

    expect(await screen.findByText('Não deu para carregar suas conquistas.')).toBeTruthy();
    expect(await screen.findByText('Não deu para carregar suas centrais.')).toBeTruthy();
    await waitFor(() =>
      expect(announcements()).toEqual(
        expect.arrayContaining([
          'Não deu para carregar suas conquistas.',
          'Não deu para carregar suas centrais.',
        ]),
      ),
    );

    // As duas voltam no "Tentar de novo" de cada uma, e o fã ouve cada chegada.
    mockApi([]);
    const [achievementsRetry, centralsRetry] = screen.getAllByRole('button', {
      name: 'Tentar de novo',
    });
    if (!achievementsRetry || !centralsRetry) throw new Error('faltou um "Tentar de novo"');
    fireEvent.press(achievementsRetry);
    expect(await screen.findByLabelText('Top 20, conquistada')).toBeTruthy();
    await waitFor(() => expect(announcements()).toContain('Conquistas carregadas.'));
    fireEvent.press(centralsRetry);
    expect(await screen.findByTestId('profile-central-netto-brito')).toBeTruthy();
    await waitFor(() => expect(announcements()).toContain('Centrais carregadas.'));
  });

  it('o "Tentar de novo" que falha de novo não diz que a seção chegou', async () => {
    mockApi(['/me/centrals']);
    renderRouter(appTree, { initialUrl: '/perfil' });

    fireEvent.press(await screen.findByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(5));
    expect(await screen.findByText('Não deu para carregar suas centrais.')).toBeTruthy();
    expect(announcements()).not.toContain('Centrais carregadas.');
  });
});
