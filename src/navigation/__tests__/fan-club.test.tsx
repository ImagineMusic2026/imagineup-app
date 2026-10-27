import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';
import { getDoc } from 'firebase/firestore';
import type { ReactNode } from 'react';
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  Dimensions,
  Platform,
  Share,
  Text,
  type AlertButton,
} from 'react-native';

import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import ApplyRoute from '@/app/meu-fa-clube/candidatura';
import MyFanClubRoute from '@/app/meu-fa-clube/index';
import NewPostRoute from '@/app/meu-fa-clube/nova-publicacao';
import RulesRoute from '@/app/meu-fa-clube/regras';
import * as fanClubApi from '@/domains/fan-club/api';
import type {
  FanClubApplication,
  MyFanClub,
  MyFanClubClub,
  OwnFanClubPost,
} from '@/domains/fan-club';
import { profileKeys } from '@/domains/profile';
import { pickPhoto, prepareFanClubPhoto } from '@/domains/profile/photo';
import { useSessionGate } from '@/hooks/use-session-gate';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { queryClient } from '@/services/query';
import { haptics } from '@/services/haptics';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// As telas da etapa 7 do fã-clube (seção 34, 34.9, itens 1 a 6): o bloco dos
// Ajustes, a apresentação, a candidatura, os estados, o "Meu fã-clube" e a
// nova publicação, com o `api.ts` do domínio mockado (o molde da 34.22, etapa
// 6: as fixtures só alcançam a gestora aprovada). E a inércia antes da
// abertura: com a `api` de antes da publicação, nada aparece e nenhuma outra
// rota é chamada. As rotas novas também ficam aqui, dentro dos guards, para
// não tocar nos testes de guards e de Ajustes que o PR #25 muda.

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
jest.mock('@/domains/profile/photo', () => ({
  ...jest.requireActual('@/domains/profile/photo'),
  pickPhoto: jest.fn(),
  prepareFanClubPhoto: jest.fn(),
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item
// nenhum (as Publicações do modo gestor, 34.24).
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

const mocked = jest.mocked(fanClubApi);

/** Os guards do app e o cache do app. */
function RootLayout() {
  const { signedIn, onboarded } = useSessionGate();
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !onboarded}>
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="editar-perfil" />
          <Stack.Screen name="meu-fa-clube/index" />
          <Stack.Screen name="meu-fa-clube/candidatura" />
          <Stack.Screen name="meu-fa-clube/nova-publicacao" />
          <Stack.Screen name="meu-fa-clube/regras" />
          <Stack.Screen name="fa-clube/[clubeId]" />
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
  '(onboarding)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(onboarding)/artistas': label('onboarding'),
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
  '(tabs)/(ranking)/recompensas': label('loja'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  'editar-perfil': label('editar perfil'),
  'meu-fa-clube/index': MyFanClubRoute,
  'meu-fa-clube/candidatura': ApplyRoute,
  'meu-fa-clube/nova-publicacao': NewPostRoute,
  'meu-fa-clube/regras': RulesRoute,
  // A página pública, só como destino do olho do modo gestor (34.24).
  'fa-clube/[clubeId]': label('página do fã-clube'),
};

/**
 * Uma aba da barra do modo gestor: "button" no iOS, "tab" no Android, como a
 * do app. Pelo rótulo exato: o nome do `getByRole` casa também com o texto de
 * dentro, e o card de atalho do Painel tem o título "Publicações".
 */
const managerTab = (name: string) => {
  const role = Platform.OS === 'ios' ? 'button' : 'tab';
  const found = screen
    .getAllByRole(role, { name })
    .filter((node) => node.props.accessibilityLabel === name);
  expect(found).toHaveLength(1);
  return found[0]!;
};

// --- Os dados -------------------------------------------------------------------------

const PROGRAM = {
  open: true,
  rulesUrl: null,
  rulesVersion: 'termos-2026-10',
  notice: 'A equipe pode reconhecer os fã-clubes, a critério da equipe.',
} as const;

const application = (patch: Partial<FanClubApplication> = {}): FanClubApplication => ({
  status: 'pending',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  proposedName: 'Netto de Coração',
  round: 1,
  submittedAt: '2026-10-18T15:00:00.000Z',
  rejectReason: null,
  canReapplyAt: null,
  canApply: false,
  history: [],
  ...patch,
});

const club = (patch: Partial<MyFanClubClub> = {}): MyFanClubClub => ({
  id: 'fc-1',
  name: 'Netto de Coração',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  status: 'active',
  postCount: 2,
  pendingPosts: 1,
  photosAllowed: true,
  featuredUntil: null,
  official: false,
  lastReward: { at: '2026-10-18T15:00:00.000Z', points: 200, prize: true },
  available: true,
  unavailableReason: null,
  rulesOutdated: false,
  ...patch,
});

const mine = (patch: Partial<MyFanClub> = {}): MyFanClub => ({
  ...PROGRAM,
  application: null,
  club: null,
  ...patch,
});

const manager = (patch: Partial<MyFanClubClub> = {}) =>
  mine({ application: application({ status: 'approved' }), club: club(patch) });

const ownPost = (patch: Partial<OwnFanClubPost>): OwnFanClubPost => ({
  id: 'fcp-1',
  clubId: 'fc-1',
  artistId: 'nettobrito',
  kind: 'text',
  text: 'Que show em Feira!',
  photo: null,
  thumb: null,
  status: 'pending',
  rejectReason: null,
  submittedAt: '2026-10-19T15:00:00.000Z',
  publishedAt: null,
  reviewedAt: null,
  ...patch,
});

const notFound = () => new ApiError('notFound', 'Não encontrado.', 404, 'not_found');
const refused = (reason: string, extra: Record<string, unknown> = {}) =>
  new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason, ...extra });
const invalid = (field: string, reason = 'format') =>
  new ApiError('validation', 'Inválido.', 400, 'fan_club_invalid', { field, reason });

/** O perfil do Firestore: o @ escolhido e o Instagram, para a candidatura. */
function profileSnapshot(username = 'camilarib') {
  return {
    exists: () => true,
    data: () => ({
      displayName: 'Camila Ribeiro',
      username,
      socials: { instagram: 'camila.up', tiktok: null, linkedin: null, x: null },
    }),
    metadata: { fromCache: false },
  };
}

/** As rotas que já existem e que as telas leem pela `api` (o contato e o convite). */
function serverAnswers(): void {
  jest.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/me/contact') return Promise.resolve({ data: { whatsapp: '+5575991234567' } });
    if (url === '/me/invite') {
      return Promise.resolve({
        data: { code: 'CAMILA12', linkBase: 'https://imagineup.app', pointsPerVisit: 2 },
      });
    }
    return Promise.reject(new Error(`rota inesperada: ${url}`));
  });
  jest.mocked(api.put).mockImplementation((url: string, body: unknown) => {
    if (url === '/me/contact') return Promise.resolve({ data: body });
    return Promise.resolve({ data: { linkId: 'fanclub:fc-1', created: true } });
  });
}

/** Nenhuma rota do fã-clube além do `GET /me/fan-club`, e nada do contato e do convite. */
function expectOnlyTheGate(): void {
  const { fetchMyFanClub, ...others } = mocked;
  expect(fetchMyFanClub).toHaveBeenCalled();
  for (const [name, fn] of Object.entries(others)) {
    if (typeof fn !== 'function') continue;
    expect([name, jest.mocked(fn).mock.calls.length]).toEqual([name, 0]);
  }
  expect(api.get).not.toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
}

/** Os textos do campo (o erro e a dica) ficam fora do leitor: o campo os lê pela dica. */
const hidden = { includeHiddenElements: true } as const;

const HINT =
  'Seu WhatsApp fica só com a equipe, para falar com você sobre o fã-clube e os prêmios.';

const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

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
  mocked.fetchMyFanClubNumbers.mockResolvedValue({
    followers: 12,
    followers30d: 5,
    links: 4,
    visits: 9,
    signups: 3,
    joins: 2,
  });
  mocked.fetchMyFanClubPosts.mockResolvedValue({ items: [], nextCursor: null });
  mocked.fetchFanClubArtists.mockResolvedValue({
    items: [
      {
        artistId: 'nettobrito',
        name: 'Netto Brito',
        shortName: 'Netto',
        thumbUrl: null,
        photosAllowed: true,
      },
    ],
  });
});

afterEach(() => {
  queryClient.clear();
  jest.restoreAllMocks();
});

// --- Os Ajustes e a inércia antes da abertura -----------------------------------------

describe('o bloco "Fã-clube" dos Ajustes (34.9, item 1)', () => {
  it('com a api de antes da publicação (o 404), os Ajustes ficam como eram, e só o GET /me/fan-club vai', async () => {
    mocked.fetchMyFanClub.mockRejectedValue(notFound());
    renderRouter(appTree, { initialUrl: '/ajustes' });

    await waitFor(() => expect(mocked.fetchMyFanClub).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByText('Fã-clube')).toBeNull();
    expect(screen.queryByTestId('settings-fan-club')).toBeNull();
    expectOnlyTheGate();
  });

  it('com o programa fechado e sem candidatura, a linha "Tenha seu fã-clube" não aparece', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ open: false }));
    renderRouter(appTree, { initialUrl: '/ajustes' });

    await waitFor(() => expect(mocked.fetchMyFanClub).toHaveBeenCalled());
    await act(async () => undefined);
    expect(screen.queryByTestId('settings-fan-club')).toBeNull();
    // "Fã-clubes que sigo" fica (etapa 8): os fã-clubes que existem continuam (decisão 9).
    expect(await screen.findByTestId('settings-fan-club-follows')).toBeTruthy();
    expectOnlyTheGate();
  });

  it('com o programa aberto, "Tenha seu fã-clube" entre Perfil e conta e Privacidade e segurança, e abre a apresentação', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    // Na conta com senha, as duas trocas ficam no Perfil e conta, antes do fã-clube.
    useSessionStore.setState((state) => ({
      user: state.user ? { ...state.user, hasPassword: true } : state.user,
    }));
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    const row = await screen.findByRole('button', { name: 'Tenha seu fã-clube' });
    const order = screen.UNSAFE_root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props.accessibilityRole === 'header' ||
          /^settings-(change-password|fan-club|fan-club-follows|blocked-fans)$/.test(
            node.props.testID ?? '',
          )),
    ).map((node) =>
      node.props.accessibilityRole === 'header' ? String(node.props.children) : node.props.testID,
    );
    expect(order).toEqual([
      'Ajustes',
      'Perfil e conta',
      'settings-change-password',
      'Fã-clube',
      'settings-fan-club',
      'settings-fan-club-follows',
      'Privacidade e segurança',
      'settings-blocked-fans',
      'Sobre',
      'Zona de perigo',
    ]);
    fireEvent.press(row);
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    expect(await screen.findByTestId('fan-club-intro')).toBeTruthy();
  });

  it.each([
    [
      'em análise',
      mine({ application: application() }),
      'Tenha seu fã-clube',
      'Candidatura em análise',
    ],
    [
      'recusada',
      mine({ application: application({ status: 'rejected', rejectReason: 'other' }) }),
      'Tenha seu fã-clube',
      'Não aprovada, toque para ver',
    ],
    [
      'fora do ar',
      manager({
        status: 'paused',
        available: false,
        unavailableReason: 'paused',
        lastReward: null,
      }),
      'Meu fã-clube',
      'Fora do ar, toque para ver',
    ],
    ['no ar', manager({ lastReward: null }), 'Meu fã-clube', 'Seu fã-clube de Netto Brito'],
  ])(
    'a linha só com o título, sem o estado embaixo (26/10/2026): %s',
    async (_name, state, name, meta) => {
      mocked.fetchMyFanClub.mockResolvedValue(state);
      renderRouter(appTree, { initialUrl: '/ajustes' });
      expect(await screen.findByRole('button', { name })).toBeTruthy();
      expect(screen.queryByText(meta)).toBeNull();
    },
  );

  it('a linha não diz mais "Novo prêmio", e o "Meu fã-clube" segue marcando o visto no aparelho', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const row = await screen.findByRole('button', { name: 'Meu fã-clube' });
    expect(screen.queryByText('Novo prêmio')).toBeNull();
    fireEvent.press(row);
    expect(await screen.findByTestId('fan-club-dashboard')).toBeTruthy();
    expect(useFanClubPrizeStore.getState().seen['uid-camila']).toBe('2026-10-18T15:00:00.000Z');
  });
});

describe('as rotas novas a frio, antes da abertura', () => {
  it.each([
    '/meu-fa-clube',
    '/meu-fa-clube?aba=publicacoes',
    '/meu-fa-clube/candidatura',
    '/meu-fa-clube/nova-publicacao',
  ])('%s com o 404 da api de antes: "não está disponível", e nada mais é chamado', async (url) => {
    mocked.fetchMyFanClub.mockRejectedValue(notFound());
    renderRouter(appTree, { initialUrl: url });

    expect(await screen.findByText('O fã-clube não está disponível agora.')).toBeTruthy();
    expectOnlyTheGate();
  });

  it('a frio, o "Voltar" da tela indisponível vai ao início, e o título não convida', async () => {
    mocked.fetchMyFanClub.mockRejectedValue(notFound());
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });

    fireEvent.press(await screen.findByText('Voltar', { exact: true }));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(mocked.fetchMyFanClub).toHaveBeenCalledTimes(1);
  });

  it('o "Meu fã-clube" a frio, sem o estado, tem o título "Fã-clube"', async () => {
    mocked.fetchMyFanClub.mockRejectedValue(notFound());
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('O fã-clube não está disponível agora.')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Fã-clube' })).toBeTruthy();
    expect(screen.queryByText('Tenha seu fã-clube')).toBeNull();
  });

  it('sem sessão, o link do "Meu fã-clube" não abre a tela e cai na entrada', async () => {
    useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
    usePreferencesStore.setState({ lastSessionUid: null });
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });
    expect(await screen.findByText('entrada')).toBeTruthy();
    expect(mocked.fetchMyFanClub).not.toHaveBeenCalled();
  });

  it('logado sem onboarding, também não abre', async () => {
    usePreferencesStore.setState({ hasCompletedOnboarding: false });
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });
    expect(await screen.findByText('onboarding')).toBeTruthy();
    expect(mocked.fetchMyFanClub).not.toHaveBeenCalled();
  });

  it('as três telas abrem por cima das abas, na pilha raiz', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/perfil' });
    act(() => router.push('/meu-fa-clube'));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    act(() => router.push('/meu-fa-clube/nova-publicacao'));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/nova-publicacao'));
    expect(view.getSegments()).toEqual(['meu-fa-clube', 'nova-publicacao']);
  });
});

// --- A apresentação e a candidatura ---------------------------------------------------

describe('a apresentação (34.9, item 2)', () => {
  const FIRST = 'Passo 1 de 4. Candidate-se. Escolha o artista e proponha o nome do fã-clube.';

  /** O passo do centro, o único que o leitor de tela vê. */
  const currentStep = () => screen.getByTestId('fan-club-intro-step');

  it('os 4 passos no carrossel e as setas, que trocam o passo e levam o foco a ele', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    const focus = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => undefined);
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByLabelText(FIRST)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Tenha seu fã-clube' })).toBeTruthy();
    // Um passo de cada vez para o leitor; os pontos não falam.
    expect(screen.getAllByLabelText(/^Passo \d de 4\./)).toHaveLength(1);
    expect(screen.queryByTestId('fan-club-intro-dots')).toBeNull();
    expect(screen.getByTestId('fan-club-intro-dots', hidden)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Passo anterior' })).toBeDisabled();

    for (let step = 2; step <= 4; step += 1) {
      fireEvent.press(screen.getByRole('button', { name: 'Próximo passo' }));
      expect(currentStep().props.accessibilityLabel).toMatch(new RegExp(`^Passo ${step} de 4\\.`));
    }
    expect(currentStep().props.accessibilityLabel).toBe(
      'Passo 4 de 4. Compartilhe. Divulgue seu link e traga fãs para a central.',
    );
    expect(screen.getByRole('button', { name: 'Próximo passo' })).toBeDisabled();
    await waitFor(() => expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus'));

    fireEvent.press(screen.getByRole('button', { name: 'Passo anterior' }));
    expect(currentStep().props.accessibilityLabel).toMatch(/^Passo 3 de 4\./);
  });

  it('o passo troca pelas ações do leitor de tela e pelo arrasto', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    await screen.findByLabelText(FIRST);
    expect(currentStep().props.accessibilityActions).toEqual([
      { name: 'previous', label: 'Passo anterior' },
      { name: 'next', label: 'Próximo passo' },
    ]);
    fireEvent(currentStep(), 'accessibilityAction', { nativeEvent: { actionName: 'next' } });
    expect(currentStep().props.accessibilityLabel).toMatch(/^Passo 2 de 4\./);
    fireEvent(currentStep(), 'accessibilityAction', { nativeEvent: { actionName: 'previous' } });
    expect(currentStep().props.accessibilityLabel).toMatch(/^Passo 1 de 4\./);

    // O arrasto para na terceira página.
    const { width } = Dimensions.get('window');
    fireEvent(screen.getByTestId('fan-club-intro-pages'), 'scrollBeginDrag');
    fireEvent(screen.getByTestId('fan-club-intro-pages'), 'momentumScrollEnd', {
      nativeEvent: { contentOffset: { x: width * 2, y: 0 } },
    });
    expect(currentStep().props.accessibilityLabel).toBe(
      'Passo 3 de 4. Publique. Textos e fotos, conferidos pela equipe antes de irem ao ar.',
    );
  });

  it('com toques seguidos na seta, o fim de uma rolagem interrompida não volta o passo', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    await screen.findByLabelText(FIRST);
    const pages = screen.getByTestId('fan-club-intro-pages');
    const { width } = Dimensions.get('window');
    const stopAt = (x: number) =>
      fireEvent(pages, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x, y: 0 } } });

    fireEvent.press(screen.getByRole('button', { name: 'Próximo passo' }));
    fireEvent.press(screen.getByRole('button', { name: 'Próximo passo' }));
    // O Android avisa o fim da primeira rolagem, cortada pela segunda, no caminho.
    stopAt(width * 0.25);
    expect(currentStep().props.accessibilityLabel).toMatch(/^Passo 3 de 4\./);
    fireEvent.press(screen.getByRole('button', { name: 'Próximo passo' }));
    stopAt(width * 2.4);
    expect(currentStep().props.accessibilityLabel).toMatch(/^Passo 4 de 4\./);
    stopAt(width * 3);
    expect(currentStep().props.accessibilityLabel).toMatch(/^Passo 4 de 4\./);

    // O arrasto do dedo vale de novo, onde quer que pare.
    fireEvent(pages, 'scrollBeginDrag');
    stopAt(width);
    expect(currentStep().props.accessibilityLabel).toMatch(/^Passo 2 de 4\./);
  });

  it('as vantagens, cada uma um foco só, com o reconhecimento por último', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(
      await screen.findByRole('header', { name: 'Vantagens de ter um fã-clube' }),
    ).toBeTruthy();
    const benefits = within(screen.getByTestId('fan-club-intro-benefits'));
    expect(benefits.getAllByLabelText(/\. /).map((node) => node.props.accessibilityLabel)).toEqual([
      'Sua página no artista. O fã-clube aparece na página do artista, e qualquer fã pode seguir.',
      'Mais fãs na central. Quem segue o seu fã-clube também entra na central do artista.',
      'Seu link. Compartilhe o link com o seu código e veja quantas pessoas você trouxe.',
      'Seus números. Seguidores, visitas e cadastros em Meu fã-clube.',
      'Destaque. A equipe pode destacar o fã-clube, que aparece primeiro na página do artista.',
      'Reconhecimento. A equipe pode dar pontos e prêmios, como ingressos, a critério dela e sem garantia.',
    ]);
    // O texto inteiro do reconhecimento fica na sheet das regras.
    expect(screen.queryByText(PROGRAM.notice)).toBeNull();
  });

  it('sem o texto do reconhecimento, a vantagem do prêmio some', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ notice: null }));
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByTestId('fan-club-intro-benefit-featured')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-intro-benefit-reward')).toBeNull();
    expect(screen.queryByText(/prêmio/i)).toBeNull();
  });

  it('o botão do pé abre a candidatura de qualquer passo; os requisitos ficam só nas regras', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    const footer = within(await screen.findByTestId('fan-club-intro-footer'));
    expect(footer.queryByText(/18 anos/)).toBeNull();
    fireEvent.press(footer.getByRole('button', { name: 'Quero meu fã-clube' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/candidatura'));
  });

  it('o aceite dos Termos de Uso no pé, com o link; com o regulamento, o link passa a ele', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    const first = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText(/^Ao se candidatar, você aceita os /)).toBeTruthy();
    fireEvent.press(screen.getByRole('link', { name: 'Termos de Uso' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://imagineup-painel.vercel.app/termos/',
      expect.anything(),
    );
    first.unmount();

    queryClient.clear();
    mocked.fetchMyFanClub.mockResolvedValue(
      mine({ rulesUrl: 'https://imagineup-painel.vercel.app/fa-clube/regulamento/' }),
    );
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });
    fireEvent.press(await screen.findByRole('link', { name: 'Regulamento do Fã-clube' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://imagineup-painel.vercel.app/fa-clube/regulamento/',
      expect.anything(),
    );
  });

  it('"Regras do fã-clube" abre a sheet com as condições e o texto inteiro do reconhecimento', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(await screen.findByRole('button', { name: 'Regras do fã-clube' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/regras'));
    const sheet = within(screen.getByTestId('fan-club-rules-sheet'));
    expect(sheet.getByRole('header', { name: 'Regras do fã-clube' })).toBeTruthy();
    for (const text of [
      'Ter 18 anos ou mais.',
      'Estar na central do artista.',
      'Ter o seu @ escolhido em Editar perfil.',
      'Manter o fã-clube ativo e a conta sem suspensão.',
    ]) {
      expect(sheet.getByText(text)).toBeTruthy();
    }
    // O selo de oficial (34.23): o único lugar que explica o fã-clube como espaço de fãs.
    expect(sheet.getByRole('header', { name: 'Fã-clube oficial' })).toBeTruthy();
    expect(
      sheet.getByText(
        'O fã-clube é um espaço de fãs. Os oficializados pela equipe levam o selo de oficial ao lado do nome.',
      ),
    ).toBeTruthy();
    expect(
      within(sheet.getByTestId('fan-club-rules-official')).getByTestId(
        'fan-club-official-badge',
        hidden,
      ),
    ).toBeTruthy();
    expect(sheet.getByText(PROGRAM.notice)).toBeTruthy();
    fireEvent.press(sheet.getByRole('link', { name: 'Ler os Termos de Uso' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://imagineup-painel.vercel.app/termos/',
      expect.anything(),
    );

    fireEvent.press(sheet.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    // A sheet lê o estado já em cache: nenhuma busca a mais.
    expect(mocked.fetchMyFanClub).toHaveBeenCalledTimes(1);
  });

  it('sem o texto do reconhecimento, a sheet mostra só as condições', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ notice: null }));
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(await screen.findByRole('button', { name: 'Regras do fã-clube' }));
    expect(await screen.findByText('Ter 18 anos ou mais.')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-rules-notice')).toBeNull();
  });

  it('a sheet das regras a frio, com a api de antes, fecha e não chama mais nada', async () => {
    mocked.fetchMyFanClub.mockRejectedValue(notFound());
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube/regras' });

    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(screen.queryByTestId('fan-club-rules-sheet')).toBeNull();
    expectOnlyTheGate();
  });
});

describe('a candidatura (34.9, item 3)', () => {
  /** Preenche o que o perfil e o contato não trazem. */
  async function fillRest(): Promise<void> {
    fireEvent.changeText(await screen.findByTestId('fan-club-apply-name'), 'Netto de Coração');
    fireEvent.changeText(
      screen.getByTestId('fan-club-apply-pitch'),
      'Vou divulgar nos meus perfis e no grupo dos fãs.',
    );
    fireEvent.press(screen.getByTestId('fan-club-apply-adult'));
    fireEvent.press(screen.getByTestId('fan-club-apply-rules'));
  }

  it('já preenchida com as redes do perfil, o WhatsApp do contato e a única central; envia e mostra a espera', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    mocked.applyForFanClub.mockResolvedValue(mine({ application: application() }));
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });
    fireEvent.press(await screen.findByTestId('fan-club-intro-apply'));

    await waitFor(() =>
      expect(screen.getByTestId('fan-club-apply-whatsapp').props.value).toBe('(75) 99123-4567'),
    );
    expect(screen.getByTestId('fan-club-apply-instagram').props.value).toBe('camila.up');
    expect(
      screen.getByText(
        'Seu WhatsApp fica só com a equipe, para falar com você sobre o fã-clube e os prêmios.',
        hidden,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Li e aceito os Termos de Uso')).toBeTruthy();
    await fillRest();
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));

    await waitFor(() => expect(mocked.applyForFanClub).toHaveBeenCalled());
    expect(mocked.applyForFanClub.mock.calls[0]![0]).toEqual({
      body: {
        artistId: 'nettobrito',
        name: 'Netto de Coração',
        instagram: 'camila.up',
        tiktok: null,
        whatsapp: '+5575991234567',
        pitch: 'Vou divulgar nos meus perfis e no grupo dos fãs.',
        adult: true,
        rulesVersion: 'termos-2026-10',
      },
      idempotencyKey: expect.stringMatching(/^club-apply-/),
    });
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    expect(await screen.findByTestId('fan-club-pending')).toBeTruthy();
    expect(announced()).toContain('Candidatura enviada. Ela está em análise.');
  });

  it('o envio inválido não chama o servidor e mostra os erros nos campos', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });

    await screen.findByTestId('fan-club-apply-artist-nettobrito');
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));
    expect(
      await screen.findByText('O nome precisa ter de 3 a 40 caracteres.', hidden),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Tenho 18 anos ou mais. Para ter um fã-clube, confirme que você tem 18 anos ou mais.',
      ),
    ).toBeTruthy();
    expect(mocked.applyForFanClub).not.toHaveBeenCalled();
  });

  it('sem central que aceite fã-clubes: "Entre na central do artista primeiro", com a Explorar', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    mocked.fetchFanClubArtists.mockResolvedValue({ items: [] });
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });

    expect(await screen.findByText('Entre na central do artista primeiro.')).toBeTruthy();
    fireEvent.press(screen.getByText('Explorar artistas'));
    await waitFor(() => expect(view.getPathname()).toBe('/explorar'));
  });

  it('a recusa de um campo vai ao campo dele: o "oficial" no nome', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    mocked.applyForFanClub.mockRejectedValue(invalid('name', 'official'));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });
    await screen.findByTestId('fan-club-apply-artist-nettobrito');
    await fillRest();
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));

    expect(
      await screen.findByText(
        'O nome não pode ter a palavra oficial. Só a equipe oficializa um fã-clube, com o selo.',
        hidden,
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('fan-club-apply-error')).toBeNull();
  });

  it('a recusa de negócio fica: o prazo com a data do servidor, também quando o estado novo tira o formulário', async () => {
    const canReapplyAt = '2026-11-17T15:00:00.000Z';
    // A tela abriu com a vez do fã; a recusa faz o estado buscar de novo, e ele
    // já diz que a vez não é agora (outro aparelho, a recusa da equipe).
    mocked.fetchMyFanClub.mockResolvedValueOnce(mine()).mockResolvedValue(
      mine({
        application: application({ status: 'rejected', rejectReason: 'other', canReapplyAt }),
      }),
    );
    mocked.applyForFanClub.mockRejectedValue(refused('cooldown', { canReapplyAt }));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });
    await screen.findByTestId('fan-club-apply-artist-nettobrito');
    await fillRest();
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));

    expect(
      await screen.findByText('Você pode enviar de novo a partir de 17/11/2026.'),
    ).toBeTruthy();
    await waitFor(() => expect(mocked.fetchMyFanClub).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('fan-club-apply-unavailable')).toBeTruthy();
    expect(screen.getByText('Você pode enviar de novo a partir de 17/11/2026.')).toBeTruthy();
    expect(announced()).toContain('Você pode enviar de novo a partir de 17/11/2026.');
  });

  it('o envio sem artista: o erro no rótulo de cada central e o foco na primeira', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    mocked.fetchFanClubArtists.mockResolvedValue({
      items: [
        {
          artistId: 'nettobrito',
          name: 'Netto Brito',
          shortName: 'Netto',
          thumbUrl: null,
          photosAllowed: true,
        },
        { artistId: 'nenho', name: 'Nenho', shortName: null, thumbUrl: null, photosAllowed: false },
      ],
    });
    serverAnswers();
    const focus = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => undefined);
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });

    await screen.findByTestId('fan-club-apply-artist-nenho');
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));

    expect(await screen.findByLabelText('Netto Brito. Escolha o artista.')).toBeTruthy();
    expect(screen.getByLabelText('Nenho. Escolha o artista.')).toBeTruthy();
    expect(announced()).toContain('Escolha o artista.');
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
  });

  it('enquanto a candidatura vai, o voltar do título fica preso', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    mocked.applyForFanClub.mockReturnValue(new Promise(() => undefined));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });
    await screen.findByTestId('fan-club-apply-artist-nettobrito');
    await fillRest();
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));

    await waitFor(() => expect(mocked.applyForFanClub).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Voltar' }).props.accessibilityState).toEqual(
        expect.objectContaining({ disabled: true }),
      ),
    );
  });

  it('o @ automático: o aviso no topo e "Editar perfil", também na recusa do servidor', async () => {
    jest.mocked(getDoc).mockResolvedValue(profileSnapshot('fa123456') as never);
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    mocked.applyForFanClub.mockRejectedValue(refused('username_required'));
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });

    expect(await screen.findByTestId('fan-club-apply-username')).toBeTruthy();
    await fillRest();
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));
    expect(await screen.findByTestId('fan-club-apply-error')).toBeTruthy();
    fireEvent.press(screen.getAllByText('Editar perfil').at(-1)!);
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
  });

  it('o suspenso: a frase da candidatura, com "Escrever para a equipe"', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    mocked.applyForFanClub.mockRejectedValue(
      new ApiError('forbidden', 'Suspensa.', 403, 'account_suspended'),
    );
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });
    await screen.findByTestId('fan-club-apply-artist-nettobrito');
    await fillRest();
    fireEvent.press(screen.getByTestId('fan-club-apply-submit'));

    expect(
      await screen.findByText(
        'Sua conta está suspensa. Você não pode se candidatar a um fã-clube.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Escrever para a equipe')).toBeTruthy();
  });

  it('em análise, a candidatura não abre de novo (o link a frio), e nada de artistas', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ application: application() }));
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/candidatura' });
    expect(await screen.findByText('Você não pode enviar uma candidatura agora.')).toBeTruthy();
    expect(mocked.fetchFanClubArtists).not.toHaveBeenCalled();
  });
});

// --- Os estados -----------------------------------------------------------------------

describe('a espera e a recusa (34.9, item 4)', () => {
  it('em análise desde a data, e "Desistir da candidatura" com a confirmação', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ application: application() }));
    mocked.withdrawApplication.mockResolvedValue(
      mine({ application: application({ status: 'withdrawn', canApply: true }) }),
    );
    confirmAlerts();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('Em análise desde 18/10/2026')).toBeTruthy();
    expect(screen.getByText('Netto de Coração, fã-clube de Netto Brito')).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-withdraw'));

    await waitFor(() => expect(mocked.withdrawApplication).toHaveBeenCalled());
    expect(await screen.findByTestId('fan-club-intro')).toBeTruthy();
    expect(announced()).toContain('Você desistiu da candidatura.');
  });

  it('a equipe decidiu antes: o "Desistir" volta o estado de agora, sem dizer que desistiu', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ application: application() }));
    mocked.withdrawApplication.mockResolvedValue(
      mine({ application: application({ status: 'rejected', rejectReason: 'other' }) }),
    );
    confirmAlerts();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(await screen.findByTestId('fan-club-withdraw'));
    expect(await screen.findByTestId('fan-club-rejected')).toBeTruthy();
    expect(announced()).not.toContain('Você desistiu da candidatura.');
  });

  it.each([
    [
      'com o prazo',
      application({
        status: 'rejected',
        rejectReason: 'not_fit',
        canReapplyAt: '2026-11-17T15:00:00.000Z',
      }),
      'A equipe entendeu que a candidatura não combina com o programa agora.',
      'Você pode enviar de novo a partir de 17/11/2026.',
    ],
    [
      'na 3ª rodada',
      application({ status: 'rejected', rejectReason: 'rules', round: 3 }),
      'A candidatura não segue as regras do fã-clube.',
      'Você já usou as 3 candidaturas.',
    ],
  ])('recusada %s: o motivo e a próxima rodada, sem botão', async (_name, item, reason, next) => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ application: item }));
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText(reason)).toBeTruthy();
    expect(screen.getByText(next)).toBeTruthy();
    expect(screen.queryByTestId('fan-club-apply-again')).toBeNull();
  });

  it('recusada com a vez do fã: "Enviar nova candidatura"', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(
      mine({
        application: application({ status: 'rejected', rejectReason: 'other', canApply: true }),
      }),
    );
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });
    fireEvent.press(await screen.findByTestId('fan-club-apply-again'));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/candidatura'));
  });

  it('encerrado pela equipe: o modo gestor com o aviso, a frase do fim e os números, sem botão', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(
      manager({ status: 'closed', available: false, unavailableReason: 'closed' }),
    );
    serverAnswers();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('Você não pode mais ter um fã-clube.')).toBeTruthy();
    expect(screen.getByText('Seu fã-clube foi encerrado.')).toBeTruthy();
    expect(await screen.findByLabelText('Seguidores: 12. +5 nos últimos 30 dias.')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-apply-again')).toBeNull();
    expect(screen.queryByTestId('fan-club-share')).toBeNull();
    expect(screen.queryByTestId('fan-club-preview')).toBeNull();
    // O "+" fica na barra e diz que acabou, em vez de abrir a nova publicação.
    fireEvent.press(screen.getByRole('button', { name: 'Nova publicação' }));
    expect(alert).toHaveBeenCalledWith(
      'Você não pode publicar agora',
      'Seu fã-clube foi encerrado.',
      expect.any(Array),
    );
    // Sem o pedido de encerramento na Conta.
    fireEvent.press(managerTab('Conta'));
    expect(await screen.findByRole('header', { name: 'Conta' })).toBeTruthy();
    expect(screen.queryByTestId('fan-club-close')).toBeNull();
  });

  it('encerrado a pedido, depois do prazo: "Enviar nova candidatura" no aviso', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(
      mine({
        application: application({ status: 'approved', round: 0, canApply: true }),
        club: club({ status: 'closed', available: false, unavailableReason: 'closed' }),
      }),
    );
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('Você já pode enviar uma nova candidatura.')).toBeTruthy();
    // Numa fileira, como o "Aceitar": o aviso alinha as ações ao começo (etapa 10).
    expect(screen.getByTestId('fan-club-apply-again-row')).toHaveStyle({ flexDirection: 'row' });
    fireEvent.press(screen.getByTestId('fan-club-apply-again'));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/candidatura'));
  });
});

// --- O "Meu fã-clube" -----------------------------------------------------------------

describe('o modo gestor do "Meu fã-clube" (34.24)', () => {
  it('o cabeçalho com o selo "Gestor", a barra com o "+" e o Painel com os números e os atalhos', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ featuredUntil: '2026-10-25' }));
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(
      await screen.findByRole('header', {
        name: 'Netto de Coração, de Netto Brito. Ativo.',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Gestor')).toBeTruthy();
    expect(screen.queryByText(/dono/iu)).toBeNull();
    for (const name of ['Painel', 'Publicações', 'Prêmios', 'Conta']) {
      expect(managerTab(name)).toBeTruthy();
    }
    expect(managerTab('Painel')).toBeSelected();
    expect(screen.getByRole('button', { name: 'Nova publicação' }).props.accessibilityHint).toBe(
      'Abre o formulário da publicação',
    );

    expect(await screen.findByLabelText('Seguidores: 12. +5 nos últimos 30 dias.')).toBeTruthy();
    expect(
      screen.getByLabelText('Links compartilhados: 4. Fãs que compartilharam o seu fã-clube.'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Visitas pelos links: 9. Pessoas que abriram o link.'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Cadastros pelo link: 3. Contas novas criadas pelo link.'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText('Entradas na central: 2. Novos fãs na central de Netto Brito.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Seu fã-clube é destaque até 25/10/2026')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Publicações: 2 no ar, 1 de 3 em análise.' }),
    ).toBeTruthy();
    // Sem o que a API não manda: o gráfico, os períodos, a posição e quem trouxe quem.
    expect(screen.queryByText(/^(7 dias|30 dias|Temporada)$|Quem mais traz/u)).toBeNull();
    expect(screen.queryByTestId('fan-club-official-badge', hidden)).toBeNull();

    // O card de Prêmios leva à aba, e "Ver meus prêmios" abre a loja.
    fireEvent.press(
      screen.getByRole('button', { name: 'Prêmios. +200 pontos e um prêmio em 18/10/2026' }),
    );
    expect(await screen.findByRole('header', { name: 'Prêmios' })).toBeTruthy();
    expect(managerTab('Prêmios')).toBeSelected();
    // A troca pedida de dentro da aba diz ao leitor para onde foi.
    expect(announced()).toContain('Prêmios');
    expect(screen.getByText('+200 pontos e um prêmio em 18/10/2026')).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-prizes-open'));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));
  });

  it('oficializado pela equipe (34.23): o selo ao lado do nome, e o leitor ouve "fã-clube oficial"', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ official: true }));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    const header = await screen.findByRole('header', {
      name: 'Netto de Coração, fã-clube oficial de Netto Brito. Ativo.',
    });
    expect(within(header).getByTestId('fan-club-official-badge', hidden)).toBeTruthy();
  });

  it('a aba e o filtro ficam no endereço, e a marca do prêmio visto vale em qualquer aba', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=conta' });

    expect(await screen.findByRole('header', { name: 'Conta' })).toBeTruthy();
    expect(managerTab('Conta')).toBeSelected();
    expect(useFanClubPrizeStore.getState().seen['uid-camila']).toBe('2026-10-18T15:00:00.000Z');
    // O Painel não está montado: nada dos números.
    expect(mocked.fetchMyFanClubNumbers).not.toHaveBeenCalled();
  });

  it('"Aceitar" e "Ver meus prêmios" ficam numa fileira, da altura do conteúdo', async () => {
    // Direto na coluna e alinhado ao começo, o desenho do Button cresce para
    // ocupar a altura que o pai der e esticava sem fim dentro da rolagem (o
    // card Prêmios no emulador Android, na conferência da etapa 10 de 34.14).
    // O Jest não mede o layout: o teste prende a fileira em volta de cada um.
    mocked.fetchMyFanClub.mockResolvedValue(manager({ rulesOutdated: true }));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    const acceptRow = await screen.findByTestId('fan-club-rules-accept-row');
    expect(acceptRow).toHaveStyle({ flexDirection: 'row' });
    expect(within(acceptRow).getByTestId('fan-club-rules-accept')).toBeTruthy();
    fireEvent.press(managerTab('Prêmios'));
    const prizesRow = await screen.findByTestId('fan-club-prizes-open-row');
    expect(prizesRow).toHaveStyle({ flexDirection: 'row' });
    expect(within(prizesRow).getByTestId('fan-club-prizes-open')).toBeTruthy();
  });

  it('"Compartilhar meu fã-clube" no cabeçalho: o link com o código, o código na mensagem e o link fanclub:<id>', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    // O código do fã já no cache, como depois da 1e: o toque usa o da tela.
    queryClient.setQueryData(profileKeys.invite(), {
      code: 'CAMILA12',
      linkBase: 'https://imagineup.app',
      pointsPerVisit: 2,
    });
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(await screen.findByRole('button', { name: 'Compartilhar meu fã-clube' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const content = JSON.stringify(share.mock.calls[0]![0]);
    expect(content).toContain('https://imagineup.app/fa-clube/fc-1?ref=CAMILA12');
    expect(content).toContain('Use o meu código de convite: CAMILA12');
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/me/invite/links/fanclub%3Afc-1', undefined, {
        headers: { 'Idempotency-Key': expect.any(String) },
      }),
    );
  });

  it('o olho abre a página como os fãs veem, por cima do modo gestor', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(await screen.findByRole('button', { name: 'Ver como os fãs veem' }));
    await waitFor(() => expect(view.getPathname()).toBe('/fa-clube/fc-1'));
    expect(screen.getByText('página do fã-clube')).toBeTruthy();
  });

  it('o "+" abre a nova publicação quando o gestor pode publicar', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    const alert = jest.spyOn(Alert, 'alert');
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=premios' });

    fireEvent.press(await screen.findByRole('button', { name: 'Nova publicação' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/nova-publicacao'));
    expect(alert).not.toHaveBeenCalled();
  });

  it('pausado: o aviso com "Falar com a equipe", sem Compartilhar nem o olho; o "+" diz o motivo', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(
      manager({ status: 'paused', available: false, unavailableReason: 'paused' }),
    );
    serverAnswers();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('Seu fã-clube está pausado pela equipe.')).toBeTruthy();
    expect(
      within(screen.getByTestId('fan-club-unavailable')).getByRole('link', {
        name: 'Falar com a equipe',
      }),
    ).toBeTruthy();
    expect(screen.queryByTestId('fan-club-share')).toBeNull();
    expect(screen.queryByTestId('fan-club-preview')).toBeNull();

    const plus = screen.getByRole('button', { name: 'Nova publicação' });
    expect(plus.props.accessibilityHint).toBe('Diz por que você não pode publicar agora');
    fireEvent.press(plus);
    expect(alert).toHaveBeenCalledWith(
      'Você não pode publicar agora',
      'Seu fã-clube está pausado pela equipe.',
      [expect.objectContaining({ text: 'Fechar' })],
    );
    expect(view.getPathname()).toBe('/meu-fa-clube');
  });

  it('fora da central: o aviso leva de volta a ela', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(
      manager({ available: false, unavailableReason: 'not_member' }),
    );
    serverAnswers();
    const dismissTo = jest.spyOn(router, 'dismissTo').mockImplementation(() => undefined);
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(
      await screen.findByRole('link', { name: 'Voltar para a central de Netto Brito' }),
    );
    expect(dismissTo).toHaveBeenCalledWith(
      expect.objectContaining({ params: { artistaId: 'nettobrito' } }),
      { withAnchor: true },
    );
  });

  it('o regulamento mudou: o "+" leva ao aviso, e o "Aceitar" manda a versão de agora', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ rulesOutdated: true }));
    mocked.acceptFanClubRules.mockResolvedValue(manager());
    serverAnswers();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, message, buttons?: AlertButton[]) => {
      expect(message).toBe(
        'O regulamento mudou. Aceite o novo, no Painel, para voltar a publicar.',
      );
      buttons?.find((button) => button.text === 'Ver no Painel')?.onPress?.();
    });
    renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=publicacoes' });

    fireEvent.press(await screen.findByRole('button', { name: 'Nova publicação' }));
    expect(await screen.findByText('O regulamento mudou')).toBeTruthy();
    expect(managerTab('Painel')).toBeSelected();
    fireEvent.press(screen.getByTestId('fan-club-rules-accept'));
    await waitFor(() =>
      expect(mocked.acceptFanClubRules).toHaveBeenCalledWith({
        rulesVersion: 'termos-2026-10',
        idempotencyKey: expect.stringMatching(/^club-rules-/),
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('fan-club-rules-notice')).not.toBeOnTheScreen(),
    );
    expect(screen.getByRole('button', { name: 'Nova publicação' }).props.accessibilityHint).toBe(
      'Abre o formulário da publicação',
    );
  });

  it('com 3 em análise, o "+" diz o motivo e leva às em análise', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ pendingPosts: 3 }));
    mocked.fetchMyFanClubPosts.mockResolvedValue({
      items: [
        ownPost({ id: 'fcp-1', text: 'Primeira' }),
        ownPost({ id: 'fcp-2', text: 'Segunda' }),
        ownPost({ id: 'fcp-3', text: 'Terceira' }),
        ownPost({ id: 'fcp-4', status: 'published', text: 'Já no ar' }),
      ],
      nextCursor: null,
    });
    serverAnswers();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, message, buttons?: AlertButton[]) => {
      expect(message).toBe('Você já tem 3 publicações em análise. Espere a equipe revisar.');
      buttons?.find((button) => button.text === 'Ver as em análise')?.onPress?.();
    });
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(await screen.findByRole('button', { name: 'Nova publicação' }));
    expect(await screen.findByText('Terceira')).toBeTruthy();
    expect(managerTab('Publicações')).toBeSelected();
    expect(screen.getByTestId('fan-club-posts-filter-em-analise')).toBeSelected();
    expect(screen.getByLabelText('Em análise, 3')).toBeTruthy();
    expect(screen.queryByText('Já no ar')).toBeNull();
    expect(view.getPathname()).toBe('/meu-fa-clube');
  });

  it('Publicações: os filtros, o status, o motivo da recusada, e Retirar com a confirmação', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    mocked.fetchMyFanClubPosts.mockResolvedValue({
      items: [
        ownPost({ id: 'fcp-1', status: 'pending' }),
        ownPost({
          id: 'fcp-2',
          status: 'rejected',
          rejectReason: 'off_topic',
          text: 'Outro texto',
        }),
        ownPost({ id: 'fcp-3', status: 'published', text: 'No ar' }),
      ],
      nextCursor: null,
    });
    mocked.removeFanClubPost.mockResolvedValue(ownPost({ id: 'fcp-1', status: 'withdrawn' }));
    serverAnswers();
    confirmAlerts();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=publicacoes' });

    expect(await screen.findByRole('header', { name: 'Publicações' })).toBeTruthy();
    expect(
      screen.getByText(
        'A equipe revisa cada publicação antes de ela ir ao ar, e até 3 esperam a revisão por vez.',
      ),
    ).toBeTruthy();
    // No ar, o filtro de partida, com as contagens do servidor nos dois primeiros.
    expect(screen.getByTestId('fan-club-posts-filter-no-ar')).toBeSelected();
    expect(screen.getByLabelText('No ar, 2')).toBeTruthy();
    expect(screen.getByLabelText('Em análise, 1')).toBeTruthy();
    expect(
      await screen.findByRole('button', { name: 'Tirar do ar a publicação: No ar' }),
    ).toBeTruthy();
    expect(screen.queryByText('Que show em Feira!')).toBeNull();

    fireEvent.press(screen.getByTestId('fan-club-posts-filter-recusadas'));
    expect(await screen.findByText('Motivo: Fora do assunto do artista.')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Recusada. Outro texto. Enviada em 19/10/2026. Motivo: Fora do assunto do artista.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('fan-club-own-post-fcp-2-remove')).toBeNull();

    fireEvent.press(screen.getByTestId('fan-club-posts-filter-em-analise'));
    // O rótulo da linha: o ponto depois do texto só quando falta (etapa 10).
    expect(
      await screen.findByLabelText('Em análise. Que show em Feira! Enviada em 19/10/2026.'),
    ).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Retirar a publicação: Que show em Feira!' }),
    );
    await waitFor(() =>
      expect(mocked.removeFanClubPost).toHaveBeenCalledWith({
        postId: 'fcp-1',
        idempotencyKey: expect.stringMatching(/^club-remove-/),
      }),
    );
    expect(announced()).toContain('Publicação retirada.');
    // A retirada sai de "Em análise" e fica em "Outras".
    expect(await screen.findByText('Nenhuma publicação em análise.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-posts-filter-outras'));
    expect(await screen.findByText('Retirada')).toBeTruthy();
  });

  it('Publicações: com poucas no filtro, a página seguinte vem sozinha', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    mocked.fetchMyFanClubPosts.mockImplementation((cursor) =>
      Promise.resolve(
        cursor === null
          ? { items: [ownPost({ id: 'fcp-1', status: 'published' })], nextCursor: 'c2' }
          : {
              items: [ownPost({ id: 'fcp-9', status: 'rejected', text: 'Bem antiga' })],
              nextCursor: null,
            },
      ),
    );
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=publicacoes&filtro=recusadas' });

    expect(await screen.findByText('Bem antiga')).toBeTruthy();
    expect(mocked.fetchMyFanClubPosts.mock.calls).toEqual([[null], ['c2']]);
  });

  it('os números que não vieram: "Sem dado", e não carregando, com "Tentar de novo"', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    mocked.fetchMyFanClubNumbers.mockRejectedValue(
      new ApiError('notFound', 'Não encontrado.', 404, 'fan_club_not_found'),
    );
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByLabelText('Seguidores: Sem dado')).toBeTruthy();
    expect(
      screen.getByLabelText('Visitas pelos links: Sem dado. Pessoas que abriram o link.'),
    ).toBeTruthy();
    expect(screen.getByText('Não deu para carregar os números.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-numbers-retry'));
    await waitFor(() => expect(mocked.fetchMyFanClubNumbers).toHaveBeenCalledTimes(2));
  });

  it('Prêmios: o último reconhecimento, "Ver meus prêmios" e "Falar com a equipe"', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=premios' });

    const card = within(await screen.findByTestId('fan-club-prizes'));
    expect(
      card.getByLabelText('Último reconhecimento: +200 pontos e um prêmio em 18/10/2026'),
    ).toBeTruthy();
    expect(card.getByRole('button', { name: 'Ver meus prêmios' })).toBeTruthy();
    expect(card.getByRole('link', { name: 'Falar com a equipe' })).toBeTruthy();
    expect(card.queryByText(PROGRAM.notice)).toBeNull();
    expect(card.queryByText(/18 anos/)).toBeNull();
  });

  it('Conta: o WhatsApp para a equipe, as regras, falar com a equipe e o encerrar no fim', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=conta' });

    expect(
      await screen.findByLabelText(`WhatsApp para a equipe, +55 (75) 99123-4567. ${HINT}`),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-contact-edit'));
    fireEvent.changeText(screen.getByTestId('fan-club-contact-input'), '75988887777');
    fireEvent.press(screen.getByTestId('fan-club-contact-save'));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/me/contact',
        { whatsapp: '+5575988887777' },
        expect.anything(),
      ),
    );
    expect(
      await screen.findByLabelText(`WhatsApp para a equipe, +55 (75) 98888-7777. ${HINT}`),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Falar com a equipe' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Quero encerrar meu fã-clube' })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Regras do fã-clube' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/regras'));
    expect(
      within(screen.getByTestId('fan-club-rules-sheet')).getByText(PROGRAM.notice),
    ).toBeTruthy();
  });

  it('o voltar do Android fora do Painel volta ao Painel', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    const backPress = jest.spyOn(BackHandler, 'addEventListener');
    renderRouter(appTree, { initialUrl: '/meu-fa-clube?aba=conta' });

    expect(await screen.findByRole('header', { name: 'Conta' })).toBeTruthy();
    const [, stay] =
      backPress.mock.calls.filter(([event]) => event === 'hardwareBackPress').at(-1) ?? [];
    act(() => {
      expect(stay?.({} as Parameters<NonNullable<typeof stay>>[0])).toBe(true);
    });
    await waitFor(() => expect(managerTab('Painel')).toBeSelected());
  });
});

// --- A nova publicação ----------------------------------------------------------------

describe('a nova publicação (34.9, item 6)', () => {
  it('só texto no artista sem fotos: o POST e "Enviado para revisão"', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ photosAllowed: false }));
    mocked.createFanClubPost.mockResolvedValue(ownPost({}));
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });
    fireEvent.press(await screen.findByTestId('fan-club-new-post'));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/nova-publicacao'));

    expect(screen.getByText('Este artista aceita só texto no fã-clube.')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-post-pick-photo')).toBeNull();
    fireEvent.changeText(screen.getByTestId('fan-club-post-text'), 'Que show em Feira!');
    fireEvent.press(screen.getByTestId('fan-club-post-submit'));

    await waitFor(() =>
      expect(mocked.createFanClubPost).toHaveBeenCalledWith({
        text: 'Que show em Feira!',
        photo: false,
        idempotencyKey: expect.stringMatching(/^club-post-/),
      }),
    );
    // De volta ao modo gestor, em Publicações, com o filtro "Em análise".
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    expect(await screen.findByRole('header', { name: 'Publicações' })).toBeTruthy();
    expect(managerTab('Publicações')).toBeSelected();
    expect(screen.getByTestId('fan-club-posts-filter-em-analise')).toBeSelected();
    expect(router.canGoBack()).toBe(false);
    expect(announced()).toContain('Enviado para revisão.');
    expect(mocked.openFanClubUpload).not.toHaveBeenCalled();
  });

  it('o topo da 4b: "Cancelar", "Nova publicação", "Enviar", "Publicando como" e a revisão com as vagas', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });
    fireEvent.press(await screen.findByRole('button', { name: 'Nova publicação' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/nova-publicacao'));

    expect(screen.getByRole('header', { name: 'Nova publicação' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy();
    expect(screen.getByText('Publicando como Netto de Coração')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Revisada pela equipe. A equipe confere a publicação antes de ela ir ao ar. 1 de 3 em análise, 2 vagas livres.',
      ),
    ).toBeTruthy();
    // Nada do que o fã-clube não tem: vídeo, enquete, música, evento, missão e o resto.
    expect(
      screen.queryByText(/vídeo|Enquete|Música|Evento|missão|nível|Fixar|Agendar|Comentários/u),
    ).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
  });

  it('com foto: a galeria sem o recorte do sistema, a prévia 4:5 e os três passos do envio', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    jest
      .mocked(pickPhoto)
      .mockResolvedValue({ uri: 'file:///original.jpg', width: 4000, height: 3000 });
    jest.mocked(prepareFanClubPhoto).mockResolvedValue({
      photo: { uri: 'file:///foto.jpg', size: 900_000, width: 1080, height: 1350 },
      thumb: { uri: 'file:///mini.jpg', size: 90_000, width: 480, height: 600 },
    });
    mocked.openFanClubUpload.mockResolvedValue({
      photoPath: 'fanClubMedia/uid-camila/club-photo-a1b2c3d4.jpg',
      thumbPath: 'fanClubMedia/uid-camila/club-thumb-a1b2c3d4.jpg',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    mocked.createFanClubPost.mockResolvedValue(ownPost({ kind: 'photo' }));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/nova-publicacao' });

    fireEvent.press(await screen.findByRole('button', { name: 'Escolher foto da galeria' }));
    expect(await screen.findByLabelText('A foto escolhida, recortada em 4 por 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Trocar foto' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Escolher foto da galeria' })).toBeNull();
    expect(pickPhoto).toHaveBeenCalledWith('library', 'none');
    expect(prepareFanClubPhoto).toHaveBeenCalledWith({
      uri: 'file:///original.jpg',
      width: 4000,
      height: 3000,
    });
    fireEvent.changeText(screen.getByTestId('fan-club-post-text'), 'Que show!');
    fireEvent.press(screen.getByTestId('fan-club-post-submit'));

    await waitFor(() => expect(mocked.createFanClubPost).toHaveBeenCalled());
    expect(mocked.uploadFanClubFile.mock.calls).toEqual([
      ['fanClubMedia/uid-camila/club-photo-a1b2c3d4.jpg', 'file:///foto.jpg'],
      ['fanClubMedia/uid-camila/club-thumb-a1b2c3d4.jpg', 'file:///mini.jpg'],
    ]);
    expect(mocked.createFanClubPost.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ text: 'Que show!', photo: true }),
    );
  });

  it('o "×" da prévia tira a foto, e o ícone do campo volta a escolher', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    jest
      .mocked(pickPhoto)
      .mockResolvedValue({ uri: 'file:///original.jpg', width: 4000, height: 3000 });
    jest.mocked(prepareFanClubPhoto).mockResolvedValue({
      photo: { uri: 'file:///foto.jpg', size: 900_000, width: 1080, height: 1350 },
      thumb: { uri: 'file:///mini.jpg', size: 90_000, width: 480, height: 600 },
    });
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/nova-publicacao' });

    fireEvent.press(await screen.findByRole('button', { name: 'Escolher foto da galeria' }));
    expect(await screen.findByTestId('fan-club-post-preview')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Tirar a foto' }));
    expect(screen.queryByTestId('fan-club-post-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Escolher foto da galeria' })).toBeTruthy();
  });

  it('a foto grande demais aparece já na escolha, sem enviar nada', async () => {
    const { PhotoPickError } = jest.requireActual('@/domains/profile/photo');
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    jest
      .mocked(pickPhoto)
      .mockResolvedValue({ uri: 'file:///enorme.jpg', width: 9000, height: 9000 });
    jest.mocked(prepareFanClubPhoto).mockRejectedValue(new PhotoPickError('tooBig'));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/nova-publicacao' });

    fireEvent.press(await screen.findByTestId('fan-club-post-pick-photo'));
    expect(await screen.findByText('Foto grande demais. Escolha outra.')).toBeTruthy();
    expect(mocked.openFanClubUpload).not.toHaveBeenCalled();
  });

  it('o envio só com espaços: o erro do campo, anunciado, sem ir ao servidor', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ photosAllowed: false }));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/nova-publicacao' });

    fireEvent.changeText(await screen.findByTestId('fan-club-post-text'), '   ');
    fireEvent.press(screen.getByTestId('fan-club-post-submit'));

    await waitFor(() => expect(announced()).toContain('Escreva de 1 a 1.000 caracteres.'));
    expect(mocked.createFanClubPost).not.toHaveBeenCalled();
  });

  it('com 3 em análise: o aviso, e o envio desligado', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ pendingPosts: 3 }));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/nova-publicacao' });

    expect(
      await screen.findByText('Você já tem 3 publicações em análise. Espere a equipe revisar.'),
    ).toBeTruthy();
    expect(screen.getByTestId('fan-club-post-submit').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('a recusa do servidor no texto vai ao campo; a do teto do dia, ao pé', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ photosAllowed: false }));
    mocked.createFanClubPost
      .mockRejectedValueOnce(invalid('text', 'not_allowed'))
      .mockRejectedValueOnce(new ApiError('dailyLimit', 'Teto.', 429, 'too_many_requests'));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube/nova-publicacao' });

    fireEvent.changeText(await screen.findByTestId('fan-club-post-text'), 'Um texto');
    fireEvent.press(screen.getByTestId('fan-club-post-submit'));
    expect(
      await screen.findByText(
        'Conforme os Termos de uso do ImagineUP, este texto não pode ser usado.',
        hidden,
      ),
    ).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('fan-club-post-text'), 'Outro texto');
    fireEvent.press(screen.getByTestId('fan-club-post-submit'));
    expect(
      await screen.findByText('Você chegou ao limite de publicações de hoje. Tente amanhã.'),
    ).toBeTruthy();
  });
});

// --- Sem o "não oficial" --------------------------------------------------------------

describe('nenhuma tela do gestor diz "não oficial" (34.23: o selo no lugar da faixa)', () => {
  it.each([
    ['a apresentação', mine(), '/meu-fa-clube', 'fan-club-intro'],
    [
      'a candidatura em análise',
      mine({ application: application() }),
      '/meu-fa-clube',
      'fan-club-pending',
    ],
    [
      'a candidatura recusada',
      mine({ application: application({ status: 'rejected', rejectReason: 'other' }) }),
      '/meu-fa-clube',
      'fan-club-rejected',
    ],
    ['o "Meu fã-clube"', manager(), '/meu-fa-clube', 'fan-club-dashboard'],
    ['as Publicações', manager(), '/meu-fa-clube?aba=publicacoes', 'fan-club-posts-note'],
    ['os Prêmios', manager(), '/meu-fa-clube?aba=premios', 'fan-club-prizes'],
    ['a Conta', manager(), '/meu-fa-clube?aba=conta', 'fan-club-account-rules'],
    ['a candidatura', mine(), '/meu-fa-clube/candidatura', 'fan-club-apply-name'],
    ['a nova publicação', manager(), '/meu-fa-clube/nova-publicacao', 'fan-club-post-text'],
    ['as regras', mine(), '/meu-fa-clube/regras', 'fan-club-rules-sheet'],
  ])('%s, do gestor, não diz "não oficial"', async (_name, state, url, testID) => {
    mocked.fetchMyFanClub.mockResolvedValue(state);
    serverAnswers();
    renderRouter(appTree, { initialUrl: url });

    expect(await screen.findByTestId(testID)).toBeTruthy();
    expect(screen.queryByText(/não oficia/iu, hidden)).toBeNull();
    expect(screen.queryByLabelText(/não oficia/iu, hidden)).toBeNull();
  });
});
