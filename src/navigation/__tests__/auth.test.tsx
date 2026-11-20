import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';
import { AccessibilityInfo } from 'react-native';

import AuthLayout from '@/app/(auth)/_layout';
import SignUpRoute from '@/app/(auth)/cadastro';
import WelcomeRoute from '@/app/(auth)/entrar';
import SignInRoute from '@/app/(auth)/entrar-com-email';
import { PhotoWall } from '@/domains/auth/components/photo-wall';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

// A abertura (1k) e o que é comum às telas de conta do grupo `(auth)`: o
// fundo com a parede de fotos, a troca entre a abertura, o cadastro e o entrar
// com e-mail, e os links dos termos. O que é só do cadastro fica em
// `auth-cadastro.test.tsx`, e o que é só do entrar com e-mail, em
// `auth-entrar.test.tsx`. Cada arquivo leva os próprios mocks e helpers: o
// projeto não tem helper de teste compartilhado.

// O build do Firebase que o Jest resolve é ESM; as telas só precisam destas peças.
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
  updateProfile: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  onSnapshot: jest.fn(() => () => undefined),
}));

// Sem .env no Jest: a API fica de fora (fixtures) e o aviso de configuração não polui a saída.
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(() => Promise.resolve()) }));

function RootLayout() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: Infinity } },
  });
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

/**
 * O grupo `(auth)` de verdade, pelos próprios arquivos de rota: a pilha com o
 * fundo da 1k e as três telas de conta. Assim a rota fina que aponta para cada
 * tela (`/entrar` é a abertura) também fica travada.
 */
const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': AuthLayout,
  '(auth)/entrar': WelcomeRoute,
  '(auth)/entrar-com-email': SignInRoute,
  '(auth)/cadastro': SignUpRoute,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
});

describe('entrada no app', () => {
  it('a abertura mostra o nome, a frase num foco só e as duas entradas, sobre a parede de fotos do grupo', () => {
    renderRouter(appTree, { initialUrl: '/entrar' });
    expect(screen.getByRole('header', { name: t('auth.welcome.title') })).toBeTruthy();
    // A frase é lida inteira, de uma vez: as palavras soltas ficam fora do leitor.
    expect(screen.getByLabelText(t('auth.welcome.tagline.label'))).toBeTruthy();
    expect(screen.queryByText(t('auth.welcome.tagline.follow'))).toBeNull();
    expect(screen.getByRole('button', { name: t('auth.welcome.createAccount') })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('auth.welcome.haveAccount') })).toBeTruthy();
    // A parede é do fundo do grupo, atrás da pilha: uma só, e fora do leitor de tela.
    expect(screen.UNSAFE_getAllByType(PhotoWall)).toHaveLength(1);
    expect(screen.queryAllByRole('image')).toHaveLength(0);
  });

  it('a abertura leva ao cadastro e a entrar com e-mail, e o link de baixo de cada um troca entre eles', async () => {
    const view = renderRouter(appTree, { initialUrl: '/entrar' });
    expect(screen.getByRole('header', { name: t('auth.welcome.title') })).toBeTruthy();
    const wall = screen.UNSAFE_getByType(PhotoWall);

    fireEvent.press(screen.getByRole('button', { name: t('auth.welcome.createAccount') }));
    await waitFor(() => expect(view.getPathname()).toBe('/cadastro'));

    fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.signIn') }));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));

    // O link troca a tela no lugar: voltar leva à abertura, não ao cadastro.
    fireEvent.press(screen.getByRole('button', { name: t('common.back') }));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));

    fireEvent.press(screen.getByRole('button', { name: t('auth.welcome.haveAccount') }));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));

    // O fundo não é de nenhuma das telas: a parede segue a mesma, montada,
    // enquanto elas trocam por cima dela. (Comparada por fora do `expect`, que
    // numa falha imprimiria a árvore inteira.)
    const walls = screen.UNSAFE_getAllByType(PhotoWall);
    expect(walls).toHaveLength(1);
    expect(walls[0] === wall).toBe(true);
  });

  it('pergunta aberta a frio: o voltar leva à abertura', async () => {
    const view = renderRouter(appTree, { initialUrl: '/entrar-com-email' });

    fireEvent.press(screen.getByRole('button', { name: t('common.back') }));

    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(screen.getByRole('header', { name: t('auth.welcome.title') })).toBeTruthy();
  });

  it('os termos e a privacidade abrem as páginas do site, como links', () => {
    renderRouter(appTree, { initialUrl: '/entrar' });

    const terms = screen.getByRole('link', { name: t('auth.terms.termsLink') });
    fireEvent.press(terms);
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://imagineup-painel.vercel.app/termos/',
      expect.anything(),
    );

    fireEvent.press(screen.getByRole('link', { name: t('auth.terms.privacyLink') }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenLastCalledWith(
      'https://imagineup-painel.vercel.app/privacidade/',
      expect.anything(),
    );
  });
});
