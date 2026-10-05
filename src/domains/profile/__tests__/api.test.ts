import { doc, getDoc, onSnapshot } from 'firebase/firestore';

import { api } from '@/services/api';
import { fixtureWallet } from '@/services/fixtures';

import {
  fetchMyAchievements,
  fetchMyInvite,
  fetchMyProfile,
  fetchMyProgress,
  fetchWallet,
  toFanProfile,
  watchMyProfile,
} from '../api';

// O build do Firebase que o Jest resolve é ESM; o domínio só usa estas peças.
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
}));
jest.mock('@/firebase', () => ({ getDb: () => ({}) }));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

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
    });
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

  it('com a API, pede /me/invite', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { code: 'ABC', pointsPerVisit: 1, pointsPerSignup: 5 } });
    await expect(fetchMyInvite()).resolves.toMatchObject({ code: 'ABC' });
    expect(get).toHaveBeenCalledWith('/me/invite');
  });
});
