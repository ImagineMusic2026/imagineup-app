import { onlineManager, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Alert, BackHandler, Linking, Text } from 'react-native';

import ReportFanRoute from '@/app/denunciar-perfil/[fanId]';
import FanPageRoute from '@/app/fa/[fanId]';
import { moderationFixture } from '@/domains/posts/fixtures';
import { SuspensionWatcher } from '@/domains/profile';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { createQueryClient } from '@/services/query/client';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { useSuspensionStore } from '@/stores/suspension';

// A sheet "Denunciar perfil" (seção 29 de docs/arquitetura-api.md, frente A),
// aberta pelo bloco "Segurança" do perfil público. O cliente do Query é o do
// app (`createQueryClient`, com o `MutationCache`) e o `SuspensionWatcher`
// fica na árvore, como no `AppProviders`: a conta suspensa tem a frase na
// sheet, sem o `Alert` por cima.

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
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), request: jest.fn() },
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

const UID = 'uid-camila';
const TITLE = 'Denunciar Thalita Santos';
const SUBMIT = 'Enviar denúncia';
const SENT = 'Denúncia enviada. A equipe vai analisar.';

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
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
  'fa/[fanId]': FanPageRoute,
  'denunciar-perfil/[fanId]': ReportFanRoute,
};

const spoken = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

/** O perfil da Thalita (completo) e a sheet aberta por "Denunciar perfil". */
async function openSheet(fanId = 'fa-rank-01', title = TITLE) {
  const view = renderRouter(appTree, { initialUrl: `/fa/${fanId}` });
  fireEvent.press(await screen.findByRole('button', { name: 'Denunciar perfil' }));
  await waitFor(() => expect(view.getPathname()).toBe(`/denunciar-perfil/${fanId}`));
  expect(await screen.findByRole('header', { name: title })).toBeTruthy();
  return view;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  moderationFixture.reset();
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
  jest.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib', city: null }),
    metadata: { fromCache: false },
  } as never);
  jest.mocked(onSnapshot).mockReturnValue(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  jest.restoreAllMocks();
});

// O link a frio fica antes: o Jest guarda os segmentos da última navegação.
describe('denunciar perfil aberto por link', () => {
  it('a frio, sem o perfil no cache, a sheet fecha e volta ao início', async () => {
    const view = renderRouter(appTree, { initialUrl: '/denunciar-perfil/fa-rank-01' });
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

describe('a sheet "Denunciar perfil" (seção 29)', () => {
  it('o título com o nome, o que a equipe analisa e os motivos, com "Sem motivo" escolhido', async () => {
    await openSheet();

    expect(
      screen.getByText(
        'A equipe do ImagineUP analisa a foto, o nome, o @, a bio e as redes. O motivo é opcional.',
      ),
    ).toBeTruthy();
    for (const name of ['Sem motivo', 'Spam', 'Ofensivo', 'Assédio', 'Outro']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(
      screen.getByRole('button', { name: 'Sem motivo' }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
  });

  it('envia com o motivo escolhido: fecha, anuncia e toca o sucesso', async () => {
    const reportFan = jest.spyOn(moderationFixture, 'reportFan');
    const view = await openSheet();

    fireEvent.press(screen.getByRole('button', { name: 'Assédio' }));
    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-01'));
    expect(reportFan).toHaveBeenCalledWith(
      'fa-rank-01',
      'harassment',
      expect.stringMatching(/^report-fan-fa-rank-01-/),
    );
    expect(spoken()).toContain(SENT);
    expect(haptics.trigger).toHaveBeenCalledWith('success');
  });

  it('"Sem motivo" manda null, e a segunda denúncia (already_reported) diz a mesma frase', async () => {
    const reportFan = jest.spyOn(moderationFixture, 'reportFan');
    const view = await openSheet();
    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-01'));
    expect(reportFan).toHaveBeenLastCalledWith('fa-rank-01', null, expect.any(String));
    expect(reportFan.mock.results.at(-1)?.value).toEqual({
      fanId: 'fa-rank-01',
      status: 'reported',
    });

    fireEvent.press(await screen.findByRole('button', { name: 'Denunciar perfil' }));
    expect(await screen.findByRole('header', { name: TITLE })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Spam' }));
    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));
    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-01'));
    expect(reportFan.mock.results.at(-1)?.value).toEqual({
      fanId: 'fa-rank-01',
      status: 'already_reported',
    });
    expect(spoken().filter((text) => text === SENT)).toHaveLength(2);
  });

  it('a conta suspensa: a frase com "Escrever para a equipe", sem o Alert, e a sheet fica', async () => {
    jest.spyOn(moderationFixture, 'reportFan').mockImplementation(() => {
      throw new ApiError('forbidden', 'Suspensa.', 403, 'account_suspended');
    });
    const view = await openSheet();

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    const short = 'Sua conta está suspensa. Fale com a equipe do ImagineUP.';
    expect(await screen.findByText(short)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Escrever para a equipe' })).toBeTruthy();
    expect(spoken()).toContain(short);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(view.getPathname()).toBe('/denunciar-perfil/fa-rank-01');
    // O `MutationCache` anota a recusa, e o perfil busca de novo; o `Alert` não abre.
    await waitFor(() => expect(useSuspensionStore.getState().refusals).toBe(1));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it.each([
    [
      'o teto do dia',
      () => new ApiError('dailyLimit', 'teto', 429, 'too_many_requests', { action: 'report' }),
      'Você chegou ao limite de denúncias de hoje. Tente amanhã.',
    ],
    [
      'o ritmo',
      () => new ApiError('rateLimited', 'ritmo', 429, 'rate_limited', null, 2000),
      'Muitos pedidos seguidos. Espere alguns segundos e tente de novo.',
    ],
    [
      'o 404',
      () => new ApiError('notFound', 'sumiu', 404, 'fan_not_found'),
      'Este fã não está mais no ImagineUP.',
    ],
    [
      'o genérico',
      () => new ApiError('server', 'fora', 500),
      'Não deu para enviar a denúncia. Tente de novo.',
    ],
  ])('%s: a frase acima do botão, anunciada, e a sheet fica', async (_case, error, text) => {
    jest.spyOn(moderationFixture, 'reportFan').mockImplementation(() => {
      throw error();
    });
    const view = await openSheet();

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    expect(await screen.findByText(text)).toBeTruthy();
    expect(spoken()).toContain(text);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(view.getPathname()).toBe('/denunciar-perfil/fa-rank-01');
    expect(screen.queryByRole('link', { name: 'Escrever para a equipe' })).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('a fechada (a conta privada) abre a mesma sheet, com o nome', async () => {
    await openSheet('fa-rank-05', 'Denunciar Aline Ferreira');
    expect(screen.getByRole('button', { name: SUBMIT })).toBeTruthy();
  });

  it('sem internet, "Enviar denúncia" fica desligado', async () => {
    await openSheet();
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('button', { name: SUBMIT }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('enquanto vai, o "×" e o voltar ficam presos; a resposta que chega com a sheet fechada só anuncia', async () => {
    const answer = deferred<{ fanId: string; status: 'reported' }>();
    jest.spyOn(moderationFixture, 'reportFan').mockImplementation(() => answer.promise as never);
    const view = await openSheet();
    const backPress = jest.spyOn(BackHandler, 'addEventListener');

    fireEvent.press(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled());
    const [, stay] = backPress.mock.calls.find(([event]) => event === 'hardwareBackPress') ?? [];
    expect(stay?.({} as Parameters<NonNullable<typeof stay>>[0])).toBe(true);

    // O arrasto da sheet no Android não trava: ela fecha com o pedido indo.
    act(() => router.back());
    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-01'));
    await act(async () => answer.resolve({ fanId: 'fa-rank-01', status: 'reported' }));

    await waitFor(() => expect(spoken()).toContain(SENT));
    expect(view.getPathname()).toBe('/fa/fa-rank-01');
  });
});
