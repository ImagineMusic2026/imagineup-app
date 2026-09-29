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
