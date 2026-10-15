/**
 * Entrar com o Google (seção 33 de docs/arquitetura-api.md). O pacote é o do
 * mock dele mesmo (o `jest.setup.js`), que troca só o módulo nativo: o JS do
 * pacote roda, e os `statusCodes` vêm com o prefixo `mock_`. O serviço guarda
 * o pacote carregado e configurado: cada teste roda num registro de módulos
 * próprio (`isolateModulesAsync`), com o serviço, o pacote, o `react-native` e
 * o `@/config/runtime` dali, para o `require` do serviço achar o mesmo pacote
 * do teste (o `doMock` do pacote só conta as cargas e devolve o de verdade).
 */

type Service = typeof import('../google-sign-in');
type GooglePackage = typeof import('@react-native-google-signin/google-signin');
type Runtime = { isExpoGo: jest.Mock<boolean, []> };
type ReactNative = typeof import('react-native');

// O Google ligado mocka o `@/config/env` aqui, com o `googleWebClientId` lido
// a cada uso (getter, sem espalhar o objeto); o jest.setup.js o deixa vazio.
const mockEnv: { googleWebClientId: string | undefined } = { googleWebClientId: undefined };
jest.mock('@/config/env', () => ({
  get googleWebClientId() {
    return mockEnv.googleWebClientId;
  },
}));

// O `extra.googleIosClientId` do app.config.ts, que só existe com o ID do cliente iOS.
const mockExtra: { googleIosClientId?: string } = {};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: mockExtra };
    },
  },
}));

const WEB_CLIENT_ID = '1234-web.apps.googleusercontent.com';
const IOS_CLIENT_ID = '1234-ios.apps.googleusercontent.com';
const PACKAGE = '@react-native-google-signin/google-signin';

interface Deps {
  service: Service;
  google: GooglePackage;
  runtime: Runtime;
  platform: ReactNative['Platform'];
  /** Quantas vezes o pacote foi carregado neste registro. */
  loads: () => number;
}

/** Roda o teste num registro de módulos próprio, contando as cargas do pacote. */
function withService(run: (deps: Deps) => Promise<void>): Promise<void> {
  return jest.isolateModulesAsync(async () => {
    let loads = 0;
    jest.doMock(PACKAGE, () => {
      loads += 1;
      return jest.requireActual<GooglePackage>(PACKAGE);
    });
    const { Platform } = jest.requireActual<ReactNative>('react-native');
    const runtime = jest.requireMock<Runtime>('@/config/runtime');
    const service = jest.requireActual<Service>('../google-sign-in');
    await run({
      service,
      runtime,
      platform: Platform,
      // O pacote do teste só é pedido quando ele precisa espiar.
      get google() {
        return jest.requireMock<GooglePackage>(PACKAGE);
      },
      loads: () => loads,
    });
  });
}

beforeEach(() => {
  mockEnv.googleWebClientId = WEB_CLIENT_ID;
  mockExtra.googleIosClientId = IOS_CLIENT_ID;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.dontMock(PACKAGE);
});

describe('quando o botão do Google aparece', () => {
  it('sem o EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, indisponível, e nada carrega o pacote', () =>
    withService(async ({ service, loads }) => {
      mockEnv.googleWebClientId = undefined;

      expect(service.isGoogleSignInAvailable()).toBe(false);
      await expect(service.googleIdToken()).rejects.toMatchObject({ reason: 'unavailable' });
      await expect(service.signOutGoogle()).resolves.toBeUndefined();
      await expect(service.revokeGoogleAccess()).resolves.toBeUndefined();
      expect(loads()).toBe(0);
    }));

  it('no Expo Go, indisponível mesmo com a variável, e nada carrega o pacote', () =>
    withService(async ({ service, runtime, loads }) => {
      runtime.isExpoGo.mockReturnValue(true);

      expect(service.isGoogleSignInAvailable()).toBe(false);
      await expect(service.googleIdToken()).rejects.toBeInstanceOf(service.GoogleSignInError);
      expect(loads()).toBe(0);
    }));

  it('no iOS, sem o ID do cliente iOS, indisponível (o pacote recusaria)', () =>
    withService(async ({ service, platform, loads }) => {
      jest.replaceProperty(platform, 'OS', 'ios');
      delete mockExtra.googleIosClientId;

      expect(service.isGoogleSignInAvailable()).toBe(false);
      expect(loads()).toBe(0);
    }));

  it('no Android, o ID do cliente iOS não faz falta', () =>
    withService(async ({ service, platform }) => {
      jest.replaceProperty(platform, 'OS', 'android');
      delete mockExtra.googleIosClientId;

      expect(service.isGoogleSignInAvailable()).toBe(true);
    }));

  it('com a variável, fora do Expo Go e com o ID do cliente iOS, disponível', () =>
    withService(async ({ service, loads }) => {
      expect(service.isGoogleSignInAvailable()).toBe(true);
      // Saber que está disponível não carrega o pacote.
      expect(loads()).toBe(0);
    }));
});

describe('a folha do Google', () => {
  it('devolve o idToken e o e-mail da conta escolhida, e configura uma vez com os dois IDs', () =>
    withService(async ({ service, google }) => {
      const configure = jest.spyOn(google.GoogleSignin, 'configure');

      await expect(service.googleIdToken()).resolves.toEqual({
        idToken: 'mockIdToken',
        email: 'mockEmail',
      });
      await service.googleIdToken();

      expect(configure).toHaveBeenCalledTimes(1);
      expect(configure).toHaveBeenCalledWith({
        webClientId: WEB_CLIENT_ID,
        iosClientId: IOS_CLIENT_ID,
      });
    }));

  it('cancelada, null, sem erro', () =>
    withService(async ({ service, google }) => {
      jest
        .spyOn(google.GoogleSignin, 'signIn')
        .mockResolvedValueOnce({ type: 'cancelled', data: null });

      await expect(service.googleIdToken()).resolves.toBeNull();
    }));

  it('o cancelamento que chega como erro também vira null', () =>
    withService(async ({ service, google }) => {
      jest
        .spyOn(google.GoogleSignin, 'signIn')
        .mockRejectedValueOnce(
          Object.assign(new Error('cancelado'), { code: google.statusCodes.SIGN_IN_CANCELLED }),
        );

      await expect(service.googleIdToken()).resolves.toBeNull();
    }));

  it('com outra entrada do Google já aberta (IN_PROGRESS), ignora, sem erro', () =>
    withService(async ({ service, google }) => {
      expect(google.statusCodes.IN_PROGRESS).toBe('mock_IN_PROGRESS');
      jest
        .spyOn(google.GoogleSignin, 'signIn')
        .mockRejectedValueOnce(
          Object.assign(new Error('em andamento'), { code: google.statusCodes.IN_PROGRESS }),
        );

      await expect(service.googleIdToken()).resolves.toBeNull();
    }));

  it('sem o idToken (o webClientId errado), o erro próprio', () =>
    withService(async ({ service, google }) => {
      jest.spyOn(google.GoogleSignin, 'signIn').mockResolvedValueOnce({
        type: 'success',
        data: {
          idToken: null,
          serverAuthCode: null,
          scopes: [],
          user: {
            id: '1',
            email: 'fa@gmail.com',
            name: null,
            photo: null,
            familyName: null,
            givenName: null,
          },
        },
      });

      await expect(service.googleIdToken()).rejects.toMatchObject({ reason: 'noIdToken' });
    }));

  it('outro erro do pacote passa adiante', () =>
    withService(async ({ service, google }) => {
      const failure = Object.assign(new Error('DEVELOPER_ERROR'), { code: '10' });
      jest.spyOn(google.GoogleSignin, 'signIn').mockRejectedValueOnce(failure);

      await expect(service.googleIdToken()).rejects.toBe(failure);
    }));
});

describe('o Google Play Services, no Android', () => {
  it('confere antes da folha, com o aviso do sistema para atualizar', () =>
    withService(async ({ service, google, platform }) => {
      jest.replaceProperty(platform, 'OS', 'android');
      const hasPlayServices = jest.spyOn(google.GoogleSignin, 'hasPlayServices');

      await expect(service.googleIdToken()).resolves.toMatchObject({ idToken: 'mockIdToken' });
      expect(hasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
    }));

  it('ausente, vira o erro próprio, e a folha não abre', () =>
    withService(async ({ service, google, platform }) => {
      jest.replaceProperty(platform, 'OS', 'android');
      jest.spyOn(google.GoogleSignin, 'hasPlayServices').mockRejectedValueOnce(
        Object.assign(new Error('sem Play Services'), {
          code: google.statusCodes.PLAY_SERVICES_NOT_AVAILABLE,
        }),
      );
      const signIn = jest.spyOn(google.GoogleSignin, 'signIn');

      await expect(service.googleIdToken()).rejects.toMatchObject({ reason: 'playServices' });
      expect(signIn).not.toHaveBeenCalled();
    }));

  it('desatualizado (a conferência responde falso), o mesmo erro', () =>
    withService(async ({ service, google, platform }) => {
      jest.replaceProperty(platform, 'OS', 'android');
      jest.spyOn(google.GoogleSignin, 'hasPlayServices').mockResolvedValueOnce(false);

      await expect(service.googleIdToken()).rejects.toMatchObject({ reason: 'playServices' });
    }));

  it('no iOS, não confere', () =>
    withService(async ({ service, google, platform }) => {
      jest.replaceProperty(platform, 'OS', 'ios');
      const hasPlayServices = jest.spyOn(google.GoogleSignin, 'hasPlayServices');

      await service.googleIdToken();
      expect(hasPlayServices).not.toHaveBeenCalled();
    }));
});

describe('sair e revogar', () => {
  it('sair do Google nunca lança', () =>
    withService(async ({ service, google }) => {
      const signOut = jest
        .spyOn(google.GoogleSignin, 'signOut')
        .mockRejectedValueOnce(new Error('sem rede'));

      await expect(service.signOutGoogle()).resolves.toBeUndefined();
      expect(signOut).toHaveBeenCalledTimes(1);
    }));

  it('revogar tira o acesso e sai, sem lançar mesmo com a revogação recusada', () =>
    withService(async ({ service, google }) => {
      const revokeAccess = jest
        .spyOn(google.GoogleSignin, 'revokeAccess')
        .mockRejectedValueOnce(new Error('recusada'));
      const signOut = jest.spyOn(google.GoogleSignin, 'signOut');

      await expect(service.revokeGoogleAccess()).resolves.toBeUndefined();
      expect(revokeAccess).toHaveBeenCalledTimes(1);
      expect(signOut).toHaveBeenCalledTimes(1);
    }));
});
