// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

// As decisões de stack do projeto viram erro de lint, para não depender de revisão.
const restrictedImports = {
  paths: [
    {
      name: 'react-native',
      importNames: ['Text'],
      message: 'Use o Text de @/components/text, que aplica as variantes do tema.',
    },
    {
      name: 'react-native',
      importNames: ['FlatList', 'SectionList', 'VirtualizedList'],
      message: 'Use FlashList de @shopify/flash-list.',
    },
    {
      name: 'expo-haptics',
      message: 'Use a camada semântica de @/services/haptics.',
    },
    { name: '@expo/vector-icons', message: 'Use lucide-react-native pelo @/components/icon.' },
    { name: 'moment', message: 'Use date-fns pelo @/utils/date.' },
    { name: 'dayjs', message: 'Use date-fns pelo @/utils/date.' },
    { name: 'yup', message: 'Use zod.' },
    { name: 'nativewind', message: 'O projeto usa StyleSheet puro.' },
    { name: 'styled-components', message: 'O projeto usa StyleSheet puro.' },
    { name: 'styled-components/native', message: 'O projeto usa StyleSheet puro.' },
    { name: 'react-native-unistyles', message: 'O projeto usa StyleSheet puro.' },
    { name: 'tamagui', message: 'O projeto usa StyleSheet puro.' },
  ],
  patterns: [
    {
      group: ['@react-navigation/*'],
      message: 'Desde a SDK 56 o Expo Router não aceita @react-navigation. Importe de expo-router.',
    },
    {
      group: ['@react-native-google-signin/*'],
      message:
        'Use @/services/google-sign-in: o pacote do Google derruba o Expo Go no import. Os tipos vêm por typeof import(...).',
    },
  ],
};

// O pacote do Google (seção 33 da nota) só entra pelo @/services/google-sign-in,
// com require fora do Expo Go. O no-restricted-imports acima não vê require nem
// import(), por isso as duas formas também viram erro fora do serviço.
const GOOGLE_SIGN_IN_SOURCE = '/^@react-native-google-signin/';
const googleSignInMessage =
  'Só o @/services/google-sign-in carrega o pacote do Google, e só fora do Expo Go.';
const googleSignInSyntax = [
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${GOOGLE_SIGN_IN_SOURCE}]`,
    message: googleSignInMessage,
  },
  {
    selector: `ImportExpression[source.value=${GOOGLE_SIGN_IN_SOURCE}]`,
    message: googleSignInMessage,
  },
];

// O SDK do Storage só em src/firebase (bloco 9): importado por um api.ts, o
// build ESM dele quebraria no Jest quase toda suíte, que só mocka o @/firebase.
const storageImport = {
  name: 'firebase/storage',
  message: 'Use @/firebase: fora dele, o Jest quebra.',
};
const restrictedWithStorage = {
  ...restrictedImports,
  paths: [...restrictedImports.paths, storageImport],
};

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // functions/ é outro pacote (Node), com tsc e testes próprios.
    ignores: ['dist/*', 'coverage/*', '.expo/*', 'functions/**'],
  },
  {
    rules: {
      'no-restricted-imports': ['error', restrictedWithStorage],
      'no-restricted-syntax': ['error', ...googleSignInSyntax],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // O único lugar do app que importa o SDK do Storage.
    files: ['src/firebase/**'],
    rules: { 'no-restricted-imports': ['error', restrictedImports] },
  },
  {
    // Os únicos lugares que podem tocar nas APIs cruas que a regra acima bloqueia.
    files: [
      'src/components/text/**',
      'src/components/error-boundary/**',
      'src/services/haptics/**',
      '**/__tests__/**',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // O único lugar que carrega o pacote do Google (por require), e os testes,
    // que o mocam. O import estático continua barrado no serviço.
    files: ['src/services/google-sign-in.ts', '**/__tests__/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/__tests__/**', 'jest.setup.js', 'jest.after-env.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
]);
