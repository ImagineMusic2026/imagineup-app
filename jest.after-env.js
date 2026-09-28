/* eslint-env jest */
// O expo-router/testing-library registra o mock simples do Reanimated quando é
// importado, por cima do de jest.setup.js. Depois dos imports do teste,
// completa o que o app usa para "reduzir movimento".
beforeAll(() => {
  const reanimated = jest.requireMock('react-native-reanimated');
  reanimated.useReducedMotion ??= () => false;
  reanimated.ReducedMotionConfig ??= () => null;
});
