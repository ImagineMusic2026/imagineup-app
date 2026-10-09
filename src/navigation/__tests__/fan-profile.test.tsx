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
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Linking, Text } from 'react-native';

import ArtistRoute from '@/app/(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]';
import RankingRoute from '@/app/(tabs)/(ranking)/ranking';
import FanProfileRoute from '@/app/fa/[fanId]';
import PostRoute from '@/app/post/[postId]';
import { followFixture } from '@/domains/artists/fixtures';
import { missionsFixture } from '@/domains/missions';
import { moderationFixture, postsFixture } from '@/domains/posts/fixtures';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';
import { usePreferencesStore } from '@/stores/preferences';

// O build do Firebase que o Jest resolve é ESM; as telas só leem o perfil do fã.
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
  api: { get: jest.fn(), post: jest.fn(), request: jest.fn() },
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
// Quem decide se os links abrem é o `@/config/server` (decisão 25 de 28.1), e
// não o env acima: sem emulador, como no `jest.setup.js`; o caso do emulador
// liga o host só nele. O getter entra pelo `defineProperty`: num objeto
// espalhado, o Babel leria o valor uma vez só, na criação do mock.
let mockEmulatorHost: string | undefined;
jest.mock('@/config/server', () => {
  const server = { ...jest.requireActual('@/config/server'), apiUrl: undefined };
  Object.defineProperty(server, 'firebaseEmulatorHost', {
    enumerable: true,
    get: () => mockEmulatorHost,
  });
  return server;
});
// Tudo nas fixtures; os testes do servidor põem só o perfil na API.
let mockDomainSources: Record<string, 'api' | 'fixtures'> = {};
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => mockDomainSources[domain] ?? 'fixtures',
  usesFixtures: () => true,
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 874 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 59 })),
  };
});

// Relógio fixo, nas fixtures e nas telas: terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const mockNow = NOW;
jest.mock('@/hooks/use-now', () => ({ useNow: () => mockNow }));

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

/** As abas com a 1f e a 1d de verdade, o post e o perfil público pelas próprias rotas. */
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
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': ArtistRoute,
  'post/[postId]': PostRoute,
  'comentario/[comentarioId]': label('comment-options'),
  'sair-da-central/[artistaId]': label('leave-central'),
  'fa/[fanId]': FanProfileRoute,
};

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

const hidden = { includeHiddenElements: true } as const;

const announced = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

const THALITA = {
  uid: 'fa-rank-01',
  displayName: 'Thalita Santos',
  username: 'thalitasan',
  photoURL: null,
  restricted: false,
  bio: 'Do arrocha ao piseiro, sigo o Netto em todo São João.\nIrará na veia.',
  socials: {
    instagram: 'thalita.teste.up',
    tiktok: 'thalita.teste.up',
    linkedin: 'thalita-teste-imagineup',
    x: 'thalitatesteup',
  },
};

const SOCIAL_LABELS = [
  'Instagram, @thalita.teste.up',
  'TikTok, @thalita.teste.up',
  'LinkedIn, in/thalita-teste-imagineup',
  'X (Twitter), @thalitatesteup',
];

const CLOSED = 'Perfil fechado. Só a foto, o nome e o @ ficam à vista.';
const SAMPLE = 'Perfil de exemplo: os links não abrem nesta versão.';
const EMPTY = 'Este fã ainda não escreveu nada aqui.';

/** A API responde o perfil de um fã (o resto das rotas não é chamado com o perfil na API só). */
function mockFanApi(answer: (url: string) => Promise<unknown>): void {
  mockDomainSources = { profile: 'api' };
  jest.mocked(api.get).mockImplementation(async (url: string) => ({ data: await answer(url) }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDomainSources = {};
  mockEmulatorHost = undefined;
  setFixtureNow(NOW);
  fixtureWallet.reset();
  followFixture.reset();
  postsFixture.reset();
  moderationFixture.reset();
  missionsFixture.reset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, networkMode: 'always' },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: 'uid-camila',
      email: 'camila@teste.imagineup',
      displayName: 'Camila Ribeiro',
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
  jest.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib', city: null }),
  } as never);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
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

// Os links a frio ficam antes: o Jest guarda os segmentos da última navegação.
describe('perfil público aberto por link (seção 28)', () => {
  it('nas fixtures, a completa: nome, @, bio e as redes sem toque, com o aviso de exemplo', async () => {
    const view = renderRouter(appTree, { initialUrl: '/fa/fa-rank-01' });

    expect(await screen.findByRole('header', { name: 'Thalita Santos' })).toBeTruthy();
    expect(view.getSegments()).toEqual(['fa', '[fanId]']);
    expect(screen.getByText('@thalitasan')).toBeTruthy();
    expect(screen.getByText(THALITA.bio)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Redes sociais' })).toBeTruthy();
    for (const name of SOCIAL_LABELS) {
      expect(screen.getByLabelText(name)).toBeTruthy();
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByText(SAMPLE)).toBeTruthy();
    // O gênero da tabela (só a equipe vê) nunca aparece.
    expect(screen.queryByText(/Mulher/, hidden)).toBeNull();

    fireEvent.press(screen.getByLabelText(SOCIAL_LABELS[0]!));
    expect(Linking.openURL).not.toHaveBeenCalled();
    // Sem botão de bloquear nem de denunciar (decisão 22): só o voltar.
    expect(screen.getAllByRole('button').map((node) => node.props.accessibilityLabel)).toEqual([
      'Voltar',
    ]);
  });

  it('sem bio e sem redes: o aviso de que o fã ainda não escreveu nada', async () => {
    renderRouter(appTree, { initialUrl: '/fa/fa-rank-04' });

    expect(await screen.findByRole('header', { name: 'Maria Clara Souza' })).toBeTruthy();
    expect(screen.getByText('@mariasou')).toBeTruthy();
    expect(screen.getByLabelText(EMPTY)).toBeTruthy();
    expect(screen.queryByText('Redes sociais', hidden)).toBeNull();
  });

  it('a conta privada e a suspensa saem fechadas, com o mesmo aviso, sem a bio', async () => {
    renderRouter(appTree, { initialUrl: '/fa/fa-rank-05' });
    expect(await screen.findByRole('header', { name: 'Aline Ferreira' })).toBeTruthy();
    expect(screen.getByLabelText(CLOSED)).toBeTruthy();
    expect(screen.queryByText(/Conta de teste privada/, hidden)).toBeNull();
    expect(screen.queryByText('Redes sociais', hidden)).toBeNull();
  });

  it('a suspensa, fechada como a privada', async () => {
    renderRouter(appTree, { initialUrl: '/fa/fa-rank-48' });
    expect(await screen.findByRole('header', { name: 'Renata Teixeira' })).toBeTruthy();
    expect(screen.getByText('@renatatei')).toBeTruthy();
    expect(screen.getByLabelText(CLOSED)).toBeTruthy();
  });

  it('o fã que saiu do ImagineUP (404): o aviso, anunciado, sem "Tentar de novo"', async () => {
    renderRouter(appTree, { initialUrl: '/fa/nettobrito' });

    expect(await screen.findByLabelText('Este fã não está mais no ImagineUP.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    await waitFor(() => expect(announced()).toContain('Este fã não está mais no ImagineUP.'));
  });

  it('com a API, as redes abrem fora do app pelo link montado; a rede torta não aparece', async () => {
    mockFanApi(async (url) => {
      if (url === '/fans/fa-rank-01') {
        return { ...THALITA, socials: { ...THALITA.socials, linkedin: 'Thalita Teste' } };
      }
      throw new Error(`rota sem resposta no teste: ${url}`);
    });
    renderRouter(appTree, { initialUrl: '/fa/fa-rank-01' });

    const instagram = await screen.findByRole('button', { name: SOCIAL_LABELS[0] });
    expect(instagram.props.accessibilityHint).toBe('Abre o perfil no Instagram, fora do app');
    expect(screen.getByRole('button', { name: SOCIAL_LABELS[3] })).toBeTruthy();
    // O LinkedIn fora do padrão não sai, e sem as fixtures não há aviso de exemplo.
    expect(screen.queryByLabelText(/^LinkedIn/)).toBeNull();
    expect(screen.queryByText(SAMPLE)).toBeNull();

    fireEvent.press(instagram);
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.instagram.com/thalita.teste.up/');
    fireEvent.press(screen.getByRole('button', { name: SOCIAL_LABELS[1] }));
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://www.tiktok.com/@thalita.teste.up');
    expect(screen.queryByText('Não deu para abrir o link.')).toBeNull();
  });

  it('com a API do emulador, as redes não abrem: as linhas sem toque e o aviso de exemplo', async () => {
    // O seed grava usuários que qualquer pessoa pode registrar (decisão 25).
    mockEmulatorHost = '10.0.2.2';
    mockFanApi(async () => THALITA);
    renderRouter(appTree, { initialUrl: '/fa/fa-rank-01' });

    expect(await screen.findByRole('header', { name: 'Thalita Santos' })).toBeTruthy();
    expect(jest.mocked(api.get).mock.calls[0]?.[0]).toBe('/fans/fa-rank-01');
    for (const name of SOCIAL_LABELS) {
      expect(screen.getByLabelText(name)).toBeTruthy();
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByText(SAMPLE)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(SOCIAL_LABELS[0]!));
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('com a API, o link que não abre mostra o aviso na tela, anunciado, com o toque de erro', async () => {
    mockFanApi(async () => THALITA);
    jest.mocked(Linking.openURL).mockRejectedValue(new Error('sem app'));
    renderRouter(appTree, { initialUrl: '/fa/fa-rank-01' });

    fireEvent.press(await screen.findByRole('button', { name: SOCIAL_LABELS[3] }));

    expect(Linking.openURL).toHaveBeenCalledWith('https://x.com/thalitatesteup');
    expect(await screen.findByText('Não deu para abrir o link.')).toBeTruthy();
    await waitFor(() => expect(announced()).toEqual(['Não deu para abrir o link.']));
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('com a API, o perfil que não carregou: o aviso, anunciado, e o "Tentar de novo" busca de novo', async () => {
    let fail = true;
    mockFanApi(async () => {
      if (fail) throw new ApiError('server', 'fora do ar', 500);
      return THALITA;
    });
    renderRouter(appTree, { initialUrl: '/fa/fa-rank-01' });

    expect(await screen.findByLabelText('Não deu para carregar o perfil.')).toBeTruthy();
    await waitFor(() => expect(announced()).toEqual(['Não deu para carregar o perfil.']));

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('header', { name: 'Thalita Santos' })).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe('perfil público aberto pelo ranking, pela 1d e pelos comentários', () => {
  it('na 1f, a linha abre o perfil por cima das abas, e o voltar devolve ao ranking', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ranking' });

    fireEvent.press(await screen.findByRole('button', { name: /^4º, Maria Clara Souza/ }));

    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-04'));
    expect(rootRoutes(view)).toEqual(['(tabs)', 'fa/[fanId]']);
    expect(await screen.findByRole('header', { name: 'Maria Clara Souza' })).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('tap');

    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/ranking'));
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it('na 1f, o 1º do pódio abre a Thalita, completa', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ranking' });

    fireEvent.press(await screen.findByRole('button', { name: /^1º lugar, Thalita S\./ }));

    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-01'));
    expect(await screen.findByRole('header', { name: 'Thalita Santos' })).toBeTruthy();
    expect(screen.getByText(THALITA.bio)).toBeTruthy();
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/ranking'));
  });

  it('na 1d, os top fãs abrem o perfil (a Aline, fechada), e o voltar devolve à central', async () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/nettobrito' });

    fireEvent.press(
      await screen.findByRole('button', { name: '2º lugar, Aline F., 6.050 pontos' }),
    );

    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-05'));
    expect(rootRoutes(view)).toEqual(['(tabs)', 'fa/[fanId]']);
    expect(await screen.findByLabelText(CLOSED)).toBeTruthy();
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/artista/nettobrito'));
  });

  it('na aba Ranking da 1d, a linha abre o perfil, e o voltar devolve à mesma aba', async () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/nettobrito' });
    await screen.findByTestId('artist-heading');
    fireEvent.press(screen.getAllByLabelText('Ranking').at(-1)!);

    fireEvent.press(await screen.findByTestId('artist-rank-2'));

    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-05'));
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/artista/nettobrito'));
    expect(screen.getAllByLabelText('Ranking').at(-1)!.props.accessibilityState?.selected).toBe(
      true,
    );
  });

  it('no post, o comentário de outro fã abre o perfil dele por cima do post', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    act(() => router.push('/post/p-clipe'));

    // A hora do comentário sai do relógio da tela, que acompanha a busca: só o começo e o texto.
    fireEvent.press(
      await screen.findByRole('button', { name: /^Thalita S\., .*: Já mandei pro grupo/ }),
    );

    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-thalita'));
    expect(rootRoutes(view)).toEqual(['(tabs)', 'post/[postId]', 'fa/[fanId]']);
    // O comentário diz "Thalita S." (o protótipo); o perfil, o nome do ranking.
    expect(await screen.findByRole('header', { name: 'Thalita Santos' })).toBeTruthy();
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/post/p-clipe'));
    expect(rootRoutes(view)).toEqual(['(tabs)', 'post/[postId]']);
  });
});
