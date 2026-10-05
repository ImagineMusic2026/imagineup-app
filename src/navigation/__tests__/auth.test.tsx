import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as WebBrowser from 'expo-web-browser';
import { FirebaseError } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
  type UserCredential,
} from 'firebase/auth';
import { onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo } from 'react-native';

import AuthLayout from '@/app/(auth)/_layout';
import SignUpRoute from '@/app/(auth)/cadastro';
import WelcomeRoute from '@/app/(auth)/entrar';
import SignInRoute from '@/app/(auth)/entrar-com-email';
import InviteRoute from '@/app/convite/[codigo]';
import { sendInviteClaim } from '@/domains/auth/api';
import { readBoundInvite, savePendingInvite } from '@/domains/invites';
import { t } from '@/i18n';
import { ApiError } from '@/services/api';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

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

// O claim do convite é o do app de verdade, menos a ida ao servidor.
jest.mock('@/domains/auth/api', () => ({
  ...jest.requireActual('@/domains/auth/api'),
  sendInviteClaim: jest.fn(async () => ({ status: 'claimed' })),
}));

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
 * tela (`/entrar` é a abertura) também fica travada. A rota do convite, fora
 * dos guards, recebe o link aberto por fora no meio do cadastro.
 */
const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': AuthLayout,
  '(auth)/entrar': WelcomeRoute,
  '(auth)/entrar-com-email': SignInRoute,
  '(auth)/cadastro': SignUpRoute,
  'convite/[codigo]': InviteRoute,
};

const announce = () => jest.mocked(AccessibilityInfo.announceForAccessibility);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  useSessionStore.setState({ status: 'signedOut', user: null, authHolds: 0 });
});

describe('entrada no app', () => {
  it('a abertura leva ao cadastro e a entrar com e-mail, e os rodapés trocam entre eles', async () => {
    const view = renderRouter(appTree, { initialUrl: '/entrar' });
    expect(screen.getByRole('header', { name: t('auth.welcome.title') })).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: t('auth.welcome.createAccount') }));
    await waitFor(() => expect(view.getPathname()).toBe('/cadastro'));

    fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.signIn') }));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));

    // O rodapé troca a tela no lugar: voltar leva à abertura, não ao cadastro.
    fireEvent.press(screen.getByRole('button', { name: t('common.back') }));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));

    fireEvent.press(screen.getByRole('button', { name: t('auth.welcome.haveAccount') }));
    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));
  });

  it('formulário aberto a frio: o voltar leva à abertura', async () => {
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

  it('o cadastro mostra a etapa 1 de 2', () => {
    renderRouter(appTree, { initialUrl: '/cadastro' });
    expect(
      screen.getByRole('progressbar', {
        name: t('components.stepProgress.label', { current: 1, total: 2 }),
      }),
    ).toBeTruthy();
  });
});

describe('entrar com e-mail', () => {
  function fillSignIn(email: string, password: string): void {
    fireEvent.changeText(screen.getByLabelText(t('auth.email')), email);
    fireEvent.changeText(screen.getByLabelText(t('auth.password')), password);
  }

  it('manda o e-mail normalizado e segura o fã até as telas de conta saírem', async () => {
    let heldWhileSigningIn = false;
    jest.mocked(signInWithEmailAndPassword).mockImplementation(async () => {
      heldWhileSigningIn = useSessionStore.getState().authHolds > 0;
      return {} as UserCredential;
    });
    renderRouter(appTree, { initialUrl: '/entrar-com-email' });

    fillSignIn(' Camila@X.com ', 'senha-123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.submit') }));
    });

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith({}, 'camila@x.com', 'senha-123');
    expect(heldWhileSigningIn).toBe(true);
    // Depois da saída em fade, o guard fica livre para trocar a pilha.
    await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
    expect(haptics.trigger).toHaveBeenCalledWith('success');
  });

  it('credencial recusada: mostra e anuncia o erro, que sai quando o fã volta a digitar', async () => {
    jest
      .mocked(signInWithEmailAndPassword)
      .mockRejectedValueOnce(new FirebaseError('auth/invalid-credential', 'recusada'));
    renderRouter(appTree, { initialUrl: '/entrar-com-email' });

    fillSignIn('camila@x.com', 'senha-errada');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.submit') }));
    });

    expect(await screen.findByText(t('auth.errors.invalidCredentials'))).toBeTruthy();
    expect(announce()).toHaveBeenCalledWith(t('auth.errors.invalidCredentials'));
    expect(useSessionStore.getState().authHolds).toBe(0);

    fireEvent.changeText(screen.getByLabelText(t('auth.password')), 'senha-certa');
    await waitFor(() => expect(screen.queryByText(t('auth.errors.invalidCredentials'))).toBeNull());
  });

  it('a senha curta enviada pelo "ir" do teclado é anunciada, e nada vai ao Firebase', async () => {
    renderRouter(appTree, { initialUrl: '/entrar-com-email' });

    fillSignIn('camila@x.com', '123');
    await act(async () => {
      fireEvent(screen.getByLabelText(t('auth.password')), 'submitEditing');
    });

    await waitFor(() =>
      expect(announce()).toHaveBeenCalledWith(t('validation.passwordMin', { min: 6 })),
    );
    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('o aviso da redefinição de senha sai quando o fã tenta entrar', async () => {
    jest.mocked(sendPasswordResetEmail).mockResolvedValue(undefined);
    jest.mocked(signInWithEmailAndPassword).mockResolvedValue({} as UserCredential);
    renderRouter(appTree, { initialUrl: '/entrar-com-email' });

    fireEvent.changeText(screen.getByLabelText(t('auth.email')), 'camila@x.com');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.forgot') }));
    });
    expect(await screen.findByText(t('auth.signIn.resetSent'))).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText(t('auth.password')), 'senha-123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.submit') }));
    });

    expect(screen.queryByText(t('auth.signIn.resetSent'))).toBeNull();
    await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
  });
});

describe('cadastro', () => {
  const user = { uid: 'nova', email: 'camila@x.com', displayName: null, photoURL: null };

  function fillSignUp(name: string, email: string, password: string): void {
    fireEvent.changeText(screen.getByLabelText(t('auth.signUp.name')), name);
    fireEvent.changeText(screen.getByLabelText(t('auth.email')), email);
    fireEvent.changeText(screen.getByLabelText(t('auth.password')), password);
  }

  it('manda o nome limpo para a conta e o e-mail normalizado', async () => {
    jest
      .mocked(createUserWithEmailAndPassword)
      .mockResolvedValue({ user } as unknown as UserCredential);
    renderRouter(appTree, { initialUrl: '/cadastro' });

    fillSignUp(' ⁦Camila Ribeiro⁩ ', ' Camila@X.com ', 'senha-123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
    });

    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    expect(createUserWithEmailAndPassword).toHaveBeenCalledWith({}, 'camila@x.com', 'senha-123');
    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: 'Camila Ribeiro' });
    expect(useSessionStore.getState().authHolds).toBe(1);
  });

  it('apertar "ir" duas vezes cria uma conta só, e o fã não sai da tela enquanto ela nasce', async () => {
    jest
      .mocked(createUserWithEmailAndPassword)
      .mockResolvedValue({ user } as unknown as UserCredential);
    const view = renderRouter(appTree, { initialUrl: '/cadastro' });

    fillSignUp('Camila Ribeiro', 'camila@x.com', 'senha-123');
    // O "próximo" da senha leva ao código de convite, e o "ir" dele envia.
    const inviteCode = screen.getByLabelText(t('auth.signUp.inviteCode'));
    await act(async () => {
      fireEvent(inviteCode, 'submitEditing');
    });
    await waitFor(() => expect(onSnapshot).toHaveBeenCalled());
    await act(async () => {
      fireEvent(inviteCode, 'submitEditing');
    });

    expect(createUserWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(useSessionStore.getState().authHolds).toBe(1);
    // Voltar e trocar de tela ficam parados até o perfil nascer.
    const back = screen.getByRole('button', { name: t('common.back') });
    expect(back).toBeDisabled();
    fireEvent.press(back);
    expect(screen.getByRole('button', { name: t('auth.signUp.signIn') })).toBeDisabled();
    expect(view.getPathname()).toBe('/cadastro');
  });

  it('nome que a regra recusaria não chega ao Firebase, e o erro é anunciado', async () => {
    renderRouter(appTree, { initialUrl: '/cadastro' });

    fillSignUp('Camila​', 'camila@x.com', 'senha-123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
    });

    // O erro chega ao leitor de tela pelo próprio campo e pelo anúncio.
    await waitFor(() =>
      expect(screen.getByLabelText(t('auth.signUp.name'))).toHaveProp(
        'accessibilityHint',
        `${t('validation.nameInvalid')} ${t('auth.signUp.nameHint')}`,
      ),
    );
    expect(announce()).toHaveBeenCalledWith(t('validation.nameInvalid'));
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('a regra da senha fica embaixo do campo e é lida com ele', () => {
    renderRouter(appTree, { initialUrl: '/cadastro' });
    expect(screen.getByLabelText(t('auth.password'))).toHaveProp(
      'accessibilityHint',
      t('auth.signUp.passwordHint', { min: 6 }),
    );
  });

  it('e-mail que já tem conta: o atalho abre o entrar com o e-mail preenchido', async () => {
    jest
      .mocked(createUserWithEmailAndPassword)
      .mockRejectedValueOnce(new FirebaseError('auth/email-already-in-use', 'em uso'));
    const view = renderRouter(appTree, { initialUrl: '/cadastro' });

    fillSignUp('Camila Ribeiro', ' Camila@X.com ', 'senha-123');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
    });
    expect(await screen.findByText(t('auth.errors.emailInUse'))).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.signInWithEmail') }));

    await waitFor(() => expect(view.getPathname()).toBe('/entrar-com-email'));
    expect(screen.getByLabelText(t('auth.email'))).toHaveProp('value', 'camila@x.com');
  });

  describe('código de convite', () => {
    const claim = jest.mocked(sendInviteClaim);

    /** O perfil nasce na hora em que o cadastro passa a esperar por ele. */
    function profileArrivesAtOnce(): void {
      jest.mocked(onSnapshot).mockImplementation(((
        _ref: unknown,
        next: (snap: unknown) => void,
      ) => {
        next({ exists: () => true, data: () => ({ displayName: 'Camila Ribeiro' }) });
        return () => undefined;
      }) as unknown as typeof onSnapshot);
    }

    beforeEach(() => {
      jest
        .mocked(createUserWithEmailAndPassword)
        .mockResolvedValue({ user } as unknown as UserCredential);
      claim.mockImplementation(async () => ({ status: 'claimed' }));
    });

    afterEach(() => {
      jest.mocked(onSnapshot).mockImplementation(() => () => undefined);
      useSessionStore.setState({ authHolds: 0 });
    });

    it('vem preenchido com o código do link guardado, e a regra fica embaixo dele', async () => {
      await savePendingInvite('k7p3m9qx', { path: '/post/p-clipe', utm: {} });
      renderRouter(appTree, { initialUrl: '/cadastro' });
      const field = screen.getByLabelText(t('auth.signUp.inviteCode'));
      await waitFor(() =>
        expect(screen.getByLabelText(t('auth.signUp.inviteCode'))).toHaveProp('value', 'K7P3M9QX'),
      );
      expect(field).toHaveProp('accessibilityHint', t('auth.signUp.inviteCodeHint'));
      expect(field).toHaveProp('autoCapitalize', 'characters');
      expect(field).toHaveProp('autoCorrect', false);
    });

    it('formato inválido: o erro no campo, anunciado, e nada vai ao Firebase', async () => {
      renderRouter(appTree, { initialUrl: '/cadastro' });
      fillSignUp('Camila Ribeiro', 'camila@x.com', 'senha-123');
      fireEvent.changeText(screen.getByLabelText(t('auth.signUp.inviteCode')), 'ab!');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
      });
      await waitFor(() =>
        expect(screen.getByLabelText(t('auth.signUp.inviteCode'))).toHaveProp(
          'accessibilityHint',
          `${t('validation.inviteCodeInvalid')} ${t('auth.signUp.inviteCodeHint')}`,
        ),
      );
      expect(announce()).toHaveBeenCalledWith(t('validation.inviteCodeInvalid'));
      expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
    });

    it('código digitado recusado: a tela fica no estágio, com os campos travados, e "Continuar sem código" solta o fã', async () => {
      profileArrivesAtOnce();
      claim.mockRejectedValueOnce(
        new ApiError('notFound', 'Convite não encontrado.', 404, 'invite_not_found'),
      );
      const view = renderRouter(appTree, { initialUrl: '/cadastro' });
      fillSignUp('Camila Ribeiro', 'camila@x.com', 'senha-123');
      fireEvent.changeText(screen.getByLabelText(t('auth.signUp.inviteCode')), 'errado12');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
      });

      const message = t('auth.signUp.inviteRejected.notFound');
      await waitFor(() => expect(announce()).toHaveBeenCalledWith(message));
      // A conta já existe: o título deixa de pedir para criar.
      expect(screen.getByText(t('auth.signUp.inviteRejected.title'))).toBeTruthy();
      expect(screen.queryByText(t('auth.signUp.title'))).toBeNull();
      expect(screen.getByText(t('auth.signUp.inviteRejected.lead'))).toBeTruthy();
      expect(screen.getByLabelText(t('auth.signUp.inviteCode'))).toHaveProp(
        'accessibilityHint',
        `${message} ${t('auth.signUp.inviteCodeHint')}`,
      );
      for (const label of [t('auth.signUp.name'), t('auth.email'), t('auth.password')]) {
        expect(screen.getByLabelText(label)).toHaveProp('editable', false);
      }
      // A conta já existe: sem o "Já tem conta?", sem voltar, e o fã segue seguro.
      expect(screen.queryByRole('button', { name: t('auth.signUp.signIn') })).toBeNull();
      expect(screen.getByRole('button', { name: t('common.back') })).toBeDisabled();
      expect(useSessionStore.getState().authHolds).toBe(1);
      expect(claim).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ERRADO12', via: 'code' }),
      );

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.skipInvite') }));
      });
      await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
      expect(claim).toHaveBeenCalledTimes(1);
      expect(view.getPathname()).toBe('/cadastro');
    });

    it('no estágio, "Continuar" com o código corrigido manda de novo e solta o fã', async () => {
      profileArrivesAtOnce();
      claim.mockRejectedValueOnce(
        new ApiError('validation', 'Não vale.', 409, 'invite_not_allowed'),
      );
      renderRouter(appTree, { initialUrl: '/cadastro' });
      fillSignUp('Camila Ribeiro', 'camila@x.com', 'senha-123');
      fireEvent.changeText(screen.getByLabelText(t('auth.signUp.inviteCode')), 'CAMILA12');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
      });
      await waitFor(() =>
        expect(announce()).toHaveBeenCalledWith(t('auth.signUp.inviteRejected.notAllowed')),
      );

      fireEvent.changeText(screen.getByLabelText(t('auth.signUp.inviteCode')), 'certo-123');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.continue') }));
      });
      await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
      expect(claim).toHaveBeenLastCalledWith(
        expect.objectContaining({ code: 'CERTO123', via: 'code' }),
      );
    });

    /** Cadastro com um código digitado que o servidor recusa: a tela para no estágio. */
    async function reachRejectedStage(): Promise<ReturnType<typeof renderRouter>> {
      profileArrivesAtOnce();
      claim.mockRejectedValueOnce(
        new ApiError('notFound', 'Convite não encontrado.', 404, 'invite_not_found'),
      );
      const view = renderRouter(appTree, { initialUrl: '/cadastro' });
      fillSignUp('Camila Ribeiro', 'camila@x.com', 'senha-123');
      fireEvent.changeText(screen.getByLabelText(t('auth.signUp.inviteCode')), 'errado12');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
      });
      await waitFor(() =>
        expect(announce()).toHaveBeenCalledWith(t('auth.signUp.inviteRejected.notFound')),
      );
      expect(useSessionStore.getState().authHolds).toBe(1);
      return view;
    }

    it('no estágio, o link de convite aberto por fora volta ao cadastro, com o fã seguro e o código novo no campo', async () => {
      const view = await reachRejectedStage();

      await act(async () => {
        router.navigate('/convite/outro-123?destino=%2Fpost%2Fp-clipe');
      });
      await waitFor(() =>
        expect(screen.getByLabelText(t('auth.signUp.inviteCode'))).toHaveProp('value', 'OUTRO123'),
      );
      expect(view.getPathname()).toBe('/cadastro');
      expect(screen.getByText(t('auth.signUp.inviteRejected.lead'))).toBeTruthy();
      expect(useSessionStore.getState().authHolds).toBe(1);
      // O erro do código recusado sai com o código novo.
      expect(screen.getByLabelText(t('auth.signUp.inviteCode'))).toHaveProp(
        'accessibilityHint',
        t('auth.signUp.inviteCodeHint'),
      );

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.continue') }));
      });
      await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
      // O código do link vai como link, com a página de onde veio.
      expect(claim).toHaveBeenLastCalledWith(
        expect.objectContaining({
          uid: 'nova',
          code: 'OUTRO123',
          via: 'link',
          origin: { path: '/post/p-clipe', utm: {} },
        }),
      );
    });

    it('a tela de cadastro que sai no estágio sem passar pelos botões solta o fã', async () => {
      const view = await reachRejectedStage();

      await act(async () => {
        router.replace('/entrar');
      });
      await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
      expect(useSessionStore.getState().authHolds).toBe(0);
    });

    it('o código do link (o mesmo do campo) não para o cadastro: vai depois, pela sincronização', async () => {
      profileArrivesAtOnce();
      await savePendingInvite('K7P3M9QX', { path: '/post/p-clipe', utm: {} });
      renderRouter(appTree, { initialUrl: '/cadastro' });
      await waitFor(() =>
        expect(screen.getByLabelText(t('auth.signUp.inviteCode'))).toHaveProp('value', 'K7P3M9QX'),
      );
      fillSignUp('Camila Ribeiro', 'camila@x.com', 'senha-123');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: t('auth.signUp.submit') }));
      });

      await waitFor(() => expect(useSessionStore.getState().authHolds).toBe(0));
      expect(claim).not.toHaveBeenCalled();
      expect(await readBoundInvite('nova')).toMatchObject({ code: 'K7P3M9QX', via: 'link' });
    });
  });
});

describe('esqueci minha senha', () => {
  it('sem e-mail, pede o e-mail no próprio campo e anuncia o pedido', async () => {
    renderRouter(appTree, { initialUrl: '/entrar-com-email' });

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.forgot') }));
    });

    const email = screen.getByLabelText(t('auth.email'));
    expect(email).toHaveProp('accessibilityHint', t('auth.signIn.forgotNeedsEmail'));
    expect(announce()).toHaveBeenCalledWith(t('auth.signIn.forgotNeedsEmail'));
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();

    // Voltou a digitar: o aviso sai.
    fireEvent.changeText(email, 'c');
    expect(screen.getByLabelText(t('auth.email')).props.accessibilityHint).toBeUndefined();
  });

  it('com e-mail, manda o link e responde sem dizer se a conta existe', async () => {
    jest.mocked(sendPasswordResetEmail).mockResolvedValue(undefined);
    renderRouter(appTree, { initialUrl: '/entrar-com-email' });

    fireEvent.changeText(screen.getByLabelText(t('auth.email')), ' Camila@X.com ');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.forgot') }));
    });

    expect(await screen.findByText(t('auth.signIn.resetSent'))).toBeTruthy();
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({}, 'camila@x.com');
  });
});
