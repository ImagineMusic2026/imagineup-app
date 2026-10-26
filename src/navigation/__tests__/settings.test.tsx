import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';
import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { LogOut } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, BackHandler, Linking, Text } from 'react-native';

import DeleteAccountRoute from '@/app/excluir-conta';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/config/links';
import { useAuthListener } from '@/domains/auth';
import { handOffEmail, readHandedOffEmail } from '@/domains/auth/email-handoff';
import { useSessionGate } from '@/hooks/use-session-gate';
import { api } from '@/services/api';
import { queryClient, queryPersister } from '@/services/query';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';

jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: jest.fn(),
  deleteUser: jest.fn(),
  EmailAuthProvider: {
    credential: jest.fn((email: string, password: string) => ({ email, password })),
  },
  onAuthStateChanged: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  updateProfile: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));

// O usuário do Firebase que a tela exclui; a sessão já confirmada.
const mockUser = { uid: 'uid-descarte', email: 'descarte@teste.imagineup' };
const mockAuth = {
  authStateReady: jest.fn(() => Promise.resolve()),
  currentUser: mockUser as typeof mockUser | null,
};
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));
// A config do app que está rodando. O `expoConfig` do jest-expo é um getter
// que não se troca (null sem manifesto); o resto das constantes segue o real.
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: Object.create(actual.default, {
      expoConfig: { get: () => ({ name: 'ImagineUP', slug: 'imagineup', version: '0.1.0' }) },
    }),
  };
});
// O update que está rodando: o binário embutido por padrão; os casos da versão trocam.
const mockUpdate = {
  isEmbeddedLaunch: true,
  createdAt: null as Date | null,
  updateId: null as string | null,
};
jest.mock('expo-updates', () => ({
  __esModule: true,
  get isEmbeddedLaunch() {
    return mockUpdate.isEmbeddedLaunch;
  },
  get createdAt() {
    return mockUpdate.createdAt;
  },
  get updateId() {
    return mockUpdate.updateId;
  },
}));
// Nas fixtures por padrão; os casos da meta com a API trocam.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

/** Os guards do app, o listener do Auth de verdade e o cache do app (que ele limpa). */
function RootLayout() {
  useAuthListener();
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
          <Stack.Screen name="trocar-senha" />
          <Stack.Screen name="trocar-email" />
          <Stack.Screen name="excluir-conta" />
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
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  '(tabs)/(perfil)/fas-bloqueados': label('fas bloqueados'),
  'editar-perfil': label('editar perfil'),
  'trocar-senha': label('trocar senha'),
  'trocar-email': label('trocar email'),
  'excluir-conta': DeleteAccountRoute,
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
};

type AuthCallback = (user: { uid: string; email: string | null } | null) => void;

/** O Firebase avisa que a sessão acabou (sair, conta excluída). */
function authSaysSignedOut(): void {
  const call = jest.mocked(onAuthStateChanged).mock.calls.at(-1);
  if (!call) throw new Error('listener não registrado');
  act(() => (call[1] as AuthCallback)(null));
}

const firebaseError = (code: string) => new FirebaseError(code, code);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

const DELETE = 'Excluir minha conta';

const hidden = { includeHiddenElements: true } as const;
const CONFIRM = 'Confirmar e excluir';

let removeClient: jest.SpyInstance;

/** A sessão de antes, com ou sem o provedor de senha (`undefined`: sem o campo). */
function setSessionPassword(hasPassword: boolean | undefined): void {
  useSessionStore.setState({
    user: {
      uid: 'uid-descarte',
      email: 'descarte@teste.imagineup',
      displayName: null,
      photoURL: null,
      ...(hasPassword === undefined ? {} : { hasPassword }),
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  mockAuth.currentUser = mockUser;
  Object.assign(mockUpdate, { isEmbeddedLaunch: true, createdAt: null, updateId: null });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  jest.mocked(onAuthStateChanged).mockReturnValue(() => undefined);
  jest.mocked(firebaseSignOut).mockResolvedValue(undefined);
  removeClient = jest.spyOn(queryPersister, 'removeClient').mockResolvedValue(undefined);
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: 'uid-descarte',
      email: 'descarte@teste.imagineup',
      displayName: null,
      photoURL: null,
    },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: 'uid-descarte',
  });
  queryClient.setQueryData(['profile', 'me', 'uid-descarte'], { username: 'fa711224' });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  queryClient.clear();
  jest.restoreAllMocks();
});

/** As linhas dos Ajustes, as divisórias e os avisos, pelo testID (o rodapé da versão é o último). */
const MENU_ROW =
  /^settings-(menu-divider|edit-profile|change-email|change-password|fan-club|fan-club-follows|blocked-fans|terms|privacy|rules|contact|contact-error|sign-out|delete-account|version)$/;

/** Os cabeçalhos e as linhas na ordem da tela: prende cada linha à seção dela. */
function menuOrder(): string[] {
  return screen.UNSAFE_root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      (node.props.accessibilityRole === 'header' || MENU_ROW.test(node.props.testID ?? '')),
  ).map((node) =>
    node.props.accessibilityRole === 'header' ? String(node.props.children) : node.props.testID,
  );
}

describe('Ajustes', () => {
  it('as seções e as linhas na ordem do menu de referência, cada linha na seção dela, e o rodapé no fim', () => {
    setSessionPassword(true);
    queryClient.setQueryData(['rewards', 'list'], {
      rulesUrl: 'https://imagineup-painel.vercel.app/regulamento/',
      rewards: [],
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(menuOrder()).toEqual([
      'Ajustes',
      'Perfil e conta',
      'settings-edit-profile',
      'settings-change-email',
      'settings-change-password',
      'settings-menu-divider',
      'Privacidade e segurança',
      'settings-blocked-fans',
      'settings-terms',
      'settings-privacy',
      'settings-menu-divider',
      'Sobre',
      'settings-rules',
      'settings-contact',
      'settings-menu-divider',
      'Zona de perigo',
      'settings-sign-out',
      'settings-version',
    ]);
    // Sem a suspensão, nada de aviso no topo.
    expect(screen.queryByTestId('suspended-notice')).toBeNull();
  });

  it('sem a conta com senha e sem a loja no cache, o Perfil e conta fica só com "Editar perfil"', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(menuOrder()).toEqual([
      'Ajustes',
      'Perfil e conta',
      'settings-edit-profile',
      'settings-menu-divider',
      'Privacidade e segurança',
      'settings-blocked-fans',
      'settings-terms',
      'settings-privacy',
      'settings-menu-divider',
      'Sobre',
      'settings-contact',
      'settings-menu-divider',
      'Zona de perigo',
      'settings-sign-out',
      'settings-version',
    ]);
  });

  it('a linha fina entre as seções vai de ponta a ponta, por cima do recuo da tela, e fica fora do leitor', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const dividers = screen.getAllByTestId('settings-menu-divider', hidden);
    expect(dividers).toHaveLength(3);
    for (const divider of dividers) {
      expect(divider).toHaveStyle({ marginHorizontal: -spacing.gutter, height: 1 });
      expect(divider.props.accessible).toBeFalsy();
    }
  });

  it('as linhas mostram só o título, sem a linha cinza embaixo, e o leitor ouve o título', () => {
    setSessionPassword(true);
    renderRouter(appTree, { initialUrl: '/ajustes' });

    for (const name of [
      'Editar perfil',
      'Trocar e-mail',
      'Trocar senha',
      'Fãs bloqueados',
      'Sair da conta',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Fale com a equipe' })).toBeTruthy();
    for (const meta of [
      'Só leitura nesta versão do app',
      'Manda um link para o e-mail novo',
      'Pede a senha atual',
      'Veja e desbloqueie',
      'Entrou como descarte@teste.imagineup',
      SUPPORT_EMAIL,
    ]) {
      expect(screen.queryByText(meta)).toBeNull();
    }
  });

  it('os nomes das seções saem como escritos, sem a caixa alta das outras telas', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByRole('header', { name: 'Perfil e conta' })).not.toHaveStyle({
      textTransform: 'uppercase',
    });
    expect(screen.getByRole('header', { name: 'Zona de perigo' })).toHaveStyle({
      color: colors.textMuted,
    });
  });

  it('a zona de perigo só com o Sair: o título e o ícone na cor de perigo, e sem a seta, porque sai na hora', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByText('Sair')).toHaveStyle({ color: colors.danger });
    expect(screen.UNSAFE_getByType(LogOut).props.color).toBe(colors.danger);
    expect(screen.queryByTestId('settings-sign-out-trailing', hidden)).toBeNull();
    // Excluir conta saiu dos Ajustes: é a última opção do "Editar perfil".
    expect(screen.queryByTestId('settings-delete-account')).toBeNull();
    expect(screen.queryByText('Excluir conta')).toBeNull();
  });

  it('"Fãs bloqueados" abre a lista na pilha do Perfil', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    const row = screen.getByRole('button', { name: 'Fãs bloqueados' });
    expect(row).toHaveProp('accessibilityHint', 'Abre a lista de fãs bloqueados');
    expect(screen.getByTestId('settings-blocked-fans-trailing', hidden)).toBeTruthy();

    fireEvent.press(row);
    await waitFor(() => expect(view.getPathname()).toBe('/fas-bloqueados'));
    expect(view.getSegments()).toEqual(['(tabs)', '(perfil)', 'fas-bloqueados']);
    expect(screen.getByText('fas bloqueados')).toBeTruthy();
  });

  it('a conta suspensa: o aviso fixo no topo, com o motivo e "Escrever para a equipe" (seção 29)', () => {
    queryClient.setQueryData(['profile', 'me', 'uid-descarte'], {
      username: 'fa711224',
      suspendedAt: '2026-10-10T12:00:00.000Z',
      suspensionReason: 'spam',
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByTestId('suspended-notice')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Sua conta está suspensa' })).toBeTruthy();
    expect(screen.getByText('Motivo: envio de spam.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Escrever para a equipe' })).toBeTruthy();
    // O aviso vem antes da primeira seção.
    const headers = screen.getAllByRole('header').map((node) => node.props.children);
    expect(headers.indexOf('Sua conta está suspensa')).toBeLessThan(
      headers.indexOf('Perfil e conta'),
    );
  });

  it('"Editar perfil" abre a tela fora das abas', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    const row = screen.getByRole('button', { name: 'Editar perfil' });
    expect(row).toHaveProp('accessibilityHint', 'Abre a edição do perfil');
    expect(screen.getByTestId('settings-edit-profile-trailing', hidden)).toBeTruthy();

    fireEvent.press(row);
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
    expect(view.getSegments()).toEqual(['editar-perfil']);
    expect(screen.getByText('editar perfil')).toBeTruthy();
  });

  it('"Trocar e-mail" e "Trocar senha" só aparecem na conta com senha (seção 29, frente D)', () => {
    setSessionPassword(true);
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const email = screen.getByRole('button', { name: 'Trocar e-mail' });
    expect(email).toHaveProp('accessibilityHint', 'Abre a troca de e-mail');
    const password = screen.getByRole('button', { name: 'Trocar senha' });
    expect(password).toHaveProp('accessibilityHint', 'Abre a troca de senha');
  });

  it.each([
    ['sem o provedor de senha', false],
    ['sem o campo na sessão', undefined],
  ])('%s, as duas linhas não aparecem', (_, hasPassword) => {
    setSessionPassword(hasPassword);
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.queryByTestId('settings-change-email')).toBeNull();
    expect(screen.queryByTestId('settings-change-password')).toBeNull();
    expect(screen.getByTestId('settings-sign-out')).toBeTruthy();
  });

  it('"Trocar senha" e "Trocar e-mail" abrem fora das abas, na pilha raiz', async () => {
    setSessionPassword(true);
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-change-password'));
    await waitFor(() => expect(view.getPathname()).toBe('/trocar-senha'));
    expect(view.getSegments()).toEqual(['trocar-senha']);
    expect(screen.getByText('trocar senha')).toBeTruthy();

    act(() => router.back());
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    fireEvent.press(screen.getByTestId('settings-change-email'));
    await waitFor(() => expect(view.getPathname()).toBe('/trocar-email'));
    expect(view.getSegments()).toEqual(['trocar-email']);
  });

  it('Sair esquece o e-mail guardado para o login (o da troca de e-mail ainda não entra)', async () => {
    handOffEmail('descarte.novo@teste.imagineup');
    renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-sign-out'));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(readHandedOffEmail()).toBeNull();
  });

  it('Sair: sai no Firebase, o cache do aparelho vai embora e o guard leva à entrada', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-sign-out'));
    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    // A linha fica ocupada até a sessão cair, e o leitor ouve isso.
    await waitFor(() => expect(screen.getByTestId('settings-sign-out')).toBeBusy());
    expect(queryClient.getQueryData(['profile', 'me', 'uid-descarte'])).toBeDefined();

    authSaysSignedOut();

    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(queryClient.getQueryData(['profile', 'me', 'uid-descarte'])).toBeUndefined();
    expect(removeClient).toHaveBeenCalled();
    expect(usePreferencesStore.getState().lastSessionUid).toBeNull();
    expect(useSessionStore.getState().status).toBe('signedOut');
  });
});

describe('excluir conta', () => {
  it('exclui no Firebase Auth e, com a sessão encerrada, limpa o aparelho e volta à entrada', async () => {
    jest.mocked(deleteUser).mockResolvedValue(undefined);
    const view = renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith(mockUser));
    expect(mockAuth.authStateReady).toHaveBeenCalled();
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Sua conta foi excluída.',
        { queue: true },
      ),
    );
    // Até o guard trocar a tela, o botão segue ocupado e o voltar, desativado.
    expect(screen.getByRole('button', { name: DELETE })).toBeBusy();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();

    // O Firebase encerra a sessão da conta excluída.
    authSaysSignedOut();
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(queryClient.getQueryData(['profile', 'me', 'uid-descarte'])).toBeUndefined();
    expect(removeClient).toHaveBeenCalled();
  });

  it('login antigo: pede a senha, reautentica com a credencial de e-mail e só então exclui', async () => {
    jest
      .mocked(deleteUser)
      .mockRejectedValueOnce(firebaseError('auth/requires-recent-login'))
      .mockResolvedValueOnce(undefined);
    jest.mocked(reauthenticateWithCredential).mockResolvedValue({} as never);
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    const password = await screen.findByLabelText('Sua senha');
    expect(password).toHaveProp('secureTextEntry', true);
    expect(announced()).toContain('Por segurança, confirme sua senha para excluir a conta.');
    expect(haptics.trigger).toHaveBeenCalledWith('warning');

    // Vazia, nada vai ao Firebase.
    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    // A mensagem chega ao leitor pelo próprio campo (hint), não pelo texto.
    expect(await screen.findByText('Digite sua senha.', hidden)).toBeTruthy();
    expect(password.props.accessibilityHint).toBe('Digite sua senha.');
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();

    fireEvent.changeText(password, 'descarte-f10');
    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledTimes(2));
    expect(EmailAuthProvider.credential).toHaveBeenCalledWith(
      'descarte@teste.imagineup',
      'descarte-f10',
    );
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockUser, {
      email: 'descarte@teste.imagineup',
      password: 'descarte-f10',
    });
    const reauthOrder = jest.mocked(reauthenticateWithCredential).mock.invocationCallOrder[0] ?? 0;
    const deleteOrder = jest.mocked(deleteUser).mock.invocationCallOrder[1] ?? 0;
    expect(reauthOrder).toBeLessThan(deleteOrder);
  });

  it('senha errada: erro no campo, a conta fica, e o erro sai quando o fã volta a digitar', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    jest
      .mocked(reauthenticateWithCredential)
      .mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    const password = await screen.findByLabelText('Sua senha');
    fireEvent.changeText(password, 'senha-errada');
    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));

    expect(await screen.findByText('Senha incorreta.', hidden)).toBeTruthy();
    expect(announced()).toContain('Senha incorreta.');
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(firebaseSignOut).not.toHaveBeenCalled();

    fireEvent.changeText(password, 'senha-certa');
    await waitFor(() => expect(screen.queryByText('Senha incorreta.', hidden)).toBeNull());
  });

  it('sem conexão no meio: mensagem, conta como estava, na mesma tela', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/network-request-failed'));
    const view = renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    const message =
      'Sem conexão. Sua conta continua como estava. Confira a internet e tente de novo.';
    expect(await screen.findByText(message)).toBeTruthy();
    expect(announced()).toContain(message);
    expect(firebaseSignOut).not.toHaveBeenCalled();
    expect(view.getPathname()).toBe('/excluir-conta');
    expect(useSessionStore.getState().status).toBe('signedIn');
    // Dá para tentar de novo.
    expect(screen.getByRole('button', { name: DELETE })).not.toBeDisabled();
  });

  it('sem internet, o botão fica desligado e diz por quê, no próprio botão', () => {
    act(() => onlineManager.setOnline(false));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    const button = screen.getByRole('button', { name: DELETE });
    expect(button).toBeDisabled();
    // O leitor chega ao botão antes do aviso: o motivo vai na dica dele.
    expect(button).toHaveProp(
      'accessibilityHint',
      'Sem internet. Conecte-se para excluir a conta.',
    );
    expect(screen.getByText('Sem internet. Conecte-se para excluir a conta.')).toBeTruthy();
  });

  it('sem internet, nem o "ir" do teclado na senha manda o pedido', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/requires-recent-login'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });
    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    const password = await screen.findByLabelText('Sua senha');

    act(() => onlineManager.setOnline(false));
    fireEvent.changeText(password, 'descarte-f10');
    fireEvent(password, 'submitEditing');

    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledTimes(1);
  });

  it('na pilha raiz, por cima das abas: diz o que se perde, sem excluir nada, e "Manter minha conta" volta', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    act(() => router.push('/excluir-conta'));

    await waitFor(() => expect(view.getPathname()).toBe('/excluir-conta'));
    expect(view.getSegments()).toEqual(['excluir-conta']);
    expect(screen.getByRole('header', { name: 'Excluir conta' })).toBeTruthy();
    expect(screen.getByText(/A exclusão é definitiva/)).toBeTruthy();
    expect(screen.getByText(/bio, cidade e redes\. O @ fica livre para outra pessoa/)).toBeTruthy();
    expect(screen.getByText(/o saldo, o nível e as conquistas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: DELETE })).toBeTruthy();
    expect(deleteUser).not.toHaveBeenCalled();

    fireEvent.press(screen.getByRole('button', { name: 'Manter minha conta' }));
    await waitFor(() => expect(view.getPathname()).toBe('/ajustes'));
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('enquanto exclui, fora das abas, o voltar do Android não tira o fã da tela', async () => {
    const pending = new Promise<void>(() => undefined);
    jest.mocked(deleteUser).mockReturnValueOnce(pending);
    const backPress = jest.spyOn(BackHandler, 'addEventListener');
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });
    act(() => router.push('/excluir-conta'));
    await waitFor(() => expect(view.getPathname()).toBe('/excluir-conta'));

    fireEvent.press(screen.getByRole('button', { name: DELETE }));
    await waitFor(() => expect(deleteUser).toHaveBeenCalled());

    const listener = backPress.mock.calls
      .filter(([event]) => event === 'hardwareBackPress')
      .at(-1)?.[1] as (() => boolean | null | undefined) | undefined;
    // `true` diz ao Android que o voltar já foi tratado: a tela fica.
    expect(listener?.()).toBe(true);
    expect(view.getPathname()).toBe('/excluir-conta');
  });

  it('aberta a frio, "Manter minha conta" cai no Perfil, e não numa pilha vazia', async () => {
    const view = renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: 'Manter minha conta' }));

    await waitFor(() => expect(view.getPathname()).toBe('/perfil'));
  });

  it('sessão que já tinha caído (token revogado): sai da conta para o fã entrar de novo', async () => {
    jest.mocked(deleteUser).mockRejectedValueOnce(firebaseError('auth/user-token-expired'));
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(announced()).toContain('Sua sessão terminou. Entre de novo para excluir a conta.');
  });

  it('sem conta logada no Firebase, nem tenta excluir', async () => {
    mockAuth.currentUser = null;
    renderRouter(appTree, { initialUrl: '/excluir-conta' });

    fireEvent.press(screen.getByRole('button', { name: DELETE }));

    await waitFor(() => expect(firebaseSignOut).toHaveBeenCalled());
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe('as páginas, o Sobre e o rodapé (seção 29, frente C)', () => {
  it('privacidade e termos abrem no navegador dentro do app, com a seta de fora do app', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const privacy = screen.getByRole('link', { name: 'Política de privacidade' });
    expect(privacy).toHaveProp('accessibilityHint', 'Abre a página no navegador');
    expect(screen.getByTestId('settings-privacy-trailing', hidden)).toBeTruthy();
    fireEvent.press(privacy);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      PRIVACY_URL,
      expect.objectContaining({ createTask: false }),
    );

    fireEvent.press(screen.getByRole('link', { name: 'Termos de uso' }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      TERMS_URL,
      expect.objectContaining({ createTask: false }),
    );
  });

  it('o regulamento só aparece com o endereço no cache da loja', () => {
    queryClient.setQueryData(['rewards', 'list'], {
      rulesUrl: 'https://imagineup-painel.vercel.app/regulamento/',
      rewards: [],
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const rules = screen.getByRole('link', { name: 'Regulamento das recompensas' });
    expect(rules).toHaveProp('accessibilityHint', 'Abre a página no navegador');
    fireEvent.press(rules);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://imagineup-painel.vercel.app/regulamento/',
      expect.anything(),
    );
  });

  it('sem a loja no cache, nem com o endereço null, a linha não aparece, e a loja não é buscada', () => {
    mockDataSource = 'api';
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.queryByTestId('settings-rules')).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith('/rewards');
    expect(queryClient.getQueryState(['rewards', 'list'])?.fetchStatus).toBe('idle');
    view.unmount();

    queryClient.setQueryData(['rewards', 'list'], { rulesUrl: null, rewards: [] });
    renderRouter(appTree, { initialUrl: '/ajustes' });
    expect(screen.queryByTestId('settings-rules')).toBeNull();
  });

  it('"Fale com a equipe" abre o app de e-mail com o endereço da equipe', async () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const contact = screen.getByRole('link', { name: 'Fale com a equipe' });
    expect(contact).toHaveProp('accessibilityHint', 'Abre o seu app de e-mail');
    fireEvent.press(contact);

    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith(
        `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Contato pelo app ImagineUP')}`,
      ),
    );
    expect(screen.queryByTestId('settings-contact-error')).toBeNull();
  });

  it('sem app de e-mail, o endereço aparece embaixo da seção, selecionável, e é anunciado', async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('sem app de e-mail'));
    renderRouter(appTree, { initialUrl: '/ajustes' });

    fireEvent.press(screen.getByTestId('settings-contact'));

    const message = `Não deu para abrir o e-mail. Escreva para ${SUPPORT_EMAIL}.`;
    const error = await screen.findByTestId('settings-contact-error');
    expect(error).toHaveTextContent(message);
    expect(error).toHaveProp('selectable', true);
    expect(announced()).toContain(message);
    // Logo depois do contato, antes da seção seguinte.
    const order = menuOrder();
    expect(order.slice(order.indexOf('settings-contact'), order.indexOf('Zona de perigo'))).toEqual(
      ['settings-contact', 'settings-contact-error', 'settings-menu-divider'],
    );
  });

  it('o rodapé: o nome e a versão do binário embutido, centralizados, sem toque', () => {
    renderRouter(appTree, { initialUrl: '/ajustes' });

    const version = screen.getByTestId('settings-version');
    expect(version).toHaveProp('accessibilityLabel', 'Versão do app, 0.1.0');
    expect(version).not.toHaveProp('accessibilityRole', 'button');
    expect(version).toHaveStyle({ alignItems: 'center' });
    // Um elemento só para o leitor: o nome e a versão ficam dentro dele.
    expect(within(version).getByText('ImagineUP')).toBeTruthy();
    expect(within(version).getByText('Versão 0.1.0')).toBeTruthy();
    // A antiga linha "Versão do app" saiu: o rodapé tomou o lugar dela.
    expect(screen.queryByText('Versão do app')).toBeNull();
  });

  it('num EAS Update, a versão traz a data e o id curto do update', () => {
    Object.assign(mockUpdate, {
      isEmbeddedLaunch: false,
      // Meio do dia em UTC: "13 out" em qualquer fuso de -12 a +11.
      createdAt: new Date('2026-10-13T12:00:00.000Z'),
      updateId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    });
    renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByText('Versão 0.1.0, atualização de 13 out (a1b2c3d4)')).toBeTruthy();
    expect(screen.getByTestId('settings-version')).toHaveProp(
      'accessibilityLabel',
      'Versão do app, 0.1.0, atualização de 13 out (a1b2c3d4)',
    );
  });
});
