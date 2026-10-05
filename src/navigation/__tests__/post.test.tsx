import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { AccessibilityInfo, Text } from 'react-native';

import HomeRoute from '@/app/(tabs)/(inicio)/index';
import CommentOptionsRoute from '@/app/comentario/[comentarioId]';
import PostRoute from '@/app/post/[postId]';
import { missionsFixture } from '@/domains/missions';
import { moderationFixture, postsFixture } from '@/domains/posts/fixtures';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// O build do Firebase que o Jest resolve é ESM; as telas só leem o perfil.
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
// Sem .env no Jest: fixtures.
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
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
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 126 })),
  };
});

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

const CLIP_ROW = new RegExp('^Netto Brito, artista verificado, há 2 horas\\. Saiu o clipe');
const AUTHOR = 'Netto Brito, artista verificado, Artista Imagine, há 2 horas';

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

/** A home e o post de verdade, pelas próprias rotas; o resto vazio. */
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
  'post/[postId]': PostRoute,
  'comentario/[comentarioId]': CommentOptionsRoute,
  convidar: label('invite'),
};

beforeEach(() => {
  jest.clearAllMocks();
  postsFixture.reset();
  moderationFixture.reset();
  missionsFixture.reset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
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
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('post com comentários', () => {
  // Link a frio antes dos que navegam: o Jest guarda os segmentos da última navegação.
  it('aberto por link, mostra o post e os comentários, sem tab bar', async () => {
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });

    expect(await screen.findByRole('button', { name: AUTHOR })).toBeTruthy();
    expect(view.getSegments()).toEqual(['post', '[postId]']);
    expect(
      await screen.findByLabelText(
        'Netto Brito, artista verificado, há 48 minutos: Thalita sempre na frente 🔥',
      ),
    ).toBeTruthy();
    // Fora das abas: a pilha raiz só tem o post, e a árvore de abas nem monta.
    expect(rootRoutes(view)).toEqual(['post/[postId]']);
  });

  it('aberto por link, o autor abre a central no Início, com a home embaixo', async () => {
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });

    fireEvent.press(await screen.findByRole('button', { name: AUTHOR }));

    await waitFor(() => expect(view.getPathname()).toBe('/artista/nettobrito'));
    expect(view.getSegments()).toEqual(['(tabs)', '(inicio)', 'artista', '[artistaId]']);
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });

  it('a curtida dada no post aparece no mural da home ao voltar', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    fireEvent.press(await screen.findByRole('button', { name: CLIP_ROW }));
    // Vindo do mural, o post abre por cima das abas, na pilha raiz.
    await waitFor(() => expect(rootRoutes(view)).toEqual(['(tabs)', 'post/[postId]']));

    fireEvent.press(await screen.findByRole('button', { name: 'Curtir, 4.812 curtidas' }));
    expect(await screen.findByRole('button', { name: 'Curtir, 4.813 curtidas' })).toBeTruthy();
    await waitFor(() => expect(client.isMutating()).toBe(0));

    act(() => testRouter.back());
    expect(await screen.findByLabelText('4.813 curtidas')).toBeTruthy();
  });

  it('o autor abre a central na aba de onde o fã veio, por cima das abas', async () => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    fireEvent.press(await screen.findByRole('button', { name: CLIP_ROW }));

    fireEvent.press(await screen.findByRole('button', { name: AUTHOR }));

    await waitFor(() => expect(view.getPathname()).toBe('/artista/nettobrito'));
    expect(view.getSegments()).toEqual(['(tabs)', '(inicio)', 'artista', '[artistaId]']);
    // O post sai e a central abre na aba que já existe, sem outra árvore de abas.
    expect(rootRoutes(view)).toEqual(['(tabs)']);

    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it.each([
    ['Perfil', '/perfil', '(perfil)'],
    ['Início', '/', '(inicio)'],
  ])(
    'do post aberto pela grade da central (%s), o autor volta à mesma central, sem outra por cima',
    async (_tab, root, group) => {
      const view = renderRouter(appTree, { initialUrl: root });
      await waitFor(() => expect(view.getPathname()).toBe(root));
      act(() => router.push('/artista/nettobrito'));
      await waitFor(() =>
        expect(view.getSegments()).toEqual(['(tabs)', group, 'artista', '[artistaId]']),
      );
      // A grade da 1d abre o post por cima das abas.
      act(() => router.push('/post/p-clipe'));

      fireEvent.press(await screen.findByRole('button', { name: AUTHOR }));

      await waitFor(() => expect(rootRoutes(view)).toEqual(['(tabs)']));
      expect(view.getSegments()).toEqual(['(tabs)', group, 'artista', '[artistaId]']);
      // Um voltar só chega à raiz da aba: a central não ficou duplicada.
      act(() => testRouter.back());
      await waitFor(() => expect(view.getPathname()).toBe(root));
    },
  );
});

describe('opções do comentário (denunciar e bloquear, bloco 6)', () => {
  const THALITA_ROW =
    'Thalita S., há 1 hora: Já mandei pro grupo da família inteira, Irará em peso! 💃';
  const OPTIONS = 'Opções do comentário de Thalita S.';

  // Link a frio antes dos que navegam: o Jest guarda os segmentos da última navegação.
  it('a sheet aberta a frio, sem o comentário no cache, fecha', async () => {
    const view = renderRouter(appTree, {
      initialUrl: '/comentario/c-clipe-thalita?post=p-clipe',
    });
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(screen.queryByText('Comentário de Thalita S.')).toBeNull();
  });

  async function openOptions(view: Router): Promise<void> {
    expect(await screen.findByLabelText(THALITA_ROW)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: OPTIONS }));
    await waitFor(() => expect(view.getPathname()).toBe('/comentario/c-clipe-thalita'));
    expect(await screen.findByRole('header', { name: 'Comentário de Thalita S.' })).toBeTruthy();
  }

  it('o botão da linha abre a sheet; "Denunciar comentário" fecha e anuncia', async () => {
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    await openOptions(view);

    fireEvent.press(screen.getByRole('button', { name: 'Spam' }));
    fireEvent.press(screen.getByRole('button', { name: 'Denunciar comentário' }));

    await waitFor(() => expect(view.getPathname()).toBe('/post/p-clipe'));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Denúncia enviada. A equipe vai analisar.',
    );
    // A denúncia não esconde o comentário.
    expect(screen.getByLabelText(THALITA_ROW)).toBeTruthy();
  });

  it('"Bloquear" fecha, anuncia e o comentário some da lista', async () => {
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    await openOptions(view);

    fireEvent.press(screen.getByRole('button', { name: 'Bloquear Thalita S.' }));

    await waitFor(() => expect(view.getPathname()).toBe('/post/p-clipe'));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Bloqueio feito: os comentários de Thalita S. somem para você.',
    );
    // `not.toBeOnTheScreen`, e não `toBeNull`: a mensagem da volta que ainda
    // acha a linha imprimiria a árvore inteira (o `_fiber`), uns 2 s de CPU.
    await waitFor(() => expect(screen.queryByLabelText(THALITA_ROW)).not.toBeOnTheScreen());
  });

  it('sem internet, denunciar e bloquear ficam desligados', async () => {
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    await openOptions(view);

    act(() => onlineManager.setOnline(false));
    expect(
      screen.getByRole('button', { name: 'Denunciar comentário' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
    expect(
      screen.getByRole('button', { name: 'Bloquear Thalita S.' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });
    act(() => onlineManager.setOnline(true));
  });
});
