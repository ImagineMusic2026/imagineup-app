import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDoc } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert, Text, View } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import PageRoute from '@/app/fa-clube/[clubeId]';
import PostRoute from '@/app/fa-clube/publicacao/[publicacaoId]';
import {
  FanClubFeedSection,
  type AddFanClubCommentResult,
  type FanClubComment,
  type FanClubCommentPage,
  type FanClubPage,
  type FanClubPost,
  type FanClubPostDetails,
  type MentionSuggestion,
  type MyFanClub,
} from '@/domains/fan-club';
import * as fanClubApi from '@/domains/fan-club/api';
import { MENTION_SEARCH_DEBOUNCE_MS } from '@/domains/fan-club/mentions';
import { useSessionGate } from '@/hooks/use-session-gate';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { queryClient } from '@/services/query';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// A tela da publicação do fã-clube (seção 37, 37.9, itens 1 a 7; a etapa 6 de
// 37.13): o botão dos comentários do card que a abre, por cima da página e da
// Início; o botão do cabeçalho que leva o foco ao campo; os comentários com as
// respostas de um nível e o "Ver N respostas"; a linha nova, sem pressável
// dentro de pressável; o campo com o modo resposta; o "Seguir o fã-clube" de
// quem não segue; a sugestão do @; os links do texto; o 404; e a página vazia
// que pede a seguinte.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn(), signOut: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({ authStateReady: () => Promise.resolve(), currentUser: null }),
  getDb: () => ({}),
  isFirebaseConfigured: true,
  uploadLocalFile: jest.fn(),
  storageFileExists: jest.fn(),
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), put: jest.fn(), post: jest.fn(), request: jest.fn() },
  ApiError: jest.requireActual('@/services/api/errors').ApiError,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({ sourceOf: () => 'api', usesFixtures: () => false }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('@/domains/fan-club/api', () => ({
  fetchMyFanClub: jest.fn(),
  fetchMyFanClubNumbers: jest.fn(),
  fetchFanClubArtists: jest.fn(),
  applyForFanClub: jest.fn(),
  withdrawApplication: jest.fn(),
  acceptFanClubRules: jest.fn(),
  fetchMyFanClubPosts: jest.fn(),
  openFanClubUpload: jest.fn(),
  uploadFanClubFile: jest.fn(),
  fanClubFileUploaded: jest.fn(),
  createFanClubPost: jest.fn(),
  removeFanClubPost: jest.fn(),
  fetchArtistFanClubs: jest.fn(),
  fetchFanClub: jest.fn(),
  fetchFanClubPosts: jest.fn(),
  reportFanClubPost: jest.fn(),
  followFanClub: jest.fn(),
  unfollowFanClub: jest.fn(),
  fetchFollowedFanClubs: jest.fn(),
  fetchFanClubFeed: jest.fn(),
  // A Fase 2 (seção 37, 37.3).
  fetchFanClubPost: jest.fn(),
  fetchFanClubComments: jest.fn(),
  addFanClubComment: jest.fn(),
  setFanClubReaction: jest.fn(),
  clearFanClubReaction: jest.fn(),
  reportFanClubComment: jest.fn(),
  requestFanClubCommentReview: jest.fn(),
  hideFanClubComment: jest.fn(),
  unhideFanClubComment: jest.fn(),
  fetchFanClubMentions: jest.fn(),
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 874 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 120 })),
  };
});

const mocked = jest.mocked(fanClubApi);

/** Os guards do app, com as rotas que a tela toca, e o cache do app. */
function RootLayout() {
  const { signedIn, onboarded } = useSessionGate();
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="fa/[fanId]" />
          <Stack.Screen name="fa-clube/[clubeId]" />
          <Stack.Screen name="fa-clube/publicacao/[publicacaoId]" />
          <Stack.Screen name="denunciar-publicacao/[publicacaoId]" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}

const label = (text: string) =>
  function Label(): ReactNode {
    return <Text>{text}</Text>;
  };

/** A Início de teste: só "Dos seus fã-clubes". */
function HomeProbe() {
  return (
    <View>
      <Text>home</Text>
      <FanClubFeedSection />
    </View>
  );
}

const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/entrar': label('entrada'),
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
  '(tabs)/(inicio)/index': HomeProbe,
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  'fa/[fanId]': label('fan'),
  'fa-clube/[clubeId]': PageRoute,
  'fa-clube/publicacao/[publicacaoId]': PostRoute,
  'denunciar-publicacao/[publicacaoId]': label('report'),
};

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

// --- Os dados -------------------------------------------------------------------------

const MINE: MyFanClub = {
  open: true,
  rulesUrl: null,
  rulesVersion: 'termos-2026-10',
  notice: null,
  application: null,
  club: null,
};

const OWNER = { uid: 'fa-thalita', name: 'Thalita Santos', username: 'thalitasan', photoURL: null };
const DAVI = { uid: 'fa-davi', name: 'Davi Lima', username: 'davilim', photoURL: null };
const CAMILA = { uid: 'uid-camila', name: 'Camila Ribeiro', username: 'camilarib', photoURL: null };

const page = (patch: Partial<FanClubPage> = {}): FanClubPage => ({
  id: 'fc-1',
  name: 'Nenho Sempre',
  artist: { id: 'nenho', name: 'Nenho', shortName: null, thumbUrl: null },
  owner: OWNER,
  followerCount: 41,
  postCount: 1,
  featured: false,
  official: false,
  isFollowing: true,
  isOwner: false,
  isMember: true,
  ...patch,
});

const counts = { heart: 3, fire: 0, laugh: 0, wow: 0, clap: 0 };

/** A publicação do Nenho, com o @ da central no texto (as posições em UTF-16). */
const post = (id: string, patch: Partial<FanClubPost> = {}): FanClubPost => ({
  id,
  clubId: 'fc-1',
  clubName: 'Nenho Sempre',
  clubOfficial: false,
  artistId: 'nenho',
  author: OWNER,
  kind: 'text',
  text: 'Quem vai no show do @nenho?',
  photo: null,
  thumb: null,
  publishedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 3,
  reactionCounts: counts,
  commentCount: 4,
  myReaction: null,
  mentions: [{ handle: 'nenho', kind: 'artist', id: 'nenho', start: 20, end: 26 }],
  ...patch,
});

const details = (patch: Partial<FanClubPostDetails> = {}): FanClubPostDetails => ({
  ...post('p1'),
  isOwner: false,
  isFollowing: true,
  isMember: true,
  artistName: 'Nenho',
  ...patch,
});

const comment = (id: string, patch: Partial<FanClubComment> = {}): FanClubComment => ({
  id,
  postId: 'p1',
  clubId: 'fc-1',
  author: DAVI,
  isManager: false,
  text: `Comentário ${id}`,
  mentions: [],
  replyToId: null,
  replyCount: 0,
  createdAt: '2026-10-19T16:00:00.000Z',
  hidden: null,
  review: null,
  ...patch,
});

/** Os de cima: o da gestora com 2 respostas e o do Davi, que marca a gestora. */
const TOP: FanClubComment[] = [
  comment('c2', {
    text: '@thalitasan bora!',
    mentions: [{ handle: 'thalitasan', kind: 'fan', id: 'fa-thalita', start: 0, end: 11 }],
  }),
  comment('c1', { author: OWNER, isManager: true, text: 'Encontro às 19h', replyCount: 2 }),
];

const REPLIES: FanClubComment[] = [
  comment('r1', { replyToId: 'c1', text: '@thalitasan combinado' }),
  comment('r2', { replyToId: 'c1', author: CAMILA, text: 'Eu também vou' }),
];

const pageOf = (items: FanClubComment[], nextCursor: string | null = null): FanClubCommentPage => ({
  items,
  nextCursor,
});

const added = (id: string, patch: Partial<FanClubComment> = {}): AddFanClubCommentResult => ({
  ...comment(id, { author: CAMILA, ...patch }),
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
});

const suggestion = (
  username: string,
  patch: Partial<MentionSuggestion> = {},
): MentionSuggestion => ({
  kind: 'fan',
  id: `fa-${username}`,
  username,
  name: null,
  photoURL: null,
  role: null,
  inConversation: true,
  ...patch,
});

/** O que o leitor ouviu, na hora ou na fila. */
const announced = () => [
  ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text),
  ...jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text),
];

/** O elemento que recebeu o foco do leitor de tela, pelo `testID`. */
const focusedTestIds = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.map(([node]) => (node as unknown as ReactTestInstance)?.props?.testID as string);

/** Abre a tela da publicação a frio e espera os comentários de cima chegarem. */
async function openPost(url = '/fa-clube/publicacao/p1') {
  const view = renderRouter(appTree, { initialUrl: url });
  await screen.findByTestId('fan-club-comments-list');
  await waitFor(() =>
    expect(screen.queryByLabelText('Carregando os comentários')).not.toBeOnTheScreen(),
  );
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of Object.values(mocked)) if (typeof fn === 'function') jest.mocked(fn).mockReset();
  for (const fn of Object.values(api)) jest.mocked(fn).mockReset();
  resetRefusalAlerts();
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'uid-camila', email: 'camila@teste.imagineup', displayName: null, photoURL: null },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: 'uid-camila',
  });
  useFanClubPrizeStore.setState({ seen: {}, hydrated: true });
  jest.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib' }),
    metadata: { fromCache: false },
  } as never);
  jest
    .mocked(api.get)
    .mockImplementation((url: string) =>
      url === '/me/invite'
        ? Promise.resolve({ data: { code: 'CAMILA12', linkBase: 'https://imagineup.app' } })
        : Promise.reject(new Error(`rota inesperada: ${url}`)),
    );
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mocked.fetchMyFanClub.mockResolvedValue(MINE);
  mocked.fetchFanClub.mockResolvedValue(page());
  mocked.fetchFanClubPosts.mockResolvedValue({ items: [post('p1')], nextCursor: null });
  mocked.fetchFanClubFeed.mockResolvedValue({ items: [], nextCursor: null });
  mocked.fetchFanClubPost.mockResolvedValue(details());
  mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
    Promise.resolve(replyTo === null ? pageOf(TOP) : pageOf(REPLIES)),
  );
  mocked.fetchFanClubMentions.mockResolvedValue({ items: [] });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

// --- Como a tela abre ---------------------------------------------------------------------

describe('o botão dos comentários do card (37.9, itens 1 e 3)', () => {
  it('na página, abre a tela da publicação por cima dela, com o card no cabeçalho e os comentários', async () => {
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const button = await screen.findByRole('button', { name: '4 comentários' });
    expect(button).toHaveProp('accessibilityHint', 'Abre a publicação com os comentários');
    fireEvent.press(button);

    expect(await screen.findByRole('header', { name: 'Publicação' })).toBeTruthy();
    expect(await screen.findByText('Encontro às 19h')).toBeTruthy();
    expect(view.getPathname()).toBe('/fa-clube/publicacao/p1');
    expect(rootRoutes(view)).toEqual(['fa-clube/[clubeId]', 'fa-clube/publicacao/[publicacaoId]']);
    expect(mocked.fetchFanClubPost).toHaveBeenCalledWith('p1');
    expect(mocked.fetchFanClubComments).toHaveBeenCalledWith({
      postId: 'p1',
      replyTo: null,
      cursor: null,
    });
    // O card da publicação no cabeçalho, com o total da seção.
    expect(screen.getByTestId('fan-club-post-card')).toBeTruthy();
    expect(screen.getByLabelText('Comentários, 4')).toBeTruthy();
  });

  it('na Início, abre por cima das abas', async () => {
    mocked.fetchFanClubFeed.mockResolvedValue({ items: [post('p1')], nextCursor: null });
    const view = renderRouter(appTree, { initialUrl: '/' });

    const card = await screen.findByTestId('home-fan-club-post-p1');
    fireEvent.press(within(card).getByRole('button', { name: '4 comentários' }));
    expect(await screen.findByRole('header', { name: 'Publicação' })).toBeTruthy();
    expect(rootRoutes(view)).toEqual(['(tabs)', 'fa-clube/publicacao/[publicacaoId]']);
  });

  it('no cabeçalho da tela, o botão dos comentários leva o foco ao campo, e não abre a tela de novo', async () => {
    const view = await openPost();

    const button = within(screen.getByTestId('fan-club-post-card')).getByRole('button', {
      name: '4 comentários',
    });
    expect(button).toHaveProp('accessibilityHint', 'Vai para o campo de comentário');
    fireEvent.press(button);
    await waitFor(() => expect(focusedTestIds()).toContain('comment-input'));
    expect(rootRoutes(view)).toEqual(['fa-clube/publicacao/[publicacaoId]']);
  });
});

// --- A lista -----------------------------------------------------------------------------

describe('os comentários e as respostas (37.9, itens 3 e 4)', () => {
  it('os de cima, do mais novo; "Ver 2 respostas" carrega as respostas recuadas, com o foco na primeira', async () => {
    await openPost();

    const order = screen
      .getAllByTestId(/^club-comment-c\d-text$/u)
      .map((node) => node.props.testID as string);
    expect(order).toEqual(['club-comment-c2-text', 'club-comment-c1-text']);
    // A marca do gestor no autor, também para o leitor.
    expect(
      screen.getByLabelText(/^Thalita Santos, @thalitasan, gestor do fã-clube, \S/u),
    ).toBeTruthy();
    expect(screen.queryByText('Eu também vou')).toBeNull();

    const more = screen.getByRole('button', {
      name: 'Ver 2 respostas ao comentário de Thalita Santos',
    });
    fireEvent.press(more);
    expect(await screen.findByText('Eu também vou')).toBeTruthy();
    expect(mocked.fetchFanClubComments).toHaveBeenCalledWith({
      postId: 'p1',
      replyTo: 'c1',
      cursor: null,
    });
    expect(screen.queryByTestId('club-thread-c1-replies')).toBeNull();
    await waitFor(() => expect(focusedTestIds()).toContain('club-comment-r1-author'));
    // A resposta do próprio fã: "Você", sem abrir o perfil.
    const mine = screen.getByTestId('club-comment-r2-author');
    expect(mine.props.accessibilityLabel).toMatch(/^Você, \S/u);
    expect(mine).not.toHaveProp('accessibilityRole', 'link');
  });

  it('"Ver mais respostas" pede a página seguinte da conversa', async () => {
    mocked.fetchFanClubComments.mockImplementation(({ replyTo, cursor }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf(TOP)
          : cursor === null
            ? pageOf([REPLIES[0]!], 'r-2')
            : pageOf([REPLIES[1]!]),
      ),
    );
    await openPost();

    fireEvent.press(screen.getByTestId('club-thread-c1-replies'));
    const more = await screen.findByRole('button', {
      name: 'Ver mais respostas ao comentário de Thalita Santos',
    });
    fireEvent.press(more);
    expect(await screen.findByText('Eu também vou')).toBeTruthy();
    expect(mocked.fetchFanClubComments).toHaveBeenLastCalledWith({
      postId: 'p1',
      replyTo: 'c1',
      cursor: 'r-2',
    });
    await waitFor(() => expect(screen.queryByTestId('club-thread-c1-more')).toBeNull());
  });

  it('o gestor: "Ver N respostas" soma as que ele ocultou, e a oculta diz "Oculto por você", sem "Responder"', async () => {
    mocked.fetchFanClubPost.mockResolvedValue(
      details({ isOwner: true, isFollowing: false, author: CAMILA }),
    );
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf([comment('c1', { replyCount: 1, hiddenReplyCount: 1 })])
          : pageOf([
              comment('r1', { replyToId: 'c1' }),
              comment('r9', { replyToId: 'c1', hidden: 'manager', text: 'Oculta' }),
            ]),
      ),
    );
    await openPost();

    fireEvent.press(await screen.findByRole('button', { name: /^Ver 2 respostas/u }));
    expect(await screen.findByText('Oculto por você')).toBeTruthy();
    expect(screen.queryByTestId('club-comment-r9-reply')).toBeNull();
    expect(screen.getByTestId('club-comment-r1-reply')).toBeTruthy();
    // O gestor comenta sem seguir o próprio fã-clube.
    expect(screen.getByTestId('comment-input')).toBeTruthy();
  });

  it('o gestor: embaixo do comentário de cima que ele ocultou, as respostas ficam sem "Responder" (37.6)', async () => {
    mocked.fetchFanClubPost.mockResolvedValue(
      details({ isOwner: true, isFollowing: false, author: CAMILA }),
    );
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf([comment('c1', { replyCount: 1, hidden: 'manager' })])
          : pageOf([comment('r1', { replyToId: 'c1' })]),
      ),
    );
    await openPost();

    fireEvent.press(await screen.findByRole('button', { name: /^Ver 1 resposta/u }));
    expect(await screen.findByTestId('club-comment-r1-text')).toBeTruthy();
    expect(screen.queryByTestId('club-comment-r1-reply')).toBeNull();
    expect(screen.queryByTestId('club-comment-c1-reply')).toBeNull();
  });

  it('as respostas que não chegam (a página vazia, sem outra): a frase no lugar, com o foco nela', async () => {
    mocked.fetchFanClubComments.mockImplementation(({ replyTo, cursor }) =>
      Promise.resolve(
        replyTo === null ? pageOf(TOP) : cursor === null ? pageOf([], 'r-2') : pageOf([]),
      ),
    );
    await openPost();

    fireEvent.press(screen.getByTestId('club-thread-c1-replies'));
    expect(await screen.findByText('Nenhuma resposta para mostrar.')).toBeTruthy();
    // A primeira página veio vazia com mais adiante: a seguinte saiu sozinha, uma vez.
    expect(
      mocked.fetchFanClubComments.mock.calls.filter(([query]) => query.replyTo === 'c1'),
    ).toHaveLength(2);
    await waitFor(() => expect(focusedTestIds()).toContain('club-thread-c1-empty'));
  });

  it('nenhum pressável dentro de outro: o autor é o pressável, e o texto com os links e o "Responder" são irmãos dele', async () => {
    await openPost();

    const author = screen.getByTestId('club-comment-c2-author');
    expect(author).toHaveProp('accessibilityRole', 'link');
    expect(author).toHaveProp('accessibilityHint', 'Abre o perfil de Davi Lima');
    // Só o próprio autor é link: nada tocável dentro dele.
    expect(within(author).queryAllByRole('link')).toEqual([author]);
    expect(within(author).queryAllByRole('button')).toHaveLength(0);
    expect(within(author).queryByText('@thalitasan bora!')).toBeNull();
    const row = screen.getByTestId('club-comment-c2');
    expect(within(row).getByRole('button', { name: 'Responder a Davi Lima' })).toBeTruthy();
    // A linha, a conversa em volta e o corpo do texto não são pressáveis (37.9, item 4).
    const thread = screen.getByTestId('club-thread-c2');
    const text = screen.getByTestId('club-comment-c2-text');
    for (const [from, until] of [
      [row, thread.parent],
      [text, row],
    ] as const) {
      for (let node: ReactTestInstance | null = from; node && node !== until; node = node.parent) {
        expect(node.props.onPress).toBeUndefined();
        expect(node.props.onStartShouldSetResponder).toBeUndefined();
        expect(node.props.accessible).not.toBe(true);
      }
    }
  });

  it('a página vazia com mais adiante pede a seguinte sozinha, uma vez', async () => {
    mocked.fetchFanClubComments.mockImplementation(({ replyTo, cursor }) =>
      Promise.resolve(
        replyTo !== null
          ? pageOf([])
          : cursor === null
            ? pageOf([], 'c-2')
            : pageOf([comment('c9', { text: 'Depois dos bloqueados' })]),
      ),
    );
    await openPost();

    expect(await screen.findByText('Depois dos bloqueados')).toBeTruthy();
    expect(
      mocked.fetchFanClubComments.mock.calls.filter(([query]) => query.replyTo === null),
    ).toHaveLength(2);
  });
});

// --- Os links do texto ---------------------------------------------------------------------

describe('o @ como link (37.7 e 37.9, itens 2 e 7)', () => {
  it('na linha, o @ é um link em linha, fora de pressável, que abre o perfil do fã', async () => {
    const view = await openPost();

    const text = screen.getByTestId('club-comment-c2-text');
    const link = within(text).getByRole('link', { name: '@thalitasan' });
    fireEvent.press(link);
    expect(await screen.findByText('fan')).toBeTruthy();
    expect(view.getPathname()).toBe('/fa/fa-thalita');
  });

  it('no card, o corpo continua um foco só, e o leitor abre a central pela ação do corpo', async () => {
    const view = await openPost();

    const body = screen.getByTestId('fan-club-post-card-body');
    expect(body.props.accessibilityLabel).toMatch(/^Quem vai no show do @nenho\? Publicado /u);
    expect(within(body).queryAllByRole('button')).toHaveLength(0);
    expect(
      (body.props.accessibilityActions as { label: string }[]).map((action) => action.label),
    ).toEqual(['Abrir a central de @nenho']);
    fireEvent(body, 'accessibilityAction', { nativeEvent: { actionName: 'mention-0' } });
    // A tela fica por cima das abas: a central abre na aba, e a tela fecha.
    expect(await screen.findByText('artist')).toBeTruthy();
    expect(view.getPathname()).toBe('/artista/nenho');
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it('o trecho que não confere com o @ fica texto puro', async () => {
    mocked.fetchFanClubComments.mockResolvedValue(
      pageOf([
        comment('c1', {
          text: 'oi @thalitasan',
          mentions: [{ handle: 'thalitasan', kind: 'fan', id: 'fa-thalita', start: 0, end: 11 }],
        }),
      ]),
    );
    await openPost();

    const text = await screen.findByTestId('club-comment-c1-text');
    expect(within(text).queryAllByRole('link')).toHaveLength(0);
  });
});

// --- O campo -----------------------------------------------------------------------------

describe('o campo (37.9, item 5)', () => {
  it('comentar: a linha "enviando…" na hora e, gravado, o comentário no topo e o total novo', async () => {
    let resolve: (value: AddFanClubCommentResult) => void = () => undefined;
    mocked.addFanClubComment.mockImplementation(() => new Promise((done) => (resolve = done)));
    await openPost();

    fireEvent.changeText(screen.getByTestId('comment-input'), 'Que demais!');
    fireEvent.press(screen.getByTestId('comment-send'));
    expect(await screen.findByLabelText('Você, enviando: Que demais!')).toBeTruthy();
    expect(screen.getByLabelText('Comentários, 5')).toBeTruthy();
    expect(mocked.addFanClubComment).toHaveBeenCalledWith({
      postId: 'p1',
      text: 'Que demais!',
      replyToId: null,
      idempotencyKey: expect.stringMatching(/^club-comment-/),
    });

    // O servidor gravou: a publicação dele já conta o comentário.
    mocked.fetchFanClubPost.mockResolvedValue(details({ commentCount: 5 }));
    await act(async () => resolve(added('c9', { text: 'Que demais!' })));
    expect(await screen.findByTestId('club-comment-c9-text')).toBeTruthy();
    expect(screen.queryByLabelText('Você, enviando: Que demais!')).toBeNull();
    expect(screen.getByLabelText('Comentários, 5')).toBeTruthy();
    expect(announced()).toContain('Comentário enviado.');
    // O último a terminar busca a publicação de novo, e o total fica o do servidor.
    await waitFor(() => expect(mocked.fetchFanClubPost).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Comentários, 5')).toBeTruthy();
  });

  it('a falha incerta fica "Não enviado", e o toque manda de novo com a mesma chave', async () => {
    mocked.addFanClubComment
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', 0))
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', 0))
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', 0))
      .mockResolvedValueOnce(added('c9', { text: 'Oi!' }));
    await openPost();

    fireEvent.changeText(screen.getByTestId('comment-input'), 'Oi!');
    fireEvent.press(screen.getByTestId('comment-send'));
    const failed = await screen.findByRole(
      'button',
      { name: 'Você, não enviado: Oi!' },
      { timeout: 6000 },
    );
    const keys = mocked.addFanClubComment.mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
    fireEvent.press(failed);
    expect(await screen.findByTestId('club-comment-c9-text')).toBeTruthy();
    expect(mocked.addFanClubComment.mock.calls.at(-1)?.[0].idempotencyKey).toBe(keys[0]);
  }, 15_000);

  it('o texto barrado pelo filtro volta ao campo, com a frase e o link da equipe', async () => {
    mocked.addFanClubComment.mockRejectedValueOnce(
      new ApiError('validation', 'Recusado.', 400, 'comment_invalid', { reason: 'not_allowed' }),
    );
    await openPost();

    fireEvent.changeText(screen.getByTestId('comment-input'), 'Texto barrado');
    fireEvent.press(screen.getByTestId('comment-send'));
    expect(await screen.findByTestId('comment-refusal')).toHaveTextContent(
      'Conforme os Termos de uso do ImagineUP, este comentário não pode ser publicado. Revise o texto.',
    );
    expect(screen.getByTestId('comment-input')).toHaveProp('value', 'Texto barrado');
  });

  it('o teto do dia: a frase embaixo do campo, com o texto de volta', async () => {
    mocked.addFanClubComment.mockRejectedValueOnce(
      new ApiError('dailyLimit', 'Limite.', 429, 'too_many_requests', { action: 'club_comment' }),
    );
    await openPost();

    fireEvent.changeText(screen.getByTestId('comment-input'), 'Mais um');
    fireEvent.press(screen.getByTestId('comment-send'));
    expect(await screen.findByTestId('comment-refusal')).toHaveTextContent(
      'Você chegou ao limite de comentários de hoje no fã-clube. Tente amanhã.',
    );
    expect(screen.getByTestId('comment-input')).toHaveProp('value', 'Mais um');
  });

  it('"Responder": o modo resposta com o @ no começo; o "×" sai dele e tira o @', async () => {
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Responder a Thalita Santos' }));
    expect(await screen.findByText('Respondendo a @thalitasan')).toBeTruthy();
    expect(screen.getByTestId('comment-input')).toHaveProp('value', '@thalitasan ');
    // O leitor ouve o modo resposta na dica do campo, que recebe o foco.
    expect(screen.getByTestId('comment-input')).toHaveProp(
      'accessibilityHint',
      'Respondendo a @thalitasan',
    );
    await waitFor(() => expect(focusedTestIds()).toContain('comment-input'));

    // Responder a outro troca o @ do começo.
    fireEvent.press(screen.getByRole('button', { name: 'Responder a Davi Lima' }));
    expect(await screen.findByText('Respondendo a @davilim')).toBeTruthy();
    expect(screen.getByTestId('comment-input')).toHaveProp('value', '@davilim ');

    fireEvent.press(screen.getByRole('button', { name: 'Cancelar a resposta a @davilim' }));
    expect(screen.queryByTestId('comment-reply')).toBeNull();
    expect(screen.getByTestId('comment-input')).toHaveProp('value', '');
    expect(screen.getByTestId('comment-input').props.accessibilityHint).toBeUndefined();
    // Na fila, depois de o foco chegar ao campo.
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Resposta cancelada.',
        { queue: true },
      ),
    );
  });

  it('responder de novo a quem o texto já marca no começo só leva o foco ao campo, sem mexer no texto', async () => {
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Responder a Thalita Santos' }));
    fireEvent.changeText(screen.getByTestId('comment-input'), '@thalitasan chego cedo');
    fireEvent.press(screen.getByRole('button', { name: 'Responder a Thalita Santos' }));
    expect(screen.getByTestId('comment-input')).toHaveProp('value', '@thalitasan chego cedo');
    expect(await screen.findByText('Respondendo a @thalitasan')).toBeTruthy();
  });

  it('a resposta recusada volta ao campo no modo resposta dela, e o reenvio vai com o respondido', async () => {
    mocked.addFanClubComment
      .mockRejectedValueOnce(
        new ApiError('validation', 'Recusado.', 400, 'comment_invalid', { reason: 'not_allowed' }),
      )
      .mockResolvedValueOnce(added('r3', { replyToId: 'c1', text: '@thalitasan chego cedo' }));
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Responder a Thalita Santos' }));
    fireEvent.changeText(screen.getByTestId('comment-input'), '@thalitasan chego cedo');
    fireEvent.press(screen.getByTestId('comment-send'));
    expect(await screen.findByTestId('comment-refusal')).toBeTruthy();
    expect(screen.getByText('Respondendo a @thalitasan')).toBeTruthy();
    expect(screen.getByTestId('comment-input')).toHaveProp('value', '@thalitasan chego cedo');

    fireEvent.press(screen.getByTestId('comment-send'));
    await waitFor(() => expect(mocked.addFanClubComment).toHaveBeenCalledTimes(2));
    expect(mocked.addFanClubComment.mock.calls[1]?.[0]).toMatchObject({
      replyToId: 'c1',
      text: '@thalitasan chego cedo',
    });
  });

  it('a resposta vai com o respondido e aparece embaixo do comentário de cima, com as respostas abertas', async () => {
    const reply = added('r3', { replyToId: 'c1', text: '@thalitasan chego cedo' });
    mocked.addFanClubComment.mockResolvedValue(reply);
    // O servidor devolve a resposta nova junto das outras depois de gravar.
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf(TOP)
          : pageOf(mocked.addFanClubComment.mock.calls.length > 0 ? [...REPLIES, reply] : REPLIES),
      ),
    );
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Responder a Thalita Santos' }));
    const input = screen.getByTestId('comment-input');
    fireEvent.changeText(input, '@thalitasan chego cedo');
    fireEvent.press(screen.getByTestId('comment-send'));

    await waitFor(() =>
      expect(mocked.addFanClubComment).toHaveBeenCalledWith(
        expect.objectContaining({ replyToId: 'c1', text: '@thalitasan chego cedo' }),
      ),
    );
    expect(await screen.findByText('Eu também vou')).toBeTruthy();
    expect(await screen.findByTestId('club-comment-r3-text')).toBeTruthy();
    expect(screen.queryByTestId('comment-reply')).toBeNull();
  });
});

describe('quem não segue (37.9, item 5)', () => {
  it('lê os comentários e vê "Seguir o fã-clube" no lugar do campo; seguir traz o campo, com o foco nele', async () => {
    mocked.fetchFanClubPost.mockResolvedValue(details({ isFollowing: false, isMember: false }));
    mocked.followFanClub.mockResolvedValue({
      clubId: 'fc-1',
      following: true,
      joined: false,
      pointsAwarded: 0,
    });
    await openPost();

    expect(screen.getByText('Siga o fã-clube para comentar e reagir.')).toBeTruthy();
    expect(screen.queryByTestId('comment-input')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Responder/u })).toBeNull();
    const follow = screen.getByRole('button', {
      name: 'Seguir o fã-clube Nenho Sempre. Você também entra na central de Nenho. O gestor do fã-clube vê que você é membro',
    });
    // O botão dos comentários do cabeçalho leva o foco ao seguir.
    const comments = within(screen.getByTestId('fan-club-post-card')).getByRole('button', {
      name: '4 comentários',
    });
    expect(comments).toHaveProp('accessibilityHint', 'Vai para o botão de seguir o fã-clube');
    fireEvent.press(comments);
    await waitFor(() => expect(focusedTestIds()).toContain('fan-club-post-follow'));

    fireEvent.press(follow);
    expect(await screen.findByTestId('comment-input')).toBeTruthy();
    await waitFor(() => expect(focusedTestIds()).toContain('comment-input'));
    expect(mocked.followFanClub).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'fc-1' }));
    expect(screen.queryByText('Siga o fã-clube para comentar e reagir.')).toBeNull();
    expect(announced()).toContain('Você está seguindo o fã-clube Nenho Sempre.');
    expect(screen.getAllByRole('button', { name: /^Responder/u }).length).toBeGreaterThan(0);
  });

  it('o seguir que fez a entrada na central sobe o "+N", que fica na tela depois de o campo aparecer', async () => {
    mocked.fetchFanClubPost.mockResolvedValue(details({ isFollowing: false, isMember: false }));
    mocked.followFanClub.mockResolvedValue({
      clubId: 'fc-1',
      following: true,
      joined: true,
      pointsAwarded: 20,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
    await openPost();
    // A entrada na central busca a publicação de novo: o servidor já diz que segue.
    mocked.fetchFanClubPost.mockResolvedValue(details());

    fireEvent.press(screen.getByTestId('fan-club-post-follow'));
    expect(await screen.findByTestId('comment-input')).toBeTruthy();
    // A pílula fica fora do leitor de tela, que ouve o anúncio dela.
    expect(screen.getByText('+20', { includeHiddenElements: true })).toBeTruthy();
  });

  it('o not_following ao comentar (deixou de seguir noutro aparelho): a publicação volta e mostra o seguir', async () => {
    mocked.addFanClubComment.mockRejectedValueOnce(
      new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason: 'not_following' }),
    );
    await openPost();
    mocked.fetchFanClubPost.mockResolvedValue(details({ isFollowing: false }));

    fireEvent.changeText(screen.getByTestId('comment-input'), 'Oi!');
    fireEvent.press(screen.getByTestId('comment-send'));
    expect(await screen.findByTestId('fan-club-follow-to-comment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Você, não enviado: Oi!' })).toBeTruthy();
  });

  it('a conta suspensa vê a frase da suspensão, sem campo', async () => {
    jest.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({
        displayName: 'Camila Ribeiro',
        username: 'camilarib',
        suspendedAt: '2026-10-20T12:00:00.000Z',
      }),
      metadata: { fromCache: false },
    } as never);
    await openPost();

    expect(await screen.findByTestId('comment-suspended')).toBeTruthy();
    expect(screen.queryByTestId('comment-input')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Responder/u })).toBeNull();
    // O botão dos comentários do cabeçalho leva o foco à frase da suspensão.
    const comments = within(screen.getByTestId('fan-club-post-card')).getByRole('button', {
      name: '4 comentários',
    });
    expect(comments).toHaveProp('accessibilityHint', 'Vai para o aviso da suspensão');
    fireEvent.press(comments);
    await waitFor(() => expect(focusedTestIds()).toContain('comment-suspended-text'));
  });
});

// --- A sugestão do @ ------------------------------------------------------------------------

describe('a sugestão do @ (37.7 e 37.9, item 6)', () => {
  const CONVERSATION = [
    suggestion('thalitasan', { id: 'fa-thalita', name: 'Thalita Santos', role: 'manager' }),
    suggestion('nenho', { kind: 'artist', id: 'nenho', name: 'Nenho', role: 'artist' }),
    suggestion('davilim', { id: 'fa-davi', name: 'Davi Lima' }),
  ];

  it('a conversa ao abrir o campo; a barra com o @, filtrada, anunciada; escolher troca o @ inteiro', async () => {
    mocked.fetchFanClubMentions.mockResolvedValue({ items: CONVERSATION });
    await openPost();

    const input = screen.getByTestId('comment-input');
    fireEvent(input, 'focus');
    await waitFor(() =>
      expect(mocked.fetchFanClubMentions).toHaveBeenCalledWith({
        clubId: 'fc-1',
        postId: 'p1',
        q: null,
      }),
    );
    fireEvent.changeText(input, 'Oi @');
    const bar = await screen.findByTestId('mention-suggestions');
    expect(
      within(bar)
        .getAllByRole('button')
        .map((node) => node.props.accessibilityLabel),
    ).toEqual([
      'Marcar Thalita Santos, @thalitasan',
      'Marcar Nenho, @nenho',
      'Marcar Davi Lima, @davilim',
    ]);
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      '3 sugestões',
      { queue: true },
    );

    fireEvent.changeText(input, 'Oi @D');
    expect(
      within(screen.getByTestId('mention-suggestions'))
        .getAllByRole('button')
        .map((node) => node.props.accessibilityLabel),
    ).toEqual(['Marcar Davi Lima, @davilim']);
    // Passada a espera, uma letra não busca (o q vai de 2 a 30, 37.3).
    act(() => {
      jest.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
    });
    expect(mocked.fetchFanClubMentions).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByRole('button', { name: 'Marcar Davi Lima, @davilim' }));
    expect(screen.getByTestId('comment-input')).toHaveProp('value', 'Oi @davilim ');
    expect(screen.queryByTestId('mention-suggestions')).toBeNull();
    // Uma conversa só, e nenhuma busca com uma letra.
    expect(mocked.fetchFanClubMentions).toHaveBeenCalledTimes(1);
  });

  it('a busca a partir de 2 letras, depois da conversa e sem repetir', async () => {
    mocked.fetchFanClubMentions.mockImplementation(({ q }) =>
      Promise.resolve({
        items:
          q === null
            ? CONVERSATION
            : [
                suggestion('nenho', { kind: 'artist', id: 'nenho', name: 'Nenho', role: 'artist' }),
                suggestion('nettobrito', {
                  kind: 'artist',
                  id: 'nettobrito',
                  name: 'Netto Brito',
                  inConversation: false,
                }),
              ],
      }),
    );
    await openPost();

    const input = screen.getByTestId('comment-input');
    fireEvent(input, 'focus');
    fireEvent.changeText(input, '@ne');
    await waitFor(() =>
      expect(mocked.fetchFanClubMentions).toHaveBeenCalledWith({
        clubId: 'fc-1',
        postId: 'p1',
        q: 'ne',
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('mention-suggestions'))
          .getAllByRole('button')
          .map((node) => node.props.accessibilityLabel),
      ).toEqual(['Marcar Nenho, @nenho', 'Marcar Netto Brito, @nettobrito']),
    );
  });
});

// --- O 404 --------------------------------------------------------------------------------

describe('a publicação que não está mais no ar', () => {
  it.each([
    [
      'o 404 da publicação',
      new ApiError('notFound', 'Publicação.', 404, 'fan_club_post_not_found'),
    ],
    [
      'o servidor de antes (a rota que não existe)',
      new ApiError('notFound', 'Rota.', 404, 'not_found'),
    ],
  ])('%s: "Esta publicação não está mais disponível."', async (_case, error) => {
    mocked.fetchFanClubPost.mockRejectedValue(error);
    renderRouter(appTree, { initialUrl: '/fa-clube/publicacao/p1' });

    expect(await screen.findByTestId('fan-club-post-not-found')).toBeTruthy();
    expect(screen.getByText('Esta publicação não está mais disponível.')).toBeTruthy();
    expect(mocked.fetchFanClubComments).not.toHaveBeenCalled();
  });

  it('antes da abertura do fã-clube (a api de antes), não chama a publicação', async () => {
    mocked.fetchMyFanClub.mockRejectedValue(new ApiError('notFound', 'Rota.', 404, 'not_found'));
    renderRouter(appTree, { initialUrl: '/fa-clube/publicacao/p1' });

    expect(await screen.findByTestId('fan-club-post-not-available')).toBeTruthy();
    expect(mocked.fetchFanClubPost).not.toHaveBeenCalled();
  });
});
