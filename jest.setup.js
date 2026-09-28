/* eslint-env jest */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// Reanimated sem runtime nativo: o mock oficial traz Easing, hooks e animações.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
