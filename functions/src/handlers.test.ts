import type { Firestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleUserCreated, NAME_WAIT_MS, type FindUser } from './handlers';
import { createProfile, deleteUserData, isStaffAccount, profileExists } from './store';

// O Firestore fica de fora: o que cada gravação faz é testado nos emuladores
// (test/profile.emulator.test.ts). Aqui vale a ordem das leituras e das esperas.
vi.mock('./store', () => ({
  createProfile: vi.fn(),
  deleteUserData: vi.fn(),
  isStaffAccount: vi.fn(),
  profileExists: vi.fn(),
}));

const db = {} as Firestore;
const uid = 'fa-nova';

type Account = { displayName?: string | null } | null;

/** O Auth responde cada leitura com a próxima conta da lista; a última se repete. */
function authReads(...accounts: Account[]) {
  let read = 0;
  return vi.fn<FindUser>(async () => accounts[Math.min(read++, accounts.length - 1)] ?? null);
}

/** Espera que não espera: guarda quanto o handler pediu. */
const fakeSleep = () => vi.fn(async (_ms: number) => undefined);

const total = (sleep: ReturnType<typeof fakeSleep>) =>
  sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isStaffAccount).mockResolvedValue(false);
  vi.mocked(profileExists).mockResolvedValue(false);
  vi.mocked(createProfile).mockResolvedValue({ status: 'created', username: 'criado' });
  vi.mocked(deleteUserData).mockResolvedValue(undefined);
});

describe('handleUserCreated: espera do nome', () => {
  it('nome que chega na segunda leitura: o perfil nasce com ele, depois de uma espera só', async () => {
    const findUser = authReads({ displayName: null }, { displayName: 'Larissa Moura' });
    const sleep = fakeSleep();

    const result = await handleUserCreated(db, findUser, { uid }, sleep);

    expect(result).toEqual({ status: 'created', username: 'criado' });
    expect(sleep.mock.calls).toEqual([[NAME_WAIT_MS[0]]]);
    expect(createProfile).toHaveBeenCalledWith(db, { uid, displayName: 'Larissa Moura' });
    // Duas leituras até o nome e a conferência depois de gravar.
    expect(findUser).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['sem nome', null],
    ['com nome vazio', ''],
    ['com nome só de espaços', '   '],
    ['com nome que as regras recusam', '͏'],
  ])(
    'conta %s que continua assim: espera tudo, pouco, e o perfil nasce sem nome',
    async (_, name) => {
      const findUser = authReads({ displayName: name });
      const sleep = fakeSleep();

      const result = await handleUserCreated(db, findUser, { uid, displayName: null }, sleep);

      expect(result).toEqual({ status: 'created', username: 'criado' });
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([...NAME_WAIT_MS]);
      expect(createProfile).toHaveBeenCalledWith(db, { uid, displayName: name });
      expect(findUser).toHaveBeenCalledTimes(1 + NAME_WAIT_MS.length + 1);
    },
  );

  it('as esperas crescem e somam pouco: conta sem nome de verdade (Apple sem nome) não fica presa', async () => {
    const sleep = fakeSleep();
    await handleUserCreated(db, authReads({ displayName: null }), { uid }, sleep);

    const waits = sleep.mock.calls.map(([ms]) => ms);
    // Sem isto, uma lista de esperas vazia (ou de uma espera só) passaria aqui.
    expect(waits).toEqual([...NAME_WAIT_MS]);
    expect(waits.length).toBeGreaterThan(1);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(new Set(waits).size).toBe(waits.length);
    // Bem abaixo dos 20 s que o app espera o perfil (PROFILE_WAIT_MS).
    expect(total(sleep)).toBeLessThanOrEqual(4_000);
  });

  it('com nome na primeira leitura (o do evento também vale), não espera', async () => {
    const sleep = fakeSleep();
    await handleUserCreated(db, authReads({ displayName: 'Camila Ribeiro' }), { uid }, sleep);
    await handleUserCreated(
      db,
      authReads({ displayName: null }),
      { uid, displayName: 'Bruna Andrade' },
      sleep,
    );

    expect(sleep).not.toHaveBeenCalled();
    expect(createProfile).toHaveBeenNthCalledWith(1, db, { uid, displayName: 'Camila Ribeiro' });
    expect(createProfile).toHaveBeenNthCalledWith(2, db, { uid, displayName: 'Bruna Andrade' });
  });

  it('a conta e o evento com nomes diferentes: vale o nome de agora da conta', async () => {
    const sleep = fakeSleep();
    await handleUserCreated(
      db,
      authReads({ displayName: 'Larissa Moura' }),
      { uid, displayName: 'Nome do Evento' },
      sleep,
    );

    expect(sleep).not.toHaveBeenCalled();
    expect(createProfile).toHaveBeenCalledWith(db, { uid, displayName: 'Larissa Moura' });
  });

  it('conta apagada durante a espera: para de esperar, não cria nada e limpa o que houver', async () => {
    const findUser = authReads({ displayName: null }, { displayName: null }, null);
    const sleep = fakeSleep();

    const result = await handleUserCreated(db, findUser, { uid }, sleep);

    expect(result).toEqual({ status: 'undone' });
    expect(sleep.mock.calls).toEqual([[NAME_WAIT_MS[0]], [NAME_WAIT_MS[1]]]);
    expect(createProfile).not.toHaveBeenCalled();
    expect(deleteUserData).toHaveBeenCalledWith(db, uid);
  });

  it('conta apagada depois de gravar o perfil que esperou o nome: desfaz', async () => {
    const findUser = authReads({ displayName: null }, { displayName: 'Larissa Moura' }, null);
    const result = await handleUserCreated(db, findUser, { uid }, fakeSleep());

    expect(result).toEqual({ status: 'undone' });
    expect(createProfile).toHaveBeenCalledWith(db, { uid, displayName: 'Larissa Moura' });
    expect(deleteUserData).toHaveBeenCalledWith(db, uid);
  });

  it('conta da equipe do painel: sai antes de ler a conta, sem esperar nem criar', async () => {
    vi.mocked(isStaffAccount).mockResolvedValue(true);
    const findUser = authReads({ displayName: null });
    const sleep = fakeSleep();

    expect(await handleUserCreated(db, findUser, { uid }, sleep)).toEqual({ status: 'staff' });
    expect(findUser).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(createProfile).not.toHaveBeenCalled();
    expect(deleteUserData).not.toHaveBeenCalled();
  });

  it('entrega repetida com o perfil já criado: não espera o nome e não mexe no perfil', async () => {
    vi.mocked(profileExists).mockResolvedValue(true);
    vi.mocked(createProfile).mockResolvedValue({ status: 'exists' });
    const sleep = fakeSleep();

    const result = await handleUserCreated(db, authReads({ displayName: null }), { uid }, sleep);

    expect(result).toEqual({ status: 'exists' });
    expect(sleep).not.toHaveBeenCalled();
    expect(deleteUserData).not.toHaveBeenCalled();
  });

  it('erro ao ler a conta no meio da espera sobe, para o gatilho tentar de novo', async () => {
    const findUser = vi
      .fn<FindUser>()
      .mockResolvedValueOnce({ displayName: null })
      .mockRejectedValueOnce(new Error('Auth fora do ar'));

    await expect(handleUserCreated(db, findUser, { uid }, fakeSleep())).rejects.toThrow(
      'Auth fora do ar',
    );
    expect(createProfile).not.toHaveBeenCalled();
    expect(deleteUserData).not.toHaveBeenCalled();
  });
});
