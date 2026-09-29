import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Text } from 'react-native';

import OnboardingLayout, {
  unstable_settings as onboardingSettings,
} from '@/app/(onboarding)/_layout';
import ChooseArtistsRoute from '@/app/(onboarding)/artistas';
import AllArtistsRoute from '@/app/(onboarding)/todos-artistas';
import { buildArtistsFixture, followFixture } from '@/domains/artists/fixtures';
import type { FollowArtistsResult } from '@/domains/artists/types';
import { useArtistSelection } from '@/domains/onboarding/hooks/use-artist-selection';
import { useSessionGate } from '@/hooks/use-session-gate';
import { playStackExit } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { queryClient as appQueryClient } from '@/services/query/client';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// O build do Firebase que o Jest resolve é ESM. A 1l não fala com ele, mas a
// barra de etapas vem do domínio de conta, que importa o Firebase.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum. É o
// mesmo recurso do jestSetup.js do pacote: a lista acha que ocupa a tela toda.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 874 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 190, height: 166 })),
  };
});

// A API real passa pelo axios com o token do Firebase; aqui só importa o que a 1l pede a ela.
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// A saída em fade de verdade, espionada: um teste segura ela para ver a ordem.
jest.mock('@/hooks/use-stack-fade', () => {
  const actual = jest.requireActual('@/hooks/use-stack-fade');
  return { ...actual, playStackExit: jest.fn(actual.playStackExit) };
});

// Lido na hora da chamada: cada teste escolhe entre as fixtures e a API.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  get dataSource() {
    return mockDataSource;
  },
  firebaseEmulatorHost: undefined,
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const exit = jest.mocked(playStackExit);
const announce = () => jest.mocked(AccessibilityInfo.announceForAccessibility);

/** Promessa que o teste resolve quando quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sentKeys = () =>
  post.mock.calls.map(
    ([, , config]) => (config?.headers as Record<string, string>)['Idempotency-Key'],
  );

let client: QueryClient;

/** Layout raiz com os guards do app: concluir o onboarding troca para as abas. */
function RootLayout() {
  const { signedIn, onboarded } = useSessionGate();
  return (
    <QueryClientProvider client={client}>
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

function Home() {
  return <Text>home</Text>;
}

/** O grupo `(onboarding)` de verdade, pelos próprios arquivos de rota. */
const appTree = {
  _layout: RootLayout,
  '(onboarding)/_layout': { default: OnboardingLayout, unstable_settings: onboardingSettings },
  '(onboarding)/artistas': ChooseArtistsRoute,
  '(onboarding)/todos-artistas': AllArtistsRoute,
  '(tabs)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(tabs)/index': Home,
};

const cardName = (name: string, fans: string) =>
  t('onboarding.chooseArtists.cardLabel', { name, fans });

const NETTO = cardName('Netto Brito', '412 mil');
const NENHO = cardName('Nenho', '298 mil');
const JUNINHO = cardName('Juninho Moraes', '141 mil');

const continueButton = (label: string) => screen.getByRole('button', { name: label });

async function chooseFeatured(...names: string[]): Promise<void> {
  for (const name of names) {
    fireEvent.press(await screen.findByRole('button', { name }));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
  mockDataSource = 'fixtures';
  followFixture.reset();
  useArtistSelection.getState().clear();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'nova', email: 'nova@x.com', displayName: 'Beatriz Santos', photoURL: null },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: false,
    lastSessionUid: 'nova',
  });
});

describe('escolha de artistas (1l)', () => {
  it('abaixo de 3 o botão fica travado e diz quantos faltam; com 3, libera', async () => {
    renderRouter(appTree, { initialUrl: '/artistas' });

    const locked = continueButton(t('onboarding.chooseArtists.needMore', { count: 3 }));
    expect(locked).toBeDisabled();
    expect(locked).toHaveProp(
      'accessibilityHint',
      t('onboarding.chooseArtists.needMoreHint', { min: 3 }),
    );

    await chooseFeatured(NETTO, NENHO);
    expect(screen.getByRole('button', { name: NETTO, selected: true })).toBeOnTheScreen();
    expect(continueButton(t('onboarding.chooseArtists.needMoreOne'))).toBeDisabled();

    await chooseFeatured(JUNINHO);
    const ready = continueButton(t('onboarding.chooseArtists.continue', { count: 3 }));
    expect(ready).toBeEnabled();
    expect(ready.props.accessibilityHint).toBeUndefined();

    // Desmarcar volta a travar.
    await chooseFeatured(NENHO);
    expect(continueButton(t('onboarding.chooseArtists.needMoreOne'))).toBeDisabled();
  });

  it('mostra os 4 artistas em destaque, o "+18 artistas" e a busca, com a etapa 2 de 2', async () => {
    renderRouter(appTree, { initialUrl: '/artistas' });

    for (const name of [NETTO, NENHO, JUNINHO, cardName('Rock Salles', '96 mil')]) {
      expect(await screen.findByRole('button', { name, selected: false })).toBeOnTheScreen();
    }
    expect(
      screen.getByRole('button', { name: t('onboarding.chooseArtists.moreLabel', { count: 18 }) }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: t('onboarding.chooseArtists.searchLabel') }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('progressbar', {
        name: t('components.stepProgress.label', { current: 2, total: 2 }),
      }),
    ).toBeOnTheScreen();
  });

  it('a sheet de todos os artistas escolhe na mesma lista da tela de trás', async () => {
    const view = renderRouter(appTree, { initialUrl: '/artistas' });
    await chooseFeatured(NETTO);

    fireEvent.press(
      screen.getByRole('button', { name: t('onboarding.chooseArtists.moreLabel', { count: 18 }) }),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/todos-artistas'));
    expect(
      screen.getByRole('header', { name: t('onboarding.chooseArtists.allTitle') }),
    ).toBeOnTheScreen();

    // Pelo "+18", a sheet abre na lista, sem a busca focada.
    expect(view.getSearchParams()).toEqual({});
    const search = screen.getByPlaceholderText(t('onboarding.chooseArtists.search'));
    expect(search).toHaveProp('autoFocus', false);

    // O que foi escolhido atrás já vem marcado na sheet. A tela de trás fica fora do
    // leitor de tela enquanto a sheet está aberta, então só os cards da sheet aparecem.
    fireEvent.changeText(search, 'netto');
    expect(screen.getByRole('button', { name: NETTO, selected: true })).toBeOnTheScreen();

    // Os que só a sheet mostra.
    fireEvent.changeText(search, 'artista 2');
    await chooseFeatured(cardName('Artista 21', '26 mil'), cardName('Artista 22', '22 mil'));

    fireEvent.press(screen.getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(view.getPathname()).toBe('/artistas'));
    expect(continueButton(t('onboarding.chooseArtists.continue', { count: 3 }))).toBeEnabled();

    // Desmarcar na sheet também vale lá atrás: o botão volta a travar.
    fireEvent.press(
      screen.getByRole('button', { name: t('onboarding.chooseArtists.searchLabel') }),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/todos-artistas'));
    fireEvent.changeText(
      screen.getByPlaceholderText(t('onboarding.chooseArtists.search')),
      'netto',
    );
    fireEvent.press(screen.getByRole('button', { name: NETTO, selected: true }));
    fireEvent.press(screen.getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(view.getPathname()).toBe('/artistas'));
    expect(continueButton(t('onboarding.chooseArtists.needMoreOne'))).toBeDisabled();
  });

  it('"Buscar por nome" abre a sheet já na busca, sem acento nem maiúscula', async () => {
    const view = renderRouter(appTree, { initialUrl: '/artistas' });

    fireEvent.press(
      await screen.findByRole('button', { name: t('onboarding.chooseArtists.searchLabel') }),
    );
    await waitFor(() => expect(view.getPathname()).toBe('/todos-artistas'));
    expect(view.getSearchParams()).toEqual({ buscar: '1' });

    const search = screen.getByPlaceholderText(t('onboarding.chooseArtists.search'));
    expect(search).toHaveProp('autoFocus', true);
    expect(search).toHaveProp('accessibilityLabel', t('onboarding.chooseArtists.searchLabel'));

    fireEvent.changeText(search, 'ROCK SÁLLES');
    expect(
      screen.getByRole('button', { name: cardName('Rock Salles', '96 mil') }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: NETTO })).toBeNull();

    fireEvent.changeText(search, 'ninguém com esse nome');
    expect(screen.getByText(t('onboarding.chooseArtists.noResults'))).toBeOnTheScreen();
    fireEvent.changeText(search, 'ninguém com esse nome mesmo');
    expect(
      announce().mock.calls.filter(
        ([message]) => message === t('onboarding.chooseArtists.noResults'),
      ),
    ).toHaveLength(1);
  });

  it('aberta a frio, a sheet fecha para a escolha de artistas', async () => {
    const view = renderRouter(appTree, { initialUrl: '/todos-artistas' });
    fireEvent.press(await screen.findByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(view.getPathname()).toBe('/artistas'));
  });
});

describe('concluir a escolha de artistas', () => {
  it('segue os artistas com chave de idempotência e só então conclui e vai para as abas', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: buildArtistsFixture() });
    let answer: (value: { data: FollowArtistsResult }) => void = () => undefined;
    post.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );

    const view = renderRouter(appTree, { initialUrl: '/artistas' });
    await chooseFeatured(NENHO, NETTO, JUNINHO);
    const label = t('onboarding.chooseArtists.continue', { count: 3 });
    fireEvent.press(continueButton(label));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      '/me/artists',
      { artistIds: ['nenho', 'netto-brito', 'juninho-moraes'] },
      { headers: { 'Idempotency-Key': expect.stringMatching(/.+/) } },
    );

    // Salvando: o botão fica ocupado, os cards travam e o onboarding espera a API.
    expect(continueButton(label)).toBeBusy();
    expect(screen.getByRole('button', { name: NETTO })).toBeDisabled();
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);

    act(() => answer({ data: { followedArtistIds: ['nenho', 'netto-brito', 'juninho-moraes'] } }));

    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(screen.getByText('home')).toBeOnTheScreen();
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(true);
    expect(haptics.trigger).toHaveBeenCalledWith('confirm');
    // A próxima escolha, em outra conta neste aparelho, começa vazia.
    expect(useArtistSelection.getState().selectedIds).toEqual([]);
  });

  it('a 1l sai em fade e só depois conclui o onboarding', async () => {
    const fade = deferred<void>();
    exit.mockImplementationOnce(() => fade.promise);

    const view = renderRouter(appTree, { initialUrl: '/artistas' });
    await chooseFeatured(NETTO, NENHO, JUNINHO);
    fireEvent.press(continueButton(t('onboarding.chooseArtists.continue', { count: 3 })));

    // Seguiu, e a saída começou: o onboarding ainda não foi concluído.
    await waitFor(() => expect(exit).toHaveBeenCalledWith('onboarding'));
    expect(followFixture.followedIds()).toEqual(
      expect.arrayContaining(['netto-brito', 'nenho', 'juninho-moraes']),
    );
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);
    expect(view.getPathname()).toBe('/artistas');

    await act(async () => fade.resolve());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(true);
  });

  it('nas fixtures, os artistas escolhidos passam a ser seguidos', async () => {
    const view = renderRouter(appTree, { initialUrl: '/artistas' });
    await chooseFeatured(cardName('Rock Salles', '96 mil'), NETTO, NENHO);
    fireEvent.press(continueButton(t('onboarding.chooseArtists.continue', { count: 3 })));

    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(followFixture.followedIds()).toContain('rock-salles');
  });

  it('se não salvar, avisa, não conclui e deixa tentar de novo com a mesma chave', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: buildArtistsFixture() });
    post.mockRejectedValue(new ApiError('network', 'sem rede'));

    const view = renderRouter(appTree, { initialUrl: '/artistas' });
    await chooseFeatured(NETTO, NENHO, JUNINHO);
    const label = t('onboarding.chooseArtists.continue', { count: 3 });
    fireEvent.press(continueButton(label));

    expect(await screen.findByText(t('onboarding.chooseArtists.saveError'))).toBeOnTheScreen();
    expect(announce()).toHaveBeenCalledWith(t('onboarding.chooseArtists.saveError'));
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(usePreferencesStore.getState().hasCompletedOnboarding).toBe(false);
    expect(view.getPathname()).toBe('/artistas');

    // A mesma escolha de novo é a mesma ação: se a rede caiu depois de o
    // servidor gravar, a chave igual não segue duas vezes.
    fireEvent.press(continueButton(label));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(t('onboarding.chooseArtists.saveError'))).toBeOnTheScreen();
    const [first, second] = sentKeys();
    expect(second).toBe(first);

    // Mudou a escolha: o erro, que era da escolha anterior, sai, e a ação é nova.
    await chooseFeatured(cardName('Rock Salles', '96 mil'));
    await waitFor(() =>
      expect(screen.queryByText(t('onboarding.chooseArtists.saveError'))).toBeNull(),
    );

    post.mockResolvedValueOnce({ data: { followedArtistIds: [] } });
    fireEvent.press(continueButton(t('onboarding.chooseArtists.continue', { count: 4 })));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(sentKeys()[2]).not.toBe(first);
  });

  it('com as opções do app, sem rede o erro aparece na hora, sem tentar sozinho', async () => {
    client = new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() });
    mockDataSource = 'api';
    get.mockResolvedValue({ data: buildArtistsFixture() });
    post.mockRejectedValue(new ApiError('network', 'sem rede'));

    renderRouter(appTree, { initialUrl: '/artistas' });
    await chooseFeatured(NETTO, NENHO, JUNINHO);
    fireEvent.press(continueButton(t('onboarding.chooseArtists.continue', { count: 3 })));

    expect(await screen.findByText(t('onboarding.chooseArtists.saveError'))).toBeOnTheScreen();
    expect(post).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('lista que não carregou mostra o erro e tenta de novo sem perder o foco', async () => {
    mockDataSource = 'api';
    const retried = deferred<{ data: ReturnType<typeof buildArtistsFixture> }>();
    get
      .mockRejectedValueOnce(new ApiError('forbidden', 'recusado', 403))
      .mockReturnValueOnce(retried.promise);

    renderRouter(appTree, { initialUrl: '/artistas' });

    expect(await screen.findByText(t('onboarding.chooseArtists.loadError'))).toBeOnTheScreen();
    expect(announce()).toHaveBeenCalledWith(t('onboarding.chooseArtists.loadError'));
    expect(continueButton(t('onboarding.chooseArtists.needMore', { count: 3 }))).toBeDisabled();

    // Buscando de novo, o botão focado fica na tela, ocupado, e a falha não é anunciada de novo.
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    await waitFor(() => expect(screen.getByRole('button', { name: t('common.retry') })).toBeBusy());
    expect(screen.getByText(t('onboarding.chooseArtists.loadError'))).toBeOnTheScreen();
    expect(announce()).toHaveBeenCalledTimes(1);

    // Chegou: o foco do leitor de tela vai para o primeiro card.
    await act(async () => retried.resolve({ data: buildArtistsFixture() }));
    expect(await screen.findByRole('button', { name: NETTO })).toBeOnTheScreen();
    await waitFor(() =>
      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
        expect.anything(),
        'focus',
      ),
    );
  });
});
