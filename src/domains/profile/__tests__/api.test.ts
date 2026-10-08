import { doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';

import { storageFileExists, uploadLocalFile } from '@/firebase';

import { api } from '@/services/api';
import { fixtureWallet } from '@/services/fixtures';

import {
  changeUsername,
  fetchMyAchievements,
  fetchMyInvite,
  fetchMyProfile,
  fetchMyProgress,
  fetchUsernameAvailability,
  fetchWallet,
  photoUploaded,
  registerInviteLink,
  removeMyPhoto,
  setMyPhoto,
  toFanProfile,
  updateMyProfile,
  uploadFanPhoto,
  watchMyProfile,
} from '../api';

// O build do Firebase que o Jest resolve é ESM; o domínio só usa estas peças.
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
  serverTimestamp: jest.fn(() => 'agora-do-servidor'),
  updateDoc: jest.fn(),
}));
jest.mock('@/firebase', () => ({
  getDb: () => ({}),
  storageFileExists: jest.fn(),
  uploadLocalFile: jest.fn(),
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const getDocMock = jest.mocked(getDoc);
const onSnapshotMock = jest.mocked(onSnapshot);
const get = jest.mocked(api.get);

/** Um `Timestamp` do Firestore, só com o que o app usa. */
const timestamp = (iso: string) => ({ toDate: () => new Date(iso) });

/** Um snapshot do Firestore; `fromCache` quando o SDK respondeu com o cache dele, sem o servidor. */
function snapshot(data: Record<string, unknown> | null, fromCache = false) {
  return { exists: () => data !== null, data: () => data ?? undefined, metadata: { fromCache } };
}

const CAMILA = {
  displayName: 'Camila Ribeiro',
  username: 'camilarib',
  city: null,
  photoURL: null,
  createdAt: timestamp('2026-09-29T11:17:40.910Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  fixtureWallet.reset();
});

describe('perfil do Firestore', () => {
  it('o Timestamp vira ISO, porque o cache vai para o disco em JSON', () => {
    expect(toFanProfile('uid-camila', CAMILA)).toEqual({
      uid: 'uid-camila',
      displayName: 'Camila Ribeiro',
      username: 'camilarib',
      city: null,
      photoURL: null,
      createdAt: '2026-09-29T11:17:40.910Z',
      usernameChangeableAt: null,
    });
  });

  it('o prazo do @ (bloco 9) vira ISO; sem ele, null', () => {
    expect(
      toFanProfile('uid-camila', {
        ...CAMILA,
        usernameChangeableAt: timestamp('2026-11-06T15:00:00.000Z'),
      }).usernameChangeableAt,
    ).toBe('2026-11-06T15:00:00.000Z');
    expect(toFanProfile('uid-camila', CAMILA).usernameChangeableAt).toBeNull();
  });

  it('a suspensão (bloco 11) vira ISO e só aparece quando existe', () => {
    expect(
      toFanProfile('uid-camila', {
        ...CAMILA,
        suspendedAt: timestamp('2026-10-07T12:00:00.000Z'),
      }).suspendedAt,
    ).toBe('2026-10-07T12:00:00.000Z');
    expect(toFanProfile('uid-camila', CAMILA)).not.toHaveProperty('suspendedAt');
    expect(toFanProfile('uid-camila', { ...CAMILA, suspendedAt: null })).not.toHaveProperty(
      'suspendedAt',
    );
  });

  it('campo fora do formato vira null em vez de quebrar a tela', () => {
    expect(
      toFanProfile('uid', { displayName: 42, username: '', city: ['x'], createdAt: 'não é data' }),
    ).toEqual({
      uid: 'uid',
      displayName: null,
      username: null,
      city: null,
      photoURL: null,
      createdAt: null,
      usernameChangeableAt: null,
    });
  });

  it('lê users/{uid} do próprio fã', async () => {
    getDocMock.mockResolvedValue(snapshot(CAMILA) as never);
    await expect(fetchMyProfile('uid-camila')).resolves.toMatchObject({
      uid: 'uid-camila',
      username: 'camilarib',
    });
    expect(doc).toHaveBeenCalledWith({}, 'users', 'uid-camila');
  });

  it('perfil ainda não criado pela função de cadastro volta null', async () => {
    getDocMock.mockResolvedValue(snapshot(null) as never);
    await expect(fetchMyProfile('uid-novo')).resolves.toBeNull();
  });

  it('a escuta avisa cada mudança, com null enquanto o perfil não existe', () => {
    const unsubscribe = jest.fn();
    onSnapshotMock.mockReturnValue(unsubscribe);
    const onChange = jest.fn();

    const stop = watchMyProfile('uid-camila', onChange);
    const [, next] = onSnapshotMock.mock.calls[0] as unknown as [
      unknown,
      (value: ReturnType<typeof snapshot>) => void,
    ];
    next(snapshot(null));
    next(snapshot({ ...CAMILA, photoURL: 'https://fotos/camila.jpg' }));

    expect(onChange).toHaveBeenNthCalledWith(1, null);
    expect(onChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ photoURL: 'https://fotos/camila.jpg' }),
    );
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('sem rede, o "não existe" do cache do SDK não apaga o perfil; o do servidor, sim', () => {
    onSnapshotMock.mockReturnValue(jest.fn());
    const onChange = jest.fn();

    watchMyProfile('uid-camila', onChange);
    const [, next] = onSnapshotMock.mock.calls[0] as unknown as [
      unknown,
      (value: ReturnType<typeof snapshot>) => void,
    ];
    // Abertura a frio sem rede: o cache do SDK (só em memória) está vazio.
    next(snapshot(null, true));
    expect(onChange).not.toHaveBeenCalled();

    next(snapshot(CAMILA, true));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ username: 'camilarib' }));
    next(snapshot(null, false));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('carteira', () => {
  it('sem a API, lê a carteira das fixtures, a mesma que o resgate desconta', async () => {
    await expect(fetchWallet()).resolves.toEqual({
      balance: 12_480,
      xp: 12_480,
      seasonPoints: 4_120,
    });
    fixtureWallet.spend(8_500);
    await expect(fetchWallet()).resolves.toMatchObject({ balance: 3_980, xp: 12_480 });
    expect(get).not.toHaveBeenCalled();
  });

  it('com a API, pede /me/wallet', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { balance: 1, xp: 2, seasonPoints: 3 } });
    await expect(fetchWallet()).resolves.toEqual({ balance: 1, xp: 2, seasonPoints: 3 });
    expect(get).toHaveBeenCalledWith('/me/wallet');
  });
});

describe('nível e conquistas', () => {
  it('sem a API, o nível sai do XP da carteira das fixtures', async () => {
    await expect(fetchMyProgress()).resolves.toMatchObject({
      xp: 12_480,
      level: { number: 7, name: 'Purainha' },
      weekEarned: 840,
    });
    await expect(fetchMyAchievements()).resolves.toMatchObject({
      unlockedCount: 14,
      totalCount: 32,
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('com a API, pede /me/progress e /me/achievements', async () => {
    mockDataSource = 'api';
    get
      .mockResolvedValueOnce({ data: { xp: 1 } })
      .mockResolvedValueOnce({ data: { totalCount: 2 } });
    await expect(fetchMyProgress()).resolves.toEqual({ xp: 1 });
    await expect(fetchMyAchievements()).resolves.toEqual({ totalCount: 2 });
    expect(get.mock.calls.map(([url]) => url)).toEqual(['/me/progress', '/me/achievements']);
  });
});

describe('convite do fã', () => {
  it('sem a API, o código de exemplo e as regras de pontos do convite', async () => {
    await expect(fetchMyInvite()).resolves.toEqual({
      code: 'CAMILA12',
      pointsPerVisit: 2,
      pointsPerSignup: 10,
    });
  });

  it('com a API, pede /me/invite, com o link e a base do servidor', async () => {
    mockDataSource = 'api';
    const invite = {
      code: 'K7P3M9QX',
      url: 'https://imagineup-painel.vercel.app/?ref=K7P3M9QX',
      linkBase: 'https://imagineup-painel.vercel.app',
      pointsPerVisit: 1,
      pointsPerSignup: 5,
    };
    get.mockResolvedValue({ data: invite });
    await expect(fetchMyInvite()).resolves.toEqual(invite);
    expect(get).toHaveBeenCalledWith('/me/invite');
  });

  it('o link compartilhado: com a API, o PUT com o id codificado e a chave', async () => {
    mockDataSource = 'api';
    const put = jest.mocked(api.put);
    put.mockResolvedValue({ data: { linkId: 'post:p-clipe', created: true } });
    await expect(registerInviteLink('post:p-clipe', 'chave-link-0001')).resolves.toEqual({
      linkId: 'post:p-clipe',
      created: true,
    });
    expect(put).toHaveBeenCalledWith('/me/invite/links/post%3Ap-clipe', undefined, {
      headers: { 'Idempotency-Key': 'chave-link-0001' },
    });
  });

  it('o link compartilhado nas fixtures: nada vai à API, e os links de exemplo não mudam', async () => {
    await expect(registerInviteLink('invite', 'chave-link-0002')).resolves.toEqual({
      linkId: 'invite',
      created: false,
    });
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('perfil editável (bloco 9)', () => {
  it('nome e cidade: updateDoc só com o que mudou e o updatedAt do servidor', async () => {
    jest.mocked(updateDoc).mockResolvedValue(undefined);
    await updateMyProfile('uid-camila', { city: null });
    expect(doc).toHaveBeenCalledWith({}, 'users', 'uid-camila');
    expect(updateDoc).toHaveBeenCalledWith('users/uid-camila', {
      city: null,
      updatedAt: 'agora-do-servidor',
    });
    expect(serverTimestamp).toHaveBeenCalled();
  });

  it('a disponibilidade do @ vai com o parâmetro', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { username: 'camilaribeiro', status: 'available' } });
    await expect(fetchUsernameAvailability('camilaribeiro')).resolves.toEqual({
      username: 'camilaribeiro',
      status: 'available',
    });
    expect(get).toHaveBeenCalledWith('/me/username/availability', {
      params: { username: 'camilaribeiro' },
    });
  });

  it('trocar o @, gravar e tirar a foto vão com a chave da tentativa', async () => {
    mockDataSource = 'api';
    const put = jest.mocked(api.put);
    const remove = jest.mocked(api.delete);
    put.mockResolvedValueOnce({
      data: { username: 'camilaribeiro', changedAt: 'x', changeableAt: 'y' },
    });
    await changeUsername('camilaribeiro', 'username-chave-0001');
    expect(put).toHaveBeenLastCalledWith(
      '/me/username',
      { username: 'camilaribeiro' },
      { headers: { 'Idempotency-Key': 'username-chave-0001' } },
    );
    put.mockResolvedValueOnce({ data: { photoURL: 'https://fotos/nova.jpg' } });
    await expect(
      setMyPhoto('fans/uid-camila/photo-abcdefgh.jpg', 'photo-abcdefgh'),
    ).resolves.toEqual({ photoURL: 'https://fotos/nova.jpg' });
    expect(put).toHaveBeenLastCalledWith(
      '/me/photo',
      { path: 'fans/uid-camila/photo-abcdefgh.jpg' },
      { headers: { 'Idempotency-Key': 'photo-abcdefgh' } },
    );
    remove.mockResolvedValueOnce({ data: { photoURL: null } });
    await expect(removeMyPhoto('photo-remove-0001')).resolves.toEqual({ photoURL: null });
    expect(remove).toHaveBeenCalledWith('/me/photo', {
      headers: { 'Idempotency-Key': 'photo-remove-0001' },
    });
  });

  it('o envio da foto vai para a pasta do fã, com o id da tentativa e o tipo JPEG', async () => {
    mockDataSource = 'api';
    jest.mocked(uploadLocalFile).mockResolvedValue(undefined);
    await expect(uploadFanPhoto('uid-camila', 'file:///pronta.jpg', 'abcdefgh')).resolves.toBe(
      'fans/uid-camila/photo-abcdefgh.jpg',
    );
    expect(uploadLocalFile).toHaveBeenCalledWith(
      'fans/uid-camila/photo-abcdefgh.jpg',
      'file:///pronta.jpg',
      'image/jpeg',
    );
    jest.mocked(storageFileExists).mockResolvedValue(true);
    await expect(photoUploaded('fans/uid-camila/photo-abcdefgh.jpg')).resolves.toBe(true);
  });

  it('nas fixtures, o @ e a foto não imitam: lançam sem chamar nada', async () => {
    await expect(fetchUsernameAvailability('camilaribeiro')).rejects.toThrow();
    await expect(changeUsername('camilaribeiro', 'chave-0001')).rejects.toThrow();
    await expect(setMyPhoto('fans/u/photo-abcdefgh.jpg', 'chave-0001')).rejects.toThrow();
    await expect(uploadFanPhoto('u', 'file:///x.jpg', 'abcdefgh')).rejects.toThrow();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(uploadLocalFile).not.toHaveBeenCalled();
  });
});
