import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDoc } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert, Share, Text, View, type AlertButton } from 'react-native';

import ArtistClubsRoute from '@/app/(tabs)/(inicio,explorar,ranking,perfil)/fa-clubes-do-artista/[artistaId]';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import FollowedRoute from '@/app/(tabs)/(perfil)/fa-clubes-que-sigo';
import UnfollowRoute from '@/app/deixar-de-seguir/[clubeId]';
import ReportFanRoute from '@/app/denunciar-perfil/[fanId]';
import ReportPostRoute from '@/app/denunciar-publicacao/[publicacaoId]';
import PageRoute from '@/app/fa-clube/[clubeId]';
import LeaveRoute from '@/app/sair-da-central/[artistaId]';
import {
  ArtistFanClubsCard,
  FanClubFeedSection,
  type FanClubCard,
  type FanClubPage,
  type FanClubPost,
  type MyFanClub,
  type MyFanClubClub,
} from '@/domains/fan-club';
import * as fanClubApi from '@/domains/fan-club/api';
import { useSessionGate } from '@/hooks/use-session-gate';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { queryClient } from '@/services/query';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// As telas da etapa 8 do fã-clube (seção 34, 34.9, itens 7 a 11): a página
// pública, o seguir e a sheet de deixar de seguir, a denúncia da publicação, o
// "Bloquear e denunciar" do gestor, "Fã-clubes que sigo", a lista do artista,
// o card da 1d, "Dos seus fã-clubes" da Início, a linha dos Ajustes e as frases
// da sheet "Sair da central". E a trava: com a `api` de antes da publicação (o
// 404 do `GET /me/fan-club`), nada aparece, e nenhuma outra rota do fã-clube é
// chamada. O card da 1d e a seção da Início entram em telas de teste, sem o
// resto da 1d e da Início.

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

/** Os guards do app, com as rotas desta etapa, e o cache do app. */
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
          <Stack.Screen name="denunciar-publicacao/[publicacaoId]" />
          <Stack.Screen name="deixar-de-seguir/[clubeId]" />
          <Stack.Screen name="denunciar-perfil/[fanId]" />
          <Stack.Screen name="sair-da-central/[artistaId]" />
          <Stack.Screen name="meu-fa-clube/index" />
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

/** A 1d de teste: só o card "Fã-clubes". */
function ArtistProbe() {
  const { artistaId = '' } = useLocalSearchParams<{ artistaId: string }>();
  return (
    <View>
      <Text>{`central ${artistaId}`}</Text>
      <ArtistFanClubsCard artistId={artistaId} artistName="Nenho" />
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
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  '(tabs)/(perfil)/fa-clubes-que-sigo': FollowedRoute,
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': ArtistProbe,
  '(tabs)/(inicio,explorar,ranking,perfil)/fa-clubes-do-artista/[artistaId]': ArtistClubsRoute,
  'fa/[fanId]': label('perfil público'),
  'fa-clube/[clubeId]': PageRoute,
  'denunciar-publicacao/[publicacaoId]': ReportPostRoute,
  'deixar-de-seguir/[clubeId]': UnfollowRoute,
  'denunciar-perfil/[fanId]': ReportFanRoute,
  'sair-da-central/[artistaId]': LeaveRoute,
  // O modo gestor, só como destino do "Gerenciar meu fã-clube" (34.24).
  'meu-fa-clube/index': label('meu fã-clube'),
};

// --- Os dados -------------------------------------------------------------------------

const PROGRAM = {
  open: true,
  rulesUrl: null,
  rulesVersion: 'termos-2026-10',
  notice: null,
} as const;

const mine = (patch: Partial<MyFanClub> = {}): MyFanClub => ({
  ...PROGRAM,
  application: null,
  club: null,
  ...patch,
});

const ownClub = (patch: Partial<MyFanClubClub> = {}): MyFanClubClub => ({
  id: 'fc-camila',
  name: 'Netto de Coração',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  status: 'active',
  postCount: 2,
  pendingPosts: 0,
  photosAllowed: true,
  featuredUntil: null,
  official: false,
  lastReward: null,
  available: true,
  unavailableReason: null,
  rulesOutdated: false,
  ...patch,
});

/** A Camila gestora do fã-clube do Netto. */
const manager = mine({
  application: {
    status: 'approved',
    artistId: 'nettobrito',
    artistName: 'Netto Brito',
    proposedName: 'Netto de Coração',
    round: 1,
    submittedAt: '2026-10-01T15:00:00.000Z',
    rejectReason: null,
    canReapplyAt: null,
    canApply: false,
    history: [],
  },
  club: ownClub(),
});

const OWNER = { uid: 'fa-thalita', name: 'Thalita Santos', username: 'thalitasan', photoURL: null };

const page = (patch: Partial<FanClubPage> = {}): FanClubPage => ({
  id: 'fc-1',
  name: 'Nenho Sempre',
  artist: { id: 'nenho', name: 'Nenho', shortName: null, thumbUrl: null },
  owner: OWNER,
  followerCount: 41,
  postCount: 2,
  featured: true,
  official: false,
  isFollowing: false,
  isOwner: false,
  isMember: false,
  ...patch,
});

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
  ...patch,
});

const card = (id: string, patch: Partial<FanClubCard> = {}): FanClubCard => ({
  id,
  name: `Fã-clube ${id}`,
  owner: OWNER,
  followers: 41,
  featured: false,
  official: false,
  postCount: 2,
  isFollowing: false,
  ...patch,
});

/**
 * O rótulo do seguir, com o aviso de membro (seção 37, "Estado"): para quem
 * já é da central e para quem entra junto.
 */
const MEMBER_NOTICE = 'O gestor do fã-clube vê que você é membro';
const FOLLOW_LABEL = `Seguir o fã-clube Nenho Sempre. ${MEMBER_NOTICE}`;
const FOLLOW_JOIN_LABEL = `Seguir o fã-clube Nenho Sempre. Você também entra na central de Nenho. ${MEMBER_NOTICE}`;

const routeMissing = () => new ApiError('notFound', 'Não encontrado.', 404, 'not_found');
const clubGone = () =>
  new ApiError('notFound', 'Este fã-clube não está disponível.', 404, 'fan_club_not_found');
const offline = () => new ApiError('network', 'Sem rede.');
const refused = (reason: string) =>
  new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason });

/** O perfil do Firestore, para os Ajustes. */
function profileSnapshot() {
  return {
    exists: () => true,
    data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib' }),
    metadata: { fromCache: false },
  };
}

/** As rotas de fora do fã-clube que as telas tocam: o convite e o bloqueio. */
function serverAnswers(): void {
  jest.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/me/invite') {
      return Promise.resolve({
        data: { code: 'CAMILA12', linkBase: 'https://imagineup.app', pointsPerVisit: 2 },
      });
    }
    return Promise.reject(new Error(`rota inesperada: ${url}`));
  });
  jest.mocked(api.put).mockImplementation((url: string) => {
    if (url.startsWith('/me/blocks/')) {
      return Promise.resolve({ data: { fanId: url.split('/').pop(), blocked: true } });
    }
    return Promise.resolve({ data: { linkId: 'fanclub:fc-1', created: true } });
  });
}

/** Nenhuma rota do fã-clube além do `GET /me/fan-club`, nem o convite do compartilhar. */
function expectOnlyTheGate(): void {
  const { fetchMyFanClub, ...others } = mocked;
  expect(fetchMyFanClub).toHaveBeenCalled();
  for (const [name, fn] of Object.entries(others)) {
    if (typeof fn !== 'function') continue;
    expect([name, jest.mocked(fn).mock.calls.length]).toEqual([name, 0]);
  }
  expect(api.get).not.toHaveBeenCalled();
}

const announced = () => [
  ...jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text),
  ...jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text),
];

/** Os textos fora do leitor (a linha da central, que vai no rótulo do botão). */
const hiddenOk = { includeHiddenElements: true } as const;

/** O `Alert` de confirmação aperta o botão destrutivo. */
function confirmAlerts(): void {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // A resposta que um teste deixou no fã-clube e na `api` não passa ao seguinte
  // (o `resetAllMocks` apagaria também as fábricas e o setup do Jest).
  for (const fn of Object.values(mocked)) if (typeof fn === 'function') jest.mocked(fn).mockReset();
  for (const fn of Object.values(api)) jest.mocked(fn).mockReset();
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
  jest.mocked(getDoc).mockResolvedValue(profileSnapshot() as never);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  serverAnswers();
  mocked.fetchMyFanClub.mockResolvedValue(mine());
  mocked.fetchFanClub.mockResolvedValue(page());
  mocked.fetchFanClubPosts.mockResolvedValue({ items: [post('p1'), post('p2')], nextCursor: null });
  mocked.fetchFanClubFeed.mockResolvedValue({ items: [], nextCursor: null });
  mocked.fetchArtistFanClubs.mockResolvedValue({ items: [], nextCursor: null });
  mocked.fetchFollowedFanClubs.mockResolvedValue({ items: [] });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

// --- A trava antes da abertura ----------------------------------------------------------

describe('antes da abertura (o 404 da api de antes), nada aparece e nada mais é chamado', () => {
  it.each(['/fa-clube/fc-1', '/fa-clubes-que-sigo', '/fa-clubes-do-artista/nenho'])(
    '%s a frio diz que o fã-clube não está disponível',
    async (url) => {
      mocked.fetchMyFanClub.mockRejectedValue(routeMissing());
      renderRouter(appTree, { initialUrl: url });

      expect(await screen.findByText('O fã-clube não está disponível agora.')).toBeTruthy();
      expectOnlyTheGate();
    },
  );

  it.each(['/denunciar-publicacao/p1', '/deixar-de-seguir/fc-1'])(
    '%s a frio fecha, sem nada no cache, e não denuncia nem deixa de seguir',
    async (url) => {
      mocked.fetchMyFanClub.mockRejectedValue(routeMissing());
      const view = renderRouter(appTree, { initialUrl: url });

      await waitFor(() => expect(view.getPathname()).toBe('/'));
      await act(async () => undefined);
      expect(mocked.reportFanClubPost).not.toHaveBeenCalled();
      expect(mocked.unfollowFanClub).not.toHaveBeenCalled();
      expectOnlyTheGate();
    },
  );

  it('a Início, a 1d, os Ajustes e a sheet de sair ficam como eram', async () => {
    mocked.fetchMyFanClub.mockRejectedValue(routeMissing());
    renderRouter(appTree, { initialUrl: '/' });
    expect(await screen.findByText('home')).toBeTruthy();
    await waitFor(() => expect(mocked.fetchMyFanClub).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId('home-fan-club-feed')).toBeNull();

    act(() => router.push('/artista/nenho'));
    expect(await screen.findByText('central nenho')).toBeTruthy();
    expect(screen.queryByTestId('artist-fan-clubs')).toBeNull();

    act(() => router.push('/sair-da-central/nenho'));
    expect(await screen.findByText('Sair da central?')).toBeTruthy();
    expect(
      screen.queryByText('Você também deixa de seguir os fã-clubes deste artista.'),
    ).toBeNull();
    expectOnlyTheGate();
    // A recusa definitiva não é perguntada de novo a cada tela que monta.
    expect(mocked.fetchMyFanClub).toHaveBeenCalledTimes(1);

    // Os Ajustes perguntam de novo a cada abertura (etapa 7), e o 404 não mostra nada.
    act(() => router.back());
    act(() => router.push('/ajustes'));
    expect(await screen.findByRole('header', { name: 'Ajustes' })).toBeTruthy();
    await waitFor(() => expect(mocked.fetchMyFanClub).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(screen.queryByTestId('settings-fan-club-follows')).toBeNull();
    expect(screen.queryByText('Fã-clubes que sigo')).toBeNull();
    expectOnlyTheGate();
  });
});

// --- A página pública -------------------------------------------------------------------

describe('a página do fã-clube (34.9, item 7)', () => {
  it('o nome sem rótulo de não oficial, o gestor, o Destaque e as publicações, sem os números', async () => {
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const header = await screen.findByRole('header', { name: 'Nenho Sempre' });
    expect(within(header).queryByTestId('fan-club-official-badge', hiddenOk)).toBeNull();
    expect(screen.queryByText(/não oficia/iu, hiddenOk)).toBeNull();
    expect(screen.queryByLabelText(/não oficia/iu, hiddenOk)).toBeNull();
    expect(screen.getByText('feito por @thalitasan')).toBeTruthy();
    // 34.24: o gestor numa linha só. A linha "Fã-clube de" e os números de
    // seguidores e de publicações saíram a pedido do dono (27/10/2026).
    expect(screen.queryByText(/^Fã-clube de/u, hiddenOk)).toBeNull();
    expect(screen.queryByTestId('fan-club-page-artist', hiddenOk)).toBeNull();
    expect(screen.getByRole('link', { name: 'Feito por @thalitasan' })).toBeTruthy();
    expect(screen.queryByText(/seguidor/u, hiddenOk)).toBeNull();
    expect(screen.queryByLabelText(/seguidor/u, hiddenOk)).toBeNull();
    expect(screen.queryByLabelText(/^\d+ publicaç/u, hiddenOk)).toBeNull();
    // Quem visita não tem a engrenagem do gestor.
    expect(screen.queryByLabelText('Gerenciar meu fã-clube', hiddenOk)).toBeNull();
    expect(screen.getByLabelText('Em destaque.')).toBeTruthy();
    // Sem prêmio e sem pontos (decisão 48).
    expect(screen.queryByText(/prêmio|pontos/iu, hiddenOk)).toBeNull();
    expect(screen.getByText('Você também entra na central de Nenho', hiddenOk)).toBeTruthy();
    // O aviso de membro antes de seguir (seção 37, "Estado"): à vista, e no rótulo do botão.
    expect(screen.getByText('O gestor do fã-clube vê que você é membro.', hiddenOk)).toBeTruthy();
    expect(screen.queryByText('O gestor do fã-clube vê que você é membro.')).toBeNull();
    expect(screen.getByRole('button', { name: FOLLOW_JOIN_LABEL })).toBeTruthy();
    expect(screen.getByTestId('fan-club-post-p1')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Denunciar a publicação: Quem vai no show? Publicação p1',
      }),
    ).toBeTruthy();
    expect(mocked.fetchFanClub).toHaveBeenCalledWith('fc-1');
  });

  it('oficializado pela equipe (34.23): o selo ao lado do nome, e o leitor ouve "fã-clube oficial"', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ official: true }));
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const header = await screen.findByRole('header', { name: 'Nenho Sempre, fã-clube oficial' });
    expect(within(header).getByTestId('fan-club-official-badge', hiddenOk)).toBeTruthy();
  });

  it('o rótulo da publicação: o ponto depois do texto só quando ele não termina em "?" ou "!"', async () => {
    // Visto no emulador Android na conferência da etapa 10 de 34.14: o texto
    // do fã que terminava em "?" saía "Irará?. Com foto." no leitor de tela.
    mocked.fetchFanClubPosts.mockResolvedValue({
      items: [
        post('p1', { text: 'Quem vem com a gente?' }),
        post('p2', { text: 'Bora assistir juntos', kind: 'photo' }),
      ],
      nextCursor: null,
    });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    expect(await screen.findByLabelText(/^Quem vem com a gente\? Publicado /u)).toBeTruthy();
    expect(screen.getByLabelText(/^Bora assistir juntos\. Com foto\. Publicado /u)).toBeTruthy();
    expect(screen.queryByLabelText(/[?!.]\. /u)).toBeNull();
  });

  it('"feito por @gestor" abre o perfil público dele', async () => {
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });
    fireEvent.press(await screen.findByText('feito por @thalitasan'));
    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-thalita'));
  });

  it('o fã-clube que saiu do ar (ou de gestor bloqueado) dá "Este fã-clube não está disponível."', async () => {
    mocked.fetchFanClub.mockRejectedValue(clubGone());
    mocked.fetchFanClubPosts.mockRejectedValue(clubGone());
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });
    expect(await screen.findByText('Este fã-clube não está disponível.')).toBeTruthy();
    expect(announced()).toContain('Este fã-clube não está disponível.');
  });

  it('o gestor vê a engrenagem "Gerenciar meu fã-clube" no cabeçalho, sem Denunciar, sem o menu de bloquear e sem o seguir', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isOwner: true, isMember: true }));
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    const manage = await screen.findByRole('button', { name: 'Gerenciar meu fã-clube' });
    // Pedido do dono (27/10/2026): um ícone ao lado do compartilhar, e não o
    // botão largo com o texto embaixo dos números.
    expect(screen.getByTestId('fan-club-manage')).toBe(manage);
    expect(screen.queryByText('Gerenciar meu fã-clube', hiddenOk)).toBeNull();
    // No cabeçalho, à esquerda do compartilhar: o leitor ouve o voltar, a
    // engrenagem e o compartilhar, nessa ordem, antes do topo da página.
    expect(
      screen
        .getAllByRole('button')
        .slice(0, 3)
        .map((button) => button.props.accessibilityLabel),
    ).toEqual(['Voltar', 'Gerenciar meu fã-clube', 'Compartilhar o fã-clube']);
    expect(manage.props.accessibilityHint).toBe('Abre o modo gestor do seu fã-clube');
    expect(screen.queryByTestId('fan-club-follow', hiddenOk)).toBeNull();
    expect(screen.queryByRole('button', { name: /Denunciar/ })).toBeNull();
    expect(screen.queryByLabelText('Mais opções do fã-clube')).toBeNull();
    expect(screen.queryByText('Você também entra na central de Nenho', hiddenOk)).toBeNull();
    // Aberta a frio, sem o modo gestor embaixo: o "Meu fã-clube" toma o lugar dela.
    fireEvent.press(manage);
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    expect(screen.getByText('meu fã-clube')).toBeTruthy();
  });

  it('vindo do modo gestor, "Gerenciar meu fã-clube" fecha a página e volta a ele', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isOwner: true, isMember: true }));
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });
    act(() => router.push('/fa-clube/fc-1'));

    fireEvent.press(await screen.findByRole('button', { name: 'Gerenciar meu fã-clube' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    expect(router.canGoBack()).toBe(false);
  });

  it('na lista vazia, o gestor lê que as publicações dele aparecem quando a equipe aprova', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isOwner: true, isMember: true, postCount: 0 }));
    mocked.fetchFanClubPosts.mockResolvedValue({ items: [], nextCursor: null });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    expect(
      await screen.findByText('Suas publicações aparecem aqui quando a equipe aprova.'),
    ).toBeTruthy();
    expect(screen.queryByText('Ainda não há publicações no ar.')).toBeNull();
  });

  it('quem visita, na lista vazia, continua lendo que não há publicações no ar', async () => {
    mocked.fetchFanClubPosts.mockResolvedValue({ items: [], nextCursor: null });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    expect(await screen.findByText('Ainda não há publicações no ar.')).toBeTruthy();
    expect(screen.queryByText('Suas publicações aparecem aqui quando a equipe aprova.')).toBeNull();
  });
});

describe('seguir (decisão 26)', () => {
  it('o seguir que faz a entrada: "Seguindo", o número sobe, e o fã ouve que seguiu e entrou', async () => {
    // O servidor depois do seguir: a entrada busca as páginas de novo.
    let followed = false;
    mocked.fetchFanClub.mockImplementation(() =>
      Promise.resolve(
        followed ? page({ isFollowing: true, isMember: true, followerCount: 42 }) : page(),
      ),
    );
    mocked.followFanClub.mockImplementation(() => {
      followed = true;
      return Promise.resolve({ clubId: 'fc-1', following: true, joined: true, pointsAwarded: 10 });
    });
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(await screen.findByRole('button', { name: FOLLOW_JOIN_LABEL }));
    expect(
      await screen.findByRole('button', { name: 'Seguindo o fã-clube Nenho Sempre' }),
    ).toBeTruthy();
    expect(mocked.followFanClub).toHaveBeenCalledWith({
      clubId: 'fc-1',
      idempotencyKey: expect.stringMatching(/^club-follow-/),
    });
    expect(screen.queryByText('Você também entra na central de Nenho', hiddenOk)).toBeNull();
    // O aviso de membro é do "Seguir": com "Seguindo", sai.
    expect(screen.queryByTestId('fan-club-member-notice', hiddenOk)).toBeNull();
    expect(announced()).toEqual(
      expect.arrayContaining([
        'Você está seguindo o fã-clube Nenho Sempre.',
        'Você entrou na central de Nenho.',
      ]),
    );
  });

  it('depois de uma falha incerta, a mesma chave; depois de uma recusa, chave nova', async () => {
    mocked.followFanClub
      .mockRejectedValueOnce(offline())
      .mockRejectedValueOnce(refused('follow_limit'))
      .mockResolvedValueOnce({ clubId: 'fc-1', following: true, joined: false, pointsAwarded: 0 });
    mocked.fetchFanClub.mockResolvedValue(page({ isMember: true }));
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(await screen.findByRole('button', { name: FOLLOW_LABEL }));
    expect(await screen.findByText('Não deu para seguir o fã-clube. Tente de novo.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: FOLLOW_LABEL }));
    expect(
      await screen.findByText(
        'Você já segue 50 fã-clubes. Deixe de seguir algum para seguir este.',
      ),
    ).toBeTruthy();
    const [first, second] = mocked.followFanClub.mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(second).toBe(first);

    fireEvent.press(screen.getByRole('button', { name: FOLLOW_LABEL }));
    await screen.findByRole('button', { name: 'Seguindo o fã-clube Nenho Sempre' });
    expect(mocked.followFanClub.mock.calls[2]?.[0].idempotencyKey).not.toBe(first);
  });

  it('a falha incerta que gravou: "Seguindo" sem o aviso, e o seguir depois de deixar de seguir leva chave nova', async () => {
    // O servidor: grava o seguir e perde a resposta; depois, o deixar de seguir.
    let following = false;
    mocked.fetchFanClub.mockImplementation(() =>
      Promise.resolve(page({ isMember: true, isFollowing: following })),
    );
    mocked.followFanClub
      .mockImplementationOnce(() => {
        following = true;
        return Promise.reject(offline());
      })
      .mockResolvedValueOnce({ clubId: 'fc-1', following: true, joined: false, pointsAwarded: 0 });
    mocked.unfollowFanClub.mockImplementation(() => {
      following = false;
      return Promise.resolve({ clubId: 'fc-1', following: false });
    });
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(await screen.findByRole('button', { name: FOLLOW_LABEL }));
    // A página busca de novo e diz "Seguindo"; o aviso da falha sai.
    const followingButton = await screen.findByRole('button', {
      name: 'Seguindo o fã-clube Nenho Sempre',
    });
    expect(screen.queryByText('Não deu para seguir o fã-clube. Tente de novo.')).toBeNull();
    fireEvent.press(followingButton);
    await waitFor(() => expect(view.getPathname()).toBe('/deixar-de-seguir/fc-1'));
    fireEvent.press(screen.getByTestId('fan-club-unfollow-confirm'));
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/fc-1'));

    fireEvent.press(await screen.findByRole('button', { name: FOLLOW_LABEL }));
    await screen.findByRole('button', { name: 'Seguindo o fã-clube Nenho Sempre' });
    const [first, second] = mocked.followFanClub.mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(second).not.toBe(first);
  });

  it('o limite de 50 mostra o atalho para "Fã-clubes que sigo"', async () => {
    mocked.followFanClub.mockRejectedValue(refused('follow_limit'));
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });
    fireEvent.press(await screen.findByRole('button', { name: FOLLOW_JOIN_LABEL }));
    fireEvent.press(await screen.findByText('Ver fã-clubes que sigo'));
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clubes-que-sigo'));
  });

  it('"Seguindo" abre a sheet "Deixar de seguir?"; confirmar volta a "Seguir" sem sair da central', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isFollowing: true, isMember: true }));
    mocked.unfollowFanClub.mockResolvedValue({ clubId: 'fc-1', following: false });
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(
      await screen.findByRole('button', { name: 'Seguindo o fã-clube Nenho Sempre' }),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/deixar-de-seguir/fc-1'));
    expect(
      screen.getByText(
        'As publicações dele saem da sua Início. Você continua na central de Nenho.',
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-unfollow-confirm'));

    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/fc-1'));
    expect(mocked.unfollowFanClub).toHaveBeenCalledWith({
      clubId: 'fc-1',
      idempotencyKey: expect.stringMatching(/^club-unfollow-/),
    });
    expect(await screen.findByRole('button', { name: FOLLOW_LABEL })).toBeTruthy();
    expect(announced()).toContain('Você deixou de seguir o fã-clube Nenho Sempre.');
  });

  it('deixar de seguir depois de uma falha incerta leva a mesma chave', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isFollowing: true, isMember: true }));
    mocked.unfollowFanClub
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ clubId: 'fc-1', following: false });
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(
      await screen.findByRole('button', { name: 'Seguindo o fã-clube Nenho Sempre' }),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/deixar-de-seguir/fc-1'));
    fireEvent.press(screen.getByTestId('fan-club-unfollow-confirm'));
    expect(await screen.findByText('Não deu para deixar de seguir. Tente de novo.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-unfollow-confirm'));
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/fc-1'));
    const [first, second] = mocked.unfollowFanClub.mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(second).toBe(first);
  });
});

describe('a denúncia da publicação (decisão 18)', () => {
  it('com o motivo de imagem: fecha e anuncia; a nova tentativa depois de uma falha incerta leva a mesma chave', async () => {
    mocked.reportFanClubPost
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ postId: 'p1', status: 'reported' });
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Denunciar a publicação: Quem vai no show? Publicação p1',
      }),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/denunciar-publicacao/p1'));
    fireEvent.press(screen.getByRole('button', { name: 'Uso indevido de imagem' }));
    fireEvent.press(screen.getByTestId('fan-club-report-submit'));
    expect(await screen.findByText('Não deu para enviar a denúncia. Tente de novo.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-report-submit'));

    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/fc-1'));
    const calls = mocked.reportFanClubPost.mock.calls.map(([vars]) => vars);
    expect(calls).toEqual([
      {
        postId: 'p1',
        reason: 'image_misuse',
        idempotencyKey: expect.stringMatching(/^club-report-p1-/),
      },
      { postId: 'p1', reason: 'image_misuse', idempotencyKey: calls[0]?.idempotencyKey },
    ]);
    expect(announced()).toContain('Denúncia enviada. A equipe vai analisar.');
  });
});

describe('"Bloquear e denunciar" o gestor (decisões 19 e 32)', () => {
  it('confirma, bloqueia, some com o fã-clube e abre a denúncia de perfil com o nome do gestor', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isFollowing: true, isMember: true }));
    confirmAlerts();
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(await screen.findByLabelText('Mais opções do fã-clube'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Bloquear e denunciar @thalitasan?',
      expect.stringContaining('Você deixa de seguir este fã-clube'),
      expect.any(Array),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/denunciar-perfil/fa-thalita'));
    expect(api.put).toHaveBeenCalledWith('/me/blocks/fa-thalita', undefined, expect.any(Object));
    expect(screen.getByText('Denunciar Thalita Santos')).toBeTruthy();
    expect(announced()).toContain('Você bloqueou @thalitasan e deixou de seguir o fã-clube.');
    // O que os fãs veem dos fã-clubes busca de novo (o bloqueado some).
    await waitFor(() => expect(mocked.fetchFanClub).toHaveBeenCalledTimes(2));

    act(() => router.back());
    expect(
      await screen.findByText(
        'Você bloqueou @thalitasan. Este fã-clube não aparece mais para você.',
      ),
    ).toBeTruthy();
  });

  it('quem não segue não ouve que deixou de seguir (só quem segue deixa, decisão 32)', async () => {
    confirmAlerts();
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    fireEvent.press(await screen.findByLabelText('Mais opções do fã-clube'));
    const message = jest.mocked(Alert.alert).mock.calls[0]?.[1];
    expect(message).toContain('Você para de ver o fã-clube e as publicações de @thalitasan.');
    expect(message).not.toContain('deixa de seguir');
    await waitFor(() => expect(view.getPathname()).toBe('/denunciar-perfil/fa-thalita'));
    expect(announced()).toContain('Você bloqueou @thalitasan.');
    expect(announced().join(' ')).not.toContain('deixou de seguir');
  });
});

// --- As listas ------------------------------------------------------------------------------

describe('"Fã-clubes que sigo" (34.9, item 10)', () => {
  it('o disponível abre a página, com o selo do oficial; o indisponível aparece com o nome, quando há, e "Indisponível", sem o selo', async () => {
    mocked.fetchFollowedFanClubs.mockResolvedValue({
      items: [
        {
          id: 'fc-1',
          name: 'Nenho Sempre',
          artistId: 'nenho',
          artistName: 'Nenho',
          owner: OWNER,
          followedAt: '2026-10-15T15:00:00.000Z',
          available: true,
          official: true,
        },
        {
          id: 'fc-2',
          name: 'Rock Raiz',
          artistId: 'rocksalles',
          artistName: 'Rock Salles',
          owner: null,
          followedAt: '2026-10-10T15:00:00.000Z',
          available: false,
          official: false,
        },
        {
          id: 'fc-3',
          name: null,
          artistId: 'nettobrito',
          artistName: 'Netto Brito',
          owner: null,
          followedAt: '2026-10-05T15:00:00.000Z',
          available: false,
          official: false,
        },
      ],
    });
    const view = renderRouter(appTree, { initialUrl: '/fa-clubes-que-sigo' });

    const official = await screen.findByLabelText('Nenho Sempre, fã-clube oficial de Nenho.');
    expect(within(official).getByTestId('fan-club-official-badge', hiddenOk)).toBeTruthy();
    const unavailable = screen.getByLabelText('Rock Raiz, fã-clube de Rock Salles. Indisponível.');
    expect(within(unavailable).queryByTestId('fan-club-official-badge', hiddenOk)).toBeNull();
    expect(
      screen.getByLabelText('Fã-clube indisponível, fã-clube de Netto Brito. Indisponível.'),
    ).toBeTruthy();
    fireEvent.press(official);
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/fc-1'));
  });

  it('o "Deixar de seguir" da linha abre a sheet, e a linha sai sem buscar a lista de novo', async () => {
    mocked.fetchFollowedFanClubs.mockResolvedValue({
      items: [
        {
          id: 'fc-2',
          name: 'Rock Raiz',
          artistId: 'rocksalles',
          artistName: 'Rock Salles',
          owner: null,
          followedAt: '2026-10-10T15:00:00.000Z',
          available: false,
          official: false,
        },
      ],
    });
    mocked.unfollowFanClub.mockResolvedValue({ clubId: 'fc-2', following: false });
    const view = renderRouter(appTree, { initialUrl: '/fa-clubes-que-sigo' });

    fireEvent.press(
      await screen.findByRole('button', { name: 'Deixar de seguir Rock Raiz, de Rock Salles' }),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/deixar-de-seguir/fc-2'));
    fireEvent.press(screen.getByTestId('fan-club-unfollow-confirm'));
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clubes-que-sigo'));
    expect(await screen.findByText('Você ainda não segue nenhum fã-clube.')).toBeTruthy();
    // O título do vazio já termina em ponto: o rótulo não leva outro.
    expect(
      screen.getByLabelText(
        'Você ainda não segue nenhum fã-clube. Os fã-clubes ficam na página de cada artista.',
      ),
    ).toBeTruthy();
    expect(mocked.fetchFollowedFanClubs).toHaveBeenCalledTimes(1);
  });
});

describe('o card da 1d e a lista do artista (34.9, item 8)', () => {
  it('até 3, o oficial com o selo, sem "não oficial", e "Ver todos" abre a lista inteira na pilha da aba', async () => {
    mocked.fetchArtistFanClubs.mockResolvedValue({
      items: [
        card('a', { featured: true, isFollowing: true, followers: 4_800, official: true }),
        card('b'),
        card('c', { followers: 1, postCount: 1 }),
        card('d'),
      ],
      nextCursor: null,
    });
    const view = renderRouter(appTree, { initialUrl: '/artista/nenho' });

    expect(await screen.findByTestId('artist-fan-clubs')).toBeTruthy();
    const official = screen.getByLabelText(
      'Fã-clube a, fã-clube oficial, feito por @thalitasan. 4,8 mil seguidores. 2 publicações. Em destaque. Você segue.',
    );
    expect(within(official).getByTestId('fan-club-official-badge', hiddenOk)).toBeTruthy();
    const other = screen.getByLabelText(
      'Fã-clube c, feito por @thalitasan. 1 seguidor. 1 publicação.',
    );
    expect(within(other).queryByTestId('fan-club-official-badge', hiddenOk)).toBeNull();
    expect(
      within(screen.getByTestId('artist-fan-clubs')).queryByText(/não oficia/iu, hiddenOk),
    ).toBeNull();
    expect(screen.queryByTestId('artist-fan-club-d')).toBeNull();
    expect(mocked.fetchArtistFanClubs).toHaveBeenCalledWith('nenho', null);

    fireEvent.press(screen.getByLabelText('Ver todos os fã-clubes de Nenho'));
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clubes-do-artista/nenho'));
    expect(await screen.findByTestId('artist-fan-club-d')).toBeTruthy();
  });

  it('sem fã-clube, o card some', async () => {
    renderRouter(appTree, { initialUrl: '/artista/nenho' });
    expect(await screen.findByText('central nenho')).toBeTruthy();
    await waitFor(() => expect(mocked.fetchArtistFanClubs).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId('artist-fan-clubs')).toBeNull();
  });
});

describe('"Dos seus fã-clubes" na Início (34.9, item 9)', () => {
  it('só com publicação; o nome, com o selo do oficial, abre a página', async () => {
    mocked.fetchFanClubFeed.mockResolvedValue({
      items: [
        post('p1', { clubOfficial: true }),
        post('p2', { clubId: 'fc-2', clubName: 'Rock Raiz' }),
      ],
      nextCursor: null,
    });
    const view = renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByText('Dos seus fã-clubes')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Denunciar a publicação: Quem vai no show? Publicação p1',
      }),
    ).toBeTruthy();
    const official = screen.getByRole('link', { name: 'Nenho Sempre, fã-clube oficial' });
    expect(within(official).getByTestId('fan-club-official-badge', hiddenOk)).toBeTruthy();
    const other = screen.getByRole('link', { name: 'Rock Raiz' });
    expect(within(other).queryByTestId('fan-club-official-badge', hiddenOk)).toBeNull();
    fireEvent.press(official);
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/fc-1'));
  });

  it('sem publicação, a seção não aparece', async () => {
    renderRouter(appTree, { initialUrl: '/' });
    await waitFor(() => expect(mocked.fetchFanClubFeed).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId('home-fan-club-feed')).toBeNull();
  });
});

// --- Os Ajustes e a sheet de sair ------------------------------------------------------------

describe('a linha "Fã-clubes que sigo" dos Ajustes (34.9, itens 1 e 10)', () => {
  it('fica também com o programa fechado (os fã-clubes que existem continuam) e abre a lista', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ open: false }));
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    const row = await screen.findByRole('button', { name: 'Fã-clubes que sigo' });
    expect(screen.queryByTestId('settings-fan-club')).toBeNull();
    fireEvent.press(row);
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clubes-que-sigo'));
  });
});

describe('a sheet "Sair da central" (34.9, item 11)', () => {
  it('diz que o fã deixa de seguir os fã-clubes do artista', async () => {
    renderRouter(appTree, { initialUrl: '/sair-da-central/nenho' });
    expect(
      await screen.findByText('Você também deixa de seguir os fã-clubes deste artista.'),
    ).toBeTruthy();
    expect(
      screen.queryByText('Seu fã-clube fica sem publicar até você voltar à central.'),
    ).toBeNull();
  });

  it('o gestor de um fã-clube do artista ouve que o fã-clube fica sem publicar', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager);
    renderRouter(appTree, { initialUrl: '/sair-da-central/nettobrito' });
    expect(
      await screen.findByText('Seu fã-clube fica sem publicar até você voltar à central.'),
    ).toBeTruthy();
  });
});
