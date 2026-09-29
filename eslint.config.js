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
  ],
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
      'no-restricted-imports': ['error', restrictedImports],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
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
    files: ['**/__tests__/**', 'jest.setup.js', 'jest.after-env.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
]);
