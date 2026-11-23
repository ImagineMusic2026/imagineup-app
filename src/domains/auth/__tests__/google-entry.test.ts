import { FirebaseError } from 'firebase/app';
import {
  deleteUser,
  GoogleAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  signInWithCredential,
  signOut as firebaseSignOut,
  type OAuthCredential,
  type User,
  type UserCredential,
} from 'firebase/auth';

import { googleIdToken, revokeGoogleAccess } from '@/services/google-sign-in';

import { deleteAccount, deleteAccountFailure, signOut, toSessionUser } from '../api';
import { forgetPendingGoogleLink, linkPendingGoogle, signInWithGoogle } from '../google-entry';

const mockAuth = { currentUser: null as User | null, authStateReady: async () => undefined };

jest.mock('@/firebase', () => ({ getFirebaseAuth: () => mockAuth }));
jest.mock('@/services/api', () => ({ api: {} }));
jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/services/google-sign-in', () => ({
  GoogleSignInError: class extends Error {},
  googleIdToken: jest.fn(),
  signOutGoogle: jest.fn(),
  revokeGoogleAccess: jest.fn(),
}));
jest.mock('firebase/auth', () => ({
  deleteUser: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn() },
  linkWithCredential: jest.fn(),
  reauthenticateWithCredential: jest.fn(),
  signInWithCredential: jest.fn(),
  signOut: jest.fn(),
}));

const EMAIL = 'bia@example.test';
const googleCredential = { providerId: 'google.com' } as OAuthCredential;
const passwordUser = { uid: 'conta-existente', email: EMAIL } as User;
const googleUser: User = {
  ...passwordUser,
  uid: 'conta-google',
  photoURL: 'https://example.test/google-avatar.png',
  providerData: [{ ...passwordUser, uid: 'google-id', providerId: 'google.com' }],
};

beforeEach(() => {
  forgetPendingGoogleLink();
  jest.resetAllMocks();
  mockAuth.currentUser = null;
  jest.mocked(googleIdToken).mockResolvedValue({ email: EMAIL, idToken: 'google-token' });
  jest.mocked(GoogleAuthProvider.credential).mockReturnValue(googleCredential);
});

function rejectGoogleAccountCollision(): void {
  jest.mocked(signInWithCredential).mockRejectedValueOnce(
    new FirebaseError('auth/account-exists-with-different-credential', 'Conta com senha'),
  );
}

it('vincula Google ao mesmo UID depois da entrada com a senha', async () => {
  rejectGoogleAccountCollision();
  await expect(signInWithGoogle()).resolves.toEqual({ kind: 'link', email: EMAIL });
  expect(linkWithCredential).not.toHaveBeenCalled();

  mockAuth.currentUser = passwordUser;
  await expect(linkPendingGoogle(passwordUser)).resolves.toBe('linked');
  expect(linkWithCredential).toHaveBeenCalledWith(passwordUser, googleCredential);
  await expect(linkPendingGoogle(passwordUser)).resolves.toBeNull();
});

it('descarta o vínculo se a sessão atual não é a conta autenticada com senha', async () => {
  rejectGoogleAccountCollision();
  await signInWithGoogle();
  mockAuth.currentUser = googleUser;

  await expect(linkPendingGoogle(passwordUser)).resolves.toBe('failed');
  expect(linkWithCredential).not.toHaveBeenCalled();
});

it('só exclui uma conta Google antiga depois de reautenticar o mesmo usuário', async () => {
  mockAuth.currentUser = googleUser;
  jest.mocked(deleteUser).mockRejectedValueOnce(
    new FirebaseError('auth/requires-recent-login', 'Login antigo'),
  );

  await expect(deleteAccount().catch(deleteAccountFailure)).resolves.toBe('needsGoogle');
  jest.mocked(reauthenticateWithCredential).mockResolvedValueOnce({ user: googleUser } as UserCredential);
  await expect(deleteAccount(undefined, true, googleUser.uid)).resolves.toBe('deleted');
  expect(reauthenticateWithCredential).toHaveBeenCalledWith(googleUser, googleCredential);
  expect(deleteUser).toHaveBeenLastCalledWith(googleUser);
  expect(revokeGoogleAccess).toHaveBeenCalledTimes(1);
});

it('mantém a conta intacta ao escolher outro usuário do Google', async () => {
  mockAuth.currentUser = googleUser;
  jest.mocked(reauthenticateWithCredential).mockRejectedValueOnce(
    new FirebaseError('auth/user-mismatch', 'Outra conta'),
  );

  await expect(deleteAccount(undefined, true, googleUser.uid).catch(deleteAccountFailure))
    .resolves.toBe('wrongGoogleAccount');
  expect(deleteUser).not.toHaveBeenCalled();
  expect(signInWithCredential).not.toHaveBeenCalled();
  expect(revokeGoogleAccess).not.toHaveBeenCalled();
});

it('cancela a exclusão se outra sessão entrar enquanto o Google está aberto', async () => {
  mockAuth.currentUser = googleUser;
  jest.mocked(googleIdToken).mockImplementationOnce(async () => {
    mockAuth.currentUser = passwordUser;
    return { email: EMAIL, idToken: 'google-token' };
  });

  await expect(deleteAccount(undefined, true, googleUser.uid)).resolves.toBe('canceled');
  expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  expect(deleteUser).not.toHaveBeenCalled();
  expect(revokeGoogleAccess).not.toHaveBeenCalled();
});

it('não encerra uma nova sessão por falha na tentativa de excluir a anterior', async () => {
  mockAuth.currentUser = passwordUser;
  await signOut(googleUser.uid);
  expect(firebaseSignOut).not.toHaveBeenCalled();
});

it('descarta a foto do provedor na sessão do ImagineUP', () => {
  expect(toSessionUser(googleUser).photoURL).toBeNull();
});
