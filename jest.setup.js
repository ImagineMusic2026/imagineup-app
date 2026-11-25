/* eslint-env jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Reanimated sem runtime nativo: o mock oficial traz Easing, hooks e animações,
// mas não o que o app usa para "reduzir movimento".
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
  ReducedMotionConfig: () => null,
}));

// Skia sem runtime nativo. É o mock do próprio pacote, o mesmo que o
// jestSetup.js da doc da 2.6 registra, com duas trocas: vem do build CommonJS,
// porque o jest-expo não transforma o pacote, e o motor é um CanvasKit que não
// desenha. A doc carrega o CanvasKit de verdade (WASM de 8 MB) trocando o
// testEnvironment, o que tiraria o ambiente do jest-expo; os testes conferem
// árvore e acessibilidade, nunca pixel. `Skia.Path.Make()` e afins funcionam e
// devolvem objetos que aceitam qualquer chamada.
jest.mock('@shopify/react-native-skia', () => {
  jest.mock('@shopify/react-native-skia/lib/commonjs/Platform', () => {
    const Noop = () => undefined;
    return {
      OS: 'web',
      PixelRatio: 1,
      requireNativeComponent: Noop,
      resolveAsset: Noop,
      findNodeHandle: Noop,
      NativeModules: Noop,
      View: Noop,
    };
  });
  jest.mock('@shopify/react-native-skia/lib/commonjs/skia/core/Font', () => ({
    useFont: () => null,
    matchFont: () => null,
    listFontFamilies: () => [],
    useFonts: () => null,
  }));

  const canvasKit = new Proxy(function noop() {}, {
    get(_target, key) {
      // Sem `then`, ninguém confunde o motor com uma promessa.
      if (key === 'then') return undefined;
      if (key === Symbol.iterator) return function* empty() {};
      if (key === Symbol.toPrimitive) return () => 0;
      if (typeof key === 'symbol') return undefined;
      return canvasKit;
    },
    apply: () => canvasKit,
    construct: () => canvasKit,
  });

  return require('@shopify/react-native-skia/lib/commonjs/mock').Mock(canvasKit);
});

// Os testes rodam como uma build sem API e sem emulador (o Expo Go sem o
// .env). O Jest não lê o .env, mas lê o ambiente do shell e do CI; com
// EXPO_PUBLIC_API_URL ou EXPO_PUBLIC_FIREBASE_EMULATOR_HOST exportada, a
// carteira iria para a API e as suítes das fixtures quebrariam sem nada mudar
// no código. Teste do modo API mocka `@/config/data-source` (ou este módulo)
// no próprio arquivo.
jest.mock('@/config/server', () => ({
  ...jest.requireActual('@/config/server'),
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

// Entrar com a Apple no iPhone (seção 39 de docs/arquitetura-api.md).
//
// expo-apple-authentication sem o módulo nativo. O falso do jest-expo devolve
// promessas vazias: o `isAvailableAsync` e o `getCredentialStateAsync` dão
// `undefined`, e o `signInAsync` lança um TypeError. Aqui, as funções são
// `jest.fn` com respostas de um iPhone, menos a disponibilidade: o padrão é
// "indisponível", para o botão nunca aparecer numa suíte que não pede por ele
// (no Jest, o `isRunningInExpoGo()` também é true, porque o jest-expo mocka o
// módulo nativo `ExpoGo`). O teste das telas mocka o
// `@/domains/auth/hooks/use-apple-entry`; o do serviço faz
// `jest.mocked(isAvailableAsync).mockResolvedValue(true)` com
// `jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn(() => false) }))`. O
// resto: a credencial de quem já entrou antes (sem nome e sem e-mail, que a
// Apple só manda na primeira vez), o estado `AUTHORIZED` e o ouvinte da
// revogação, que o teste dispara com
// `require('expo-apple-authentication').mockEmitRevoked()`. O teste troca a
// resposta com `jest.mocked(signInAsync).mockResolvedValueOnce(...)`, e o
// cancelamento é o `mockRejectedValueOnce` de um erro com o código
// `ERR_REQUEST_CANCELED`. O botão é uma `View` com o papel de botão, o rótulo
// que o sistema escreve e o `onPress` (o `fireEvent.press` toca nele), e fora
// do iOS não desenha nada, como o de verdade. Os enums são os de verdade. Os
// testes da Apple limpam com `jest.clearAllMocks()`, nunca com o
// `resetAllMocks()`, que apagaria as respostas daqui.
jest.mock('expo-apple-authentication', () => {
  const React = require('react');
  const { Platform, View } = require('react-native');
  const actual = jest.requireActual('expo-apple-authentication');
  const { AppleAuthenticationButtonType: ButtonType } = actual;

  const revokeListeners = new Set();
  const buttonLabels = {
    [ButtonType.SIGN_IN]: 'Iniciar sessão com a Apple',
    [ButtonType.CONTINUE]: 'Continuar com a Apple',
    [ButtonType.SIGN_UP]: 'Cadastrar-se com a Apple',
  };

  function credential(options) {
    return {
      user: 'mock-apple-user',
      state: options?.state ?? null,
      fullName: {
        namePrefix: null,
        givenName: null,
        middleName: null,
        familyName: null,
        nameSuffix: null,
        nickname: null,
      },
      email: null,
      realUserStatus: actual.AppleAuthenticationUserDetectionStatus.LIKELY_REAL,
      identityToken: 'mock-apple-identity-token',
      authorizationCode: 'mock-apple-authorization-code',
    };
  }

  function AppleAuthenticationButton({ onPress, ...props }) {
    if (Platform.OS !== 'ios') return null;
    return React.createElement(View, {
      accessible: true,
      accessibilityRole: 'button',
      accessibilityLabel: buttonLabels[props.buttonType],
      ...props,
      onPress,
    });
  }

  return {
    ...actual,
    __esModule: true,
    isAvailableAsync: jest.fn(() => Promise.resolve(false)),
    signInAsync: jest.fn((options) => Promise.resolve(credential(options))),
    refreshAsync: jest.fn((options) => Promise.resolve(credential(options))),
    signOutAsync: jest.fn((options) => Promise.resolve(credential(options))),
    getCredentialStateAsync: jest.fn(() =>
      Promise.resolve(actual.AppleAuthenticationCredentialState.AUTHORIZED),
    ),
    formatFullName: jest.fn((fullName) =>
      [fullName?.givenName, fullName?.middleName, fullName?.familyName].filter(Boolean).join(' '),
    ),
    addRevokeListener: jest.fn((listener) => {
      revokeListeners.add(listener);
      return { remove: () => revokeListeners.delete(listener) };
    }),
    mockEmitRevoked() {
      for (const listener of [...revokeListeners]) listener();
    },
    AppleAuthenticationButton,
  };
});

// expo-crypto com o crypto do Node. O falso do jest-expo devolve `undefined`
// no `randomUUID` e um texto vazio no `digestStringAsync`: o nonce da Apple
// passaria vazio sem nenhum teste notar. Aqui, o UUID é aleatório de verdade,
// e o resumo é o do Node, no algoritmo e na codificação pedidos (hex por
// padrão), para o teste conferir o SHA-256 do nonce bruto. O teste fixa o
// valor com `jest.mocked(randomUUID).mockReturnValueOnce(...)`.
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  const actual = jest.requireActual('expo-crypto');

  // 'SHA-256' vira 'sha256', 'MD5' vira 'md5'.
  const nodeAlgorithm = (algorithm) => algorithm.replace('-', '').toLowerCase();
  const randomBytes = (byteCount) => new Uint8Array(nodeCrypto.randomBytes(byteCount));

  return {
    ...actual,
    __esModule: true,
    randomUUID: jest.fn(() => nodeCrypto.randomUUID()),
    getRandomBytes: jest.fn(randomBytes),
    getRandomBytesAsync: jest.fn((byteCount) => Promise.resolve(randomBytes(byteCount))),
    digestStringAsync: jest.fn((algorithm, data, options) =>
      Promise.resolve(
        nodeCrypto
          .createHash(nodeAlgorithm(algorithm))
          .update(data, 'utf8')
          .digest(options?.encoding === actual.CryptoEncoding.BASE64 ? 'base64' : 'hex'),
      ),
    ),
  };
});
