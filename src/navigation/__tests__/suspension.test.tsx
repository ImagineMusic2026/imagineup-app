import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Alert, Linking, Text, type AlertButton } from 'react-native';

import OnboardingLayout, {
  unstable_settings as onboardingSettings,
} from '@/app/(onboarding)/_layout';
import ChooseArtistsRoute from '@/app/(onboarding)/artistas';
import AllArtistsRoute from '@/app/(onboarding)/todos-artistas';
import HomeRoute from '@/app/(tabs)/(inicio)/index';
import ProfileRoute from '@/app/(tabs)/(perfil)/perfil';
import CommentOptionsRoute from '@/app/comentario/[comentarioId]';
import InviteRoute from '@/app/convidar';
import EditProfileRoute from '@/app/editar-perfil';
import PostRoute from '@/app/post/[postId]';
import RewardDetailsRoute from '@/app/recompensa/[recompensaId]';
import { followFixture } from '@/domains/artists/fixtures';
import { missionsFixture } from '@/domains/missions';
import { useArtistSelection } from '@/domains/onboarding/hooks/use-artist-selection';
import { moderationFixture, postsFixture } from '@/domains/posts/fixtures';
import { SuspensionWatcher } from '@/domains/profile';
import { rewardsFixture } from '@/domains/rewards/fixtures';
import { useSessionGate } from '@/hooks/use-session-gate';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { createQueryClient } from '@/services/query/client';
import { REFUSAL_ALERT_LOCK_MS, resetRefusalAlerts } from '@/services/refusal-alert';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { useSuspensionStore } from '@/stores/suspension';

// A conta suspensa no app (seção 29 de docs/arquitetura-api.md, frente E): o
// aviso fixo da 1b e da 1e (o dos Ajustes fica no settings.test.tsx), o
// `Alert` "Conta suspensa" nas ações sem texto na tela (uma vez a cada 30 s;
// com a trava, a frase anunciada) e, um canal só por recusa, a frase com o link
// "Escrever para a equipe" nas telas que já mostram erro. O cliente do Query é
// o do app (`createQueryClient`, com o `MutationCache`) e o
// `SuspensionWatcher` fica na árvore, como no `AppProviders`.

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
  storageFileExists: jest.fn(),
  uploadLocalFile: jest.fn(),
}));
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api/errors'),
  api: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn(), request: jest.fn() },
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
// Tudo nas fixtures; a edição do perfil e o convite põem o domínio deles na API.
let mockSources: Record<string, 'api' | 'fixtures'> = {};
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => mockSources[domain] ?? 'fixtures',
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

const UID = 'uid-camila';
const NOW = new Date('2026-10-13T15:00:00.000Z');
const SUSPENDED = () => new ApiError('forbidden', 'Suspensa.', 403, 'account_suspended');
const SHORT = 'Sua conta está suspensa. Fale com a equipe do ImagineUP.';
const CONTACT = 'Escrever para a equipe';
const MAILTO = 'mailto:music@imaginegroup.com.br?subject=Conta%20suspensa%20no%20ImagineUP';

type ProfileData = Record<string, unknown>;

const CAMILA: ProfileData = {
  displayName: 'Camila Ribeiro',
  username: 'camilarib',
  city: null,
  photoURL: null,
  bio: null,
};
const suspendedCamila = (reason: unknown): ProfileData => ({
  ...CAMILA,
  suspendedAt: '2026-10-10T12:00:00.000Z',
  suspensionReason: reason,
});

const snapshot = (data: ProfileData) => ({
  exists: () => true,
  data: () => data,
  metadata: { fromCache: false },
});

let client: QueryClient;

/** O layout raiz com o cliente do app e o `SuspensionWatcher`, como o `AppProviders`. */
function RootLayout() {
  return (
    <QueryClientProvider client={client}>
      <SuspensionWatcher />
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

/** A 1b, a 1e, o post, as sheets, o resgate, a edição do perfil e o convite de verdade. */
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
  '(tabs)/(ranking)/recompensas': label('rewards'),
  '(tabs)/(perfil)/perfil': ProfileRoute,
  '(tabs)/(perfil)/ajustes': label('settings'),
  '(tabs)/(perfil)/extrato': label('ledger'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  'post/[postId]': PostRoute,
  'comentario/[comentarioId]': CommentOptionsRoute,
  'recompensa/[recompensaId]': RewardDetailsRoute,
  'editar-perfil': EditProfileRoute,
  convidar: InviteRoute,
  'fa/[fanId]': label('fan'),
};

const alert = () => jest.mocked(Alert.alert);
const alertTitles = () => alert().mock.calls.map(([title]) => title);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

function setProfile(data: ProfileData): void {
  jest.mocked(getDoc).mockResolvedValue(snapshot(data) as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSources = {};
  postsFixture.reset();
  moderationFixture.reset();
  missionsFixture.reset();
  fixtureWallet.reset();
  followFixture.reset();
  rewardsFixture.reset();
  resetRefusalAlerts();
  useSuspensionStore.getState().reset();
  client = createQueryClient({
    queries: { gcTime: Infinity },
    mutations: { gcTime: Infinity },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: UID,
      email: 'camila@teste.imagineup',
      displayName: 'Camila Ribeiro',
      photoURL: null,
    },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: UID,
  });
  setProfile(CAMILA);
  jest.mocked(onSnapshot).mockReturnValue(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('o aviso fixo da conta suspensa', () => {
  it('na 1b, com o motivo e o link "Escrever para a equipe"', async () => {
    setProfile(suspendedCamila('offensive'));
    renderRouter(appTree, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: 'Sua conta está suspensa' })).toBeTruthy();
    expect(
      screen.getByText(
        'Você continua vendo o app, mas não pode curtir, comentar, confirmar presença, entrar em centrais, resgatar, denunciar nem mudar o perfil.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Motivo: conteúdo ofensivo.')).toBeTruthy();

    fireEvent.press(screen.getByRole('link', { name: CONTACT }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(MAILTO));
  });

  it('na 1e, com o motivo pelos textos da suspensão; com "other", sem a linha', async () => {
    setProfile(suspendedCamila('spam'));
    const view = renderRouter(appTree, { initialUrl: '/perfil' });
    expect(await screen.findByText('Motivo: envio de spam.')).toBeTruthy();
    view.unmount();
    client.clear();

    setProfile(suspendedCamila('other'));
    renderRouter(appTree, { initialUrl: '/perfil' });
    expect(await screen.findByRole('header', { name: 'Sua conta está suspensa' })).toBeTruthy();
    expect(screen.queryByText(/^Motivo:/)).toBeNull();
  });

  it('o e-mail que não abre: o endereço na tela, selecionável, e anunciado', async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('sem app de e-mail'));
    setProfile(suspendedCamila('harassment'));
    renderRouter(appTree, { initialUrl: '/' });
    expect(await screen.findByText('Motivo: assédio.')).toBeTruthy();

    fireEvent.press(screen.getByRole('link', { name: CONTACT }));
    const text = 'Não deu para abrir o e-mail. Escreva para music@imaginegroup.com.br.';
    expect(await screen.findByText(text)).toHaveProp('selectable', true);
    expect(announced()).toContain(text);
  });

  it('sem a suspensão, nada', async () => {
    renderRouter(appTree, { initialUrl: '/' });
    expect(await screen.findByText('Do seu fandom')).toBeTruthy();
    expect(screen.queryByTestId('suspended-notice')).toBeNull();
  });
});

describe('o Alert "Conta suspensa" nas ações sem texto na tela', () => {
  it('a curtida recusada com 403: um Alert a cada 30 s, sem o anúncio genérico, e o perfil busca de novo', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    const like = jest.spyOn(postsFixture, 'setLike').mockImplementation(() => {
      throw SUSPENDED();
    });
    renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    const reads = () => jest.mocked(getDoc).mock.calls.length;

    fireEvent.press(await screen.findByRole('button', { name: 'Curtir, 4.812 curtidas' }));
    await waitFor(() => expect(alertTitles()).toEqual(['Conta suspensa']));
    const [, message, buttons] = alert().mock.calls[0] as [string, string, AlertButton[]];
    expect(message).toContain('escreva para music@imaginegroup.com.br.');
    expect(buttons.map((button) => button.text)).toEqual([CONTACT, 'Entendi']);
    expect(announced()).not.toContain('Não deu para curtir o post. Tente de novo.');
    expect(announced()).not.toContain(SHORT);
    // O coração volta, e o perfil busca de novo (o aviso fixo vem dele).
    expect(await screen.findByRole('button', { name: 'Curtir, 4.812 curtidas' })).toBeTruthy();
    const readsAfterRefusal = reads();
    expect(readsAfterRefusal).toBeGreaterThan(1);

    // A segunda recusa logo depois não abre outro, e a frase do suspenso é
    // anunciada: a recusa não fica calada.
    fireEvent.press(screen.getByRole('button', { name: 'Curtir, 4.812 curtidas' }));
    await waitFor(() => expect(like).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(reads()).toBeGreaterThan(readsAfterRefusal));
    expect(alertTitles()).toEqual(['Conta suspensa']);
    await waitFor(() => expect(announced()).toContain(SHORT));
    expect(announced()).not.toContain('Não deu para curtir o post. Tente de novo.');

    // Passados 30 s, abre de novo.
    act(() => jest.setSystemTime(Date.now() + REFUSAL_ALERT_LOCK_MS));
    fireEvent.press(screen.getByRole('button', { name: 'Curtir, 4.812 curtidas' }));
    await waitFor(() => expect(alertTitles()).toEqual(['Conta suspensa', 'Conta suspensa']));
  });
});

describe('a frase com o link nas telas que mostram erro, sem o Alert', () => {
  const THALITA_ROW =
    'Thalita S., há 1 hora: Já mandei pro grupo da família inteira, Irará em peso! 💃';

  it('a sheet de denúncia de comentário', async () => {
    jest.spyOn(moderationFixture, 'report').mockImplementation(() => {
      throw SUSPENDED();
    });
    const view = renderRouter(appTree, { initialUrl: '/post/p-clipe' });
    expect(await screen.findByLabelText(THALITA_ROW)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Opções do comentário de Thalita S.' }));
    await waitFor(() => expect(view.getPathname()).toBe('/comentario/c-clipe-thalita'));

    fireEvent.press(await screen.findByRole('button', { name: 'Denunciar comentário' }));
    expect(await screen.findByText(SHORT)).toBeTruthy();
    expect(screen.getByRole('link', { name: CONTACT })).toBeTruthy();
    expect(announced()).toContain(SHORT);
    // A sheet fica, e o Alert não abre por cima da frase.
    expect(view.getPathname()).toBe('/comentario/c-clipe-thalita');
    await waitFor(() => expect(useSuspensionStore.getState().refusals).toBe(1));
    expect(alert()).not.toHaveBeenCalled();
  });

  it('o resgate: o estado da conta suspensa, definitivo, no detalhe', async () => {
    jest.spyOn(rewardsFixture, 'redeem').mockImplementation(() => {
      throw SUSPENDED();
    });
    renderRouter(appTree, { initialUrl: '/recompensa/videochamada' });

    fireEvent.press(await screen.findByRole('button', { name: 'Resgatar por 8.500 pontos' }));
    fireEvent.press(await screen.findByRole('button', { name: t('rewards.confirm.action') }));

    const text = 'Sua conta está suspensa. Você não pode resgatar.';
    expect(await screen.findByLabelText(text)).toBeTruthy();
    expect(screen.getByRole('link', { name: CONTACT })).toBeTruthy();
    // De volta ao detalhe, com o botão do resgate.
    expect(screen.getByRole('button', { name: 'Resgatar por 8.500 pontos' })).toBeTruthy();
    await waitFor(() => expect(useSuspensionStore.getState().refusals).toBe(1));
    expect(alert()).not.toHaveBeenCalled();
  });

  it('a edição do perfil: a frase de agora, com o link, e o ✓ apagado', async () => {
    mockSources = { profile: 'api' };
    jest.mocked(api.put).mockRejectedValueOnce(SUSPENDED());
    renderRouter(appTree, { initialUrl: '/editar-perfil' });

    fireEvent.changeText(await screen.findByTestId('edit-profile-bio'), 'Salvador.');
    fireEvent.press(screen.getByTestId('edit-profile-save'));

    expect(await screen.findByText(SHORT)).toBeTruthy();
    expect(screen.getByRole('link', { name: CONTACT })).toBeTruthy();
    expect(screen.getByTestId('edit-profile-save')).toBeDisabled();
    await waitFor(() => expect(useSuspensionStore.getState().refusals).toBe(1));
    expect(alert()).not.toHaveBeenCalled();
  });

  it('o compositor dá lugar à frase com a conta suspensa', async () => {
    setProfile(suspendedCamila('spam'));
    renderRouter(appTree, { initialUrl: '/post/p-clipe' });

    expect(
      await screen.findByText('Sua conta está suspensa. Você não pode comentar.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: CONTACT })).toBeTruthy();
    expect(screen.queryByTestId('comment-input')).toBeNull();
  });

  it('o comentário recusado antes de o perfil mostrar a suspensão volta ao campo, com a frase', async () => {
    jest.spyOn(postsFixture, 'addComment').mockImplementation(() => {
      throw SUSPENDED();
    });
    renderRouter(appTree, { initialUrl: '/post/p-clipe' });

    fireEvent.changeText(await screen.findByTestId('comment-input'), 'Que clipe!');
    fireEvent.press(screen.getByTestId('comment-send'));

    const text = 'Sua conta está suspensa. Você não pode comentar.';
    expect(await screen.findByTestId('comment-refusal')).toHaveTextContent(text);
    expect(screen.getByTestId('comment-input')).toHaveProp('value', 'Que clipe!');
    expect(announced()).toContain(text);
    expect(screen.getByRole('link', { name: CONTACT })).toBeTruthy();
    await waitFor(() => expect(useSuspensionStore.getState().refusals).toBe(1));
    expect(alert()).not.toHaveBeenCalled();
  });

  it('a sheet do convite: o suspenso sem código, sem "Tentar de novo"', async () => {
    mockSources = { invite: 'api' };
    setProfile(suspendedCamila('spam'));
    jest.mocked(api.get).mockRejectedValue(SUSPENDED());
    renderRouter(appTree, { initialUrl: '/convidar' });

    expect(
      await screen.findByText('Sua conta está suspensa. O link sai sem os pontos.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: CONTACT })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(screen.queryByText(t('invite.noCode'))).toBeNull();
  });
});

describe('o onboarding do suspenso', () => {
  /** Os guards do app: concluir o onboarding troca para as abas. */
  function GuardedLayout() {
    const { signedIn, onboarded } = useSessionGate();
    return (
      <QueryClientProvider client={client}>
        <SuspensionWatcher />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={signedIn && !onboarded}>
            <Stack.Screen name="(onboarding)" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn && onboarded}>
            <Stack.Screen name="(tabs)" />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    );
  }

  const onboardingTree = {
    _layout: GuardedLayout,
    '(onboarding)/_layout': { default: OnboardingLayout, unstable_settings: onboardingSettings },
    '(onboarding)/artistas': ChooseArtistsRoute,
    '(onboarding)/todos-artistas': AllArtistsRoute,
    '(tabs)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
    '(tabs)/index': label('home'),
  };

  const cardName = (name: string, fans: string) =>
    t('onboarding.chooseArtists.cardLabel', { name, fans });

  it('o 403 conclui o onboarding sem seguir, e o Alert explica', async () => {
    usePreferencesStore.setState({ hasCompletedOnboarding: false });
    useArtistSelection.getState().clear();
    const follow = jest.spyOn(followFixture, 'follow').mockImplementation(() => {
      throw SUSPENDED();
    });
    const view = renderRouter(onboardingTree, { initialUrl: '/artistas' });

    for (const name of [
      cardName('Netto Brito', '412 mil'),
      cardName('Nenho', '298 mil'),
      cardName('Juninho Moraes', '141 mil'),
    ]) {
      fireEvent.press(await screen.findByRole('button', { name }));
    }
    fireEvent.press(
      screen.getByRole('button', { name: t('onboarding.chooseArtists.continue', { count: 3 }) }),
    );

    await waitFor(() => expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(true));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(follow).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(t('onboarding.chooseArtists.saveError'))).toBeNull();
    expect(announced()).not.toContain(t('onboarding.chooseArtists.saveError'));
    await waitFor(() => expect(alertTitles()).toEqual(['Conta suspensa']));
  });
});
