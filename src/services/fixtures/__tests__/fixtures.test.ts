import { API_ERROR_CODES, ApiError } from '@/services/api/errors';

import {
  fixtureBlocks,
  fixtureDelay,
  fixtureMembership,
  fixtureNow,
  fixtureWallet,
  onFixtureCentralLeft,
  onFixtureFanBlocked,
  resetFixtureSession,
  setFixtureNow,
} from '..';

describe('ajudantes das fixtures', () => {
  afterEach(() => {
    fixtureWallet.reset();
    setFixtureNow(null);
    jest.useRealTimers();
  });

  it('no Jest a espera resolve sem depender de timer', async () => {
    jest.useFakeTimers();
    await expect(fixtureDelay()).resolves.toBeUndefined();
  });

  it('com espera explícita, só resolve depois do tempo', async () => {
    jest.useFakeTimers();
    const done = jest.fn();
    const waiting = fixtureDelay(400).then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    jest.advanceTimersByTime(400);
    await waiting;
    expect(done).toHaveBeenCalled();
  });

  it('o relógio preso devolve sempre a mesma data, e cópias dela', () => {
    const pinned = new Date(2026, 8, 29, 20, 0);
    setFixtureNow(pinned);
    const now = fixtureNow();
    expect(now).toEqual(pinned);
    now.setFullYear(2000);
    expect(fixtureNow()).toEqual(pinned);
  });

  it('sem relógio preso, usa a hora do aparelho', () => {
    const before = Date.now();
    const now = fixtureNow().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('carteira das fixtures', () => {
  afterEach(() => fixtureWallet.reset());

  it('começa com os números do protótipo', () => {
    expect(fixtureWallet.get()).toEqual({ balance: 12_480, xp: 12_480, seasonPoints: 4_120 });
  });

  it('ganho soma no saldo, no nível e na temporada', () => {
    expect(fixtureWallet.earn(20)).toEqual({ balance: 12_500, xp: 12_500, seasonPoints: 4_140 });
  });

  it('guarda quanto o fã ganhou desde a abertura, sem descontar o resgate', () => {
    expect(fixtureWallet.earned()).toBe(0);
    fixtureWallet.earn(15);
    fixtureWallet.earn(20);
    fixtureWallet.spend(1_000);
    expect(fixtureWallet.earned()).toBe(35);
    fixtureWallet.reset();
    expect(fixtureWallet.earned()).toBe(0);
  });

  it('resgate desconta só do saldo: o nível não cai', () => {
    expect(fixtureWallet.spend(8_500)).toEqual({ balance: 3_980, xp: 12_480, seasonPoints: 4_120 });
  });

  it('recusa resgate sem saldo com o erro que a API mandaria, sem mexer na carteira', () => {
    let error: unknown;
    try {
      fixtureWallet.spend(20_000);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'validation',
      status: 409,
      code: API_ERROR_CODES.insufficientPoints,
    });
    expect((error as ApiError).isRetryable).toBe(false);
    expect(fixtureWallet.get().balance).toBe(12_480);
  });

  it('não aceita pontos negativos nem quebrados', () => {
    expect(() => fixtureWallet.earn(-5)).toThrow(RangeError);
    expect(() => fixtureWallet.spend(1.5)).toThrow(RangeError);
  });

  it('quem lê recebe uma cópia, não o estado interno', () => {
    const snapshot = fixtureWallet.get();
    snapshot.balance = 0;
    expect(fixtureWallet.get().balance).toBe(12_480);
  });
});

describe('membro das centrais nas fixtures (bloco 8)', () => {
  afterEach(() => fixtureMembership.reset());

  it('começa membro das três centrais do protótipo; sair e entrar mudam; o fim da sessão volta ao início', () => {
    expect(['nettobrito', 'nenho', 'juninhomoraes'].map(fixtureMembership.isMember)).toEqual([
      true,
      true,
      true,
    ]);
    expect(fixtureMembership.isMember('rocksalles')).toBe(false);
    fixtureMembership.leave('nenho');
    fixtureMembership.join('rocksalles');
    expect(fixtureMembership.isMember('nenho')).toBe(false);
    expect(fixtureMembership.isMember('rocksalles')).toBe(true);
    resetFixtureSession();
    expect(fixtureMembership.isMember('nenho')).toBe(true);
    expect(fixtureMembership.isMember('rocksalles')).toBe(false);
  });
});

// O fã-clube (seção 34) ouve a saída da central e o bloqueio, para apagar o
// seguir como o servidor: as fixtures compartilhadas avisam sem importar o
// domínio.
describe('os ouvintes da saída da central e do bloqueio', () => {
  afterEach(() => resetFixtureSession());

  it('a saída avisa a central; entrar e o reset não avisam', () => {
    const left = jest.fn();
    onFixtureCentralLeft(left);
    fixtureMembership.join('rocksalles');
    fixtureMembership.leave('nenho');
    resetFixtureSession();
    expect(left.mock.calls).toEqual([['nenho']]);
  });

  it('o bloqueio avisa sempre, também de quem já estava na lista; desbloquear não avisa', () => {
    const blocked = jest.fn();
    onFixtureFanBlocked(blocked);
    fixtureBlocks.add('fa-rank-01');
    fixtureBlocks.add('fa-rank-01');
    fixtureBlocks.remove('fa-rank-01');
    expect(blocked.mock.calls).toEqual([['fa-rank-01'], ['fa-rank-01']]);
  });
});
