import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDoc } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert, Text, View } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import ReportPostRoute from '@/app/denunciar-publicacao/[publicacaoId]';
import PageRoute from '@/app/fa-clube/[clubeId]';
import {
  fanClubKeys,
  FanClubFeedSection,
  type FanClubPage,
  type FanClubPost,
  type FanClubReactionCounts,
  type FanClubReactionResult,
  type MyFanClub,
} from '@/domains/fan-club';
import * as fanClubApi from '@/domains/fan-club/api';
import { useSessionGate } from '@/hooks/use-session-gate';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { queryClient } from '@/services/query';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// O card da publicação do fã-clube na Fase 2 (seção 37, 37.9, itens 1 e 2; a
// etapa 5 de 37.13), na página e na Início: o botão da reação (tocar curte,
// segurar abre a fileira dos 5 emojis dentro do card), as ações do leitor de
// tela, o total só para ler de quem não segue, o total dos comentários só
// como número e a volta no erro. E o app novo com o servidor de antes: sem o
// `reactionCount`, o card fica como era.

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

const mocked = jest.mocked(fanClubApi);

/** Os guards do app, com as rotas que o card toca, e o cache do app. */
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
          <Stack.Screen name="fa-clube/[clubeId]" />
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
  '(tabs)/(inicio)/index': HomeProbe,
  'fa-clube/[clubeId]': PageRoute,
  'denunciar-publicacao/[publicacaoId]': ReportPostRoute,
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

const page = (patch: Partial<FanClubPage> = {}): FanClubPage => ({
  id: 'fc-1',
  name: 'Nenho Sempre',
  artist: { id: 'nenho', name: 'Nenho', shortName: null, thumbUrl: null },
  owner: OWNER,
  followerCount: 41,
  postCount: 2,
  featured: false,
  official: false,
  isFollowing: true,
  isOwner: false,
  isMember: true,
  ...patch,
});

const counts = (patch: Partial<FanClubReactionCounts> = {}): FanClubReactionCounts => ({
  heart: 0,
  fire: 0,
  laugh: 0,
  wow: 0,
  clap: 0,
  ...patch,
});

/** A publicação do servidor da Fase 2: 5 reações (3 corações e 2 fogos) e 2 comentários. */
const post = (id: string, patch: Partial<FanClubPost> = {}): FanClubPost => ({
  id,
  clubId: 'fc-1',
  clubName: 'Nenho Sempre',
  clubOfficial: false,
  artistId: 'nenho',
  author: OWNER,
  kind: 'text',
  text: `Quem vai no show? Publicação ${id}`,
  photo: null,
  thumb: null,
  publishedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 5,
  reactionCounts: counts({ heart: 3, fire: 2 }),
  commentCount: 2,
  myReaction: null,
  mentions: [],
  ...patch,
});

/** A publicação como o servidor de antes manda: sem os campos da Fase 2. */
const oldPost = (id: string): FanClubPost => {
  const {
    reactionCount: _count,
    reactionCounts: _counts,
    commentCount: _comments,
    myReaction: _mine,
    mentions: _mentions,
    ...rest
  } = post(id);
  return rest;
};

const answer = (
  reaction: FanClubReactionResult['reaction'],
  reactionCount: number,
  perEmoji: Partial<FanClubReactionCounts>,
): FanClubReactionResult => ({
  postId: 'p1',
  reaction,
  reactionCount,
  reactionCounts: counts(perEmoji),
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
});

/** Os textos fora do leitor (os emojis, que o rótulo diz pelo nome). */
const hiddenOk = { includeHiddenElements: true } as const;

const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

/**
 * O botão da reação do card da p1, pelo rótulo inteiro: o rótulo é o do
 * desenho ("Reagir, 5 reações"), igual nos cards de mesmo total, e o leitor
 * chega a ele depois do corpo da publicação.
 */
async function reactionButton(name: string | RegExp) {
  const card = await screen.findByTestId('fan-club-post-p1');
  return within(card).findByRole('button', { name });
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
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mocked.fetchMyFanClub.mockResolvedValue(MINE);
  mocked.fetchFanClub.mockResolvedValue(page());
  mocked.fetchFanClubPosts.mockResolvedValue({ items: [post('p1'), post('p2')], nextCursor: null });
  mocked.fetchFanClubFeed.mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

// --- O card na página -------------------------------------------------------------------

describe('a reação no card da página (37.9, item 1)', () => {
  it('antes do Compartilhar: o botão da reação, com o total e o estado, e o total dos comentários só como número', async () => {
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const button = await reactionButton('Reagir, 5 reações');
    expect(button).toHaveProp(
      'accessibilityHint',
      'Reage com coração. Para escolher outra reação, toque e segure ou use as ações',
    );
    expect(button).not.toBeSelected();
    // O total e os mais usados à vista; o emoji não entra no rótulo.
    const card = screen.getByTestId('fan-club-post-p1');
    expect(within(card).getByText('5')).toBeTruthy();
    expect(within(card).getByText('❤️\u{1F525}', hiddenOk)).toBeTruthy();
    expect(within(card).queryByText('❤️\u{1F525}')).toBeNull();
    // O total dos comentários: lido, sem papel de botão (a tela da publicação é da etapa 6).
    const comments = within(card).getByLabelText('2 comentários');
    expect(comments).not.toHaveProp('accessibilityRole', 'button');
    expect(within(card).queryByRole('button', { name: /coment/u })).toBeNull();
    // A ordem da fileira: a reação, os comentários, o Compartilhar e o Denunciar.
    const order = within(card)
      .getAllByTestId(/^fan-club-post-p1-(react|comments|share|report)$/u)
      .map((node) => node.props.testID as string);
    expect(order).toEqual([
      'fan-club-post-p1-react',
      'fan-club-post-p1-comments',
      'fan-club-post-p1-share',
      'fan-club-post-p1-report',
    ]);
    // Nenhum pressável dentro de outro: o corpo é um foco só, sem botão dentro.
    const body = within(card).getByLabelText(/^Quem vai no show\? Publicação p1\. Publicado /u);
    expect(within(body).queryAllByRole('button')).toHaveLength(0);
  });

  it('tocar curte com o coração na hora; tocar de novo tira; cada toque com a chave dele', async () => {
    mocked.setFanClubReaction.mockResolvedValue(answer('heart', 6, { heart: 4, fire: 2 }));
    mocked.clearFanClubReaction.mockResolvedValue(answer(null, 5, { heart: 3, fire: 2 }));
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(await reactionButton('Reagir, 5 reações'));
    const reacted = await reactionButton('Reagir, 6 reações, você reagiu com coração');
    expect(reacted).toBeSelected();
    expect(reacted).toHaveProp(
      'accessibilityHint',
      'Tira a sua reação. Para trocar, toque e segure ou use as ações',
    );
    expect(mocked.setFanClubReaction).toHaveBeenCalledWith({
      postId: 'p1',
      reaction: 'heart',
      idempotencyKey: expect.stringMatching(/^club-react-/),
    });
    expect(haptics.trigger).toHaveBeenCalledWith('like');

    fireEvent.press(reacted);
    expect(await reactionButton('Reagir, 5 reações')).not.toBeSelected();
    await waitFor(() => expect(mocked.clearFanClubReaction).toHaveBeenCalled());
    const first = mocked.setFanClubReaction.mock.calls[0]?.[0].idempotencyKey;
    expect(mocked.clearFanClubReaction.mock.calls[0]?.[0]).toEqual({
      postId: 'p1',
      idempotencyKey: expect.not.stringMatching(first ?? ''),
    });
  });

  it('segurar abre a fileira dos 5 emojis no próprio card, com o foco no primeiro; escolher troca e fecha', async () => {
    mocked.setFanClubReaction.mockResolvedValue(answer('fire', 6, { heart: 3, fire: 3 }));
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent(await reactionButton('Reagir, 5 reações'), 'longPress');
    const card = screen.getByTestId('fan-club-post-p1');
    const picker = within(card).getByTestId('fan-club-post-p1-picker');
    expect(
      within(picker)
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel as string),
    ).toEqual([
      'Reagir com coração',
      'Reagir com fogo',
      'Reagir com risada',
      'Reagir com espanto',
      'Reagir com aplauso',
      'Fechar as reações',
    ]);
    // A fileira troca a de ações dentro do card; a outra publicação continua com a dela.
    expect(within(card).queryByTestId('fan-club-post-p1-share')).toBeNull();
    expect(screen.getByTestId('fan-club-post-p2-share')).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
    await waitFor(() =>
      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ testID: 'fan-club-post-p1-picker-heart' }),
        }),
        'focus',
      ),
    );

    fireEvent.press(within(picker).getByRole('button', { name: 'Reagir com fogo' }));
    const reacted = await reactionButton('Reagir, 6 reações, você reagiu com fogo');
    expect(within(card).queryByTestId('fan-club-post-p1-picker')).toBeNull();
    expect(mocked.setFanClubReaction).toHaveBeenCalledWith({
      postId: 'p1',
      reaction: 'fire',
      idempotencyKey: expect.stringMatching(/^club-react-/),
    });
    // O foco volta ao botão da reação.
    await waitFor(() =>
      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({ testID: reacted.props.testID }),
        }),
        'focus',
      ),
    );
  });

  it('o escolhido aparece marcado na fileira; "Fechar" fecha sem reagir', async () => {
    mocked.fetchFanClubPosts.mockResolvedValue({
      items: [
        post('p1', {
          myReaction: 'laugh',
          reactionCounts: counts({ heart: 3, fire: 1, laugh: 1 }),
        }),
      ],
      nextCursor: null,
    });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent(await reactionButton('Reagir, 5 reações, você reagiu com risada'), 'longPress');
    const picker = screen.getByTestId('fan-club-post-p1-picker');
    expect(within(picker).getByRole('button', { name: 'Reagir com risada' })).toBeSelected();
    expect(within(picker).getByRole('button', { name: 'Reagir com fogo' })).not.toBeSelected();
    fireEvent.press(within(picker).getByRole('button', { name: 'Fechar as reações' }));
    expect(await reactionButton('Reagir, 5 reações, você reagiu com risada')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-post-p1-picker')).toBeNull();
    expect(mocked.setFanClubReaction).not.toHaveBeenCalled();
    expect(mocked.clearFanClubReaction).not.toHaveBeenCalled();
  });

  it('deixou de seguir com a fileira aberta: ela fecha, e não volta aberta sozinha ao seguir de novo', async () => {
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent(await screen.findByTestId('fan-club-post-p1-react'), 'longPress');
    expect(screen.getByTestId('fan-club-post-p1-picker')).toBeTruthy();

    const following = (isFollowing: boolean) =>
      act(() => {
        queryClient.setQueryData<FanClubPage>(
          fanClubKeys.club('fc-1'),
          (current) => current && { ...current, isFollowing },
        );
      });
    following(false);
    expect(await screen.findByTestId('fan-club-post-p1-reactions')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-post-p1-picker')).toBeNull();

    following(true);
    expect(await screen.findByTestId('fan-club-post-p1-react')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-post-p1-picker')).toBeNull();
    expect(screen.getByTestId('fan-club-post-p1-share')).toBeTruthy();
  });

  it('o leitor de tela: "Escolher reação", uma ação por emoji e "Tirar a reação", que reagem e anunciam', async () => {
    mocked.setFanClubReaction.mockResolvedValue(answer('wow', 6, { heart: 3, fire: 2, wow: 1 }));
    mocked.clearFanClubReaction.mockResolvedValue(answer(null, 5, { heart: 3, fire: 2 }));
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const button = await reactionButton('Reagir, 5 reações');
    expect(
      (button.props.accessibilityActions as { label: string }[]).map((action) => action.label),
    ).toEqual([
      'Escolher reação',
      'Reagir com coração',
      'Reagir com fogo',
      'Reagir com risada',
      'Reagir com espanto',
      'Reagir com aplauso',
    ]);
    fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'react-wow' } });
    const reacted = await reactionButton('Reagir, 6 reações, você reagiu com espanto');
    expect(announced()).toContain('Você reagiu com espanto.');
    expect(
      (reacted.props.accessibilityActions as { name: string; label: string }[]).at(-1),
    ).toEqual({ name: 'clear', label: 'Tirar a reação' });

    fireEvent(reacted, 'accessibilityAction', { nativeEvent: { actionName: 'clear' } });
    expect(await reactionButton('Reagir, 5 reações')).toBeTruthy();
    expect(announced()).toContain('Você tirou a reação.');
    await waitFor(() => expect(mocked.clearFanClubReaction).toHaveBeenCalled());

    // "Escolher reação" abre a fileira, como o segurar.
    fireEvent(await reactionButton('Reagir, 5 reações'), 'accessibilityAction', {
      nativeEvent: { actionName: 'longpress' },
    });
    expect(screen.getByTestId('fan-club-post-p1-picker')).toBeTruthy();
  });

  it('o teto do dia: o card volta ao que era e abre o "Limite de hoje"', async () => {
    mocked.setFanClubReaction.mockRejectedValue(
      new ApiError('dailyLimit', 'Limite.', 429, 'too_many_requests', { action: 'club_react' }),
    );
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(await reactionButton('Reagir, 5 reações'));
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        'Limite de hoje',
        'Você chegou ao limite de reações de hoje no fã-clube. Tente amanhã.',
        expect.any(Array),
      ),
    );
    expect(await reactionButton('Reagir, 5 reações')).not.toBeSelected();
  });

  it('quem não segue e não é o gestor vê o total só para ler, sem botão de reagir', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isFollowing: false, isMember: false }));
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const total = await screen.findByTestId('fan-club-post-p1-reactions');
    expect(total).toHaveProp('accessibilityLabel', '5 reações');
    expect(total).not.toHaveProp('accessibilityRole', 'button');
    expect(screen.queryByRole('button', { name: /^Reagir/u })).toBeNull();
    expect(screen.getAllByLabelText('2 comentários')).toHaveLength(2);
  });

  it('sem reação nenhuma, a pílula fica só com o ícone e o número (sem a peça vazia dos emojis)', async () => {
    mocked.fetchFanClubPosts.mockResolvedValue({
      items: [post('p1', { reactionCount: 0, reactionCounts: counts() })],
      nextCursor: null,
    });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    // A pílula dentro do botão (o `View` em volta do "0"): o coração e o número, sem a terceira peça.
    const button = await reactionButton('Reagir, 0 reações');
    let pill: ReactTestInstance | null = within(button).getByText('0').parent;
    while (pill && (pill.type as unknown) !== 'View') pill = pill.parent;
    expect((pill?.props.children as unknown[]).filter(Boolean)).toHaveLength(2);
  });

  it('o gestor reage na própria publicação, sem seguir o próprio fã-clube', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isOwner: true, isFollowing: false }));
    mocked.fetchFanClubPosts.mockResolvedValue({
      items: [post('p1', { reactionCount: 1, reactionCounts: counts({ clap: 1 }) })],
      nextCursor: null,
    });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    expect(await reactionButton('Reagir, 1 reação')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-post-p1-report')).toBeNull();
  });

  it('quem não segue, sem reação nenhuma: o total só para ler fica sem a peça vazia dos emojis', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isFollowing: false, isMember: false }));
    mocked.fetchFanClubPosts.mockResolvedValue({
      items: [post('p1', { reactionCount: 0, reactionCounts: counts() })],
      nextCursor: null,
    });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const total = await screen.findByTestId('fan-club-post-p1-reactions');
    expect(total).toHaveProp('accessibilityLabel', '0 reações');
    expect((total.props.children as unknown[]).filter(Boolean)).toHaveLength(2);
  });

  it('o app novo com o servidor de antes: sem o reactionCount, o card fica como era', async () => {
    mocked.fetchFanClubPosts.mockResolvedValue({ items: [oldPost('p1')], nextCursor: null });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    expect(await screen.findByTestId('fan-club-post-p1-share')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-post-p1-react')).toBeNull();
    expect(screen.queryByTestId('fan-club-post-p1-reactions')).toBeNull();
    expect(screen.queryByTestId('fan-club-post-p1-comments')).toBeNull();
  });
});

// --- O card na Início -------------------------------------------------------------------

describe('a reação no card da Início (37.9, item 1)', () => {
  it('quem segue reage na Início, e o cartão troca na hora', async () => {
    mocked.fetchFanClubFeed.mockResolvedValue({ items: [post('p1')], nextCursor: null });
    mocked.setFanClubReaction.mockResolvedValue(answer('heart', 6, { heart: 4, fire: 2 }));
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByText('Dos seus fã-clubes')).toBeTruthy();
    const card = screen.getByTestId('home-fan-club-post-p1');
    fireEvent.press(within(card).getByRole('button', { name: 'Reagir, 5 reações' }));
    expect(
      await within(card).findByRole('button', {
        name: 'Reagir, 6 reações, você reagiu com coração',
      }),
    ).toBeTruthy();
    expect(within(card).getByLabelText('2 comentários')).toBeTruthy();
    await waitFor(() => expect(mocked.setFanClubReaction).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
  });

  it('segurar abre a fileira dentro do cartão da Início, sem sair da fileira dos cartões', async () => {
    mocked.fetchFanClubFeed.mockResolvedValue({
      items: [post('p1'), post('p2', { clubId: 'fc-2', clubName: 'Rock Raiz' })],
      nextCursor: null,
    });
    renderRouter(appTree, { initialUrl: '/' });

    const card = await screen.findByTestId('home-fan-club-post-p1');
    fireEvent(within(card).getByRole('button', { name: 'Reagir, 5 reações' }), 'longPress');
    expect(within(card).getByTestId('home-fan-club-post-p1-picker')).toBeTruthy();
    expect(
      within(screen.getByTestId('home-fan-club-feed-list')).getByTestId(
        'home-fan-club-post-p1-picker',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('home-fan-club-post-p2-picker')).toBeNull();
  });
});
