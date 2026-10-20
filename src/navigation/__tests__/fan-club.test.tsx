import { QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { getDoc } from 'firebase/firestore';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Alert, Share, Text, type AlertButton } from 'react-native';

import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import ApplyRoute from '@/app/meu-fa-clube/candidatura';
import MyFanClubRoute from '@/app/meu-fa-clube/index';
import NewPostRoute from '@/app/meu-fa-clube/nova-publicacao';
import * as fanClubApi from '@/domains/fan-club/api';
import type {
  FanClubApplication,
  FanClubListPage,
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

  it('com o programa aberto, "Tenha seu fã-clube" entre Perfil e Segurança, e abre a apresentação', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    const row = await screen.findByRole('button', {
      name: 'Tenha seu fã-clube. Divulgue um artista e traga fãs',
    });
    expect(screen.getAllByRole('header').map((node) => node.props.children)).toEqual([
      'Ajustes',
      'Perfil',
      'Fã-clube',
      'Segurança',
      'Conta',
      'Sobre',
    ]);
    fireEvent.press(row);
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    expect(await screen.findByTestId('fan-club-intro')).toBeTruthy();
  });

  it.each([
    [
      'em análise',
      mine({ application: application() }),
      'Tenha seu fã-clube. Candidatura em análise',
    ],
    [
      'recusada',
      mine({ application: application({ status: 'rejected', rejectReason: 'other' }) }),
      'Tenha seu fã-clube. Não aprovada, toque para ver',
    ],
    [
      'fora do ar',
      manager({
        status: 'paused',
        available: false,
        unavailableReason: 'paused',
        lastReward: null,
      }),
      'Meu fã-clube. Fora do ar, toque para ver',
    ],
    ['no ar', manager({ lastReward: null }), 'Meu fã-clube. Seu fã-clube de Netto Brito'],
  ])('a meta da linha: %s', async (_name, state, name) => {
    mocked.fetchMyFanClub.mockResolvedValue(state);
    renderRouter(appTree, { initialUrl: '/ajustes' });
    expect(await screen.findByRole('button', { name })).toBeTruthy();
  });

  it('"Novo prêmio" até o gestor abrir o "Meu fã-clube", que marca o visto no aparelho', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(await screen.findByRole('button', { name: 'Meu fã-clube. Novo prêmio' }));
    expect(await screen.findByTestId('fan-club-dashboard')).toBeTruthy();
    expect(useFanClubPrizeStore.getState().seen['uid-camila']).toBe('2026-10-18T15:00:00.000Z');
    act(() => router.back());
    expect(
      await screen.findByRole('button', { name: 'Meu fã-clube. Seu fã-clube de Netto Brito' }),
    ).toBeTruthy();
  });
});

describe('as rotas novas a frio, antes da abertura', () => {
  it.each(['/meu-fa-clube', '/meu-fa-clube/candidatura', '/meu-fa-clube/nova-publicacao'])(
    '%s com o 404 da api de antes: "não está disponível", e nada mais é chamado',
    async (url) => {
      mocked.fetchMyFanClub.mockRejectedValue(notFound());
      renderRouter(appTree, { initialUrl: url });

      expect(await screen.findByText('O fã-clube não está disponível agora.')).toBeTruthy();
      expectOnlyTheGate();
    },
  );

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
  it('os 5 passos, um de cada vez, com "Passo N de 5"; o último abre a candidatura', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine());
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(
      await screen.findByLabelText(
        'Passo 1 de 5. Envie sua candidatura. Escolha o artista, proponha o nome do fã-clube e conte como você vai divulgar.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(PROGRAM.notice)).toBeTruthy();
    for (let step = 2; step <= 5; step += 1) {
      fireEvent.press(screen.getByTestId('fan-club-intro-next'));
      expect(screen.getByTestId('fan-club-intro-step').props.accessibilityLabel).toMatch(
        new RegExp(`^Passo ${step} de 5\\.`),
      );
    }
    expect(screen.queryByTestId('fan-club-intro-skip')).toBeNull();
    fireEvent.press(screen.getByTestId('fan-club-intro-next'));
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/candidatura'));
  });

  it('"Pular" abre a candidatura de qualquer passo; sem o texto do reconhecimento, ele some', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(mine({ notice: null }));
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    fireEvent.press(await screen.findByTestId('fan-club-intro-skip'));
    expect(screen.queryByTestId('fan-club-intro-notice')).toBeNull();
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube/candidatura'));
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
    fireEvent.press(await screen.findByTestId('fan-club-intro-skip'));

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
        'O nome não pode ter a palavra oficial, porque o fã-clube não é oficial.',
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

  it('encerrado pela equipe: o "Meu fã-clube" com o aviso, a frase do fim e os números, sem botão', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(
      manager({ status: 'closed', available: false, unavailableReason: 'closed' }),
    );
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('Você não pode mais ter um fã-clube.')).toBeTruthy();
    expect(screen.getByText('Seu fã-clube foi encerrado.')).toBeTruthy();
    expect(await screen.findByLabelText('Seguidores: 12')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-apply-again')).toBeNull();
    expect(screen.queryByTestId('fan-club-share')).toBeNull();
    expect(screen.queryByTestId('fan-club-new-post')).toBeNull();
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

describe('o "Meu fã-clube" (34.9, item 5)', () => {
  it('o cabeçalho com a faixa não oficial, os números com rótulo e o card Prêmios', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ featuredUntil: '2026-10-25' }));
    serverAnswers();
    const view = renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(
      await screen.findByRole('header', {
        name: 'Fã-clube, não oficial. Netto de Coração, de Netto Brito. Ativo.',
      }),
    ).toBeTruthy();
    expect(screen.getByText('Seu fã-clube é destaque até 25/10/2026')).toBeTruthy();
    expect(await screen.findByLabelText('Seguidores: 12')).toBeTruthy();
    expect(screen.getByLabelText('Novos em 30 dias: 5')).toBeTruthy();
    expect(screen.getByLabelText('Entradas trazidas: 2')).toBeTruthy();
    expect(screen.getByLabelText('Publicações no ar: 2')).toBeTruthy();
    expect(screen.getByLabelText('Em análise: 1')).toBeTruthy();
    expect(screen.getByText('+200 pontos e um prêmio em 18/10/2026')).toBeTruthy();
    expect(screen.getByText(PROGRAM.notice)).toBeTruthy();
    fireEvent.press(screen.getByTestId('fan-club-prizes-open'));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));
  });

  it('"Ver meus prêmios" e "Aceitar" ficam numa fileira, da altura do conteúdo', async () => {
    // Direto na coluna e alinhado ao começo, o desenho do Button cresce para
    // ocupar a altura que o pai der e esticava sem fim dentro da rolagem (o
    // card Prêmios no emulador Android, na conferência da etapa 10 de 34.14).
    // O Jest não mede o layout: o teste prende a fileira em volta de cada um.
    mocked.fetchMyFanClub.mockResolvedValue(manager({ rulesOutdated: true }));
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    const prizesRow = await screen.findByTestId('fan-club-prizes-open-row');
    expect(prizesRow).toHaveStyle({ flexDirection: 'row' });
    expect(within(prizesRow).getByTestId('fan-club-prizes-open')).toBeTruthy();
    const acceptRow = screen.getByTestId('fan-club-rules-accept-row');
    expect(acceptRow).toHaveStyle({ flexDirection: 'row' });
    expect(within(acceptRow).getByTestId('fan-club-rules-accept')).toBeTruthy();
  });

  it('"Compartilhar meu fã-clube": o link com o código, o código na mensagem e o link fanclub:<id>', async () => {
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

    fireEvent.press(await screen.findByTestId('fan-club-share'));

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

  it('fora do ar: o aviso com o motivo, sem Compartilhar nem Nova publicação', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(
      manager({ status: 'paused', available: false, unavailableReason: 'paused' }),
    );
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('Seu fã-clube está pausado pela equipe.')).toBeTruthy();
    expect(screen.queryByTestId('fan-club-share')).toBeNull();
    expect(screen.queryByTestId('fan-club-new-post')).toBeNull();
  });

  it('o regulamento mudou: o aviso e "Aceitar", com a versão de agora', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager({ rulesOutdated: true }));
    mocked.acceptFanClubRules.mockResolvedValue(manager());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('O regulamento mudou')).toBeTruthy();
    expect(screen.getByTestId('fan-club-new-post').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
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
  });

  it('"Minhas publicações": o status, o motivo da recusada, e Retirar com a confirmação', async () => {
    const page: FanClubListPage<OwnFanClubPost> = {
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
    };
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    mocked.fetchMyFanClubPosts.mockResolvedValue(page);
    mocked.removeFanClubPost.mockResolvedValue(ownPost({ id: 'fcp-1', status: 'withdrawn' }));
    serverAnswers();
    confirmAlerts();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByText('Motivo: Fora do assunto do artista.')).toBeTruthy();
    // O rótulo da linha: o ponto depois do texto só quando falta (etapa 10).
    expect(
      screen.getByLabelText('Em análise. Que show em Feira! Enviada em 19/10/2026.'),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Recusada. Outro texto. Enviada em 19/10/2026. Motivo: Fora do assunto do artista.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('fan-club-own-post-fcp-2-remove')).toBeNull();
    // Cada botão diz de qual publicação é.
    expect(screen.getByRole('button', { name: 'Tirar do ar a publicação: No ar' })).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', { name: 'Retirar a publicação: Que show em Feira!' }),
    );

    await waitFor(() =>
      expect(mocked.removeFanClubPost).toHaveBeenCalledWith({
        postId: 'fcp-1',
        idempotencyKey: expect.stringMatching(/^club-remove-/),
      }),
    );
    expect(await screen.findByText('Retirada')).toBeTruthy();
    expect(announced()).toContain('Publicação retirada.');
  });

  it('os números que não vieram: "Sem dado", e não carregando', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    mocked.fetchMyFanClubNumbers.mockRejectedValue(
      new ApiError('notFound', 'Não encontrado.', 404, 'fan_club_not_found'),
    );
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(await screen.findByLabelText('Seguidores: Sem dado')).toBeTruthy();
    expect(screen.getByLabelText('Visitas: Sem dado')).toBeTruthy();
    expect(screen.getByText('Não deu para carregar os números.')).toBeTruthy();
  });

  it('o card Prêmios traz as condições de conduta ao lado do texto do reconhecimento', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

    expect(
      await screen.findByText(
        'Para o reconhecimento: 18 anos ou mais, o fã-clube ativo e a conta sem suspensão.',
      ),
    ).toBeTruthy();
  });

  it('o WhatsApp para a equipe: o número guardado, Editar e Salvar pelo PUT /me/contact', async () => {
    mocked.fetchMyFanClub.mockResolvedValue(manager());
    serverAnswers();
    renderRouter(appTree, { initialUrl: '/meu-fa-clube' });

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
    await waitFor(() => expect(view.getPathname()).toBe('/meu-fa-clube'));
    expect(announced()).toContain('Enviado para revisão.');
    expect(mocked.openFanClubUpload).not.toHaveBeenCalled();
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

    fireEvent.press(await screen.findByTestId('fan-club-post-pick-photo'));
    expect(await screen.findByLabelText('A foto escolhida, recortada em 4 por 5')).toBeTruthy();
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
