import { sourceOf } from '@/config/data-source';
import type { BoundInvite, PendingInvite } from '@/domains/invites';
import { api, ApiError, type ApiErrorKind } from '@/services/api';

import {
  buildClaimBody,
  buildVisitBody,
  isFinalInviteRejection,
  sendInviteClaim,
  sendInviteVisit,
  typedInviteRejection,
} from '../api';

// O build do Firebase que o Jest resolve é ESM; aqui nada chega a ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
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
    ['429', error(429, 'too_many_requests')],
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
