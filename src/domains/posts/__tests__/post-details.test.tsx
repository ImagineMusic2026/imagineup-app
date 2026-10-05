import { FlashList } from '@shopify/flash-list';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getDoc, onSnapshot } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { artistKeys } from '@/domains/artists';
import { missionKeys, missionsFixture } from '@/domains/missions';
import { profileKeys } from '@/domains/profile';
import { rankingKeys } from '@/domains/ranking';
import { buildMyInviteFixture } from '@/domains/profile/fixtures';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { colors } from '@/theme';

import {
  COMMENT_POINTS,
  buildCommentsPageFixture,
  buildFeedPageFixture,
  findPostFixture,
  postsFixture,
} from '../fixtures';
import { postKeys, postMutationKeys, registerPostMutationDefaults } from '../queries';
import type { Page, Post, PostComment } from '../types';
import { mergeComments, PostDetailsScreen, unsentCount } from '../views/post-details';

// O nome e a foto de quem comenta vêm do perfil (Firestore).
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

// Fixtures por padrão; os testes de resposta do servidor trocam para a API.
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

let mockPostId = 'p-clipe';
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ postId: mockPostId }),
  useNavigationContainerRef: () => ({ getRootState: () => undefined }),
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 874 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 64 })),
  };
});

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const request = jest.mocked(api.request);

const hidden = { includeHiddenElements: true } as const;

const CLIP_TEXT = 'Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.';
const COMMENTS_TITLE = (count: string) => t('post.comments.titleLabel', { count });
const pendingLabel = (text: string) => `Você, enviando: ${text}`;
const failedLabel = (text: string) => `Você, não enviado: ${text}`;
const sentLabel = (text: string) => `Você, agora: ${text}`;

/** O comentário como o servidor devolve depois de gravar. */
const savedComment = (text: string, id = 'c-servidor') => ({
  id,
  postId: 'p-clipe',
  authorId: 'uid-camila',
  authorName: 'Camila Ribeiro',
  authorAvatarUrl: null,
  authorIsArtist: false,
  text,
  createdAt: new Date().toISOString(),
  pointsAwarded: 0,
});

const idempotencyKeys = () =>
  post.mock.calls.map(
    ([, , config]) => (config?.headers as Record<string, string>)['Idempotency-Key'],
  );

const commentMutations = () =>
  client.getMutationCache().findAll({ mutationKey: postMutationKeys.comment });

const profileSnapshot = {
  exists: () => true,
  data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib', city: null }),
};

/** Promessa que o teste resolve ou recusa quando quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A API respondendo como as fixtures, com os comentários e o envio trocáveis. */
function mockApi(): void {
  mockDataSource = 'api';
  get.mockImplementation(async (url: string, config?: { params?: unknown }) => {
    const now = new Date();
    const cursor = (config?.params as { cursor?: string | null } | undefined)?.cursor ?? null;
    if (url === '/posts/p-clipe') return { data: findPostFixture(now, 'p-clipe') } as never;
    if (url === '/posts/p-clipe/comments') {
      return {
        data: buildCommentsPageFixture(now, 'p-clipe', cursor),
      } as never;
    }
    if (url === '/me/invite') {
      return { data: { code: 'CAMILA12', pointsPerVisit: 2, pointsPerSignup: 10 } } as never;
    }
    throw new Error(`rota sem resposta no teste: ${url}`);
  });
}

let client: QueryClient;

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** Monta a tela com o perfil da Camila já lido (quem comenta). */
async function renderPost() {
  render(<PostDetailsScreen />, { wrapper });
  await screen.findByText(CLIP_TEXT);
  // O código de convite do compartilhar chega junto.
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await waitFor(() =>
    expect(client.getQueryData(profileKeys.me('uid-camila'))).toMatchObject({
      displayName: 'Camila Ribeiro',
    }),
  );
  await screen.findByLabelText(
    'Netto Brito, artista verificado, há 48 minutos: Thalita sempre na frente 🔥',
  );
}

/**
 * Espera a tela terminar o que ainda busca depois do último passo (a lista de
 * comentários, a medida da FlashList), dentro do teste: solto depois dele, o
 * React avisaria de atualização fora do `act`.
 */
async function settle(): Promise<void> {
  await waitFor(() => expect(client.isFetching() + client.isMutating()).toBe(0));
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

const input = () => screen.getByLabelText(t('post.commentPlaceholder'));
const sendButton = () => screen.getByRole('button', { name: t('post.composer.send') });

function type(text: string): void {
  fireEvent.changeText(input(), text);
}

function sendComment(text: string): void {
  type(text);
  fireEvent.press(sendButton());
}

const announcements = () => [
  ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text),
  ...jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  mockPostId = 'p-clipe';
  postsFixture.reset();
  missionsFixture.reset();
  fixtureWallet.reset();
  // Sem busca de novo por dado velho: cada teste diz o que a tela busca.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  // O perfil de quem comenta e o código do compartilhar, como depois da home.
  client.setQueryData(profileKeys.me('uid-camila'), {
    uid: 'uid-camila',
    displayName: 'Camila Ribeiro',
    username: 'camilarib',
    city: null,
    photoURL: null,
    createdAt: null,
  });
  client.setQueryData(profileKeys.invite(), buildMyInviteFixture());
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
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  jest.restoreAllMocks();
});

describe('post com comentários', () => {
  it('monta com o post, as ações e a primeira página de comentários', async () => {
    await renderPost();
    expect(
      screen.getByRole('button', {
        name: 'Netto Brito, artista verificado, Artista Imagine, há 2 horas',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('header', { name: COMMENTS_TITLE('327') })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Curtir, 4.812 curtidas' })).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Thalita S., há 1 hora: Já mandei pro grupo da família inteira, Irará em peso! 💃',
      ),
    ).toBeTruthy();
  });

  it('enviar fica desligado com o campo vazio ou só com espaço', async () => {
    await renderPost();
    expect(sendButton().props.accessibilityState).toMatchObject({ disabled: true });
    type('   \n ');
    expect(sendButton().props.accessibilityState).toMatchObject({ disabled: true });
    type('Oi');
    expect(sendButton().props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('o contador aparece a partir de 450 caracteres e fica laranja em 500', async () => {
    await renderPost();
    expect(input().props.maxLength).toBe(500);

    type('a'.repeat(449));
    expect(screen.queryByText('449/500', hidden)).toBeNull();

    type('a'.repeat(450));
    expect(screen.getByText('450/500', hidden)).toHaveStyle({ color: colors.textMuted });
    expect(input().props.accessibilityHint).toBe('450 de 500 caracteres');

    type('a'.repeat(500));
    expect(screen.getByText('500/500', hidden)).toHaveStyle({ color: colors.danger });
    // O `maxLength` descarta o resto calado: o leitor ouve que chegou ao limite.
    await waitFor(() =>
      expect(announcements()).toEqual([t('post.composer.limitReached', { max: 500 })]),
    );
  });

  it('o campo e o enviar têm alvo de 44, com o desenho de 40 dentro', async () => {
    await renderPost();
    expect(input()).toHaveStyle({ minHeight: 44 });
    expect(sendButton()).toHaveStyle({ width: 44, height: 44 });
  });

  it('"Comentar" leva o foco do teclado e o do leitor de tela ao campo', async () => {
    await renderPost();
    fireEvent.press(screen.getByRole('button', { name: 'Comentar, 327 comentários' }));
    await waitFor(() =>
      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
        expect.anything(),
        'focus',
      ),
    );
  });

  it('o comentário entra na hora com "enviando…", a contagem sobe e ele chega com "+2"', async () => {
    await renderPost();
    sendComment('  Clipe lindo demais, Netto!  ');

    // Na hora, antes da resposta: o campo limpa e a linha aparece no topo.
    expect(await screen.findByLabelText(pendingLabel('Clipe lindo demais, Netto!'))).toBeTruthy();
    expect(input().props.value).toBe('');
    expect(screen.getByRole('header', { name: COMMENTS_TITLE('328') })).toBeTruthy();

    expect(await screen.findByLabelText(sentLabel('Clipe lindo demais, Netto!'))).toBeTruthy();
    expect(screen.queryByLabelText(pendingLabel('Clipe lindo demais, Netto!'))).toBeNull();
    expect(screen.getByRole('header', { name: COMMENTS_TITLE('328') })).toBeTruthy();
    // O que deu certo sai do cache de mutações na hora.
    expect(commentMutations()).toHaveLength(0);
    expect(haptics.trigger).toHaveBeenCalledWith('commentSent');
    await waitFor(() =>
      expect(announcements()).toEqual([`Comentário enviado. Mais ${COMMENT_POINTS} pontos`]),
    );
    expect(haptics.trigger).toHaveBeenCalledWith('pointsEarned');
    expect(screen.getByText(`+${COMMENT_POINTS}`, hidden)).toBeTruthy();
    expect(fixtureWallet.get().balance).toBe(12_480 + COMMENT_POINTS);
  });

  it('comentário recusado sai: a contagem volta e o texto volta ao campo', async () => {
    mockApi();
    const reply = deferred<never>();
    post.mockReturnValue(reply.promise);
    await renderPost();

    sendComment('Clipe lindo!');
    expect(await screen.findByLabelText(pendingLabel('Clipe lindo!'))).toBeTruthy();
    expect(await screen.findByRole('header', { name: COMMENTS_TITLE('328') })).toBeTruthy();

    await act(async () => reply.reject(new ApiError('validation', 'recusado', 422)));

    await waitFor(() => expect(screen.queryByLabelText(pendingLabel('Clipe lindo!'))).toBeNull());
    expect(screen.queryByLabelText(failedLabel('Clipe lindo!'))).toBeNull();
    expect(screen.getByRole('header', { name: COMMENTS_TITLE('327') })).toBeTruthy();
    expect(input().props.value).toBe('Clipe lindo!');
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(announcements()).toContain(t('post.composer.error'));
  });

  it.each([
    ['de rede, tenta com a mesma chave', new ApiError('network', 'sem rede'), true],
    ['de recusa, tenta com chave nova', new ApiError('validation', 'recusado', 422), false],
  ])(
    'com outro texto no campo, o que falhou fica "Não enviado"; no erro %s',
    async (_case, error, sameKey) => {
      mockApi();
      const first = deferred<never>();
      post.mockReturnValueOnce(first.promise);
      await renderPost();

      sendComment('Primeiro');
      const pending = await screen.findByLabelText(pendingLabel('Primeiro'));
      type('Segundo, ainda escrevendo');
      await act(async () => first.reject(error));

      const row = await screen.findByRole('button', { name: failedLabel('Primeiro') });
      // A mesma view nativa: o foco do leitor de tela não se perde na troca.
      expect(row).toBe(pending);
      expect(input().props.value).toBe('Segundo, ainda escrevendo');
      expect(screen.getByRole('header', { name: COMMENTS_TITLE('327') })).toBeTruthy();
      expect(announcements()).toContain(t('post.comments.failedAnnouncement'));

      post.mockResolvedValueOnce({ data: savedComment('Primeiro') } as never);
      fireEvent.press(row);

      expect(await screen.findByLabelText(sentLabel('Primeiro'))).toBe(row);
      const keys = idempotencyKeys();
      expect(keys).toHaveLength(2);
      expect(keys[0] === keys[1]).toBe(sameKey);
      expect(post).toHaveBeenLastCalledWith(
        '/posts/p-clipe/comments',
        { text: 'Primeiro' },
        expect.anything(),
      );
      expect(screen.queryByRole('button', { name: failedLabel('Primeiro') })).toBeNull();
    },
  );

  it('falha incerta com o campo vazio fica "Não enviado" e tenta de novo com a mesma chave', async () => {
    mockApi();
    const first = deferred<never>();
    post.mockReturnValueOnce(first.promise);
    await renderPost();

    sendComment('Primeiro');
    const pending = await screen.findByLabelText(pendingLabel('Primeiro'));
    await act(async () => first.reject(new ApiError('network', 'sem rede')));

    // O servidor pode ter gravado: o texto não volta para um envio com chave nova.
    const row = await screen.findByRole('button', { name: failedLabel('Primeiro') });
    expect(row).toBe(pending);
    expect(input().props.value).toBe('');
    expect(screen.getByRole('header', { name: COMMENTS_TITLE('327') })).toBeTruthy();
    expect(announcements()).toContain(t('post.comments.failedAnnouncement'));
    expect(announcements()).not.toContain(t('post.composer.error'));

    post.mockResolvedValueOnce({ data: savedComment('Primeiro') } as never);
    fireEvent.press(row);

    expect(await screen.findByLabelText(sentLabel('Primeiro'))).toBe(row);
    const keys = idempotencyKeys();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('o "Não enviado" continua na tela depois de o fã mandar outro comentário', async () => {
    mockApi();
    // O tempo padrão do TanStack: a mutação sem observador sairia do cache em 5 min.
    client.setDefaultOptions({
      ...client.getDefaultOptions(),
      mutations: { retry: false },
    });
    const first = deferred<never>();
    post.mockReturnValueOnce(first.promise);
    await renderPost();

    sendComment('Primeiro');
    await screen.findByLabelText(pendingLabel('Primeiro'));
    type('Segundo');
    await act(async () => first.reject(new ApiError('network', 'sem rede')));
    await screen.findByRole('button', { name: failedLabel('Primeiro') });

    post.mockResolvedValueOnce({ data: savedComment('Segundo', 'c-segundo') } as never);
    fireEvent.press(sendButton());
    expect(await screen.findByLabelText(sentLabel('Segundo'))).toBeTruthy();

    // A que falhou fica sem observador, mas não sai do cache; a que deu certo saiu.
    const [failed, ...others] = commentMutations();
    expect(others).toHaveLength(0);
    expect(failed?.state.status).toBe('error');
    expect(failed?.options.gcTime).toBe(Infinity);
    expect(screen.getByRole('button', { name: failedLabel('Primeiro') })).toBeTruthy();
  });

  it('o comentário gravado enquanto a lista ainda vinha continua nela', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    const stale = deferred<unknown>();
    let listCalls = 0;
    get.mockImplementation(async (url, config) => {
      const cursor = (config?.params as { cursor?: string | null } | undefined)?.cursor ?? null;
      if (url === '/posts/p-clipe/comments' && cursor === null) {
        listCalls += 1;
        // A primeira busca saiu antes da gravação e volta sem o comentário.
        if (listCalls === 1) return stale.promise as never;
        const page = buildCommentsPageFixture(new Date(), 'p-clipe', null);
        const { pointsAwarded: _points, ...saved } = savedComment('Primeiro');
        return { data: { ...page, items: [saved, ...page.items] } } as never;
      }
      return answer?.(url, config) as never;
    });
    post.mockResolvedValueOnce({ data: savedComment('Primeiro') } as never);
    render(<PostDetailsScreen />, { wrapper });
    await screen.findByText(CLIP_TEXT);

    sendComment('Primeiro');

    expect(await screen.findByLabelText(sentLabel('Primeiro'))).toBeTruthy();
    await act(async () =>
      stale.resolve({ data: buildCommentsPageFixture(new Date(), 'p-clipe', null) }),
    );
    expect(screen.getByLabelText(sentLabel('Primeiro'))).toBeTruthy();
    expect(listCalls).toBe(2);
    await settle();
  });

  it('sem internet, o comentário espera na fila com "enviando…" e chega quando a rede volta', async () => {
    registerPostMutationDefaults(client);
    await renderPost();

    act(() => onlineManager.setOnline(false));
    sendComment('Offline mesmo');

    expect(await screen.findByLabelText(pendingLabel('Offline mesmo'))).toBeTruthy();
    // O campo limpou e a linha está longe do foco: o leitor ouve que ele vai depois.
    expect(announcements()).toContain(t('post.composer.queued'));
    const [paused] = client.getMutationCache().findAll({ mutationKey: postMutationKeys.comment });
    expect(paused?.state.isPaused).toBe(true);
    expect(paused?.options.scope).toEqual({ id: 'posts-comment-p-clipe' });
    // Esperando a rede, a seta fica (não o carregando).
    expect(sendButton().props.accessibilityState).toMatchObject({ busy: false });

    act(() => onlineManager.setOnline(true));
    expect(await screen.findByLabelText(sentLabel('Offline mesmo'))).toBeTruthy();
    expect(screen.getByRole('header', { name: COMMENTS_TITLE('328') })).toBeTruthy();
  });

  it('o fim da lista pede a página seguinte uma vez só, e os comentários dela aparecem', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    const next = deferred<unknown>();
    get.mockImplementation(async (url, config) => {
      const cursor = (config?.params as { cursor?: string | null } | undefined)?.cursor ?? null;
      if (url === '/posts/p-clipe/comments' && cursor === '10') return next.promise as never;
      return answer?.(url, config) as never;
    });
    render(<PostDetailsScreen />, { wrapper });
    await screen.findByText('Thalita sempre na frente 🔥', hidden);
    const pageCalls = () =>
      get.mock.calls.filter(
        ([url, config]) =>
          url === '/posts/p-clipe/comments' &&
          (config?.params as { cursor?: string | null }).cursor === '10',
      );

    // O fim da lista chega mais de uma vez (a lista curta também o dispara sozinha).
    const list = screen.UNSAFE_getByType(FlashList);
    act(() => list.props.onEndReached());
    act(() => list.props.onEndReached());
    await waitFor(() => expect(pageCalls()).toHaveLength(1));
    act(() => list.props.onEndReached());
    expect(pageCalls()).toHaveLength(1);

    const nextPage = buildCommentsPageFixture(new Date(), 'p-clipe', '10');
    await act(async () => next.resolve({ data: nextPage }));
    // A página nova desenha mais dez linhas: com a suíte inteira rodando, passa de 1 s.
    expect(
      await screen.findByTestId(`comment-${nextPage.items[0]?.id ?? ''}`, {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(pageCalls()).toHaveLength(1);
    await settle();
  });

  it('a página seguinte que falhou mostra "Tentar de novo", e o fim da lista não pede de novo sozinho', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    let failures = 0;
    get.mockImplementation(async (url, config) => {
      const cursor = (config?.params as { cursor?: string | null } | undefined)?.cursor ?? null;
      if (url === '/posts/p-clipe/comments' && cursor === '10' && failures === 0) {
        failures += 1;
        throw new ApiError('server', 'fora do ar', 500);
      }
      return answer?.(url, config) as never;
    });
    await renderPost();
    const pageCalls = () =>
      get.mock.calls.filter(
        ([url, config]) =>
          url === '/posts/p-clipe/comments' &&
          (config?.params as { cursor?: string | null }).cursor === '10',
      ).length;

    const list = screen.UNSAFE_getByType(FlashList);
    act(() => list.props.onEndReached());
    expect(await screen.findByLabelText(t('post.comments.moreError'))).toBeTruthy();
    await waitFor(() => expect(announcements()).toContain(t('post.comments.moreError')));

    act(() => list.props.onEndReached());
    expect(pageCalls()).toBe(1);

    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    // A página nova desenha mais dez linhas: com a suíte inteira rodando, passa de 1 s.
    const eleventh = buildCommentsPageFixture(new Date(), 'p-clipe', '10').items[0];
    expect(
      await screen.findByTestId(`comment-${eleventh?.id ?? ''}`, {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.queryByLabelText(t('post.comments.moreError'))).toBeNull();
    expect(pageCalls()).toBe(2);
    await settle();
  });

  it('post que não existe mostra o aviso, sem campo de comentário; o voltar é o do título', async () => {
    mockPostId = 'nao-existe';
    render(<PostDetailsScreen />, { wrapper });
    expect(await screen.findByLabelText(t('post.details.notFound'))).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: t('common.back') })).toBeTruthy();
    await waitFor(() => expect(announcements()).toEqual([t('post.details.notFound')]));
    expect(screen.queryByLabelText(t('post.commentPlaceholder'))).toBeNull();
  });

  it('post que não carregou mostra "Tentar de novo", anuncia uma vez e busca de novo', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    let failures = 0;
    get.mockImplementation(async (url, config) => {
      if (url === '/posts/p-clipe' && failures === 0) {
        failures += 1;
        throw new ApiError('network', 'sem rede');
      }
      return answer?.(url, config) as never;
    });
    render(<PostDetailsScreen />, { wrapper });

    expect(await screen.findByLabelText(t('post.details.loadError'))).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText(CLIP_TEXT)).toBeTruthy();
    expect(announcements().filter((text) => text === t('post.details.loadError'))).toHaveLength(1);
    await settle();
  });

  it('comentários que não carregaram mostram "Tentar de novo" e anunciam', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    let failures = 0;
    get.mockImplementation(async (url, config) => {
      if (url === '/posts/p-clipe/comments' && failures === 0) {
        failures += 1;
        throw new ApiError('server', 'fora do ar', 500);
      }
      return answer?.(url, config) as never;
    });
    render(<PostDetailsScreen />, { wrapper });

    expect(await screen.findByLabelText(t('post.comments.loadError'))).toBeTruthy();
    await waitFor(() => expect(announcements()).toContain(t('post.comments.loadError')));
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByText('Thalita sempre na frente 🔥', hidden)).toBeTruthy();
    await settle();
  });
});

describe('lista de comentários', () => {
  const comment = (id: string, extra: Partial<PostComment> = {}): PostComment => ({
    id,
    postId: 'p-clipe',
    authorId: 'fa',
    authorName: 'Fã',
    authorAvatarUrl: null,
    authorIsArtist: false,
    text: id,
    createdAt: new Date().toISOString(),
    ...extra,
  });

  it('os do fã que ainda vão ficam em cima, e o que o servidor gravou não aparece duas vezes', () => {
    const pending = comment('local-2', { status: 'pending' });
    const failed = comment('local-1', { status: 'failed' });
    // O servidor já devolveu o local-2, mas a linha dele ainda está indo.
    const saved = comment('c-9', { localId: 'local-2' });
    expect(
      mergeComments([pending, failed], [saved, comment('c-1'), comment('c-2')]).map(
        (item) => item.id,
      ),
    ).toEqual(['local-2', 'local-1', 'c-1', 'c-2']);
  });

  it('a contagem soma os do fã que ainda vão e que a lista do servidor não tem', () => {
    const pending = comment('local-2', { status: 'pending' });
    const failed = comment('local-1', { status: 'failed' });
    const going = comment('local-3', { status: 'pending' });
    // O servidor já devolveu o local-2: ele está na contagem do post.
    const saved = comment('c-9', { localId: 'local-2' });
    expect(unsentCount([going, pending, failed], [saved, comment('c-1')])).toBe(1);
    expect(unsentCount([failed], [])).toBe(0);
  });

  it('o comentário que a página seguinte traz de novo (a lista andou uma casa) aparece uma vez', () => {
    expect(
      mergeComments([], [comment('c-1'), comment('c-2'), comment('c-2'), comment('c-3')]).map(
        (item) => item.id,
      ),
    ).toEqual(['c-1', 'c-2', 'c-3']);
  });
});

describe('curtir no post', () => {
  const feedPost = (): Post | undefined =>
    client
      .getQueryData<InfiniteData<Page<Post>>>(postKeys.feed())
      ?.pages[0]?.items.find((item) => item.id === 'p-clipe');

  function seedFeed(): void {
    client.setQueryData<InfiniteData<Page<Post>>>(postKeys.feed(), {
      pages: [buildFeedPageFixture(new Date(), null)],
      pageParams: [null],
    });
  }

  it('curtir atualiza o detalhe e o mural da home, e dá o toque de curtida', async () => {
    seedFeed();
    await renderPost();

    fireEvent.press(screen.getByRole('button', { name: 'Curtir, 4.812 curtidas' }));

    const liked = await screen.findByRole('button', { name: 'Curtir, 4.813 curtidas' });
    expect(liked.props.accessibilityState).toMatchObject({ selected: true });
    expect(feedPost()).toMatchObject({ likedByMe: true, likeCount: 4_813 });
    expect(haptics.trigger).toHaveBeenCalledWith('like');
    // O servidor confirma e o detalhe busca de novo sem perder a curtida.
    await waitFor(() => expect(client.isMutating()).toBe(0));
    await waitFor(() =>
      expect(client.getQueryData(postKeys.detail('p-clipe'))).toMatchObject({ likeCount: 4_813 }),
    );
  });

  it('a curtida recusada volta no detalhe e no mural, com toque de erro e anúncio', async () => {
    mockApi();
    seedFeed();
    const reply = deferred<never>();
    request.mockReturnValue(reply.promise);
    await renderPost();

    fireEvent.press(screen.getByRole('button', { name: 'Curtir, 4.812 curtidas' }));
    await screen.findByRole('button', { name: 'Curtir, 4.813 curtidas' });
    expect(feedPost()).toMatchObject({ likedByMe: true, likeCount: 4_813 });

    await act(async () => reply.reject(new ApiError('server', 'fora do ar', 500)));

    expect(await screen.findByRole('button', { name: 'Curtir, 4.812 curtidas' })).toBeTruthy();
    expect(feedPost()).toMatchObject({ likedByMe: false, likeCount: 4_812 });
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(announcements()).toContain(t('post.likeError'));
  });

  describe('missão de curtida', () => {
    const NENHO_TEXT = 'Um pedaço do ensaio de ontem. Qual música vocês querem no show?';
    const invalidated = (spy: jest.SpyInstance) =>
      spy.mock.calls.map(([filters]) => (filters as { queryKey: readonly unknown[] }).queryKey);

    async function renderNenhoPost() {
      mockPostId = 'p-nenho-2';
      render(<PostDetailsScreen />, { wrapper });
      await screen.findByText(NENHO_TEXT);
      await settle();
    }

    it('a curtida que conclui "Curta 5 posts do Nenho" sobe "+10" e atualiza missões, saldo, ranking e centrais', async () => {
      // A missão já em 4 de 5: falta uma curtida num post do Nenho.
      missionsFixture.record('like', new Date(), { artistId: 'nenho' });
      missionsFixture.record('like', new Date(), { artistId: 'nenho' });
      await renderNenhoPost();
      const invalidate = jest.spyOn(client, 'invalidateQueries');

      fireEvent.press(screen.getByRole('button', { name: 'Curtir, 2.310 curtidas' }));

      expect(await screen.findByText('+10', hidden)).toBeTruthy();
      expect(haptics.trigger).toHaveBeenCalledWith('pointsEarned');
      expect(invalidated(invalidate)).toEqual(
        expect.arrayContaining([
          missionKeys.all,
          profileKeys.wallet(),
          rankingKeys.all,
          artistKeys.centrals(),
        ]),
      );
      await settle();
    });

    it('a curtida que só anda a missão faz as missões buscarem de novo, sem "+N" nem saldo', async () => {
      await renderNenhoPost();
      const invalidate = jest.spyOn(client, 'invalidateQueries');

      fireEvent.press(screen.getByRole('button', { name: 'Curtir, 2.310 curtidas' }));

      await waitFor(() => expect(invalidated(invalidate)).toContainEqual(missionKeys.all));
      expect(invalidated(invalidate)).not.toContainEqual(profileKeys.wallet());
      expect(screen.queryByTestId('post-like-points', hidden)).toBeNull();
      await settle();
    });

    it('a curtida que volta da fila com o app reaberto também atualiza o saldo e as centrais', async () => {
      registerPostMutationDefaults(client);
      missionsFixture.record('like', new Date(), { artistId: 'nenho' });
      missionsFixture.record('like', new Date(), { artistId: 'nenho' });
      client.setQueryData(profileKeys.wallet(), { balance: 1, xp: 1, seasonPoints: 1 });
      client.setQueryData(artistKeys.centrals(), []);

      // Sem a tela montada: só as opções registradas no AppProviders.
      await client
        .getMutationCache()
        .build(client, { mutationKey: postMutationKeys.like })
        .execute({ postId: 'p-nenho-2', liked: true, idempotencyKey: 'da-fila' });

      expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(true);
      expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(true);
    });
  });
});
