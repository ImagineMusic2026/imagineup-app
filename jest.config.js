/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.after-env.js'],
  // Faz o react-native-worklets (usado pelo Reanimated) carregar a versão JS no Jest.
  resolver: 'react-native-worklets/jest/resolver.js',
  moduleNameMapper: {
    // A condição react-native do lucide aponta para ESM (.mjs), que o Jest não transforma.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // tests/ roda só com os emuladores do Firestore e do Storage (npm run test:rules);
  // functions/ tem os próprios testes.
  testPathIgnorePatterns: ['/node_modules/', '/.expo/', '<rootDir>/tests/', '<rootDir>/functions/'],
};
