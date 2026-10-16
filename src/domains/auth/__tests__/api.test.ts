import { FirebaseError } from 'firebase/app';
import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
  type User,
} from 'firebase/auth';

import { sourceOf } from '@/config/data-source';
import type { BoundInvite, PendingInvite } from '@/domains/invites';
import { api, ApiError, type ApiErrorKind } from '@/services/api';

import {
  buildClaimBody,
  buildVisitBody,
  changeEmailFailure,
  changePassword,
  changePasswordFailure,
  confirmedUser,
  deleteAccountFailure,
  isFinalInviteRejection,
  listenToAuth,
  RecentLoginRequiredError,
  requestEmailChange,
  sendInviteClaim,
  sendInviteVisit,
  SessionEndedError,
  sessionProvider,
  signInMethodOf,
  toSessionUser,
  typedInviteRejection,
} from '../api';

// O build do Firebase que o Jest resolve é ESM; aqui só chegam estas peças.
jest.mock('firebase/app', () => ({
  FirebaseError: class FirebaseError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));
jest.mock('firebase/auth', () => ({
  EmailAuthProvider: {
    credential: jest.fn((email: string, password: string) => ({ email, password })),
  },
  reauthenticateWithCredential: jest.fn(),
  updatePassword: jest.fn(),
  verifyBeforeUpdateEmail: jest.fn(),
  onAuthStateChanged: jest.fn(() => () => undefined),
}));
jest.mock('firebase/firestore', () => ({}));
// A conta da sessão que troca a senha e o e-mail.
const mockUser = { uid: 'uid-alan', email: 'alan@teste.imagineup' };
const mockAuth = {
  authStateReady: jest.fn(() => Promise.resolve()),
  currentUser: mockUser as { uid: string; email: string | null } | null,
};
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => mockAuth,
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: jest.fn(() => 'api'),
  usesFixtures: () => false,
}));
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api/errors'),
  api: { post: jest.fn(), put: jest.fn(), get: jest.fn() },
}));

const post = jest.mocked(api.post);
const source = jest.mocked(sourceOf);

const fromLink: BoundInvite = {
  uid: 'uid-bia',
  code: 'k7p3m9qx',
  via: 'link',
  origin: {
    path: '/post/p-clipe?aba=comentarios',
    utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
  },
  receivedAt: '2026-10-05T14:02:11.000Z',
  boundAt: '2026-10-05T14:05:00.000Z',
  idempotencyKey: 'invite-K7P3M9QX-2026-10-05T14:02:11.000Z',
};

const typed: BoundInvite = {
  uid: 'uid-enzo',
  code: 'CAMILA12',
  via: 'code',
  origin: null,
  receivedAt: '2026-10-05T14:05:00.000Z',
  boundAt: '2026-10-05T14:05:00.000Z',
  idempotencyKey: 'invite-CAMILA12-2026-10-05T14:05:00.000Z',
};

const pending: PendingInvite = {
  code: 'K7P3M9QX',
  receivedAt: '2026-10-05T14:02:11.000Z',
  origin: { path: '/artista/nettobrito', utm: {} },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = mockUser;
  source.mockReturnValue('api');
  post.mockResolvedValue({ data: { status: 'claimed' } });
});

describe('corpos do convite', () => {
  it('claim do link: código normalizado, a página sem a busca, os três utm e o openedAt', () => {
    expect(buildClaimBody(fromLink)).toEqual({
      code: 'K7P3M9QX',
      via: 'link',
      link: { path: '/post/p-clipe' },
      utm: { source: 'instagram', medium: 'story', campaign: 'sao-joao' },
      openedAt: '2026-10-05T14:02:11.000Z',
    });
  });

  it('claim do código digitado: sem página, sem utm e com o openedAt null', () => {
    expect(buildClaimBody(typed)).toEqual({
      code: 'CAMILA12',
      via: 'code',
      link: null,
      openedAt: null,
    });
  });

  it('visita: o link guardado, sem utm quando o link não tinha', () => {
    expect(buildVisitBody(pending)).toEqual({
      code: 'K7P3M9QX',
      link: { path: '/artista/nettobrito' },
      openedAt: '2026-10-05T14:02:11.000Z',
    });
  });
});

describe('envio', () => {
  it('o claim vai com a chave do convite e só com o token da conta dele', async () => {
    await expect(sendInviteClaim(fromLink)).resolves.toEqual({ status: 'claimed' });
    expect(post).toHaveBeenCalledWith('/invites/claim', buildClaimBody(fromLink), {
      headers: { 'Idempotency-Key': fromLink.idempotencyKey },
      sessionUid: 'uid-bia',
    });
  });

  it('a visita vai com a chave do link e o token de quem visita', async () => {
    post.mockResolvedValueOnce({ data: { status: 'received' } });
    await expect(sendInviteVisit(pending, 'uid-alan')).resolves.toEqual({ status: 'received' });
    expect(post).toHaveBeenCalledWith('/invites/visit', buildVisitBody(pending), {
      headers: { 'Idempotency-Key': 'visit-K7P3M9QX-2026-10-05T14:02:11.000Z' },
      sessionUid: 'uid-alan',
    });
  });

  it('nas fixtures, nenhuma chamada: o claim conta como aceito e a visita como recebida', async () => {
    source.mockReturnValue('fixtures');
    await expect(sendInviteClaim(fromLink)).resolves.toEqual({ status: 'claimed' });
    await expect(sendInviteVisit(pending, 'uid-alan')).resolves.toEqual({ status: 'received' });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('recusa definitiva do convite (isFinalInviteRejection)', () => {
  const error = (status: number | null, code: string | null, kind: ApiErrorKind = 'validation') =>
    new ApiError(kind, 'x', status, code);

  it.each([
    ['invalid_request', 400],
    ['idempotency_key_required', 400],
    ['not_fan', 403],
    ['account_suspended', 403],
    ['invite_not_found', 404],
    ['invite_not_allowed', 409],
    ['idempotency_key_reused', 422],
  ])('%s (%s) é definitiva: o app esquece o convite', (code, status) => {
    expect(isFinalInviteRejection(error(status, code))).toBe(true);
  });

  it.each([
    ['rede, sem status', error(null, null)],
    ['o getIdToken que falhou antes de sair (unknown sem status)', error(null, null, 'unknown')],
    ['401', error(401, 'unauthenticated')],
    ['429 do teto do dia', error(429, 'too_many_requests', 'dailyLimit')],
    ['429 do ritmo', error(429, 'rate_limited', 'rateLimited')],
    ['503 profile_not_ready', error(503, 'profile_not_ready')],
    ['500', error(500, 'internal')],
    ['404 sem código (servidor sem a rota)', error(404, 'not_found')],
    ['404 sem corpo', error(404, null)],
    ['erro que não é da API', new Error('x')],
  ])('%s é incerta: o convite fica para a próxima rodada', (_, failure) => {
    expect(isFinalInviteRejection(failure)).toBe(false);
  });

  it('só o 404 e o 409 do convite são recusas que o fã conserta digitando', () => {
    expect(typedInviteRejection(error(404, 'invite_not_found'))).toBe('notFound');
    expect(typedInviteRejection(error(409, 'invite_not_allowed'))).toBe('notAllowed');
    expect(typedInviteRejection(error(400, 'invalid_request'))).toBeNull();
    expect(typedInviteRejection(error(null, 'invite_not_found'))).toBeNull();
  });
});

describe('a sessão sabe se a conta tem senha (toSessionUser, seção 29)', () => {
  const user = (providerData: { providerId: string }[] | undefined) =>
    ({ uid: 'u', email: 'u@x.com', displayName: null, photoURL: null, providerData }) as User;

  it.each([
    ['e-mail e senha', [{ providerId: 'password' }], true],
    ['senha e Google', [{ providerId: 'google.com' }, { providerId: 'password' }], true],
    ['só Google', [{ providerId: 'google.com' }], false],
    ['sem provedor', [], false],
    ['sem a lista (usuário montado à mão)', undefined, false],
  ])('%s: hasPassword %s', (_, providerData, expected) => {
    expect(toSessionUser(user(providerData)).hasPassword).toBe(expected);
  });
});

describe('os jeitos de entrar da conta e o da sessão (seção 33)', () => {
  const user = (providerData: { providerId: string }[] | undefined) =>
    ({ uid: 'u', email: 'u@x.com', displayName: null, photoURL: null, providerData }) as User;

  it.each([
    ['e-mail e senha', [{ providerId: 'password' }], ['password']],
    ['Google', [{ providerId: 'google.com' }], ['google']],
    [
      'Apple e Google',
      [{ providerId: 'apple.com' }, { providerId: 'google.com' }],
      ['apple', 'google'],
    ],
    [
      'a senha e a Apple',
      [{ providerId: 'password' }, { providerId: 'apple.com' }],
      ['password', 'apple'],
    ],
    [
      'outro provedor fica de fora',
      [{ providerId: 'phone' }, { providerId: 'google.com' }],
      ['google'],
    ],
    ['sem a lista', undefined, []],
  ])('%s', (_, providerData, expected) => {
    expect(toSessionUser(user(providerData)).providers).toEqual(expected);
  });

  it.each([
    ['password', 'password'],
    ['google.com', 'google'],
    ['apple.com', 'apple'],
    ['custom', null],
    [null, null],
  ])('o provedor %s é o jeito %s', (providerId, method) => {
    expect(signInMethodOf(providerId)).toBe(method);
  });

  it('o provedor da sessão vem do token, e não da lista de provedores', async () => {
    const both = {
      ...user([{ providerId: 'apple.com' }, { providerId: 'google.com' }]),
      getIdTokenResult: jest.fn(async () => ({ signInProvider: 'google.com' })),
    } as unknown as User;
    await expect(sessionProvider(both)).resolves.toBe('google');
  });

  it('o listener avisa a sessão na hora, e o provedor dela depois, só para a conta de agora', async () => {
    let tokenRead: (value: { signInProvider: string }) => void = () => undefined;
    const camila = {
      ...user([{ providerId: 'apple.com' }]),
      uid: 'uid-camila',
      getIdTokenResult: jest.fn(
        () =>
          new Promise((resolve) => {
            tokenRead = resolve;
          }),
      ),
    } as unknown as User;
    const onUser = jest.fn();
    const onProvider = jest.fn();
    listenToAuth(onUser, onProvider);
    const callback = jest.mocked(onAuthStateChanged).mock.calls.at(-1)?.[1] as (
      user: User | null,
    ) => void;

    mockAuth.currentUser = { uid: 'uid-camila', email: 'camila@x.com' };
    callback(camila);
    // A sessão não espera o token.
    expect(onUser).toHaveBeenCalledWith(expect.objectContaining({ uid: 'uid-camila' }));
    expect(onProvider).not.toHaveBeenCalled();

    tokenRead({ signInProvider: 'apple.com' });
    await waitForCalls(onProvider);
    expect(onProvider).toHaveBeenCalledWith('uid-camila', 'apple');
  });

  it('o provedor que chega depois de outra conta entrar, ou o token que falha, não muda nada', async () => {
    const camila = {
      ...user([{ providerId: 'apple.com' }]),
      uid: 'uid-camila',
      getIdTokenResult: jest.fn(async () => ({ signInProvider: 'apple.com' })),
    } as unknown as User;
    const offline = {
      ...camila,
      getIdTokenResult: jest.fn(async () => {
        throw new Error('sem rede');
      }),
    } as unknown as User;
    const onProvider = jest.fn();
    listenToAuth(jest.fn(), onProvider);
    const callback = jest.mocked(onAuthStateChanged).mock.calls.at(-1)?.[1] as (
      user: User | null,
    ) => void;

    // A Bia entrou antes de o token da Camila chegar.
    mockAuth.currentUser = { uid: 'uid-bia', email: 'bia@x.com' };
    callback(camila);
    await flushPromises();
    // Sem rede com o token vencido.
    mockAuth.currentUser = { uid: 'uid-camila', email: 'camila@x.com' };
    callback(offline);
    await flushPromises();

    expect(camila.getIdTokenResult).toHaveBeenCalled();
    expect(offline.getIdTokenResult).toHaveBeenCalled();
    expect(onProvider).not.toHaveBeenCalled();
  });
});

/** Deixa as promessas pendentes andarem. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(() => resolve()));
}

/** Espera as promessas pendentes até a função ser chamada. */
async function waitForCalls(fn: jest.Mock): Promise<void> {
  for (let i = 0; i < 10 && fn.mock.calls.length === 0; i += 1) await flushPromises();
}

const firebaseError = (code: string) => new FirebaseError(code, code);

describe('trocar a senha e o e-mail (seção 29, frente D)', () => {
  it('a senha: espera a sessão, reautentica com a senha atual e só então troca', async () => {
    await changePassword('senha-atual', 'senha-nova');

    expect(mockAuth.authStateReady).toHaveBeenCalled();
    expect(EmailAuthProvider.credential).toHaveBeenCalledWith(
      'alan@teste.imagineup',
      'senha-atual',
    );
    expect(reauthenticateWithCredential).toHaveBeenCalledWith(mockUser, {
      email: 'alan@teste.imagineup',
      password: 'senha-atual',
    });
    expect(updatePassword).toHaveBeenCalledWith(mockUser, 'senha-nova');
    const reauth = jest.mocked(reauthenticateWithCredential).mock.invocationCallOrder[0] ?? 0;
    const update = jest.mocked(updatePassword).mock.invocationCallOrder[0] ?? 0;
    expect(reauth).toBeLessThan(update);
  });

  it('o e-mail: reautentica e manda o link pelo verifyBeforeUpdateEmail, sem actionCodeSettings', async () => {
    await requestEmailChange('senha-atual', 'alan.novo@teste.imagineup');

    expect(reauthenticateWithCredential).toHaveBeenCalled();
    expect(verifyBeforeUpdateEmail).toHaveBeenCalledWith(mockUser, 'alan.novo@teste.imagineup');
    expect(jest.mocked(verifyBeforeUpdateEmail).mock.calls[0]).toHaveLength(2);
  });

  it('senha atual errada: nada é trocado', async () => {
    jest
      .mocked(reauthenticateWithCredential)
      .mockRejectedValueOnce(firebaseError('auth/invalid-credential'));
    await expect(changePassword('errada', 'senha-nova')).rejects.toThrow();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('sem conta logada, ou sem e-mail para reautenticar, a sessão terminou', async () => {
    mockAuth.currentUser = null;
    await expect(changePassword('a', 'b')).rejects.toBeInstanceOf(SessionEndedError);
    mockAuth.currentUser = { uid: 'uid-alan', email: null };
    await expect(requestEmailChange('a', 'b@x.com')).rejects.toBeInstanceOf(SessionEndedError);
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['auth/invalid-credential', 'wrongPassword'],
    ['auth/wrong-password', 'wrongPassword'],
    ['auth/weak-password', 'weakPassword'],
    ['auth/password-does-not-meet-requirements', 'weakPassword'],
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-token-expired', 'sessionEnded'],
    ['auth/user-not-found', 'sessionEnded'],
    ['auth/user-disabled', 'sessionEnded'],
    ['auth/requires-recent-login', 'unknown'],
    ['auth/email-already-in-use', 'unknown'],
  ])('troca de senha: %s vira %s', (code, failure) => {
    expect(changePasswordFailure(firebaseError(code))).toBe(failure);
  });

  it.each([
    ['auth/invalid-credential', 'wrongPassword'],
    ['auth/wrong-password', 'wrongPassword'],
    ['auth/email-already-in-use', 'emailInUse'],
    ['auth/invalid-new-email', 'invalidEmail'],
    ['auth/invalid-email', 'invalidEmail'],
    ['auth/missing-new-email', 'invalidEmail'],
    ['auth/operation-not-allowed', 'notAllowed'],
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-token-expired', 'sessionEnded'],
    ['auth/user-not-found', 'sessionEnded'],
    ['auth/user-disabled', 'sessionEnded'],
    ['auth/weak-password', 'unknown'],
  ])('troca de e-mail: %s vira %s', (code, failure) => {
    expect(changeEmailFailure(firebaseError(code))).toBe(failure);
  });

  it('a sessão que acabou e o erro que não é do Firebase', () => {
    expect(changePasswordFailure(new SessionEndedError())).toBe('sessionEnded');
    expect(changeEmailFailure(new SessionEndedError())).toBe('sessionEnded');
    expect(changePasswordFailure(new Error('x'))).toBe('unknown');
    expect(changeEmailFailure(new Error('x'))).toBe('unknown');
  });
});

describe('por que a exclusão não passou (seção 33, decisão 12)', () => {
  it('a conta da sessão confirmada, ou a sessão que terminou', async () => {
    await expect(confirmedUser()).resolves.toBe(mockUser);
    expect(mockAuth.authStateReady).toHaveBeenCalled();
    mockAuth.currentUser = null;
    await expect(confirmedUser()).rejects.toBeInstanceOf(SessionEndedError);
  });

  it.each([
    ['a senha', 'needsPassword', 'password'],
    ['o Google', 'needsGoogle', 'google'],
    // A sessão da Apple sempre abre a folha dela: não há estágio a mostrar.
    ['a Apple', 'unknown', 'apple'],
  ] as const)('o login recente pedido pela sessão d%s vira %s', (_, failure, method) => {
    expect(deleteAccountFailure(new RecentLoginRequiredError(method))).toBe(failure);
  });

  it.each([
    ['auth/requires-recent-login', 'needsPassword'],
    ['auth/user-mismatch', 'wrongAccount'],
    ['auth/invalid-credential', 'wrongPassword'],
    ['auth/wrong-password', 'wrongPassword'],
    ['auth/network-request-failed', 'network'],
    ['auth/too-many-requests', 'tooManyRequests'],
    ['auth/user-token-expired', 'sessionEnded'],
    ['auth/user-not-found', 'sessionEnded'],
    ['auth/user-disabled', 'sessionEnded'],
    ['auth/internal-error', 'unknown'],
  ])('%s vira %s', (code, failure) => {
    expect(deleteAccountFailure(firebaseError(code))).toBe(failure);
  });

  it.each([
    ['o Google', 'google'],
    ['a Apple', 'apple'],
  ] as const)(
    'na reautenticação pel%s, o token recusado (auth/invalid-credential) não é senha errada',
    (_, method) => {
      expect(deleteAccountFailure(firebaseError('auth/invalid-credential'), method)).toBe(
        'unknown',
      );
      expect(deleteAccountFailure(firebaseError('auth/user-mismatch'), method)).toBe(
        'wrongAccount',
      );
      expect(deleteAccountFailure(firebaseError('auth/invalid-credential'), 'password')).toBe(
        'wrongPassword',
      );
    },
  );

  it('a sessão que acabou e o erro que não é do Firebase (a folha do provedor que falhou)', () => {
    expect(deleteAccountFailure(new SessionEndedError())).toBe('sessionEnded');
    expect(deleteAccountFailure(new Error('A folha falhou.'))).toBe('unknown');
  });
});
