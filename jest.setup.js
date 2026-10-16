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

// Pelo mesmo motivo, o Google fica desligado em toda suíte: com o
// EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID exportado no shell, o botão dele
// apareceria sem nada mudar no código. Teste do Google ligado mocka o
// `@/config/env` no próprio arquivo, com o `googleWebClientId`.
jest.mock('@/config/env', () => ({
  ...jest.requireActual('@/config/env'),
  googleWebClientId: undefined,
}));

// O Jest roda como uma build própria, e não no Expo Go: o jest-expo traz o
// módulo nativo `ExpoGo` falso, e com ele o `isRunningInExpoGo()` do `expo`
// dá verdadeiro em toda suíte. Troca só o `@/config/runtime` (o `expo` inteiro
// fica); teste do Expo Go muda o retorno do `isExpoGo` no próprio arquivo.
jest.mock('@/config/runtime', () => ({ isExpoGo: jest.fn(() => false) }));

// expo-video sem o módulo nativo. O falso do jest-expo não tem o
// `VideoPlayer`, e importar o pacote lança (ele mexe no
// `NativeVideoModule.VideoPlayer.prototype` ao carregar), em toda suíte que
// chegue a ele. Aqui, cada `useVideoPlayer` cria um player falso
// e roda o `setup`, como o de verdade, e cria outro quando a fonte muda. O
// player guarda os ouvintes do `addListener` (o `useEvent` e o
// `useEventListener` do `expo` ouvem por ele), e o teste dispara o evento com
// `player.emit('statusChange', { status: 'error', error: { message: 'x' } })`,
// que também atualiza o `status` (e o `playingChange`, o `playing`). Os
// players criados ficam em `require('expo-video').mockPlayers`, na ordem
// (zere com `mockPlayers.length = 0`). A `VideoView` é uma `View` com as
// props: o `fireEvent(view, 'firstFrameRender')` chama o `onFirstFrameRender`.
jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');

  const mockPlayers = [];

  function createPlayer(source) {
    const listeners = new Map();
    const player = {
      source: typeof source === 'string' ? { uri: source } : source,
      status: 'idle',
      playing: false,
      currentTime: 0,
      duration: 0,
      muted: false,
      loop: false,
      volume: 1,
      play: jest.fn(() => {
        player.playing = true;
      }),
      pause: jest.fn(() => {
        player.playing = false;
      }),
      replay: jest.fn(),
      seekBy: jest.fn(),
      replace: jest.fn(),
      replaceAsync: jest.fn(() => Promise.resolve()),
      release: jest.fn(),
      addListener: jest.fn((event, listener) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        return { remove: () => set.delete(listener) };
      }),
      emit(event, payload) {
        if (event === 'statusChange') player.status = payload.status;
        if (event === 'playingChange') player.playing = payload.isPlaying;
        for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
      },
    };
    mockPlayers.push(player);
    return player;
  }

  function useVideoPlayer(source, setup) {
    const key = JSON.stringify(source);
    const player = React.useMemo(
      () => {
        const created = createPlayer(source);
        setup?.(created);
        return created;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps -- como o hook de verdade: player novo só com outra fonte.
      [key],
    );
    React.useEffect(() => () => player.release(), [player]);
    return player;
  }

  const VideoView = React.forwardRef(function VideoView(props, ref) {
    React.useImperativeHandle(
      ref,
      () => ({
        enterFullscreen: jest.fn(() => Promise.resolve()),
        exitFullscreen: jest.fn(() => Promise.resolve()),
        startPictureInPicture: jest.fn(() => Promise.resolve()),
        stopPictureInPicture: jest.fn(() => Promise.resolve()),
      }),
      [],
    );
    return React.createElement(View, props);
  });

  return {
    __esModule: true,
    mockPlayers,
    useVideoPlayer,
    createVideoPlayer: (source) => createPlayer(source),
    VideoView,
    VideoAirPlayButton: () => null,
    isPictureInPictureSupported: () => false,
    setVideoCacheSizeAsync: jest.fn(() => Promise.resolve()),
    clearVideoCacheAsync: jest.fn(() => Promise.resolve()),
    getCurrentVideoCacheSize: () => 0,
  };
});

// O teto do cache de vídeo (`configureVideoCache`, chamado na abertura) sem
// tocar no expo-video; o teste do serviço usa o de verdade (`jest.requireActual`).
jest.mock('@/services/video-cache', () => ({
  ...jest.requireActual('@/services/video-cache'),
  configureVideoCache: jest.fn(() => Promise.resolve()),
}));

// Entrar com a Apple e com o Google (seção 33 de docs/arquitetura-api.md).
//
// expo-apple-authentication sem o módulo nativo. O falso do jest-expo devolve
// promessas vazias: o `isAvailableAsync` e o `getCredentialStateAsync` dão
// `undefined`, e o `signInAsync` lança um TypeError. Aqui, as funções são
// `jest.fn` com as respostas de um iPhone (o jest-expo roda como iOS; com o
// `Platform.OS` de outro sistema, indisponível e sem botão, como o de
// verdade): disponível, a credencial de quem já entrou antes (sem nome e sem
// e-mail, que a Apple só manda na primeira vez), o estado `AUTHORIZED` e o
// ouvinte da revogação, que o teste dispara com
// `require('expo-apple-authentication').mockEmitRevoked()`. O teste troca a
// resposta com `jest.mocked(signInAsync).mockResolvedValueOnce(...)`, e o
// cancelamento é o `mockRejectedValueOnce` de um erro com o código
// `ERR_REQUEST_CANCELED`. O botão é uma `View` com o papel de botão, o rótulo
// que o sistema escreve e o `onPress` (o `fireEvent.press` toca nele). Os
// enums são os de verdade.
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
    isAvailableAsync: jest.fn(() => Promise.resolve(Platform.OS === 'ios')),
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

// O pacote do Google sem o módulo nativo: importar o de verdade lança (o
// `TurboModuleRegistry` não acha o `RNGoogleSignin`). É o mock do próprio
// pacote (a página "Testing" da doc dele), que troca só o módulo nativo e
// deixa o JS do pacote rodar: o `signIn` responde `{ type: 'success', data }`,
// o cancelamento vira `{ type: 'cancelled', data: null }` e o
// `hasPlayServices` do Android confere as opções. A resposta padrão é de
// sucesso, com o `idToken` `mockIdToken` e o e-mail `mockEmail`, e os
// `statusCodes` valem `mock_SIGN_IN_CANCELLED`, `mock_IN_PROGRESS` e assim por
// diante. O teste troca a resposta com
// `jest.spyOn(GoogleSignin, 'signIn').mockResolvedValueOnce(...)` (o
// `GoogleSignin` é um objeto comum). O caminho é o do arquivo, porque o
// `exports` do pacote não publica a pasta `jest`.
require('./node_modules/@react-native-google-signin/google-signin/jest/build/jest/setup.js');
