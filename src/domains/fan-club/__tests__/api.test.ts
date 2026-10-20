import { api } from '@/services/api';
import { resetFixtureSession, setFixtureNow } from '@/services/fixtures';

import {
  acceptFanClubRules,
  applyForFanClub,
  createFanClubPost,
  fetchArtistFanClubs,
  fetchFanClub,
  fetchFanClubArtists,
  fetchFanClubFeed,
  fetchFanClubPosts,
  fetchFollowedFanClubs,
  fetchMyFanClub,
  fetchMyFanClubNumbers,
  fetchMyFanClubPosts,
  followFanClub,
  openFanClubUpload,
  removeFanClubPost,
  reportFanClubPost,
  unfollowFanClub,
  withdrawApplication,
} from '../api';
import { OWN_CLUB_ID } from '../fixtures';
import type { FanClubApplicationBody } from '../types';

// As rotas do fã-clube (seção 34, 34.3) pelo api.ts: com a API, o método, a
// URL, a chave e o corpo de cada uma; nas fixtures, nada vai para a rede.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const request = jest.mocked(api.request);
const NOW = new Date(2026, 9, 19, 12, 0);
const KEY = { 'Idempotency-Key': 'chave-1234' };

const BODY: FanClubApplicationBody = {
  artistId: 'nettobrito',
  name: 'Netto de Coração',
  instagram: 'camila.teste.up',
  tiktok: null,
  whatsapp: '+5575900000010',
  pitch: 'Divulgo o Netto nos stories e no grupo dos fãs de Irará.',
  adult: true,
  rulesVersion: 'termos-2026-10',
};

beforeEach(() => {
  setFixtureNow(NOW);
  mockDataSource = 'fixtures';
  get.mockReset();
  request.mockReset();
});

afterEach(() => {
  resetFixtureSession();
  setFixtureNow(null);
});

describe('as leituras pela API', () => {
  beforeEach(() => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { marcador: true } });
  });

  it.each<[string, () => Promise<unknown>, string, object | null]>([
    ['o estado do fã', fetchMyFanClub, '/me/fan-club', null],
    ['os números', fetchMyFanClubNumbers, '/me/fan-club/numbers', null],
    ['as centrais da candidatura', fetchFanClubArtists, '/me/fan-club/artists', null],
    [
      '"Minhas publicações"',
      () => fetchMyFanClubPosts('c1'),
      '/me/fan-club/posts',
      { params: { cursor: 'c1' } },
    ],
    [
      'os fã-clubes do artista',
      () => fetchArtistFanClubs('nettobrito', null),
      '/artists/nettobrito/fan-clubs',
      { params: { cursor: null } },
    ],
    ['a página', () => fetchFanClub('fc-1'), '/fan-clubs/fc-1', null],
    [
      'as publicações da página',
      () => fetchFanClubPosts('fc-1', 'c2'),
      '/fan-clubs/fc-1/posts',
      { params: { cursor: 'c2' } },
    ],
    ['"Fã-clubes que sigo"', fetchFollowedFanClubs, '/me/fan-club-follows', null],
    [
      '"Dos seus fã-clubes"',
      () => fetchFanClubFeed(null),
      '/me/fan-club-feed',
      { params: { cursor: null } },
    ],
  ])('%s: GET %s', async (_name, call, url, config) => {
    // Sem o segundo argumento, a leitura vai sem parâmetros.
    await expect(call()).resolves.toEqual({ marcador: true });
    if (config) expect(get).toHaveBeenCalledWith(url, config);
    else expect(get).toHaveBeenCalledWith(url);
    expect(request).not.toHaveBeenCalled();
  });

  it('os ids vão escapados no caminho', async () => {
    await fetchFanClub('a/b');
    expect(get).toHaveBeenCalledWith('/fan-clubs/a%2Fb');
  });
});

describe('as gravações pela API, com a chave da tentativa', () => {
  beforeEach(() => {
    mockDataSource = 'api';
    request.mockResolvedValue({ data: { marcador: true } });
  });

  it.each<[string, () => Promise<unknown>, object]>([
    [
      'candidatar',
      () => applyForFanClub({ body: BODY, idempotencyKey: 'chave-1234' }),
      { method: 'POST', url: '/me/fan-club/application', headers: KEY, data: BODY },
    ],
    [
      'desistir',
      () => withdrawApplication({ idempotencyKey: 'chave-1234' }),
      { method: 'DELETE', url: '/me/fan-club/application', headers: KEY },
    ],
    [
      'o novo aceite',
      () => acceptFanClubRules({ rulesVersion: 'termos-2026-10', idempotencyKey: 'chave-1234' }),
      {
        method: 'PUT',
        url: '/me/fan-club/rules',
        headers: KEY,
        data: { rulesVersion: 'termos-2026-10' },
      },
    ],
    [
      'a vaga da foto, sem corpo',
      () => openFanClubUpload({ idempotencyKey: 'chave-1234' }),
      { method: 'POST', url: '/me/fan-club/upload', headers: KEY },
    ],
    [
      'publicar',
      () => createFanClubPost({ text: 'Bora!', photo: true, idempotencyKey: 'chave-1234' }),
      {
        method: 'POST',
        url: '/me/fan-club/posts',
        headers: KEY,
        data: { text: 'Bora!', photo: true },
      },
    ],
    [
      'retirar',
      () => removeFanClubPost({ postId: 'p-1', idempotencyKey: 'chave-1234' }),
      { method: 'DELETE', url: '/me/fan-club/posts/p-1', headers: KEY },
    ],
    [
      'denunciar com o motivo de imagem',
      () =>
        reportFanClubPost({ postId: 'p-1', reason: 'image_misuse', idempotencyKey: 'chave-1234' }),
      {
        method: 'POST',
        url: '/fan-club-posts/p-1/report',
        headers: KEY,
        data: { reason: 'image_misuse' },
      },
    ],
    [
      'seguir',
      () => followFanClub({ clubId: 'fc-1', idempotencyKey: 'chave-1234' }),
      { method: 'PUT', url: '/me/fan-club-follows/fc-1', headers: KEY },
    ],
    [
      'deixar de seguir',
      () => unfollowFanClub({ clubId: 'fc-1', idempotencyKey: 'chave-1234' }),
      { method: 'DELETE', url: '/me/fan-club-follows/fc-1', headers: KEY },
    ],
  ])('%s', async (_name, call, config) => {
    await expect(call()).resolves.toEqual({ marcador: true });
    expect(request).toHaveBeenCalledWith(config);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('o corpo da candidatura', () => {
  it('vai só com as 8 chaves que o servidor aceita, sem o que o formulário tiver a mais', async () => {
    mockDataSource = 'api';
    request.mockResolvedValue({ data: {} });
    const withExtra = { ...BODY, acceptedTerms: true } as FanClubApplicationBody;
    await applyForFanClub({ body: withExtra, idempotencyKey: 'chave-1234' });
    expect(request.mock.calls[0]?.[0]).toMatchObject({ data: BODY });
    const sent = (request.mock.calls[0]?.[0] as { data: object }).data;
    expect(Object.keys(sent).sort()).toEqual(Object.keys(BODY).sort());
  });
});

describe('nas fixtures, nada vai para a rede', () => {
  it('as leituras e as gravações respondem pelo "servidor" de exemplo', async () => {
    const mine = await fetchMyFanClub();
    expect(mine.club?.id).toBe(OWN_CLUB_ID);
    await expect(fetchMyFanClubNumbers()).resolves.toMatchObject({ followers: 2, joins: 2 });
    await expect(fetchFanClub(OWN_CLUB_ID)).resolves.toMatchObject({ isOwner: true });
    const posted = await createFanClubPost({
      text: 'Ensaio aberto no domingo!',
      photo: false,
      idempotencyKey: 'chave-1234',
    });
    expect(posted.status).toBe('pending');
    // A mesma chave devolve a publicação da primeira vez, sem criar outra.
    await expect(
      createFanClubPost({ text: 'Outro texto', photo: false, idempotencyKey: 'chave-1234' }),
    ).resolves.toEqual(posted);
    expect(get).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
