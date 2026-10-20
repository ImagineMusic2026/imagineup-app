import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
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
  isFollowing: false,
  isOwner: false,
  isMember: false,
  ...patch,
});

const post = (id: string, patch: Partial<FanClubPost> = {}): FanClubPost => ({
  id,
  clubId: 'fc-1',
  clubName: 'Nenho Sempre',
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
  postCount: 2,
  isFollowing: false,
  ...patch,
});

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

/** Nenhuma rota do fã-clube além do `GET /me/fan-club`. */
function expectOnlyTheGate(): void {
  const { fetchMyFanClub, ...others } = mocked;
  expect(fetchMyFanClub).toHaveBeenCalled();
  for (const [name, fn] of Object.entries(others)) {
    if (typeof fn !== 'function') continue;
    expect([name, jest.mocked(fn).mock.calls.length]).toEqual([name, 0]);
  }
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
  });
});

// --- A página pública -------------------------------------------------------------------

describe('a página do fã-clube (34.9, item 7)', () => {
  it('a faixa antes do nome, o gestor, o artista, os seguidores, o Destaque e as publicações', async () => {
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    expect(
      await screen.findByRole('header', { name: 'Fã-clube, não oficial. Nenho Sempre' }),
    ).toBeTruthy();
    expect(screen.getByText('feito por @thalitasan')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Central de Nenho' })).toBeTruthy();
    expect(screen.getByLabelText('41 seguidores. Em destaque.')).toBeTruthy();
    expect(screen.getByText('Você também entra na central de Nenho', hiddenOk)).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Seguir o fã-clube Nenho Sempre. Você também entra na central de Nenho',
      }),
    ).toBeTruthy();
    expect(screen.getByTestId('fan-club-post-p1')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Denunciar a publicação: Quem vai no show? Publicação p1',
      }),
    ).toBeTruthy();
    expect(mocked.fetchFanClub).toHaveBeenCalledWith('fc-1');
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

  it('o gestor vê "Seu fã-clube", sem Denunciar e sem o menu de bloquear', async () => {
    mocked.fetchFanClub.mockResolvedValue(page({ isOwner: true, isMember: true }));
    renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });

    expect(await screen.findByLabelText('Seu fã-clube, Nenho Sempre')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Denunciar/ })).toBeNull();
    expect(screen.queryByLabelText('Mais opções do fã-clube')).toBeNull();
    expect(screen.queryByText('Você também entra na central de Nenho', hiddenOk)).toBeNull();
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

    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Seguir o fã-clube Nenho Sempre. Você também entra na central de Nenho',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Seguindo o fã-clube Nenho Sempre' }),
    ).toBeTruthy();
    expect(mocked.followFanClub).toHaveBeenCalledWith({
      clubId: 'fc-1',
      idempotencyKey: expect.stringMatching(/^club-follow-/),
    });
    expect(screen.getByLabelText('42 seguidores. Em destaque.')).toBeTruthy();
    expect(screen.queryByText('Você também entra na central de Nenho', hiddenOk)).toBeNull();
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

    fireEvent.press(await screen.findByRole('button', { name: 'Seguir o fã-clube Nenho Sempre' }));
    expect(await screen.findByText('Não deu para seguir o fã-clube. Tente de novo.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Seguir o fã-clube Nenho Sempre' }));
    expect(
      await screen.findByText(
        'Você já segue 50 fã-clubes. Deixe de seguir algum para seguir este.',
      ),
    ).toBeTruthy();
    const [first, second] = mocked.followFanClub.mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(second).toBe(first);

    fireEvent.press(screen.getByRole('button', { name: 'Seguir o fã-clube Nenho Sempre' }));
    await screen.findByRole('button', { name: 'Seguindo o fã-clube Nenho Sempre' });
    expect(mocked.followFanClub.mock.calls[2]?.[0].idempotencyKey).not.toBe(first);
  });

  it('o limite de 50 mostra o atalho para "Fã-clubes que sigo"', async () => {
    mocked.followFanClub.mockRejectedValue(refused('follow_limit'));
    const view = renderRouter(appTree, { initialUrl: '/fa-clube/fc-1' });
    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Seguir o fã-clube Nenho Sempre. Você também entra na central de Nenho',
      }),
    );
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
    expect(
      await screen.findByRole('button', { name: 'Seguir o fã-clube Nenho Sempre' }),
    ).toBeTruthy();
    expect(screen.getByLabelText('40 seguidores. Em destaque.')).toBeTruthy();
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
});

// --- As listas ------------------------------------------------------------------------------

describe('"Fã-clubes que sigo" (34.9, item 10)', () => {
  it('o disponível abre a página; o indisponível aparece com o nome, quando há, e "Indisponível"', async () => {
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
        },
        {
          id: 'fc-2',
          name: 'Rock Raiz',
          artistId: 'rocksalles',
          artistName: 'Rock Salles',
          owner: null,
          followedAt: '2026-10-10T15:00:00.000Z',
          available: false,
        },
        {
          id: 'fc-3',
          name: null,
          artistId: 'nettobrito',
          artistName: 'Netto Brito',
          owner: null,
          followedAt: '2026-10-05T15:00:00.000Z',
          available: false,
        },
      ],
    });
    const view = renderRouter(appTree, { initialUrl: '/fa-clubes-que-sigo' });

    expect(await screen.findByLabelText('Nenho Sempre, fã-clube de Nenho.')).toBeTruthy();
    expect(screen.getByLabelText('Rock Raiz, fã-clube de Rock Salles. Indisponível.')).toBeTruthy();
    expect(
      screen.getByLabelText('Fã-clube indisponível, fã-clube de Netto Brito. Indisponível.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Nenho Sempre, fã-clube de Nenho.'));
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
        },
      ],
    });
    mocked.unfollowFanClub.mockResolvedValue({ clubId: 'fc-2', following: false });
    const view = renderRouter(appTree, { initialUrl: '/fa-clubes-que-sigo' });

    fireEvent.press(await screen.findByRole('button', { name: 'Deixar de seguir Rock Raiz' }));
    await waitFor(() => expect(view.getPathname()).toBe('/deixar-de-seguir/fc-2'));
    fireEvent.press(screen.getByTestId('fan-club-unfollow-confirm'));
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clubes-que-sigo'));
    expect(await screen.findByText('Você ainda não segue nenhum fã-clube.')).toBeTruthy();
    expect(mocked.fetchFollowedFanClubs).toHaveBeenCalledTimes(1);
  });
});

describe('o card da 1d e a lista do artista (34.9, item 8)', () => {
  it('até 3, com a faixa, e "Ver todos" abre a lista inteira na pilha da aba', async () => {
    mocked.fetchArtistFanClubs.mockResolvedValue({
      items: [
        card('a', { featured: true, isFollowing: true, followers: 4_800 }),
        card('b'),
        card('c', { followers: 1, postCount: 1 }),
        card('d'),
      ],
      nextCursor: null,
    });
    const view = renderRouter(appTree, { initialUrl: '/artista/nenho' });

    expect(await screen.findByTestId('artist-fan-clubs')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Fã-clube não oficial Fã-clube a, feito por @thalitasan. 4,8 mil seguidores. 2 publicações. Em destaque. Você segue.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Fã-clube não oficial Fã-clube c, feito por @thalitasan. 1 seguidor. 1 publicação.',
      ),
    ).toBeTruthy();
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
  it('só com publicação; a faixa e o nome abrem a página', async () => {
    mocked.fetchFanClubFeed.mockResolvedValue({ items: [post('p1')], nextCursor: null });
    const view = renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByText('Dos seus fã-clubes')).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Denunciar a publicação: Quem vai no show? Publicação p1',
      }),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'Fã-clube, não oficial. Nenho Sempre' }));
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

    const row = await screen.findByRole('button', {
      name: 'Fã-clubes que sigo. As publicações deles aparecem na sua Início',
    });
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
