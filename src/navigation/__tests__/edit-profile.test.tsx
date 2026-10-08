import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  Dimensions,
  StyleSheet,
  Text,
  type AlertButton,
} from 'react-native';

import EditProfileRoute from '@/app/editar-perfil';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import ProfileRoute from '@/app/(tabs)/(perfil)/perfil';
import { followFixture } from '@/domains/artists/fixtures';
import { storageFileExists, uploadLocalFile } from '@/firebase';
import { api, ApiError } from '@/services/api';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// A tela "Editar perfil" (seção 28 de docs/arquitetura-api.md, sobre a 24.12):
// fora das abas, com o X, o título e o ✓; toda a edição pela API num
// PUT /me/profile (o axios mockado), a foto pelo fluxo do bloco 9, com o
// seletor de imagem e o manipulador mockados. O perfil vem do Firestore
// mockado, com a escuta que o teste dispara.

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
  api: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  ImageManipulator: { manipulate: jest.fn() },
}));

let mockDataSource: 'api' | 'fixtures' = 'api';
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

// Quarta, 7 de outubro de 2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-07T15:00:00.000Z');
const UID = 'uidCamila';
const hidden = { includeHiddenElements: true } as const;

type ProfileData = Record<string, unknown>;

const CAMILA: ProfileData = {
  displayName: 'Camila Ribeiro',
  username: 'camilarib',
  city: 'Feira de Santana, BA',
  photoURL: null,
  bio: 'Feira de Santana.',
};

/** O perfil editável que o PUT /me/profile devolve, a partir do documento. */
const editable = (data: ProfileData) => ({
  displayName: data.displayName ?? null,
  username: data.username ?? null,
  usernameChangeableAt: null,
  bio: data.bio ?? null,
  city: data.city ?? null,
  gender: data.gender ?? null,
  privateAccount: data.privateAccount === true,
  socials: { instagram: null, tiktok: null, linkedin: null, x: null },
});

const snapshot = (data: ProfileData) => ({
  exists: () => true,
  data: () => data,
  metadata: { fromCache: false },
});

let client: QueryClient;

function RootLayout() {
  return (
    <QueryClientProvider client={client}>
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
  // A 1e fica na base da pilha do Perfil (a âncora): com a API ligada, a de
  // verdade leria a carteira. Só o teste das entradas a usa.
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  // Na pilha raiz, fora das abas (seção 28).
  'editar-perfil': EditProfileRoute,
};

/** A árvore com a 1e de verdade (nas fixtures), para o toque no hero. */
const treeWithProfile = { ...appTree, '(tabs)/(perfil)/perfil': ProfileRoute };

const get = jest.mocked(api.get);
const put = jest.mocked(api.put);
const remove = jest.mocked(api.delete);
const post = jest.mocked(api.post);

const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);
const announcedInQueue = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

/** A escuta do perfil: o teste manda a versão nova do documento. */
let emitProfile: (data: ProfileData) => void = () => undefined;

/** Abre a tela com o perfil dado e espera o formulário. */
async function openEditProfile(profile: ProfileData = CAMILA) {
  jest.mocked(getDoc).mockResolvedValue(snapshot(profile) as never);
  const view = renderRouter(appTree, { initialUrl: '/editar-perfil' });
  await screen.findByTestId(
    mockDataSource === 'api' ? 'edit-profile-name' : 'edit-profile-read-only',
  );
  return view;
}

/** O PUT /me/profile que responde com o perfil depois da mudança. */
function answerProfile(base: ProfileData = CAMILA): void {
  put.mockImplementation(async (url, body) => {
    if (url !== '/me/profile') throw new Error(`PUT inesperado: ${url}`);
    return { data: editable({ ...base, ...(body as ProfileData) }) };
  });
}

/** Um pedido que o teste resolve na hora que quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const saveButton = () => screen.getByTestId('edit-profile-save');
const nameInput = () => screen.getByTestId('edit-profile-name');
const usernameInput = () => screen.getByTestId('edit-profile-username-input');
const bioInput = () => screen.getByTestId('edit-profile-bio');
const cityInput = () => screen.getByTestId('edit-profile-city');
const usernameLine = () => screen.getByTestId('edit-profile-username-status', hidden);
const closeButton = () => screen.getByRole('button', { name: 'Fechar' });

/** O corpo e a chave de cada PUT /me/profile. */
const profilePuts = () =>
  put.mock.calls
    .filter(([url]) => url === '/me/profile')
    .map(([, body, config]) => ({
      body,
      key: (config as { headers: Record<string, string> }).headers['Idempotency-Key'],
      signal: (config as { signal?: AbortSignal }).signal,
    }));

/** O último "Descartar alterações?" (ou "Sair com a foto indo?") que a tela abriu. */
function lastAlert(): { title: string; message?: string; buttons: AlertButton[] } {
  const call = jest.mocked(Alert.alert).mock.calls.at(-1);
  if (!call) throw new Error('nenhum diálogo');
  return { title: call[0], message: call[1], buttons: call[2] ?? [] };
}

/** O voltar do Android, pela escuta que a tela registrou por último. */
function pressAndroidBack(spy: jest.SpyInstance): boolean | null | undefined {
  const calls = spy.mock.calls.filter(([event]) => event === 'hardwareBackPress');
  const listener = calls.at(-1)?.[1] as (() => boolean | null | undefined) | undefined;
  return listener?.();
}

/** O blob do arquivo preparado, com o tamanho, como o React Native devolve. */
class FakeXhr {
  response: unknown = null;
  responseType = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open() {}
  send() {
    this.response = { size: 40_000, close: () => undefined };
    this.onload?.();
  }
}

const realXhr = globalThis.XMLHttpRequest;

/** A galeria devolve uma foto, e o manipulador a prepara. */
function mockGallery(): void {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///galeria.jpg', width: 1200, height: 900 }],
  } as never);
  type Context = { crop: jest.Mock; resize: jest.Mock; renderAsync: jest.Mock };
  const context: Context = {
    crop: jest.fn((): Context => context),
    resize: jest.fn((): Context => context),
    renderAsync: jest.fn(async () => ({
      width: 512,
      height: 512,
      saveAsync: jest.fn(async () => ({ uri: 'file:///pronta.jpg', width: 512, height: 512 })),
    })),
  };
  jest.mocked(ImageManipulator.manipulate).mockReturnValue(context as never);
}

/** A vaga do envio (proteção contra abuso, 27.4) responde o caminho pedido. */
function mockPhotoSlot(): void {
  mockGallery();
  jest.mocked(uploadLocalFile).mockResolvedValue(undefined);
  post.mockImplementation(async (_url, body) => ({
    data: { path: (body as { path: string }).path, expiresAt: '2026-10-07T15:10:00.000Z' },
  }));
}

/** Abre as opções da foto e escolhe a galeria. */
function pickFromGallery(): void {
  fireEvent.press(screen.getByRole('button', { name: 'Trocar foto' }));
  fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));
}

const avatarUri = () =>
  screen.UNSAFE_queryAllByType(Image).map((image) => (image.props.source as { uri: string }).uri);

const window = Dimensions.get('window');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  setFixtureNow(NOW);
  mockDataSource = 'api';
  fixtureWallet.reset();
  followFixture.reset();
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, networkMode: 'always' },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: UID,
      email: 'camila@teste.imagineup',
      displayName: 'Camila da Sessão',
      photoURL: null,
    },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: UID,
  });
  emitProfile = () => undefined;
  jest.mocked(onSnapshot).mockImplementation(((
    _ref: unknown,
    next: (value: ReturnType<typeof snapshot>) => void,
  ) => {
    emitProfile = (data) => next(snapshot(data));
    return () => undefined;
  }) as never);
  answerProfile();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  act(() => Dimensions.set({ window }));
  client.clear();
  setFixtureNow(null);
  globalThis.XMLHttpRequest = realXhr;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Editar perfil: sem o perfil', () => {
  it('o perfil que ainda não existe mostra o aviso com "Tentar de novo", e não o indicador sem fim', async () => {
    jest.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
      metadata: { fromCache: false },
    } as never);
    renderRouter(appTree, { initialUrl: '/editar-perfil' });
    const text = 'Seu perfil ainda não está pronto. Espere alguns segundos.';
    expect(await screen.findByText(text)).toBeTruthy();
    expect(announced()).toContain(text);
    expect(screen.queryByLabelText('Carregando seu perfil')).toBeNull();
    // O header fica, com o X e sem o ✓.
    expect(closeButton()).toBeTruthy();
    expect(screen.queryByTestId('edit-profile-save')).toBeNull();

    // Ele nasceu: o "Tentar de novo" busca de novo e o formulário aparece.
    jest.mocked(getDoc).mockResolvedValue(snapshot(CAMILA) as never);
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByTestId('edit-profile-name')).toBeTruthy();
  });

  it('a leitura que falhou sem nada salvo mostra o erro com "Tentar de novo"', async () => {
    jest
      .mocked(getDoc)
      .mockRejectedValue(Object.assign(new Error('sem rede'), { code: 'unavailable' }));
    renderRouter(appTree, { initialUrl: '/editar-perfil' });
    const text = 'Não deu para carregar seu perfil.';
    expect(await screen.findByText(text)).toBeTruthy();
    expect(announced()).toContain(text);
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });
});

describe('Editar perfil: entradas e saída', () => {
  it('abre pelos Ajustes e pelo hero, fora das abas, e o X fecha sem pergunta sem mudança', async () => {
    // A 1e e os Ajustes nas fixtures: a tela fica só leitura, com o mesmo header.
    mockDataSource = 'fixtures';
    jest.mocked(getDoc).mockResolvedValue(snapshot(CAMILA) as never);
    const view = renderRouter(treeWithProfile, { initialUrl: '/ajustes' });
    fireEvent.press(screen.getByTestId('settings-edit-profile'));
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
    expect(view.getSegments()).toEqual(['editar-perfil']);
    expect(screen.getByRole('header', { name: 'Editar perfil' })).toBeTruthy();
    fireEvent.press(closeButton());
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    expect(Alert.alert).not.toHaveBeenCalled();

    act(() => router.navigate('/perfil'));
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
    fireEvent.press(await screen.findByRole('button', { name: /^Camila Ribeiro, @camilarib/ }));
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
    fireEvent.press(closeButton());
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('aberta a frio, salvar fecha e cai nas abas (não fica numa pilha vazia)', async () => {
    const view = await openEditProfile();
    fireEvent.changeText(cityInput(), 'Irará, BA');
    fireEvent.press(saveButton());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(screen.getByText('home')).toBeTruthy();
  });
});

describe('Editar perfil: o ✓', () => {
  it('apagado sem mudança e sem internet; liga com a mudança', async () => {
    await openEditProfile();
    expect(saveButton()).toBeDisabled();
    fireEvent.changeText(bioInput(), 'Salvador.');
    expect(saveButton()).toBeEnabled();
    act(() => onlineManager.setOnline(false));
    expect(saveButton()).toBeDisabled();
    act(() => onlineManager.setOnline(true));
    expect(saveButton()).toBeEnabled();
    // Voltar ao valor do perfil apaga de novo.
    fireEvent.changeText(bioInput(), 'Feira de Santana.');
    expect(saveButton()).toBeDisabled();
  });

  it('apagado com o @ conferindo, e ligado quando ele fica "Disponível"', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    expect(saveButton()).toBeDisabled();
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(usernameLine()).toHaveTextContent('Disponível'));
    expect(saveButton()).toBeEnabled();
  });

  it('para o suspenso: a frase da conta suspensa, os campos só leitura e o ✓ apagado', async () => {
    await openEditProfile({
      ...CAMILA,
      suspendedAt: { toDate: () => new Date('2026-10-07T12:00:00.000Z') },
    });
    expect(
      screen.getByText('Sua conta está suspensa. Fale com a equipe do ImagineUP.'),
    ).toBeTruthy();
    expect(saveButton()).toBeDisabled();
    expect(nameInput()).toHaveProp('editable', false);
    expect(bioInput()).toHaveProp('editable', false);
    expect(usernameInput()).toHaveProp('editable', false);
    // O gênero e a conta privada viram texto, sem toque.
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.press(saveButton());
    expect(put).not.toHaveBeenCalled();
  });

  it('perfil sem nome: o nome da sessão, o ✓ já ligado e o X fecha sem o diálogo', async () => {
    const view = await openEditProfile({ ...CAMILA, displayName: null, username: 'fa711224' });
    expect(nameInput()).toHaveProp('value', 'Camila da Sessão');
    expect(saveButton()).toBeEnabled();
    fireEvent.press(closeButton());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('perfil sem nome: salvar leva o nome da sessão junto', async () => {
    await openEditProfile({ ...CAMILA, displayName: null, username: 'fa711224' });
    fireEvent.changeText(cityInput(), 'Irará, BA');
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ displayName: 'Camila da Sessão', city: 'Irará, BA' });
  });
});

describe('Editar perfil: salvar', () => {
  it('manda só o que mudou no PUT /me/profile com a chave, anuncia, toca success e fecha', async () => {
    const view = await openEditProfile();
    fireEvent.changeText(cityInput(), '  Irará, BA ');
    fireEvent.changeText(bioInput(), 'Do arrocha ao piseiro.\nIrará na veia.');
    fireEvent.press(saveButton());

    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    const [sent] = profilePuts();
    expect(sent?.body).toEqual({
      bio: 'Do arrocha ao piseiro.\nIrará na veia.',
      city: 'Irará, BA',
    });
    expect(sent?.key).toMatch(/^profile-/);
    expect(sent?.signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(announced()).toContain('Perfil salvo.'));
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });

  it('o @ vai no mesmo pedido, e o anúncio diz o @ novo', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), '@CamilaRibeiro');
    expect(usernameInput()).toHaveProp('value', 'camilaribeiro');
    fireEvent.changeText(bioInput(), 'Salvador.');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.press(saveButton());

    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ username: 'camilaribeiro', bio: 'Salvador.' });
    await waitFor(() =>
      expect(announced()).toContain('Perfil salvo. Seu @ agora é @camilaribeiro.'),
    );
  });

  it('a tela fica presa enquanto salva: o X desliga, o voltar do Android não sai e o ✓ diz que está ocupado', async () => {
    const answer = deferred<{ data: ReturnType<typeof editable> }>();
    put.mockReturnValueOnce(answer.promise as never);
    const backPress = jest.spyOn(BackHandler, 'addEventListener');
    const view = await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(saveButton());

    await waitFor(() => expect(closeButton()).toBeDisabled());
    expect(screen.getByTestId('edit-profile-save')).toBeBusy();
    expect(screen.getByRole('button', { name: 'Salvando o perfil' })).toBeTruthy();
    expect(bioInput()).toHaveProp('editable', false);
    // A foto também fica presa: o sucesso do ✓ não fecha a tela com uma foto começada no meio.
    const photo = screen.getByRole('button', { name: 'Trocar foto' });
    expect(photo).toBeDisabled();
    fireEvent.press(photo);
    expect(screen.queryByRole('button', { name: 'Escolher foto da galeria' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover foto' })).toBeNull();
    expect(pressAndroidBack(backPress)).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(view.getPathname()).toBe('/editar-perfil');

    await act(async () => answer.resolve({ data: editable({ ...CAMILA, bio: 'Salvador.' }) }));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });
});

describe('Editar perfil: o perfil vivo', () => {
  it('a escuta traz a bio apagada e um @ automático: os campos não mexidos acompanham, e o ✓ não liga', async () => {
    await openEditProfile();
    act(() => emitProfile({ ...CAMILA, bio: null, username: 'fa711224' }));
    await waitFor(() => expect(bioInput()).toHaveProp('value', ''));
    expect(usernameInput()).toHaveProp('value', 'fa711224');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByTestId('edit-profile-username-automatic', hidden)).toBeTruthy();
  });

  it('um campo mexido fica com o rascunho, e nenhum pedido sai com a bio ou o @ antigos', async () => {
    await openEditProfile();
    fireEvent.changeText(cityInput(), 'Salvador, BA');
    act(() =>
      emitProfile({ ...CAMILA, city: 'Feira de Santana, BA', bio: null, username: 'fa711224' }),
    );
    await waitFor(() => expect(bioInput()).toHaveProp('value', ''));
    expect(cityInput()).toHaveProp('value', 'Salvador, BA');
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ city: 'Salvador, BA' });
  });

  it('a conta privada acompanha a escuta: a chave e o aviso público mudam com o perfil', async () => {
    const name = 'Conta privada. Os outros fãs não veem sua bio nem suas redes.';
    await openEditProfile({ ...CAMILA, privateAccount: true });
    expect(screen.getByRole('switch', { name, checked: true })).toBeTruthy();
    expect(screen.queryByTestId('edit-profile-public-hint')).toBeNull();

    // Outro aparelho desligou a privada.
    act(() => emitProfile({ ...CAMILA, privateAccount: false, bio: 'Nova bio viva.' }));
    await waitFor(() => expect(bioInput()).toHaveProp('value', 'Nova bio viva.'));
    expect(screen.getByRole('switch', { name, checked: false })).toBeTruthy();
    expect(screen.getByTestId('edit-profile-public-hint')).toBeTruthy();
    expect(saveButton()).toBeDisabled();

    // Ligar de novo é mudança contra o perfil vivo, e vai no corpo.
    fireEvent.press(screen.getByRole('switch', { name }));
    expect(screen.getByRole('switch', { name, checked: true })).toBeTruthy();
    expect(saveButton()).toBeEnabled();
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ privateAccount: true });
  });

  it('o campo mexido que volta ao texto de antes, depois de a escuta trazer outro valor, segue como mudança', async () => {
    await openEditProfile();
    fireEvent.changeText(bioInput(), 'Feira de Santana. E do Nenho.');
    // A Moderação apagou a bio (e outro aparelho trocou a cidade, para a escuta aparecer).
    act(() => emitProfile({ ...CAMILA, bio: null, city: 'Irará, BA' }));
    await waitFor(() => expect(cityInput()).toHaveProp('value', 'Irará, BA'));
    expect(bioInput()).toHaveProp('value', 'Feira de Santana. E do Nenho.');

    // A fã desiste do acréscimo: a bio da tela não é mais a do servidor.
    fireEvent.changeText(bioInput(), 'Feira de Santana.');
    expect(saveButton()).toBeEnabled();
    fireEvent.press(closeButton());
    expect(lastAlert().title).toBe('Descartar alterações?');
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ bio: 'Feira de Santana.' });
  });

  it('o prazo do @ que chega pela escuta com o @ mexido volta o campo ao @ de agora, só leitura', async () => {
    get.mockResolvedValue({ data: { username: 'camilanova', status: 'available' } } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilanova');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(usernameLine()).toHaveTextContent('Disponível'));

    // Outro aparelho trocou o @, e o prazo de 30 dias começou.
    act(() =>
      emitProfile({
        ...CAMILA,
        username: 'camila2',
        usernameChangeableAt: { toDate: () => new Date('2026-11-06T15:00:00.000Z') },
      }),
    );
    await waitFor(() => expect(usernameInput()).toHaveProp('value', 'camila2'));
    expect(usernameInput()).toHaveProp('editable', false);
    expect(usernameLine()).toHaveTextContent('Você troca o @ de novo em 6 de novembro.');
    expect(saveButton()).toBeDisabled();
  });
});

describe('Editar perfil: o @', () => {
  it('"Conferindo..." e, 400 ms depois da última tecla, "Disponível" com o check, numa consulta só', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camila');
    act(() => jest.advanceTimersByTime(200));
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    expect(usernameLine()).toHaveTextContent('Conferindo...');

    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(usernameLine()).toHaveTextContent('Disponível'));
    expect(screen.getByTestId('edit-profile-username-icon', hidden)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/me/username/availability', {
      params: { username: 'camilaribeiro' },
    });
    expect(announced()).toContain('Disponível');
  });

  it('a linha de baixo fica fora do leitor, e o mesmo texto chega pela dica do campo', async () => {
    await openEditProfile();
    const rule = 'De 3 a 20 letras minúsculas e números. Depois de trocar, só de novo em 30 dias.';
    expect(screen.queryByText(rule)).toBeNull();
    expect(usernameLine()).toHaveTextContent(rule);
    expect(usernameInput()).toHaveProp('accessibilityHint', rule);
    expect(usernameInput()).toHaveProp('keyboardType', 'ascii-capable');
    expect(usernameInput()).toHaveProp('maxLength', 64);
    expect(usernameInput()).toHaveProp('autoCapitalize', 'none');
  });

  it('"Indisponível" com o motivo: de outro fã, reservado e fora do formato (este sem consulta)', async () => {
    get.mockImplementation(async (_url, config) => {
      const username = (config as { params: { username: string } }).params.username;
      return {
        data: { username, status: username === 'netto' ? 'reserved' : 'taken' },
      } as never;
    });
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'alanferreira');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() =>
      expect(usernameLine()).toHaveTextContent('Indisponível: este @ já tem dono.'),
    );
    expect(usernameInput()).toHaveProp('accessibilityHint', 'Indisponível: este @ já tem dono.');
    expect(saveButton()).toBeDisabled();

    fireEvent.changeText(usernameInput(), 'netto');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() =>
      expect(usernameLine()).toHaveTextContent('Indisponível: este @ é reservado.'),
    );

    get.mockClear();
    fireEvent.changeText(usernameInput(), 'ca');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() =>
      expect(usernameLine()).toHaveTextContent(
        'Indisponível: use de 3 a 20 letras minúsculas e números.',
      ),
    );
    expect(get).not.toHaveBeenCalled();
    expect(announced()).toContain('Indisponível: use de 3 a 20 letras minúsculas e números.');
  });

  it('a consulta que falha diz que não deu para conferir, e o "Tentar de novo" confere outra vez', async () => {
    get.mockRejectedValueOnce(new ApiError('network', 'sem rede'));
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(usernameLine()).toHaveTextContent('Não deu para conferir o @.'));
    expect(announced()).toContain('Não deu para conferir o @.');
    expect(saveButton()).toBeDisabled();

    get.mockResolvedValueOnce({
      data: { username: 'camilaribeiro', status: 'available' },
    } as never);
    fireEvent.press(screen.getByRole('button', { name: 'Conferir o @ de novo' }));
    await waitFor(() => expect(usernameLine()).toHaveTextContent('Disponível'));
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('edit-profile-username-recheck')).toBeNull();
  });

  it('com o prazo correndo, o campo é só de leitura com o @ de agora, e a linha diz a data', async () => {
    await openEditProfile({
      ...CAMILA,
      usernameChangeableAt: { toDate: () => new Date('2026-11-06T15:00:00.000Z') },
    });
    expect(usernameInput()).toHaveProp('editable', false);
    expect(usernameInput()).toHaveProp('value', 'camilarib');
    expect(usernameLine()).toHaveTextContent('Você troca o @ de novo em 6 de novembro.');
    expect(usernameInput()).toHaveProp(
      'accessibilityHint',
      'Você troca o @ de novo em 6 de novembro.',
    );
  });

  it('o 409 de dono segura o ✓ e não grava a bio; voltar ao @ de agora solta o resto', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    put.mockRejectedValueOnce(new ApiError('validation', 'tem dono', 409, 'username_taken', null));
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    fireEvent.changeText(bioInput(), 'Salvador.');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.press(saveButton());

    await waitFor(() =>
      expect(usernameLine()).toHaveTextContent('Indisponível: este @ já tem dono.'),
    );
    expect(announced().filter((text) => text === 'Indisponível: este @ já tem dono.')).toHaveLength(
      1,
    );
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(saveButton()).toBeDisabled();
    // A bio não foi gravada: o perfil em cache segue com a de antes.
    expect(bioInput()).toHaveProp('value', 'Salvador.');

    fireEvent.changeText(usernameInput(), 'camilarib');
    expect(saveButton()).toBeEnabled();
    answerProfile();
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(2));
    expect(profilePuts()[1]?.body).toEqual({ bio: 'Salvador.' });
  });

  it('o 409 do prazo (relógio do aparelho adiantado) volta o @ ao de agora, com a data, e a bio salva no ✓ seguinte', async () => {
    // O aparelho acha que o prazo passou; o servidor, não.
    await openEditProfile({
      ...CAMILA,
      usernameChangeableAt: { toDate: () => new Date('2026-10-07T14:59:00.000Z') },
    });
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    put.mockRejectedValueOnce(new ApiError('validation', 'cedo', 409, 'username_change_too_soon'));
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    fireEvent.changeText(bioInput(), 'Salvador.');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.press(saveButton());

    const text = 'Você troca o @ de novo em 7 de outubro.';
    await waitFor(() => expect(usernameLine()).toHaveTextContent(text));
    expect(announced()).toContain(text);
    expect(usernameInput()).toHaveProp('value', 'camilarib');
    expect(usernameInput()).toHaveProp('editable', false);
    expect(saveButton()).toBeEnabled();

    answerProfile();
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(2));
    expect(profilePuts()[1]?.body).toEqual({ bio: 'Salvador.' });
  });

  it('o 409 do prazo sem a data no perfil diz o prazo, sem "tente de novo"', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    put.mockRejectedValueOnce(new ApiError('validation', 'cedo', 409, 'username_change_too_soon'));
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.press(saveButton());
    await waitFor(() =>
      expect(usernameLine()).toHaveTextContent('Você trocou o @ há menos de 30 dias.'),
    );
    expect(announced()).not.toContain('Não deu para salvar. Tente de novo.');
  });
});

describe('Editar perfil: a bio', () => {
  it('o contador fica embaixo da caixa, fora do leitor, e o leitor ouve a contagem pela dica', async () => {
    await openEditProfile({ ...CAMILA, bio: null });
    expect(screen.getByTestId('edit-profile-bio-counter', hidden)).toHaveTextContent('0/200');
    expect(screen.queryByText('0/200')).toBeNull();
    fireEvent.changeText(bioInput(), 'Oi, sou fã.');
    expect(screen.getByTestId('edit-profile-bio-counter', hidden)).toHaveTextContent('11/200');
    expect(bioInput()).toHaveProp('accessibilityHint', '11 de 200 caracteres.');
    expect(bioInput()).toHaveProp('multiline', true);
    expect(bioInput()).toHaveProp('maxLength', 200);
  });

  it('no limite de 200, anuncia uma vez', async () => {
    await openEditProfile({ ...CAMILA, bio: null });
    fireEvent.changeText(bioInput(), 'a'.repeat(200));
    await waitFor(() =>
      expect(announcedInQueue()).toContain('Você chegou ao limite de 200 caracteres.'),
    );
    fireEvent.changeText(bioInput(), 'a'.repeat(200));
    expect(
      announcedInQueue().filter((text) => text === 'Você chegou ao limite de 200 caracteres.'),
    ).toHaveLength(1);
  });

  it('a bio que já chega cheia (a salva, a da escuta) não anuncia o limite; digitar até ele, sim', async () => {
    const limit = 'Você chegou ao limite de 200 caracteres.';
    await openEditProfile({ ...CAMILA, bio: 'a'.repeat(200) });
    expect(screen.getByTestId('edit-profile-bio-counter', hidden)).toHaveTextContent('200/200');
    act(() => emitProfile({ ...CAMILA, bio: 'b'.repeat(200) }));
    await waitFor(() => expect(bioInput()).toHaveProp('value', 'b'.repeat(200)));
    expect(announcedInQueue()).not.toContain(limit);

    fireEvent.changeText(bioInput(), 'b'.repeat(199));
    fireEvent.changeText(bioInput(), 'b'.repeat(200));
    await waitFor(() => expect(announcedInQueue()).toContain(limit));
  });

  it('7 linhas são recusadas no campo, com o erro anunciado e nada enviado', async () => {
    await openEditProfile();
    fireEvent.changeText(bioInput(), 'a\nb\nc\nd\ne\nf\ng');
    fireEvent.press(saveButton());
    expect(await screen.findByText('Use até 6 linhas.', hidden)).toBeTruthy();
    expect(announced()).toContain('Use até 6 linhas.');
    expect(put).not.toHaveBeenCalled();
  });
});

describe('Editar perfil: detalhes', () => {
  const GENDER_CLOSED = 'Gênero, Não informado. Só você e a equipe do ImagineUP veem.';

  it('o gênero abre as opções, escolhe, fecha e devolve o foco à linha, com o rótulo e a meta', async () => {
    await openEditProfile();
    const row = screen.getByRole('button', { name: GENDER_CLOSED });
    expect(row).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
    // Fechadas, as opções ficam fora do leitor.
    expect(screen.queryByRole('button', { name: 'Mulher' })).toBeNull();

    fireEvent.press(row);
    expect(screen.getByRole('button', { name: GENDER_CLOSED })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ expanded: true }),
    );
    const woman = screen.getByRole('button', { name: 'Mulher' });
    expect(woman).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
    fireEvent.press(woman);

    const chosen = screen.getByRole('button', {
      name: 'Gênero, Mulher. Só você e a equipe do ImagineUP veem.',
    });
    expect(chosen).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
    act(() => jest.advanceTimersByTime(150));
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
      expect.anything(),
      'focus',
    );

    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ gender: 'woman' });
  });

  // O preset "Grande" do Android chega como o float 1.3f (1,2999999...), abaixo de 1,3.
  it.each([
    ['2', 2],
    ['1,3 do Android', Math.fround(1.3)],
  ])(
    'com a fonte a %s, o valor do gênero desce para baixo do título, no recuo dele; na padrão, fica ao lado',
    async (_scale, fontScale) => {
      act(() => Dimensions.set({ window: { ...window, fontScale } }));
      await openEditProfile();
      expect(screen.getByTestId('edit-profile-gender')).toHaveStyle({ flexDirection: 'column' });
      // O recuo do ícone (18) e do vão da linha (12): o valor fica embaixo do título.
      expect(screen.getByTestId('edit-profile-gender-value', hidden)).toHaveStyle({
        paddingLeft: 30,
      });
      act(() => Dimensions.set({ window: { ...window, fontScale: 1 } }));
      await waitFor(() =>
        expect(screen.getByTestId('edit-profile-gender')).toHaveStyle({ flexDirection: 'row' }),
      );
      expect(screen.getByTestId('edit-profile-gender-value', hidden)).not.toHaveStyle({
        paddingLeft: 30,
      });
    },
  );

  it('a conta privada é uma chave só, com o checked e o rótulo com a meta', async () => {
    await openEditProfile();
    const name = 'Conta privada. Os outros fãs não veem sua bio nem suas redes.';
    expect(screen.getByRole('switch', { name, checked: false })).toBeTruthy();
    expect(
      screen.getByText('Sem a conta privada, qualquer fã do ImagineUP vê sua bio e suas redes.'),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('switch', { name }));
    expect(screen.getByRole('switch', { name, checked: true })).toBeTruthy();
    expect(screen.queryByTestId('edit-profile-public-hint')).toBeNull();
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ privateAccount: true });
  });
});

describe('Editar perfil: redes sociais', () => {
  it('os campos com as props de teclado: url nas três e o padrão no LinkedIn (acentos)', async () => {
    await openEditProfile();
    for (const network of ['instagram', 'tiktok', 'x']) {
      expect(screen.getByTestId(`edit-profile-social-${network}`)).toHaveProp(
        'keyboardType',
        'url',
      );
    }
    const linkedin = screen.getByTestId('edit-profile-social-linkedin');
    expect(linkedin).toHaveProp('keyboardType', 'default');
    expect(linkedin.props).toMatchObject({
      autoCapitalize: 'none',
      autoCorrect: false,
      spellCheck: false,
      autoComplete: 'off',
      maxLength: 300,
      returnKeyType: 'next',
      accessibilityLabel: 'LinkedIn',
    });
    expect(screen.getByLabelText('X (Twitter)')).toBeTruthy();
  });

  it('o link colado vira o usuário ao sair do campo e vai no socials do corpo', async () => {
    await openEditProfile();
    const instagram = screen.getByTestId('edit-profile-social-instagram');
    fireEvent.changeText(instagram, 'https://www.instagram.com/camila.teste.up/?igsh=abc');
    fireEvent(instagram, 'blur');
    expect(screen.getByTestId('edit-profile-social-instagram')).toHaveProp(
      'value',
      'camila.teste.up',
    );
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(1));
    expect(profilePuts()[0]?.body).toEqual({ socials: { instagram: 'camila.teste.up' } });
  });

  it('o link de outro domínio é recusado no campo, com o erro anunciado no envio', async () => {
    await openEditProfile();
    const x = screen.getByTestId('edit-profile-social-x');
    fireEvent.changeText(x, 'https://www.instagram.com/camila.teste.up');
    fireEvent(x, 'blur');
    expect(await screen.findByText('Esse link não é do X (Twitter).', hidden)).toBeTruthy();
    fireEvent.press(saveButton());
    await waitFor(() => expect(announced()).toContain('Esse link não é do X (Twitter).'));
    expect(put).not.toHaveBeenCalled();
  });

  it('o erro do campo sai quando o fã corrige e sai dele', async () => {
    await openEditProfile();
    const x = screen.getByTestId('edit-profile-social-x');
    fireEvent.changeText(x, 'a'.repeat(16));
    fireEvent(x, 'blur');
    expect(await screen.findByText('Usuário fora do formato do X (Twitter).', hidden)).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('edit-profile-social-x'), 'camilatesteup');
    fireEvent(screen.getByTestId('edit-profile-social-x'), 'blur');
    await waitFor(() =>
      expect(screen.queryByText('Usuário fora do formato do X (Twitter).', hidden)).toBeNull(),
    );
  });
});

describe('Editar perfil: as recusas', () => {
  it('profile_invalid do gênero: "Confira este campo." embaixo do header', async () => {
    put.mockRejectedValueOnce(
      new ApiError('validation', 'fora', 400, 'profile_invalid', {
        field: 'gender',
        reason: 'unknown',
      }),
    );
    await openEditProfile();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Gênero, Não informado. Só você e a equipe do ImagineUP veem.',
      }),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Homem' }));
    fireEvent.press(saveButton());
    expect(await screen.findByTestId('edit-profile-message')).toHaveTextContent(
      'Confira este campo.',
    );
    expect(announced()).toContain('Confira este campo.');
  });

  it('profile_invalid com displayName: "Confira este campo." no nome, anunciado', async () => {
    put.mockRejectedValueOnce(
      new ApiError('validation', 'fora', 400, 'profile_invalid', {
        field: 'displayName',
        reason: 'invisible',
      }),
    );
    await openEditProfile();
    fireEvent.changeText(nameInput(), 'Camila R.');
    fireEvent.press(saveButton());
    await waitFor(() => expect(announced()).toContain('Confira este campo.'));
    expect(nameInput()).toHaveProp('accessibilityHint', 'Confira este campo.');
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('o 429 do nome fica no campo do nome', async () => {
    put.mockRejectedValueOnce(
      new ApiError('unknown', 'teto', 429, 'too_many_requests', { limit: 5, action: 'name' }),
    );
    await openEditProfile();
    fireEvent.changeText(nameInput(), 'Camila R.');
    fireEvent.press(saveButton());
    const text = 'Você trocou o nome muitas vezes hoje. Tente amanhã.';
    await waitFor(() => expect(announced()).toContain(text));
    expect(nameInput()).toHaveProp('accessibilityHint', text);
    expect(screen.queryByTestId('edit-profile-message')).toBeNull();
  });

  it('o 429 do perfil fica embaixo do header', async () => {
    put.mockRejectedValueOnce(
      new ApiError('unknown', 'teto', 429, 'too_many_requests', { limit: 20, action: 'profile' }),
    );
    await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(saveButton());
    const text = 'Você salvou o perfil muitas vezes hoje. Tente amanhã.';
    expect(await screen.findByTestId('edit-profile-message')).toHaveTextContent(text);
    expect(announced()).toContain(text);
  });

  it('o resto (o ritmo da API) diz que não deu para salvar', async () => {
    put.mockRejectedValueOnce(new ApiError('unknown', 'ritmo', 429, 'rate_limited'));
    await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(saveButton());
    expect(await screen.findByTestId('edit-profile-message')).toHaveTextContent(
      'Não deu para salvar. Tente de novo.',
    );
  });

  it('a falha incerta: o aviso, a mesma chave na segunda tentativa e chave nova depois de mexer', async () => {
    put.mockRejectedValueOnce(new ApiError('network', 'sem rede'));
    put.mockRejectedValueOnce(new ApiError('server', 'caiu', 503));
    await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(saveButton());
    const text = 'Não deu para confirmar se o perfil foi salvo. Tente de novo.';
    expect(await screen.findByTestId('edit-profile-message')).toHaveTextContent(text);
    expect(announced()).toContain(text);

    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(2));
    fireEvent.changeText(bioInput(), 'Salvador, BA.');
    await waitFor(() => expect(saveButton()).toBeEnabled());
    fireEvent.press(saveButton());
    await waitFor(() => expect(profilePuts()).toHaveLength(3));
    const [first, second, third] = profilePuts();
    expect(second?.key).toBe(first?.key);
    expect(third?.key).not.toBe(first?.key);
  });

  it('com o relógio falso, os 20 s soltam a tela com o aviso incerto e cancelam o pedido', async () => {
    put.mockReturnValueOnce(new Promise(() => undefined) as never);
    await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(saveButton());
    await waitFor(() => expect(closeButton()).toBeDisabled());

    act(() => jest.advanceTimersByTime(19_999));
    expect(closeButton()).toBeDisabled();
    act(() => jest.advanceTimersByTime(1));
    expect(await screen.findByTestId('edit-profile-message')).toHaveTextContent(
      'Não deu para confirmar se o perfil foi salvo. Tente de novo.',
    );
    expect(closeButton()).toBeEnabled();
    expect(profilePuts()[0]?.signal?.aborted).toBe(true);
  });

  it('a falha incerta seguida da escuta com o perfil salvo: o aviso some, o ✓ apaga e o X fecha sem perguntar', async () => {
    put.mockRejectedValueOnce(new ApiError('network', 'sem rede'));
    const view = await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(saveButton());
    expect(await screen.findByTestId('edit-profile-message')).toBeTruthy();

    // A gravação chegou ao servidor: a escuta traz o perfil igual ao rascunho.
    act(() => emitProfile({ ...CAMILA, bio: 'Salvador.' }));
    await waitFor(() => expect(screen.queryByTestId('edit-profile-message')).toBeNull());
    expect(saveButton()).toBeDisabled();
    fireEvent.press(closeButton());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('o 403 da conta suspensa vira a tela do suspenso', async () => {
    put.mockRejectedValueOnce(new ApiError('forbidden', 'suspensa', 403, 'account_suspended'));
    await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(saveButton());
    const text = 'Sua conta está suspensa. Fale com a equipe do ImagineUP.';
    expect(await screen.findByText(text)).toBeTruthy();
    expect(announced()).toContain(text);
    expect(saveButton()).toBeDisabled();
  });
});

describe('Editar perfil: sair com mudança', () => {
  it('"Descartar alterações?" no X e no voltar do Android, com as duas escolhas', async () => {
    const backPress = jest.spyOn(BackHandler, 'addEventListener');
    const view = await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');

    fireEvent.press(closeButton());
    expect(lastAlert()).toMatchObject({
      title: 'Descartar alterações?',
      message: 'O que você mudou não vai ser salvo.',
    });
    const [keep, discard] = lastAlert().buttons;
    expect(keep).toMatchObject({ text: 'Continuar editando', style: 'cancel' });
    expect(discard).toMatchObject({ text: 'Descartar', style: 'destructive' });
    // Continuar editando: a tela fica.
    keep?.onPress?.();
    expect(view.getPathname()).toBe('/editar-perfil');

    expect(pressAndroidBack(backPress)).toBe(true);
    expect(Alert.alert).toHaveBeenCalledTimes(2);
    act(() => lastAlert().buttons[1]?.onPress?.());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(put).not.toHaveBeenCalled();
  });

  it('só o @ mexido, conferindo ou sem conferência, também pergunta antes de sair', async () => {
    get.mockRejectedValue(new ApiError('network', 'sem rede'));
    const backPress = jest.spyOn(BackHandler, 'addEventListener');
    const view = await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    expect(usernameLine()).toHaveTextContent('Conferindo...');
    fireEvent.press(closeButton());
    expect(lastAlert()).toMatchObject({
      title: 'Descartar alterações?',
      message: 'O que você mudou não vai ser salvo.',
    });

    act(() => jest.advanceTimersByTime(400));
    await waitFor(() => expect(usernameLine()).toHaveTextContent('Não deu para conferir o @.'));
    expect(pressAndroidBack(backPress)).toBe(true);
    expect(Alert.alert).toHaveBeenCalledTimes(2);
    expect(view.getPathname()).toBe('/editar-perfil');
  });

  it('com uma troca de foto que deu certo nesta abertura, o texto diz que a foto nova já está salva', async () => {
    mockPhotoSlot();
    put.mockImplementation(async (url) => {
      if (url === '/me/photo') return { data: { photoURL: 'https://fotos.exemplo/nova.jpg' } };
      throw new Error('inesperado');
    });
    await openEditProfile();
    pickFromGallery();
    await waitFor(() => expect(announced()).toContain('Foto atualizada.'));
    fireEvent.changeText(bioInput(), 'Salvador.');
    fireEvent.press(closeButton());
    expect(lastAlert().message).toBe(
      'O que você mudou não vai ser salvo. A foto nova já está salva.',
    );
  });

  it('fechar depois da foto pronta, sem outra mudança, não pergunta', async () => {
    mockPhotoSlot();
    put.mockResolvedValue({ data: { photoURL: 'https://fotos.exemplo/nova.jpg' } } as never);
    const view = await openEditProfile();
    pickFromGallery();
    await waitFor(() => expect(announced()).toContain('Foto atualizada.'));
    fireEvent.press(closeButton());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('Editar perfil: com a foto indo', () => {
  it('um foco só no bloco, ocupado e desligado; o ✓ apaga; o X pergunta "Sair com a foto indo?" e "Sair" fecha', async () => {
    mockPhotoSlot();
    const answer = deferred<{ data: { photoURL: string } }>();
    put.mockReturnValueOnce(answer.promise as never);
    const view = await openEditProfile();
    fireEvent.changeText(bioInput(), 'Salvador.');
    pickFromGallery();

    const busy = await screen.findByRole('button', { name: 'Enviando a foto' });
    expect(busy).toBeBusy();
    expect(busy).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Trocar foto' })).toBeNull();
    expect(screen.getAllByLabelText('Enviando a foto')).toHaveLength(1);
    await waitFor(() => expect(saveButton()).toBeDisabled());

    fireEvent.press(closeButton());
    expect(lastAlert()).toMatchObject({
      title: 'Sair com a foto indo?',
      message:
        'A foto ainda está sendo enviada e pode não ser trocada. O que você mudou no resto não vai ser salvo.',
    });
    const [keep, leave] = lastAlert().buttons;
    expect(keep).toMatchObject({ text: 'Continuar editando', style: 'cancel' });
    expect(leave).toMatchObject({ text: 'Sair', style: 'destructive' });
    act(() => leave?.onPress?.());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    await act(async () => answer.resolve({ data: { photoURL: 'https://fotos.exemplo/nova.jpg' } }));
  });

  it('sem outra mudança, o texto só fala da foto', async () => {
    mockPhotoSlot();
    put.mockReturnValueOnce(new Promise(() => undefined) as never);
    await openEditProfile();
    pickFromGallery();
    await screen.findByRole('button', { name: 'Enviando a foto' });
    // A tela fica sabendo pela contagem das mutações da foto, que avisa no tique seguinte.
    act(() => jest.advanceTimersByTime(0));
    fireEvent.press(closeButton());
    expect(lastAlert().message).toBe('A foto ainda está sendo enviada e pode não ser trocada.');
  });

  it('reaberta com a foto ainda indo, o bloco mostra o ocupado e não deixa mandar outra', async () => {
    mockPhotoSlot();
    const answer = deferred<{ data: { photoURL: string } }>();
    put.mockReturnValueOnce(answer.promise as never);
    const view = await openEditProfile();
    pickFromGallery();
    await screen.findByRole('button', { name: 'Enviando a foto' });
    act(() => jest.advanceTimersByTime(0));
    fireEvent.press(closeButton());
    act(() => lastAlert().buttons[1]?.onPress?.());
    await waitFor(() => expect(view.getPathname()).toBe('/'));

    // A mutação da abertura anterior segue; a tela nova a vê pelo cache das mutações.
    act(() => router.push('/editar-perfil'));
    const busy = await screen.findByRole('button', { name: 'Enviando a foto' });
    expect(busy).toBeBusy();
    expect(busy).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Trocar foto' })).toBeNull();
    expect(screen.getByTestId('edit-profile-photo-busy', hidden)).toBeTruthy();
    expect(saveButton()).toBeDisabled();

    await act(async () => answer.resolve({ data: { photoURL: 'https://fotos.exemplo/nova.jpg' } }));
    expect(await screen.findByRole('button', { name: 'Trocar foto' })).toBeTruthy();
    await waitFor(() => expect(avatarUri()).toEqual(['https://fotos.exemplo/nova.jpg']));
    expect(uploadLocalFile).toHaveBeenCalledTimes(1);
  });
});

describe('Editar perfil: sem a API (fixtures)', () => {
  it('só leitura: os valores como texto, sem campos, sem ✓, e o X fecha sem pergunta', async () => {
    mockDataSource = 'fixtures';
    const view = await openEditProfile({ ...CAMILA, gender: 'woman', privateAccount: true });
    expect(screen.getByText('Nesta versão do app, o perfil é só para ver.')).toBeTruthy();
    expect(screen.getByLabelText('Seu @, @camilarib')).toBeTruthy();
    expect(screen.getByLabelText('Bio, Feira de Santana.')).toBeTruthy();
    expect(screen.getByLabelText('Gênero, Mulher')).toBeTruthy();
    expect(screen.getByLabelText('Conta privada, Ligada')).toBeTruthy();
    expect(screen.getByLabelText('Instagram, Não preenchido')).toBeTruthy();
    expect(screen.queryByTestId('edit-profile-save')).toBeNull();
    expect(screen.queryByTestId('edit-profile-name')).toBeNull();
    // A foto sem toque.
    expect(screen.queryByRole('button', { name: 'Trocar foto' })).toBeNull();
    fireEvent.press(closeButton());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('Editar perfil: a foto (com a API)', () => {
  beforeEach(() => {
    mockPhotoSlot();
  });

  it('"Trocar foto" abre as opções, e da galeria ao PUT: o avatar troca, anuncia e toca success', async () => {
    put.mockResolvedValue({ data: { photoURL: 'https://fotos.exemplo/nova.jpg' } } as never);
    await openEditProfile();
    expect(avatarUri()).toEqual([]);
    const button = screen.getByRole('button', { name: 'Trocar foto' });
    expect(button).toHaveProp('accessibilityHint', 'Mostra as opções da foto');
    expect(button).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
    // Fechadas, as opções ficam fora do leitor; sem foto, não há "Remover foto".
    expect(screen.queryByRole('button', { name: 'Escolher foto da galeria' })).toBeNull();
    fireEvent.press(button);
    expect(screen.getByRole('button', { name: 'Tirar foto com a câmera' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remover foto' })).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body, config] = put.mock.calls[0]!;
    expect(url).toBe('/me/photo');
    const { path } = body as { path: string };
    expect(path).toMatch(new RegExp(`^fans/${UID}/photo-[a-z0-9-]+\\.jpg$`));
    expect(uploadLocalFile).toHaveBeenCalledWith(path, 'file:///pronta.jpg', 'image/jpeg');
    // A vaga vem antes do envio, com o mesmo caminho e uma chave própria.
    expect(post).toHaveBeenCalledWith(
      '/me/photo/upload',
      { path },
      { headers: { 'Idempotency-Key': expect.stringMatching(/^photo-upload-/) } },
    );
    expect(post.mock.invocationCallOrder[0]!).toBeLessThan(
      jest.mocked(uploadLocalFile).mock.invocationCallOrder[0]!,
    );
    expect((config as { headers: Record<string, string> }).headers['Idempotency-Key']).toBe(
      `photo-${path.slice(path.indexOf('photo-') + 'photo-'.length, -'.jpg'.length)}`,
    );
    await waitFor(() => expect(avatarUri()).toEqual(['https://fotos.exemplo/nova.jpg']));
    expect(announced()).toContain('Foto atualizada.');
    expect(haptics.trigger).toHaveBeenCalledWith('success');
  });

  it('a nova tentativa depois da falha incerta, com o arquivo já no Storage, não envia de novo', async () => {
    put
      .mockRejectedValueOnce(new ApiError('network', 'sem rede'))
      .mockResolvedValueOnce({ data: { photoURL: 'https://fotos.exemplo/nova.jpg' } } as never);
    jest.mocked(storageFileExists).mockResolvedValue(true);
    await openEditProfile();
    pickFromGallery();
    await waitFor(() =>
      expect(announced()).toContain('Não deu para trocar a foto. Tente de novo.'),
    );

    fireEvent.press(screen.getByTestId('edit-profile-photo-retry'));
    await waitFor(() => expect(announced()).toContain('Foto atualizada.'));
    expect(uploadLocalFile).toHaveBeenCalledTimes(1);
    // Com o arquivo lá, nem a vaga é pedida de novo.
    expect(post).toHaveBeenCalledTimes(1);
    expect(storageFileExists).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[1]![1]).toEqual(put.mock.calls[0]![1]);
    expect(put.mock.calls[1]![2]).toEqual(put.mock.calls[0]![2]);
  });

  it('o photo_not_found abre uma tentativa nova, uma vez, com id e chave novos', async () => {
    const notFound = () => new ApiError('notFound', 'sumiu', 404, 'photo_not_found');
    put
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ data: { photoURL: 'https://fotos.exemplo/nova.jpg' } } as never);
    await openEditProfile();
    pickFromGallery();
    await waitFor(() => expect(announced()).toContain('Foto atualizada.'));
    expect(uploadLocalFile).toHaveBeenCalledTimes(2);
    const [first, second] = jest.mocked(uploadLocalFile).mock.calls.map(([path]) => path);
    expect(second).not.toBe(first);
    // Uma vaga para cada arquivo.
    expect(post.mock.calls.map(([, body]) => (body as { path: string }).path)).toEqual([
      first,
      second,
    ]);
    expect(put.mock.calls[1]![2]).not.toEqual(put.mock.calls[0]![2]);

    // Vindo de novo nas duas, o erro.
    put.mockReset();
    put.mockRejectedValue(notFound());
    pickFromGallery();
    await waitFor(() =>
      expect(announced()).toContain('Não deu para trocar a foto. Tente de novo.'),
    );
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('a recusa do Storage (perfil ausente, sessão trocada) não oferece "Tentar de novo"', async () => {
    jest
      .mocked(uploadLocalFile)
      .mockRejectedValue(Object.assign(new Error('negado'), { code: 'storage/unauthorized' }));
    await openEditProfile();
    pickFromGallery();
    await waitFor(() =>
      expect(announced()).toContain('Não deu para trocar a foto. Tente de novo.'),
    );
    expect(screen.queryByTestId('edit-profile-photo-retry')).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it('o teto do dia das vagas: diz que trocou muitas vezes e não envia', async () => {
    post.mockRejectedValue(new ApiError('unknown', 'teto', 429, 'too_many_requests'));
    await openEditProfile();
    pickFromGallery();
    const text = 'Você trocou a foto muitas vezes hoje. Tente amanhã.';
    expect(await screen.findByText(text)).toBeTruthy();
    expect(uploadLocalFile).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('pedidos seguidos demais (rate_limited) ficam com o aviso genérico', async () => {
    post.mockRejectedValue(new ApiError('unknown', 'ritmo', 429, 'rate_limited'));
    await openEditProfile();
    pickFromGallery();
    await waitFor(() =>
      expect(announced()).toContain('Não deu para trocar a foto. Tente de novo.'),
    );
    expect(uploadLocalFile).not.toHaveBeenCalled();
  });

  it('a foto recusada pelo servidor anuncia o motivo e toca error', async () => {
    put.mockRejectedValue(new ApiError('validation', 'fora', 400, 'photo_invalid'));
    await openEditProfile();
    pickFromGallery();
    const text = 'Não deu para usar essa foto. Escolha outra.';
    expect(await screen.findByText(text)).toBeTruthy();
    expect(announced()).toContain(text);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('remover a foto volta às iniciais e anuncia', async () => {
    remove.mockResolvedValue({ data: { photoURL: null } } as never);
    await openEditProfile({ ...CAMILA, photoURL: 'https://fotos.exemplo/atual.jpg' });
    expect(avatarUri()).toEqual(['https://fotos.exemplo/atual.jpg']);
    fireEvent.press(screen.getByRole('button', { name: 'Trocar foto' }));
    fireEvent.press(screen.getByRole('button', { name: 'Remover foto' }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('/me/photo', {
        headers: { 'Idempotency-Key': expect.stringMatching(/^photo-remove-/) },
      }),
    );
    await waitFor(() => expect(avatarUri()).toEqual([]));
    expect(announced()).toContain('Foto removida.');
  });

  it('o suspenso com foto só vê "Remover foto"', async () => {
    await openEditProfile({
      ...CAMILA,
      photoURL: 'https://fotos.exemplo/atual.jpg',
      suspendedAt: { toDate: () => new Date('2026-10-07T12:00:00.000Z') },
    });
    fireEvent.press(screen.getByRole('button', { name: 'Trocar foto' }));
    expect(screen.getByRole('button', { name: 'Remover foto' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Escolher foto da galeria' })).toBeNull();
  });

  it('o suspenso sem foto não tem nada tocável na foto', async () => {
    await openEditProfile({
      ...CAMILA,
      suspendedAt: { toDate: () => new Date('2026-10-07T12:00:00.000Z') },
    });
    expect(screen.queryByRole('button', { name: 'Trocar foto' })).toBeNull();
  });
});

describe('Editar perfil: o estilo das linhas', () => {
  it('os grupos são cards sem padding com os campos sem caixa', async () => {
    await openEditProfile();
    const basic = screen.getByTestId('edit-profile-basic');
    expect(StyleSheet.flatten(basic.props.style)).toMatchObject({
      paddingVertical: 0,
      paddingHorizontal: 0,
    });
    expect(screen.getByRole('header', { name: 'Informações básicas' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Detalhes' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Redes sociais' })).toBeTruthy();
    expect(nameInput()).toHaveProp('placeholder', 'Seu nome');
    expect(usernameInput()).toHaveProp('placeholder', 'seunome');
    expect(bioInput()).toHaveProp('placeholder', 'Conte um pouco sobre você...');
    expect(cityInput()).toHaveProp('placeholder', 'Sua cidade (opcional)');
  });
});
