import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDoc } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert, Text, type AlertButton } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import CommentOptionsRoute from '@/app/comentario-fa-clube/[comentarioId]';
import ReportFanRoute from '@/app/denunciar-perfil/[fanId]';
import PostRoute from '@/app/fa-clube/publicacao/[publicacaoId]';
import type {
  FanClubComment,
  FanClubCommentPage,
  FanClubPost,
  FanClubPostDetails,
  MyFanClub,
} from '@/domains/fan-club';
import * as fanClubApi from '@/domains/fan-club/api';
import { fanClubKeys } from '@/domains/fan-club/keys';
import { useSessionGate } from '@/hooks/use-session-gate';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { queryClient } from '@/services/query';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// A moderação dos comentários do fã-clube e a sheet de opções (seção 37, 37.6
// e 37.9, itens 4 e 10; a etapa 7 de 37.13): o botão de opções dos
// comentários dos outros, irmão do autor, que abre a sheet "Opções do
// comentário" (Denunciar e Bloquear); no comentário do gestor, o "Bloquear e
// denunciar" da página, com o texto e o fluxo dela e o 404 da tela da
// publicação na volta; o ocultar e o reexibir do gestor, confirmados por
// `Alert`, com o total; e o "Oculto pelo gestor" do autor, pela data na lista
// (o `ownHidden`), com o "Pedir revisão".

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
          <Stack.Screen name="fa-clube/publicacao/[publicacaoId]" />
          <Stack.Screen name="comentario-fa-clube/[comentarioId]" />
          <Stack.Screen name="denunciar-perfil/[fanId]" />
        </Stack.Protected>
      </Stack>
    </QueryClientProvider>
  );
}

const label = (text: string) =>
  function Label(): ReactNode {
    return <Text>{text}</Text>;
  };

const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(auth)/entrar': label('entrada'),
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(perfil)/perfil': label('profile'),
  'fa/[fanId]': label('fan'),
  'fa-clube/publicacao/[publicacaoId]': PostRoute,
  'comentario-fa-clube/[comentarioId]': CommentOptionsRoute,
  'denunciar-perfil/[fanId]': ReportFanRoute,
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

const post = (patch: Partial<FanClubPost> = {}): FanClubPost => ({
  id: 'p1',
  clubId: 'fc-1',
  clubName: 'Nenho Sempre',
  clubOfficial: false,
  artistId: 'nenho',
  author: OWNER,
  kind: 'text',
  text: 'Quem vai no show?',
  photo: null,
  thumb: null,
  publishedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 3,
  reactionCounts: { heart: 3, fire: 0, laugh: 0, wow: 0, clap: 0 },
  commentCount: 4,
  myReaction: null,
  mentions: [],
  ...patch,
});

const details = (patch: Partial<FanClubPostDetails> = {}): FanClubPostDetails => ({
  ...post(),
  isOwner: false,
  isFollowing: true,
  isMember: true,
  artistName: 'Nenho',
  ...patch,
});

/** Um comentário, em horas depois das 15h de 19/10/2026 (a hora da publicação). */
const comment = (
  id: string,
  hoursAfter: number,
  patch: Partial<FanClubComment> = {},
): FanClubComment => ({
  id,
  postId: 'p1',
  clubId: 'fc-1',
  author: DAVI,
  isManager: false,
  text: `Comentário ${id}`,
  mentions: [],
  replyToId: null,
  replyCount: 0,
  createdAt: new Date(
    Date.parse('2026-10-19T15:00:00.000Z') + hoursAfter * 3_600_000,
  ).toISOString(),
  hidden: null,
  review: null,
  ...patch,
});

/** Os de cima: o do Davi, o da Camila e o da gestora, com 2 respostas. */
const TOP: FanClubComment[] = [
  comment('c3', 5),
  comment('c2', 4, { author: CAMILA, text: 'Eu vou!' }),
  comment('c1', 1, { author: OWNER, isManager: true, text: 'Encontro às 19h', replyCount: 2 }),
];

const pageOf = (
  items: FanClubComment[],
  patch: Partial<FanClubCommentPage> = {},
): FanClubCommentPage => ({ items, nextCursor: null, ...patch });

const notFound = (code: string) => new ApiError('notFound', 'Não encontrado.', 404, code);
const refused = (reason: string) =>
  new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason });

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

/** O `Alert` responde com o botão deste texto (a confirmação), e a recusa fica registrada. */
function answerAlerts(choice: string): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((button) => button.text === choice)?.onPress?.();
  });
}

/** A tela da publicação a frio, com os comentários de cima carregados. */
async function openPost() {
  const view = renderRouter(appTree, { initialUrl: '/fa-clube/publicacao/p1' });
  await screen.findByTestId('fan-club-comments-list');
  await waitFor(() =>
    expect(screen.queryByLabelText('Carregando os comentários')).not.toBeOnTheScreen(),
  );
  return view;
}

/** O bloqueio de sempre (`PUT /me/blocks/:fanId`), que responde bloqueado. */
function blocksAnswer(): void {
  jest.mocked(api.put).mockImplementation((url: string) => {
    if (url.startsWith('/me/blocks/')) {
      return Promise.resolve({ data: { fanId: url.split('/').pop(), blocked: true } });
    }
    return Promise.reject(new Error(`rota inesperada: ${url}`));
  });
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
    .mockImplementation((url: string) => Promise.reject(new Error(`rota inesperada: ${url}`)));
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mocked.fetchMyFanClub.mockResolvedValue(MINE);
  mocked.fetchFanClubPost.mockResolvedValue(details());
  mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
    Promise.resolve(
      replyTo === null
        ? pageOf(TOP, { ownHidden: [] })
        : pageOf([comment('r1', 2, { replyToId: 'c1' }), comment('r2', 3, { replyToId: 'c1' })]),
    ),
  );
  mocked.fetchFanClubMentions.mockResolvedValue({ items: [] });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

// --- A sheet de opções --------------------------------------------------------------------

describe('a sheet "Opções do comentário" do fã-clube (37.9, item 10)', () => {
  it('o botão de opções, irmão do autor, abre a sheet por cima da tela; o próprio comentário não tem', async () => {
    const view = await openPost();

    const options = screen.getByRole('button', { name: 'Opções do comentário de Davi Lima' });
    expect(options.props.testID).toBe('club-comment-c3-options');
    // Nunca dentro do pressável do autor, e a linha continua sem ser pressável.
    const author = screen.getByTestId('club-comment-c3-author');
    expect(within(author).queryAllByRole('button')).toHaveLength(0);
    const row = screen.getByTestId('club-comment-c3');
    for (let node: ReactTestInstance | null = row; node; node = node.parent) {
      if (node === row.parent) break;
      expect(node.props.onPress).toBeUndefined();
    }
    expect(screen.queryByTestId('club-comment-c2-options')).toBeNull();
    // A fã não é a gestora: sem o "Ocultar".
    expect(screen.queryByTestId('club-comment-c3-hide')).toBeNull();

    fireEvent.press(options);
    expect(await screen.findByRole('header', { name: 'Comentário de Davi Lima' })).toBeTruthy();
    expect(view.getPathname()).toBe('/comentario-fa-clube/c3');
    expect(rootRoutes(view)).toEqual([
      'fa-clube/publicacao/[publicacaoId]',
      'comentario-fa-clube/[comentarioId]',
    ]);
    expect(screen.getByRole('button', { name: 'Bloquear Davi Lima' })).toBeTruthy();
  });

  it('denunciar com o motivo: o comentário e o motivo, e a sheet fecha e anuncia', async () => {
    mocked.reportFanClubComment.mockResolvedValue({ commentId: 'c3', status: 'reported' });
    const view = await openPost();

    fireEvent.press(screen.getByTestId('club-comment-c3-options'));
    fireEvent.press(await screen.findByRole('button', { name: 'Spam' }));
    fireEvent.press(screen.getByRole('button', { name: 'Denunciar comentário' }));

    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/publicacao/p1'));
    expect(mocked.reportFanClubComment).toHaveBeenCalledWith({
      commentId: 'c3',
      reason: 'spam',
      idempotencyKey: expect.stringMatching(/^club-comment-report-c3-/),
    });
    expect(announced()).toContain('Denúncia enviada. A equipe vai analisar.');
    // A denúncia não esconde o comentário.
    expect(screen.getByTestId('club-comment-c3')).toBeTruthy();
  });

  it('o comentário que saiu da vista: a frase fica na sheet, e a lista busca de novo', async () => {
    mocked.reportFanClubComment.mockRejectedValue(notFound('fan_club_comment_not_found'));
    await openPost();

    fireEvent.press(screen.getByTestId('club-comment-c3-options'));
    fireEvent.press(await screen.findByRole('button', { name: 'Denunciar comentário' }));

    expect(await screen.findByText('Este comentário não está mais disponível.')).toBeTruthy();
    expect(announced()).toContain('Este comentário não está mais disponível.');
    await waitFor(() =>
      expect(
        mocked.fetchFanClubComments.mock.calls.filter(([query]) => query.replyTo === null),
      ).toHaveLength(2),
    );
  });

  it('bloquear quem comentou: a sheet fecha e anuncia, sem o convite à denúncia que o servidor recusaria, e a lista busca de novo', async () => {
    blocksAnswer();
    const view = await openPost();

    fireEvent.press(screen.getByTestId('club-comment-c3-options'));
    expect(
      await screen.findByText(
        'Os comentários de Davi Lima somem para você, neste e nos outros posts. Davi Lima não fica sabendo.',
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Bloquear Davi Lima' }));

    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/publicacao/p1'));
    expect(api.put).toHaveBeenCalledWith('/me/blocks/fa-davi', undefined, expect.any(Object));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(announced()).toContain('Bloqueio feito. Os comentários somem para você.');
    expect(announced()).not.toContain(
      'Você bloqueou Davi Lima. A equipe só fica sabendo se você denunciar o comentário.',
    );
    expect(screen.queryByText(/A equipe só fica sabendo/u)).toBeNull();
    await waitFor(() =>
      expect(
        mocked.fetchFanClubComments.mock.calls.filter(([query]) => query.replyTo === null),
      ).toHaveLength(2),
    );
  });

  it('a gestora no próprio fã-clube continua vendo quem bloqueou: o texto diz isso, e depois do bloqueio a denúncia fica à mão', async () => {
    blocksAnswer();
    mocked.fetchFanClubPost.mockResolvedValue(
      details({ isOwner: true, isFollowing: false, author: CAMILA }),
    );
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf([comment('c3', 5), comment('c2', 4, { author: CAMILA, isManager: true })])
          : pageOf([]),
      ),
    );
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Opções do comentário de Davi Lima' }));
    expect(
      await screen.findByText(
        'No seu fã-clube, você continua vendo os comentários de Davi Lima, para poder ocultar. Nos outros lugares, eles somem para você. Davi Lima não fica sabendo.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/neste e nos outros posts/u)).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Bloquear Davi Lima' }));

    // A lista dela não filtra bloqueados (37.8), e o servidor aceita a denúncia dela.
    expect(
      await screen.findByText(
        'Você bloqueou Davi Lima. A equipe só fica sabendo se você denunciar o comentário.',
      ),
    ).toBeTruthy();
    expect(announced()).toContain(
      'Você bloqueou Davi Lima. A equipe só fica sabendo se você denunciar o comentário.',
    );
    expect(screen.getByRole('button', { name: 'Denunciar comentário' })).toBeTruthy();
  });

  it('no comentário do gestor, o "Bloquear e denunciar" da página: confirma, troca a sheet pela denúncia de perfil, e na volta a publicação dá 404', async () => {
    blocksAnswer();
    answerAlerts('Bloquear e denunciar');
    const view = await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Opções do comentário de Thalita Santos' }));
    expect(
      await screen.findByText(
        'Você deixa de seguir este fã-clube e para de ver o fã-clube e as publicações de @thalitasan. Em seguida, conte para a equipe o que aconteceu. @thalitasan não fica sabendo do bloqueio.',
      ),
    ).toBeTruthy();
    // Depois do bloqueio, o fã-clube some para quem bloqueou o gestor.
    mocked.fetchFanClubPost.mockRejectedValue(notFound('fan_club_post_not_found'));
    fireEvent.press(screen.getByRole('button', { name: 'Bloquear e denunciar' }));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Bloquear e denunciar @thalitasan?',
      expect.stringContaining('Você deixa de seguir este fã-clube'),
      expect.any(Array),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/denunciar-perfil/fa-thalita'));
    expect(api.put).toHaveBeenCalledWith('/me/blocks/fa-thalita', undefined, expect.any(Object));
    expect(rootRoutes(view)).toEqual([
      'fa-clube/publicacao/[publicacaoId]',
      'denunciar-perfil/[fanId]',
    ]);
    // O nome do gestor vem da publicação em cache: a página não foi aberta.
    expect(await screen.findByText('Denunciar Thalita Santos')).toBeTruthy();
    expect(announced()).toContain('Você bloqueou @thalitasan e deixou de seguir o fã-clube.');

    act(() => router.back());
    expect(await screen.findByTestId('fan-club-post-not-found')).toBeTruthy();
    expect(screen.getByText('Esta publicação não está mais disponível.')).toBeTruthy();
  });

  it('quem não segue o fã-clube não ouve que deixa de seguir', async () => {
    mocked.fetchFanClubPost.mockResolvedValue(details({ isFollowing: false }));
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Opções do comentário de Thalita Santos' }));
    expect(
      await screen.findByText(
        'Você para de ver o fã-clube e as publicações de @thalitasan. Em seguida, conte para a equipe o que aconteceu. @thalitasan não fica sabendo do bloqueio.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/deixa de seguir/u)).toBeNull();
  });

  it('aberta a frio, sem o comentário no cache, a sheet fecha', async () => {
    const view = renderRouter(appTree, {
      initialUrl: '/comentario-fa-clube/c3?publicacao=p1',
    });
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(screen.queryByRole('header', { name: /^Comentário de/u })).toBeNull();
    expect(mocked.reportFanClubComment).not.toHaveBeenCalled();
  });
});

// --- O gestor ------------------------------------------------------------------------------

describe('o ocultar e o reexibir do gestor (37.6)', () => {
  beforeEach(() => {
    // A Camila é a gestora: o comentário dela e o do Davi.
    mocked.fetchFanClubPost.mockResolvedValue(
      details({ isOwner: true, isFollowing: false, author: CAMILA, commentCount: 2 }),
    );
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf([
              comment('c3', 5),
              comment('c2', 4, { author: CAMILA, isManager: true, text: 'Valeu!' }),
            ])
          : pageOf([]),
      ),
    );
  });

  it('"Ocultar" confirma por Alert; o comentário fica "Oculto por você", com "Reexibir", e o total desce', async () => {
    mocked.hideFanClubComment.mockImplementation(() => {
      // O servidor: a publicação passa a contar 1 (a que a tela busca de novo).
      mocked.fetchFanClubPost.mockResolvedValue(
        details({ isOwner: true, isFollowing: false, author: CAMILA, commentCount: 1 }),
      );
      return Promise.resolve({ commentId: 'c3', hidden: true });
    });
    answerAlerts('Ocultar');
    await openPost();

    // Nunca no próprio comentário (decisão 21 de 37.1).
    expect(screen.queryByTestId('club-comment-c2-hide')).toBeNull();
    expect(screen.queryByTestId('club-comment-c2-options')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Ocultar o comentário de Davi Lima' }));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Ocultar o comentário?',
      'O comentário some para os outros fãs. Quem escreveu continua vendo, com o aviso de que você ocultou, e pode pedir revisão à equipe.',
      expect.any(Array),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('club-comment-c3')).getByText('Oculto por você'),
      ).toBeTruthy(),
    );
    expect(mocked.hideFanClubComment).toHaveBeenCalledWith({
      commentId: 'c3',
      idempotencyKey: expect.stringMatching(/^club-comment-hide-/),
    });
    expect(screen.getByRole('button', { name: 'Reexibir o comentário de Davi Lima' })).toBeTruthy();
    expect(screen.queryByTestId('club-comment-c3-hide')).toBeNull();
    // O oculto não tem "Responder" nem opções.
    expect(screen.queryByTestId('club-comment-c3-reply')).toBeNull();
    expect(screen.queryByTestId('club-comment-c3-options')).toBeNull();
    expect(await screen.findByLabelText('Comentários, 1')).toBeTruthy();
    expect(announced()).toContain('Comentário oculto.');
  });

  it('"Reexibir" confirma e volta o comentário à vista', async () => {
    mocked.fetchFanClubComments.mockResolvedValue(
      pageOf([comment('c3', 5, { hidden: 'manager' })]),
    );
    mocked.unhideFanClubComment.mockResolvedValue({ commentId: 'c3', hidden: false });
    answerAlerts('Reexibir');
    await openPost();

    expect(within(screen.getByTestId('club-comment-c3')).getByText('Oculto por você')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Reexibir o comentário de Davi Lima' }));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Reexibir o comentário?',
      'O comentário volta a aparecer para os fãs.',
      expect.any(Array),
    );
    expect(
      await screen.findByRole('button', { name: 'Ocultar o comentário de Davi Lima' }),
    ).toBeTruthy();
    expect(mocked.unhideFanClubComment).toHaveBeenCalledWith({
      commentId: 'c3',
      idempotencyKey: expect.stringMatching(/^club-comment-unhide-/),
    });
    expect(screen.queryByText('Oculto por você')).toBeNull();
    expect(announced()).toContain('Comentário reexibido.');
  });

  it('a recusa num Alert: o que a equipe reexibiu não se oculta de novo (staff_decided)', async () => {
    mocked.hideFanClubComment.mockRejectedValue(refused('staff_decided'));
    answerAlerts('Ocultar');
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Ocultar o comentário de Davi Lima' }));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'A equipe reexibiu este comentário, e ele não pode ser ocultado de novo.',
      ),
    );
    expect(screen.queryByText('Oculto por você')).toBeNull();
    expect(screen.getByLabelText('Comentários, 2')).toBeTruthy();
  });

  it('cancelar a confirmação não manda nada', async () => {
    answerAlerts('Cancelar');
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Ocultar o comentário de Davi Lima' }));
    expect(Alert.alert).toHaveBeenCalled();
    expect(mocked.hideFanClubComment).not.toHaveBeenCalled();
  });

  it('enquanto um ocultar vai, o "Ocultar" das outras linhas também fica desligado', async () => {
    mocked.fetchFanClubComments.mockResolvedValue(
      pageOf([comment('c4', 6, { author: OWNER }), comment('c3', 5)]),
    );
    let finish: () => void = () => undefined;
    mocked.hideFanClubComment.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ commentId: 'c3', hidden: true }))),
    );
    answerAlerts('Ocultar');
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Ocultar o comentário de Davi Lima' }));
    // O segundo pedido seria descartado em silêncio: o botão não se oferece.
    await waitFor(() => expect(screen.getByTestId('club-comment-c4-hide')).toBeDisabled());
    expect(screen.getByTestId('club-comment-c3-hide')).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByTestId('club-comment-c4-hide')).not.toBeDisabled());
    expect(mocked.hideFanClubComment).toHaveBeenCalledTimes(1);
  });
});

// --- O autor -------------------------------------------------------------------------------

describe('o "Oculto pelo gestor" do autor (37.6 e 37.9, item 4)', () => {
  const hiddenMine = (id: string, hoursAfter: number, patch: Partial<FanClubComment> = {}) =>
    comment(id, hoursAfter, { author: CAMILA, hidden: 'manager', text: `Oculto ${id}`, ...patch });

  it('o oculto entra na lista pela data, esmaecido, com "Pedir revisão"; pedir confirma e passa a "Revisão pedida"', async () => {
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf(TOP, { ownHidden: [hiddenMine('h1', 3, { replyCount: 2 })] })
          : pageOf([]),
      ),
    );
    mocked.requestFanClubCommentReview.mockResolvedValue({ commentId: 'h1', status: 'requested' });
    answerAlerts('Pedir revisão');
    await openPost();

    const order = screen
      .getAllByTestId(/^club-comment-[ch]\d-text$/u)
      .map((node) => (node.props.testID as string).replace(/^club-comment-|-text$/gu, ''));
    expect(order).toEqual(['c3', 'c2', 'h1', 'c1']);
    const row = screen.getByTestId('club-comment-h1');
    expect(within(row).getByText('Oculto pelo gestor')).toBeTruthy();
    expect(within(row).queryByTestId('club-comment-h1-reply')).toBeNull();
    expect(within(row).queryByTestId('club-comment-h1-options')).toBeNull();
    // As respostas saíram da vista com ele: o autor não tem o "Ver 2 respostas".
    expect(screen.queryByTestId('club-thread-h1-replies')).toBeNull();

    const request = within(row).getByRole('button', { name: 'Pedir revisão' });
    expect(request).toHaveProp(
      'accessibilityHint',
      'Pede à equipe para revisar o comentário que o gestor ocultou',
    );
    fireEvent.press(request);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Pedir revisão?',
      'A equipe do ImagineUP revisa o comentário e decide se ele volta a aparecer para os fãs. Você pode pedir uma vez.',
      expect.any(Array),
    );
    expect(await within(row).findByText('Revisão pedida')).toBeTruthy();
    expect(mocked.requestFanClubCommentReview).toHaveBeenCalledWith({
      commentId: 'h1',
      idempotencyKey: expect.stringMatching(/^club-comment-review-/),
    });
    expect(within(row).queryByRole('button', { name: 'Pedir revisão' })).toBeNull();
    expect(announced()).toContain('Revisão pedida. A equipe vai analisar.');
    // O botão sumiu: o foco do leitor vai ao estado, no lugar dele.
    await waitFor(() => expect(focusedTestIds()).toContain('club-comment-h1-review'));
  });

  it('o já pedido que a equipe manteve (already_requested): a lista nova diz "A equipe manteve oculto", e é o que o leitor ouve', async () => {
    let kept = false;
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf(TOP, { ownHidden: [hiddenMine('h1', 3, kept ? { review: 'kept' } : {})] })
          : pageOf([]),
      ),
    );
    mocked.requestFanClubCommentReview.mockImplementation(() => {
      kept = true;
      return Promise.resolve({ commentId: 'h1', status: 'already_requested' });
    });
    answerAlerts('Pedir revisão');
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Pedir revisão' }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('club-comment-h1')).getByText('A equipe manteve oculto'),
      ).toBeTruthy(),
    );
    await waitFor(() => expect(announced()).toContain('A equipe manteve oculto'));
    expect(announced()).not.toContain('Revisão pedida. A equipe vai analisar.');
    expect(screen.queryByText('Revisão pedida')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pedir revisão' })).toBeNull();
  });

  it('o teto do dia do pedido de revisão abre o "Limite de hoje"', async () => {
    mocked.fetchFanClubComments.mockResolvedValue(
      pageOf(TOP, { ownHidden: [hiddenMine('h1', 3)] }),
    );
    mocked.requestFanClubCommentReview.mockRejectedValue(
      new ApiError('dailyLimit', 'Limite.', 429, 'too_many_requests', { action: 'report' }),
    );
    answerAlerts('Pedir revisão');
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Pedir revisão' }));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Limite de hoje',
        'Você chegou ao limite de denúncias e pedidos de revisão de hoje. Tente amanhã.',
        expect.any(Array),
      ),
    );
    expect(screen.getByRole('button', { name: 'Pedir revisão' })).toBeTruthy();
  });

  it('mantido pela equipe: "A equipe manteve oculto", sem o botão', async () => {
    mocked.fetchFanClubComments.mockResolvedValue(
      pageOf(TOP, { ownHidden: [hiddenMine('h1', 3, { review: 'kept' })] }),
    );
    await openPost();

    const row = screen.getByTestId('club-comment-h1');
    expect(within(row).getByText('A equipe manteve oculto')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Pedir revisão' })).toBeNull();
  });

  it('o gestor reexibiu antes do pedido (o 404): a frase num Alert, e a lista busca de novo', async () => {
    mocked.fetchFanClubComments.mockResolvedValue(
      pageOf(TOP, { ownHidden: [hiddenMine('h1', 3)] }),
    );
    mocked.requestFanClubCommentReview.mockRejectedValue(notFound('fan_club_comment_not_found'));
    answerAlerts('Pedir revisão');
    await openPost();

    fireEvent.press(screen.getByRole('button', { name: 'Pedir revisão' }));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Este comentário não está mais disponível.'),
    );
    await waitFor(() =>
      expect(
        mocked.fetchFanClubComments.mock.calls.filter(([query]) => query.replyTo === null),
      ).toHaveLength(2),
    );
  });

  it('a resposta oculta fica embaixo do comentário de cima carregado, com as respostas fechadas; sem ele, entre os de cima, sem recuo', async () => {
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) =>
      Promise.resolve(
        replyTo === null
          ? pageOf(TOP, {
              ownHidden: [
                hiddenMine('h1', 1.5, { replyToId: 'c1', text: '@thalitasan oculta' }),
                hiddenMine('h2', 4.5, { replyToId: 'c-antigo', text: '@davilim fora' }),
              ],
            })
          : pageOf([comment('r1', 2, { replyToId: 'c1' }), comment('r2', 3, { replyToId: 'c1' })]),
      ),
    );
    await openPost();

    const thread = screen.getByTestId('club-thread-c1');
    expect(within(thread).getByTestId('club-comment-h1')).toBeTruthy();
    expect(within(thread).getByTestId('club-thread-c1-replies')).toBeTruthy();
    // O de cima dela não está na lista: ela entra entre os de cima, pela data.
    expect(screen.getByTestId('club-thread-h2')).toBeTruthy();
    const order = screen
      .getAllByTestId(/^club-thread-[ch]\d$/u)
      .map((node) => (node.props.testID as string).replace('club-thread-', ''));
    expect(order).toEqual(['c3', 'h2', 'c2', 'c1']);

    // Abertas, as respostas entram com a oculta pela data.
    fireEvent.press(within(thread).getByTestId('club-thread-c1-replies'));
    expect(await within(thread).findByTestId('club-comment-r1')).toBeTruthy();
    const replies = within(thread)
      .getAllByTestId(/^club-comment-[rh]\d$/u)
      .map((node) => (node.props.testID as string).replace('club-comment-', ''));
    expect(replies).toEqual(['h1', 'r1', 'r2']);
    // O foco vai à primeira que chegou, e não à oculta, que já estava à vista.
    await waitFor(() => expect(focusedTestIds()).toContain('club-comment-r1-author'));
    expect(focusedTestIds()).not.toContain('club-comment-h1-author');
  });

  it('o comentário de cima que o gestor oculta fecha as respostas abertas: ficam só as do fã ocultas', async () => {
    let hidden = false;
    mocked.fetchFanClubComments.mockImplementation(({ replyTo }) => {
      if (replyTo !== null) {
        // Fechado para o autor, o servidor daria o 404.
        return hidden
          ? Promise.reject(notFound('fan_club_comment_not_found'))
          : Promise.resolve(pageOf([comment('r1', 3, { replyToId: 'c2' })]));
      }
      const mine = comment('c2', 2, { author: CAMILA, text: 'Eu vou!', replyCount: 1 });
      return Promise.resolve(
        hidden
          ? pageOf([comment('c3', 5)], {
              ownHidden: [
                { ...mine, hidden: 'manager' },
                hiddenMine('h1', 4, { replyToId: 'c2', text: '@davilim oculta' }),
              ],
            })
          : pageOf([comment('c3', 5), mine], { ownHidden: [] }),
      );
    });
    await openPost();

    fireEvent.press(screen.getByTestId('club-thread-c2-replies'));
    expect(await screen.findByTestId('club-comment-r1')).toBeTruthy();

    // A gestora ocultou: a lista dos de cima chega com ele no `ownHidden`.
    hidden = true;
    await act(() =>
      queryClient.invalidateQueries({ queryKey: fanClubKeys.comments('p1', null), exact: true }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('club-comment-c2')).getByText('Oculto pelo gestor'),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId('club-comment-r1')).toBeNull();
    expect(
      within(screen.getByTestId('club-thread-c2')).getByTestId('club-comment-h1'),
    ).toBeTruthy();
    // Fechadas, as respostas não buscam de novo (o servidor daria o 404).
    await act(() => queryClient.invalidateQueries({ queryKey: fanClubKeys.public() }));
    expect(screen.queryByText('Não deu para carregar as respostas.')).toBeNull();
    expect(announced()).not.toContain('Não deu para carregar as respostas.');
    expect(
      mocked.fetchFanClubComments.mock.calls.filter(([query]) => query.replyTo === 'c2'),
    ).toHaveLength(1);
  });
});
