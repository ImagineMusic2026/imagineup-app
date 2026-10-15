import {
  dehydrate,
  hydrate,
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from '@tanstack/react-query';
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
import { AccessibilityInfo, Alert, Text } from 'react-native';

import HomeRoute from '@/app/(tabs)/(inicio)/index';
import CommentOptionsRoute from '@/app/comentario/[comentarioId]';
import PostRoute from '@/app/post/[postId]';
import { missionsFixture } from '@/domains/missions';
import {
  moderationKeys,
  postKeys,
  postMutationKeys,
  registerPostMutationDefaults,
  type Post,
} from '@/domains/posts';
import { findPostFixture, moderationFixture, postsFixture } from '@/domains/posts/fixtures';
import { fanKeys, type FanPublicProfile } from '@/domains/profile';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { createQueryClient } from '@/services/query/client';
import { persistOptions } from '@/services/query/persister';
import { resetRefusalAlerts } from '@/services/refusal-alert';
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
  'fa/[fanId]': label('fan'),
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

  it('"Bloquear" não fecha (seção 29): o convite para denunciar no lugar do botão, e "Denunciar comentário" ainda envia', async () => {
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    await openOptions(view);

    fireEvent.press(screen.getByRole('button', { name: 'Bloquear Thalita S.' }));

    // O nome do comentário sem o ponto dele, antes do ponto da frase.
    const invite =
      'Você bloqueou Thalita S. A equipe só fica sabendo se você denunciar o comentário.';
    expect(await screen.findByText(invite)).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(invite);
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    expect(view.getPathname()).toBe('/comentario/c-clipe-thalita');
    expect(screen.queryByRole('button', { name: 'Bloquear Thalita S.' })).toBeNull();
    // O comentário sai da lista do post, embaixo da sheet. `not.toBeOnTheScreen`,
    // e não `toBeNull`: a mensagem da volta que ainda acha a linha imprimiria a
    // árvore inteira (o `_fiber`), uns 2 s de CPU.
    await waitFor(() => expect(screen.queryByLabelText(THALITA_ROW)).not.toBeOnTheScreen());

    // A sheet segue com o comentário: denunciar ainda vai, e aí fecha.
    fireEvent.press(screen.getByRole('button', { name: 'Ofensivo' }));
    fireEvent.press(screen.getByRole('button', { name: 'Denunciar comentário' }));
    await waitFor(() => expect(view.getPathname()).toBe('/post/p-clipe'));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Denúncia enviada. A equipe vai analisar.',
    );
  });

  it('bloquear pela sheet muda o perfil público em cache e zera a lista de bloqueados', async () => {
    const thalita: FanPublicProfile = {
      uid: 'fa-thalita',
      displayName: 'Thalita Santos',
      username: 'thalitasan',
      photoURL: null,
      restricted: false,
      bio: null,
      socials: null,
      blockedByMe: false,
    };
    client.setQueryData(fanKeys.profile('fa-thalita'), thalita);
    client.setQueryData(moderationKeys.blocked(), {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [null],
    });
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    await openOptions(view);

    fireEvent.press(screen.getByRole('button', { name: 'Bloquear Thalita S.' }));

    await waitFor(() =>
      expect(client.getQueryData<FanPublicProfile>(fanKeys.profile('fa-thalita'))).toMatchObject({
        blockedByMe: true,
      }),
    );
    expect(client.getQueryData(moderationKeys.blocked())).toBeUndefined();
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

describe('perfil público pelo comentário (seção 28)', () => {
  const THALITA_ROW =
    'Thalita S., há 1 hora: Já mandei pro grupo da família inteira, Irará em peso! 💃';

  it('a linha da Thalita é o botão que abre o perfil dela por cima do post; o Netto e o "Você" não', async () => {
    // Um comentário do próprio fã, já gravado: a linha "Você".
    postsFixture.addComment(
      {
        postId: 'p-clipe',
        text: 'Que clipe!',
        idempotencyKey: 'comment-camila-0001',
        author: { id: 'uid-camila', name: 'Camila Ribeiro', photoURL: null },
      },
      new Date(),
    );
    const view = renderRouter(appTree, { initialUrl: '/' });
    fireEvent.press(await screen.findByRole('button', { name: CLIP_ROW }));

    const thalita = await screen.findByRole('button', { name: THALITA_ROW });
    expect(thalita.props.accessibilityHint).toBe('Abre o perfil de Thalita S.');
    // A resposta do Netto (artista) e o comentário do fã continuam sem botão.
    expect(screen.getByLabelText(/^Netto Brito, artista verificado, há 48 minutos/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /^Netto Brito, artista verificado, há 48 minutos/ }),
    ).toBeNull();
    expect(screen.getByLabelText(/^Você, .*Que clipe!$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Você, / })).toBeNull();

    fireEvent.press(thalita);
    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-thalita'));
    expect(rootRoutes(view)).toEqual(['(tabs)', 'post/[postId]', 'fa/[fanId]']);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');

    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/post/p-clipe'));
    expect(rootRoutes(view)).toEqual(['(tabs)', 'post/[postId]']);
  });
});

describe('o vídeo do post (seção 33)', () => {
  const THALITA_ROW =
    'Thalita S., há 1 hora: Já mandei pro grupo da família inteira, Irará em peso! 💃';
  const VIDEO_URL =
    'https://firebasestorage.googleapis.com/v0/b/imagine-up-app.firebasestorage.app/o/posts%2Fp-clipe%2Fvideo-1.mp4?alt=media&token=v';

  /** O player falso do `jest.setup.js`. */
  const players = () =>
    jest.requireMock<{ mockPlayers: { play: jest.Mock; pause: jest.Mock }[] }>('expo-video')
      .mockPlayers;

  it('abrir o perfil de um fã por um comentário pausa o vídeo, e o voltar não o toca de novo', async () => {
    players().length = 0;
    // As fixtures não têm o mp4: o detalhe do clipe vem do cache, com ele, e não busca de novo.
    client.setQueryDefaults(postKeys.detail('p-clipe'), { staleTime: Infinity });
    client.setQueryData<Post>(postKeys.detail('p-clipe'), {
      ...findPostFixture(new Date(), 'p-clipe'),
      media: { url: VIDEO_URL, thumbnailUrl: null, posterUrl: null, width: 1080, height: 608 },
    });
    const view = renderRouter(appTree, { initialUrl: '/' });
    fireEvent.press(await screen.findByRole('button', { name: CLIP_ROW }));

    fireEvent.press(await screen.findByRole('button', { name: 'Tocar o vídeo de Netto Brito' }));
    const [player] = players();
    expect(player?.play).toHaveBeenCalledTimes(1);
    expect(player?.pause).not.toHaveBeenCalled();

    fireEvent.press(await screen.findByRole('button', { name: THALITA_ROW }));
    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-thalita'));
    await waitFor(() => expect(player?.pause).toHaveBeenCalledTimes(1));

    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/post/p-clipe'));
    // O mesmo player, parado: o fã toca de novo pelos controles.
    expect(players()).toHaveLength(1);
    expect(player?.play).toHaveBeenCalledTimes(1);
  });
});

describe('o 429 com o cliente do app (seção 29, frente F)', () => {
  const LIKE = 'Curtir, 4.812 curtidas';
  const LIKED = 'Curtir, 4.813 curtidas';
  const DAILY_LIKE = 'Você chegou ao limite de curtidas de hoje. Tente amanhã.';
  const dailyLimit = () =>
    new ApiError(
      'dailyLimit',
      'Tentativas demais por hoje.',
      429,
      'too_many_requests',
      { limit: 30, action: 'like' },
      43_200_000,
    );
  const rateLimited = () =>
    new ApiError('rateLimited', 'Muitos pedidos.', 429, 'rate_limited', null, 1000);

  beforeEach(() => {
    // O cliente do app: as novas tentativas e o `MutationCache` de verdade.
    client = createQueryClient({ queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } });
    resetRefusalAlerts();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => jest.useRealTimers());

  it('o teto do dia de curtir abre o "Limite de hoje", um só para duas recusas; a segunda anuncia a frase', async () => {
    const like = jest.spyOn(postsFixture, 'setLike').mockImplementation(() => {
      throw dailyLimit();
    });
    renderRouter(appTree, { initialUrl: '/post/p-clipe' });

    fireEvent.press(await screen.findByRole('button', { name: LIKE }));
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
    expect(Alert.alert).toHaveBeenCalledWith('Limite de hoje', DAILY_LIKE, [
      { text: 'Entendi', style: 'cancel' },
    ]);
    // O teto do dia não tenta de novo, e o coração volta. Com o `Alert`, sem anúncio.
    expect(like).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(DAILY_LIKE);

    // A segunda, com a trava de 30 s segurando o `Alert`, anuncia a frase do teto.
    fireEvent.press(await screen.findByRole('button', { name: LIKE }));
    await waitFor(() => expect(like).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: LIKE })).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(DAILY_LIKE);
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(
      'Não deu para curtir o post. Tente de novo.',
    );
  });

  it('a curtida restaurada do disco (só a default) recusada no teto apaga o coração', async () => {
    registerPostMutationDefaults(client);
    renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    await screen.findByRole('button', { name: LIKE });
    // O cache que voltou do disco com a curtida da fila: o coração aceso.
    act(() => {
      client.setQueryData<Post>(postKeys.detail('p-clipe'), (post) =>
        post ? { ...post, likedByMe: true, likeCount: post.likeCount + 1 } : post,
      );
    });
    expect(await screen.findByRole('button', { name: LIKED })).toBeTruthy();

    jest.spyOn(postsFixture, 'setLike').mockImplementation(() => {
      throw dailyLimit();
    });
    // A mutação restaurada não tem o hook: roda com as defaults da fila.
    await act(async () => {
      const restored = client.getMutationCache().build(client, {
        mutationKey: postMutationKeys.like,
      });
      await restored
        .execute({ postId: 'p-clipe', liked: true, idempotencyKey: 'like-da-fila' })
        .catch(() => undefined);
    });

    expect(await screen.findByRole('button', { name: LIKE })).toBeTruthy();
    expect(Alert.alert).toHaveBeenCalledWith('Limite de hoje', DAILY_LIKE, [
      { text: 'Entendi', style: 'cancel' },
    ]);
  });

  it('o comentário no ritmo tenta de novo sozinho, vira "Não enviado" e o toque repete a mesma chave', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const add = jest.spyOn(postsFixture, 'addComment').mockImplementation(() => {
      throw rateLimited();
    });
    renderRouter(appTree, { initialUrl: '/post/p-clipe' });

    fireEvent.changeText(await screen.findByTestId('comment-input'), 'Que clipe!');
    fireEvent.press(screen.getByTestId('comment-send'));
    // As três novas tentativas do ritmo, cada uma depois do Retry-After (1 s).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
    }

    const row = await screen.findByRole('button', { name: 'Você, não enviado: Que clipe!' });
    expect(add).toHaveBeenCalledTimes(4);
    // O texto não voltou ao campo: a tentativa fica na linha.
    expect(screen.getByTestId('comment-input')).toHaveProp('value', '');
    const firstKey = add.mock.calls[0]?.[0].idempotencyKey;
    expect(new Set(add.mock.calls.map(([input]) => input.idempotencyKey))).toEqual(
      new Set([firstKey]),
    );

    add.mockRestore();
    const retried = jest.spyOn(postsFixture, 'addComment');
    fireEvent.press(row);
    await waitFor(() => expect(retried).toHaveBeenCalledTimes(1));
    expect(retried.mock.calls[0]?.[0].idempotencyKey).toBe(firstKey);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Você, não enviado: Que clipe!' })).toBeNull(),
    );
  });
});

// O filtro do que o fã publica (seção 30), com o cliente do app: o espião da
// fixture faz o papel do servidor (as fixtures não filtram), e nenhum termo da
// lista entra no teste.
describe('o comentário da fila recusado pelo filtro (seção 30)', () => {
  const TEXT = 'Texto de teste da fila';
  const contentRefused = () =>
    new ApiError('validation', 'Fora dos Termos de uso.', 400, 'comment_invalid', {
      reason: 'not_allowed',
    });

  /** O cliente do app, com as defaults da fila, como o `AppProviders` monta. */
  function appClient(): QueryClient {
    const created = createQueryClient({
      queries: { gcTime: Infinity },
      mutations: { gcTime: Infinity },
    });
    registerPostMutationDefaults(created);
    return created;
  }

  beforeEach(() => {
    client = appClient();
  });

  it('a recusa com a tela fechada vai para o disco e volta "Não publicado"; o toque devolve o texto sem mandar de novo', async () => {
    const add = jest.spyOn(postsFixture, 'addComment').mockImplementation(() => {
      throw contentRefused();
    });
    // A mutação que volta do disco roda só com a default da fila, sem a tela.
    await act(async () => {
      await client
        .getMutationCache()
        .build(client, { mutationKey: postMutationKeys.comment })
        .execute({
          postId: 'p-clipe',
          text: TEXT,
          idempotencyKey: 'comentario-da-fila',
          localId: 'local-da-fila',
          sentAt: new Date().toISOString(),
          author: { id: 'uid-camila', name: 'Camila Ribeiro', photoURL: null },
        })
        .catch(() => undefined);
    });
    expect(add).toHaveBeenCalledTimes(1);

    // O app fecha (o persister grava, pelo JSON) e abre de novo com o cache do disco.
    const saved = JSON.parse(
      JSON.stringify(dehydrate(client, persistOptions.dehydrateOptions)),
    ) as DehydratedState;
    client.clear();
    client = appClient();
    hydrate(client, saved);
    renderRouter(appTree, { initialUrl: '/post/p-clipe' });

    const row = await screen.findByRole('button', { name: `Você, não publicado: ${TEXT}` });
    expect(row.props.accessibilityHint).toBe('Volta o texto para o campo');
    expect(screen.getByText('Não publicado. Toque para editar o texto')).toBeTruthy();

    // O erro voltou do disco como objeto do JSON: o toque não manda de novo.
    fireEvent.press(row);
    expect(await screen.findByTestId('comment-refusal')).toHaveTextContent(
      'Conforme os Termos de uso do ImagineUP, este comentário não pode ser publicado. Revise o texto.',
    );
    expect(screen.getByTestId('comment-input')).toHaveProp('value', TEXT);
    expect(screen.queryByRole('button', { name: `Você, não publicado: ${TEXT}` })).toBeNull();
    expect(add).toHaveBeenCalledTimes(1);
    expect(client.getMutationCache().findAll({ mutationKey: postMutationKeys.comment })).toEqual(
      [],
    );
  });
});
