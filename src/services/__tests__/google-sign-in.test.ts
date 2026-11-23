import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import { googleIdToken, isGoogleSignInAvailable } from '../google-sign-in';

jest.mock('expo', () => ({ isRunningInExpoGo: jest.fn() }));
jest.mock('@/config/env', () => ({
  firebaseEnv: {},
  googleWebClientId: '1234-web.apps.googleusercontent.com',
}));

const mockConfigure = jest.fn();
const mockHasPlayServices = jest.fn();
const mockSignIn = jest.fn();

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: mockConfigure,
    hasPlayServices: mockHasPlayServices,
    signIn: mockSignIn,
  },
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.mocked(isRunningInExpoGo).mockReturnValue(false);
  mockHasPlayServices.mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

it('não carrega o módulo nativo no Expo Go, mesmo com o cliente configurado', async () => {
  jest.mocked(isRunningInExpoGo).mockReturnValue(true);

  expect(isGoogleSignInAvailable()).toBe(false);
  await expect(googleIdToken()).rejects.toMatchObject({ reason: 'unavailable' });
  expect(mockConfigure).not.toHaveBeenCalled();
});

it('não oferece login Google no iOS', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');

  expect(isGoogleSignInAvailable()).toBe(false);
});

it('devolve o token e o e-mail da conta escolhida no Android', async () => {
  mockSignIn.mockResolvedValueOnce({
    type: 'success',
    data: { idToken: 'google-id-token', user: { email: 'fan@example.com' } },
  });

  expect(isGoogleSignInAvailable()).toBe(true);
  await expect(googleIdToken()).resolves.toEqual({
    idToken: 'google-id-token',
    email: 'fan@example.com',
  });
  expect(mockHasPlayServices).toHaveBeenCalledWith({ showPlayServicesUpdateDialog: true });
});

it('trata o fechamento do seletor como cancelamento', async () => {
  mockSignIn.mockResolvedValueOnce({ type: 'cancelled' });

  await expect(googleIdToken()).resolves.toBeNull();
});
