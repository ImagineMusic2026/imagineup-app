import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { AccessibilityInfo, Text } from 'react-native';

import EditProfileRoute from '@/app/(tabs)/(perfil)/editar-perfil';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import ProfileRoute from '@/app/(tabs)/(perfil)/perfil';
import { followFixture } from '@/domains/artists/fixtures';
import { resetLastProfileSave } from '@/domains/profile/queries';
import { storageFileExists, uploadLocalFile } from '@/firebase';
import { api, ApiError } from '@/services/api';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// A tela "Editar perfil" (bloco 9, docs/arquitetura-api.md, 24.12 e 24.14):
// nome e cidade direto no Firestore (o updateDoc mockado), o @ e a foto pela
// API (o axios mockado), com o seletor de imagem e o manipulador mockados.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
  serverTimestamp: jest.fn(() => 'agora-do-servidor'),
  updateDoc: jest.fn(),
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
  api: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
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

let mockDataSource: 'api' | 'fixtures' = 'fixtures';
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
};

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
  // A 1e fica na base da pilha do Perfil (a âncora), embaixo da tela: com a
  // API ligada, a de verdade leria a carteira. Só o teste das entradas a usa.
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  '(tabs)/(perfil)/editar-perfil': EditProfileRoute,
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
};

/** A árvore com a 1e de verdade (nas fixtures), para o toque no hero. */
const treeWithProfile = { ...appTree, '(tabs)/(perfil)/perfil': ProfileRoute };

const get = jest.mocked(api.get);
const put = jest.mocked(api.put);
const remove = jest.mocked(api.delete);

const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

/** A gravação do perfil que o teste resolve na hora que quiser. */
function deferredUpdate() {
  let settle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
  jest.mocked(updateDoc).mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return {
    resolve: () => act(() => settle!.resolve()),
    reject: (error: unknown) => act(() => settle!.reject(error)),
  };
}

/** Abre a tela com o perfil dado e espera o formulário. */
async function openEditProfile(profile: ProfileData = CAMILA) {
  jest.mocked(getDoc).mockResolvedValue(snapshot(profile) as never);
  const view = renderRouter(appTree, { initialUrl: '/editar-perfil' });
  await screen.findByTestId('edit-profile-name');
  return view;
}

const saveButton = () => screen.getByTestId('edit-profile-save');
const usernameInput = () => screen.getByTestId('edit-profile-username-input');

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

const avatarUri = () =>
  screen.UNSAFE_queryAllByType(Image).map((image) => (image.props.source as { uri: string }).uri);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  fixtureWallet.reset();
  followFixture.reset();
  resetLastProfileSave();
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
  jest.mocked(onSnapshot).mockReturnValue(() => undefined);
  jest.mocked(updateDoc).mockResolvedValue(undefined);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
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

describe('Editar perfil: entradas', () => {
  it('abre pelos Ajustes e pelo toque no hero, e o voltar devolve a cada um', async () => {
    jest.mocked(getDoc).mockResolvedValue(snapshot(CAMILA) as never);
    const view = renderRouter(treeWithProfile, { initialUrl: '/ajustes' });
    fireEvent.press(screen.getByTestId('settings-edit-profile'));
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
    expect(screen.getByRole('header', { name: 'Editar perfil' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));

    act(() => router.navigate('/perfil'));
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
    fireEvent.press(await screen.findByRole('button', { name: /^Camila Ribeiro, @camilarib/ }));
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
  });
});

describe('Editar perfil: nome e cidade', () => {
  it('salva só o que mudou, anuncia e toca success', async () => {
    await openEditProfile();
    expect(saveButton()).toBeDisabled();
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), '  Irará, BA ');
    expect(saveButton()).toBeEnabled();
    fireEvent.press(saveButton());

    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith(`users/${UID}`, {
        city: 'Irará, BA',
        updatedAt: 'agora-do-servidor',
      }),
    );
    await waitFor(() => expect(announced()).toContain('Perfil salvo.'));
    expect(haptics.trigger).toHaveBeenCalledWith('success');
  });

  it('cidade vazia limpa o campo (null) e o nome muda junto', async () => {
    await openEditProfile();
    fireEvent.changeText(screen.getByTestId('edit-profile-name'), 'Camila R.');
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), '');
    fireEvent.press(saveButton());
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith(`users/${UID}`, {
        displayName: 'Camila R.',
        city: null,
        updatedAt: 'agora-do-servidor',
      }),
    );
  });

  it('perfil sem nome: o campo começa com o nome da sessão, o "Salvar" já liga e a cidade leva o nome junto', async () => {
    await openEditProfile({ ...CAMILA, displayName: null, username: 'fa711224', city: null });
    expect(screen.getByTestId('edit-profile-name')).toHaveProp('value', 'Camila da Sessão');
    expect(saveButton()).toBeEnabled();
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Irará, BA');
    fireEvent.press(saveButton());
    await waitFor(() =>
      expect(updateDoc).toHaveBeenCalledWith(`users/${UID}`, {
        displayName: 'Camila da Sessão',
        city: 'Irará, BA',
        updatedAt: 'agora-do-servidor',
      }),
    );
  });

  it('o "Salvar" fica desligado sem internet e nos 10 s depois de salvar', async () => {
    await openEditProfile();
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Irará, BA');
    act(() => onlineManager.setOnline(false));
    expect(saveButton()).toBeDisabled();
    act(() => onlineManager.setOnline(true));
    fireEvent.press(saveButton());
    await waitFor(() => expect(announced()).toContain('Perfil salvo.'));

    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Salvador, BA');
    expect(saveButton()).toBeDisabled();
    act(() => jest.advanceTimersByTime(9_999));
    expect(saveButton()).toBeDisabled();
    act(() => jest.advanceTimersByTime(1));
    expect(saveButton()).toBeEnabled();
  });

  it('outro fã que entra no mesmo aparelho logo depois não herda a espera de 10 s', async () => {
    const view = await openEditProfile();
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Irará, BA');
    fireEvent.press(saveButton());
    await waitFor(() => expect(announced()).toContain('Perfil salvo.'));
    view.unmount();

    useSessionStore.setState({
      status: 'signedIn',
      user: { uid: 'uidAlan', email: 'alan@teste.imagineup', displayName: 'Alan', photoURL: null },
      authHolds: 0,
    });
    usePreferencesStore.setState({ lastSessionUid: 'uidAlan' });
    await openEditProfile({ ...CAMILA, displayName: 'Alan Ferreira', username: 'alanferreira' });
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Salvador, BA');
    expect(saveButton()).toBeEnabled();
  });

  it('a trava de 10 s da regra (permission-denied) mostra e anuncia o texto dela', async () => {
    jest
      .mocked(updateDoc)
      .mockRejectedValueOnce(Object.assign(new Error('negado'), { code: 'permission-denied' }));
    await openEditProfile();
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Irará, BA');
    fireEvent.press(saveButton());
    const text = 'Você salvou há pouco. Espere alguns segundos e tente de novo.';
    expect(await screen.findByText(text)).toBeTruthy();
    expect(announced()).toContain(text);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('sem resposta em 10 s: "Ainda salvando", o "Salvar" desligado até resolver e o resultado anunciado', async () => {
    const save = deferredUpdate();
    await openEditProfile();
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Irará, BA');
    fireEvent.press(saveButton());
    await waitFor(() => expect(updateDoc).toHaveBeenCalled());

    act(() => jest.advanceTimersByTime(10_000));
    expect(screen.getByText('Ainda salvando. Confira a internet.')).toBeTruthy();
    expect(announced()).toContain('Ainda salvando. Confira a internet.');
    fireEvent.changeText(screen.getByTestId('edit-profile-city'), 'Salvador, BA');
    expect(saveButton()).toBeDisabled();

    await save.resolve();
    await waitFor(() => expect(announced()).toContain('Perfil salvo.'));
  });

  it('nome inválido não grava: o erro no campo, anunciado', async () => {
    await openEditProfile();
    fireEvent.changeText(screen.getByTestId('edit-profile-name'), '');
    fireEvent.press(saveButton());
    expect(await screen.findByText('Digite seu nome.', hidden)).toBeTruthy();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe('Editar perfil: sem a API (fixtures)', () => {
  it('o @ só como texto e a foto sem botões', async () => {
    await openEditProfile();
    expect(screen.getByText('@camilarib')).toBeTruthy();
    expect(screen.queryByTestId('edit-profile-username-input')).toBeNull();
    expect(screen.queryByTestId('edit-profile-gallery')).toBeNull();
    expect(screen.queryByTestId('edit-profile-camera')).toBeNull();
  });
});

describe('Editar perfil: o @ (com a API)', () => {
  beforeEach(() => {
    mockDataSource = 'api';
  });

  it('o automático leva o selo e a dica para trocar', async () => {
    await openEditProfile({ ...CAMILA, username: 'fa711224' });
    expect(screen.getByTestId('edit-profile-username-automatic', hidden)).toBeTruthy();
    expect(usernameInput()).toHaveProp(
      'accessibilityHint',
      'Este @ foi criado sozinho. Escolha um com a sua cara.',
    );
  });

  it('"Conferindo..." e, 400 ms depois da última tecla, "Disponível", com uma chamada só', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camila');
    act(() => jest.advanceTimersByTime(200));
    fireEvent.changeText(usernameInput(), '@CamilaRibeiro');
    expect(usernameInput()).toHaveProp('value', 'camilaribeiro');
    expect(screen.getByText('Conferindo...', hidden)).toBeTruthy();
    expect(screen.getByTestId('edit-profile-username-submit')).toBeDisabled();

    act(() => jest.advanceTimersByTime(400));
    expect(await screen.findByText('Disponível', hidden)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/me/username/availability', {
      params: { username: 'camilaribeiro' },
    });
    expect(announced()).toContain('Disponível');
    expect(screen.getByTestId('edit-profile-username-submit')).toBeEnabled();
  });

  it('de outro fã aparece como erro do campo; fora do formato, sem chamar o servidor', async () => {
    get.mockResolvedValue({ data: { username: 'alanferreira', status: 'taken' } } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'alanferreira');
    act(() => jest.advanceTimersByTime(400));
    expect(await screen.findByText('Este @ já tem dono.', hidden)).toBeTruthy();

    get.mockClear();
    fireEvent.changeText(usernameInput(), 'ca');
    act(() => jest.advanceTimersByTime(400));
    expect(
      await screen.findByText('Use de 3 a 20 letras minúsculas e números.', hidden),
    ).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
  });

  it('troca o @: a chave da tentativa, o anúncio e o toque success', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    put.mockResolvedValue({
      data: {
        username: 'camilaribeiro',
        changedAt: NOW.toISOString(),
        changeableAt: '2026-11-06T15:00:00.000Z',
      },
    } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    await screen.findByText('Disponível', hidden);
    fireEvent.press(screen.getByTestId('edit-profile-username-submit'));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/me/username',
        { username: 'camilaribeiro' },
        { headers: { 'Idempotency-Key': expect.stringMatching(/^username-/) } },
      ),
    );
    await waitFor(() => expect(announced()).toContain('Seu @ agora é @camilaribeiro.'));
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    // O prazo chegou no cache: o campo fica só de leitura, com a data.
    await waitFor(() =>
      expect(usernameInput()).toHaveProp(
        'accessibilityHint',
        'Você troca o @ de novo em 6 de novembro.',
      ),
    );
    expect(usernameInput()).toHaveProp('editable', false);
  });

  it('o username_invalid do servidor (reservado) e o taken aparecem no campo; a falha incerta repete a chave, e a recusa segura o botão', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    await screen.findByText('Disponível', hidden);

    put.mockRejectedValueOnce(new ApiError('network', 'sem rede'));
    fireEvent.press(screen.getByTestId('edit-profile-username-submit'));
    await waitFor(() => expect(announced()).toContain('Não deu para trocar o @. Tente de novo.'));
    put.mockRejectedValueOnce(new ApiError('validation', 'reservado', 400, 'username_invalid'));
    fireEvent.press(screen.getByTestId('edit-profile-username-submit'));
    await waitFor(() => expect(announced()).toContain('Este @ não está disponível.'));
    const [first, second] = put.mock.calls.map(
      (call) => (call[2] as { headers: Record<string, string> }).headers['Idempotency-Key'],
    );
    expect(second).toBe(first);
    // A recusa definitiva segura o "Trocar @" do mesmo @ até o fã mexer no campo.
    expect(screen.getByTestId('edit-profile-username-submit')).toBeDisabled();

    get.mockResolvedValue({ data: { username: 'camilaribeiro2', status: 'available' } } as never);
    fireEvent.changeText(usernameInput(), 'camilaribeiro2');
    act(() => jest.advanceTimersByTime(400));
    await screen.findByText('Disponível', hidden);
    put.mockRejectedValueOnce(new ApiError('validation', 'tem dono', 409, 'username_taken'));
    fireEvent.press(screen.getByTestId('edit-profile-username-submit'));
    expect(await screen.findByText('Este @ já tem dono.', hidden)).toBeTruthy();
    const third = (put.mock.calls[2]![2] as { headers: Record<string, string> }).headers[
      'Idempotency-Key'
    ];
    expect(third).not.toBe(first);
  });

  it('a consulta que falha diz que não deu para conferir, e o "Tentar de novo" confere outra vez', async () => {
    get.mockRejectedValueOnce(new ApiError('network', 'sem rede'));
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    expect(await screen.findByText('Não deu para conferir o @.', hidden)).toBeTruthy();
    expect(announced()).toContain('Não deu para conferir o @.');
    expect(screen.getByTestId('edit-profile-username-submit')).toBeDisabled();

    get.mockResolvedValueOnce({
      data: { username: 'camilaribeiro', status: 'available' },
    } as never);
    fireEvent.press(screen.getByRole('button', { name: 'Conferir o @ de novo' }));
    expect(await screen.findByText('Disponível', hidden)).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('edit-profile-username-submit')).toBeEnabled();
    expect(screen.queryByTestId('edit-profile-username-recheck')).toBeNull();
  });

  it('o @ recusado com dono não volta "Disponível" pelo retrato de 30 s, e o anúncio sai uma vez', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    put.mockRejectedValue(new ApiError('validation', 'tem dono', 409, 'username_taken'));
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    await screen.findByText('Disponível', hidden);
    fireEvent.press(screen.getByTestId('edit-profile-username-submit'));
    expect(await screen.findByText('Este @ já tem dono.', hidden)).toBeTruthy();
    await waitFor(() =>
      expect(announced().filter((text) => text === 'Este @ já tem dono.')).toHaveLength(1),
    );

    // Apaga uma letra e digita de novo: o retrato diz "já tem dono", sem nova consulta.
    fireEvent.changeText(usernameInput(), 'camilaribeir');
    act(() => jest.advanceTimersByTime(400));
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    expect(await screen.findByText('Este @ já tem dono.', hidden)).toBeTruthy();
    expect(screen.getByTestId('edit-profile-username-submit')).toBeDisabled();
    const checksOfRefused = get.mock.calls.filter(
      ([, config]) =>
        (config as { params: { username: string } }).params.username === 'camilaribeiro',
    );
    expect(checksOfRefused).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('o 409 do prazo diz a data do perfil (relógio do aparelho adiantado) e segura o "Trocar @"', async () => {
    // O aparelho acha que o prazo passou; o servidor, não.
    await openEditProfile({
      ...CAMILA,
      usernameChangeableAt: { toDate: () => new Date('2026-10-07T14:59:00.000Z') },
    });
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    put.mockRejectedValue(new ApiError('validation', 'cedo', 409, 'username_change_too_soon'));
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    await screen.findByText('Disponível', hidden);
    fireEvent.press(screen.getByTestId('edit-profile-username-submit'));
    const text = 'Você troca o @ de novo em 7 de outubro.';
    expect(await screen.findByText(text, hidden)).toBeTruthy();
    expect(announced()).toContain(text);
    expect(announced()).not.toContain('Não deu para trocar o @. Tente de novo.');
    expect(screen.getByTestId('edit-profile-username-submit')).toBeDisabled();
  });

  it('o 409 do prazo sem a data no perfil diz o prazo, sem "tente de novo"', async () => {
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } } as never);
    put.mockRejectedValue(new ApiError('validation', 'cedo', 409, 'username_change_too_soon'));
    await openEditProfile();
    fireEvent.changeText(usernameInput(), 'camilaribeiro');
    act(() => jest.advanceTimersByTime(400));
    await screen.findByText('Disponível', hidden);
    fireEvent.press(screen.getByTestId('edit-profile-username-submit'));
    expect(await screen.findByText('Você trocou o @ há menos de 30 dias.', hidden)).toBeTruthy();
    expect(screen.getByTestId('edit-profile-username-submit')).toBeDisabled();
  });

  it('com o prazo correndo, o campo é só de leitura e diz a data', async () => {
    await openEditProfile({
      ...CAMILA,
      usernameChangeableAt: { toDate: () => new Date('2026-11-06T15:00:00.000Z') },
    });
    expect(usernameInput()).toHaveProp('editable', false);
    expect(usernameInput()).toHaveProp(
      'accessibilityHint',
      'Você troca o @ de novo em 6 de novembro.',
    );
    expect(screen.getByTestId('edit-profile-username-submit')).toBeDisabled();
  });
});

describe('Editar perfil: a foto (com a API)', () => {
  beforeEach(() => {
    mockDataSource = 'api';
    mockGallery();
    jest.mocked(uploadLocalFile).mockResolvedValue(undefined);
  });

  it('da galeria ao PUT: o avatar troca, anuncia e toca success', async () => {
    put.mockResolvedValue({ data: { photoURL: 'https://fotos.exemplo/nova.jpg' } } as never);
    await openEditProfile();
    expect(avatarUri()).toEqual([]);
    fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body, config] = put.mock.calls[0]!;
    expect(url).toBe('/me/photo');
    const { path } = body as { path: string };
    expect(path).toMatch(new RegExp(`^fans/${UID}/photo-[a-z0-9-]+\\.jpg$`));
    expect(uploadLocalFile).toHaveBeenCalledWith(path, 'file:///pronta.jpg', 'image/jpeg');
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
    fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));
    await waitFor(() =>
      expect(announced()).toContain('Não deu para trocar a foto. Tente de novo.'),
    );

    fireEvent.press(screen.getByTestId('edit-profile-photo-retry'));
    await waitFor(() => expect(announced()).toContain('Foto atualizada.'));
    expect(uploadLocalFile).toHaveBeenCalledTimes(1);
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
    fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));
    await waitFor(() => expect(announced()).toContain('Foto atualizada.'));
    expect(uploadLocalFile).toHaveBeenCalledTimes(2);
    const [first, second] = jest.mocked(uploadLocalFile).mock.calls.map(([path]) => path);
    expect(second).not.toBe(first);
    expect(put.mock.calls[1]![2]).not.toEqual(put.mock.calls[0]![2]);

    // Vindo de novo nas duas, o erro.
    put.mockReset();
    put.mockRejectedValue(notFound());
    fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));
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
    fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));
    await waitFor(() =>
      expect(announced()).toContain('Não deu para trocar a foto. Tente de novo.'),
    );
    expect(screen.queryByTestId('edit-profile-photo-retry')).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it('a foto recusada pelo servidor anuncia o motivo e toca error', async () => {
    put.mockRejectedValue(new ApiError('validation', 'fora', 400, 'photo_invalid'));
    await openEditProfile();
    fireEvent.press(screen.getByRole('button', { name: 'Escolher foto da galeria' }));
    const text = 'Não deu para usar essa foto. Escolha outra.';
    expect(await screen.findByText(text)).toBeTruthy();
    expect(announced()).toContain(text);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('remover a foto volta às iniciais e anuncia', async () => {
    remove.mockResolvedValue({ data: { photoURL: null } } as never);
    await openEditProfile({ ...CAMILA, photoURL: 'https://fotos.exemplo/atual.jpg' });
    expect(avatarUri()).toEqual(['https://fotos.exemplo/atual.jpg']);
    fireEvent.press(screen.getByTestId('edit-profile-remove-photo'));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith('/me/photo', {
        headers: { 'Idempotency-Key': expect.stringMatching(/^photo-remove-/) },
      }),
    );
    await waitFor(() => expect(avatarUri()).toEqual([]));
    expect(announced()).toContain('Foto removida.');
  });
});
