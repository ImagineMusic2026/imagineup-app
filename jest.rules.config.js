/**
 * Testes das regras do Firestore e do Storage, em Node e contra os emuladores.
 * Rode com `npm run test:rules` (sobe os emuladores e roda esta config).
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'jest-expo/node',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  testTimeout: 20_000,
  // Todos os arquivos usam o mesmo emulador e o mesmo projeto: em paralelo, um
  // limpa os dados do outro no meio do teste.
  maxWorkers: 1,
  // O preset de Node não aplica o babel-preset-expo sozinho (o projeto não tem
  // babel.config.js), e sem ele o TypeScript dos testes não é lido.
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
};
