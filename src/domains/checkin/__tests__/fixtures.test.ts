import { ApiError } from '@/services/api/errors';
import { fixtureWallet, resetFixtureSession, setFixtureNow } from '@/services/fixtures';

import {
  CHECKIN_FIXTURE_CYCLE,
  CHECKIN_FIXTURE_ENABLED,
  CHECKIN_FIXTURE_STREAK,
  checkinFixture,
} from '../fixtures';

// O "servidor" do check-in nas fixtures, com as regras do de verdade (um por
// dia de São Paulo, a sequência que recomeça com um dia pulado e o ciclo de
// pontos) e o exemplo do seed dos emuladores: a Camila com 4 dias seguidos
// até ontem. A chave de exemplo nasce desligada, como a do servidor.

// A carteira (o `earnFixturePoints`) lê a fonte na hora: cada teste escolhe.
let mockWalletSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => (domain === 'wallet' ? mockWalletSource : 'fixtures'),
  usesFixtures: () => true,
}));

/** Meio-dia de São Paulo de 10 de novembro de 2026 (15 h em UTC). */
const NOW = new Date('2026-11-10T15:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const BALANCE = 12_480;

/** O relógio das fixtures `days` dias depois do `NOW`, na mesma hora. */
const goToDay = (days: number): void => setFixtureNow(new Date(NOW.getTime() + days * DAY_MS));

beforeEach(() => {
  mockWalletSource = 'fixtures';
  setFixtureNow(NOW);
});

afterEach(() => {
  resetFixtureSession();
  setFixtureNow(null);
});

/**
 * O exemplo nasce desligado (`CHECKIN_FIXTURE_ENABLED`): os blocos que contam
 * com ele ligam antes de cada teste, e o `resetFixtureSession` do `afterEach`
 * volta ao padrão.
 */
const turnOn = (): void => checkinFixture.setEnabled(true);

describe('check-in de exemplo', () => {
  beforeEach(turnOn);

  it('com a chave de exemplo ligada, é o do seed dos emuladores: o ciclo padrão e 4 dias seguidos até ontem', () => {
    expect(CHECKIN_FIXTURE_CYCLE).toEqual([3, 3, 4, 4, 5, 6, 15]);
    expect(CHECKIN_FIXTURE_STREAK).toBe(4);
    expect(checkinFixture.state()).toEqual({
      enabled: true,
      checkedInToday: false,
      streak: 4,
      best: 4,
      cycle: [3, 3, 4, 4, 5, 6, 15],
      // O de hoje é o quinto dia: vale 5.
      cycleDay: 5,
      todayPoints: 5,
      // A próxima meia-noite de São Paulo (3 h em UTC).
      resetsAt: '2026-11-11T03:00:00.000Z',
    });
  });

  it('sem check-in na sessão, o exemplo acompanha o relógio: a sequência terminou sempre ontem', () => {
    goToDay(40);
    expect(checkinFixture.state()).toMatchObject({
      checkedInToday: false,
      streak: 4,
      cycleDay: 5,
      resetsAt: '2026-12-21T03:00:00.000Z',
    });
  });

  it('o ciclo devolvido é uma cópia: mexer nele não muda o exemplo', () => {
    checkinFixture.state().cycle.push(99);
    expect(checkinFixture.state().cycle).toEqual([3, 3, 4, 4, 5, 6, 15]);
  });
});

describe('servidor do check-in nas fixtures', () => {
  beforeEach(turnOn);

  it('o check-in de hoje rende o valor do dia do ciclo, na carteira e na resposta', () => {
    const result = checkinFixture.checkin('k1');
    expect(result).toEqual({
      pointsAwarded: 5,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      // O check-in não anda missão: as missões não buscam de novo.
      missionsChanged: false,
      checkin: {
        enabled: true,
        checkedInToday: true,
        streak: 5,
        best: 5,
        cycle: [3, 3, 4, 4, 5, 6, 15],
        cycleDay: 5,
        todayPoints: 5,
        resetsAt: '2026-11-11T03:00:00.000Z',
      },
    });
    expect(fixtureWallet.get()).toEqual({
      balance: BALANCE + 5,
      xp: BALANCE + 5,
      seasonPoints: 4_120 + 5,
    });
    expect(checkinFixture.state()).toEqual(result.checkin);
  });

  it('a mesma chave de novo devolve a resposta da primeira vez, sem pagar de novo', () => {
    const first = checkinFixture.checkin('k1');
    goToDay(1);
    expect(checkinFixture.checkin('k1')).toEqual(first);
    expect(fixtureWallet.get().balance).toBe(BALANCE + 5);
  });

  it('o segundo toque no mesmo dia, com outra chave, responde sem pontos e com o mesmo estado', () => {
    const first = checkinFixture.checkin('k1');
    const second = checkinFixture.checkin('k2');
    expect(second.pointsAwarded).toBe(0);
    expect(second.checkin).toEqual(first.checkin);
    expect(fixtureWallet.get().balance).toBe(BALANCE + 5);
  });
});

describe('a virada do dia nas fixtures', () => {
  beforeEach(turnOn);

  it('no dia seguinte, a sequência segue viva e o check-in volta a abrir, no dia seguinte do ciclo', () => {
    checkinFixture.checkin('k1');
    goToDay(1);
    expect(checkinFixture.state()).toMatchObject({
      checkedInToday: false,
      streak: 5,
      best: 5,
      cycleDay: 6,
      todayPoints: 6,
      resetsAt: '2026-11-12T03:00:00.000Z',
    });
    expect(checkinFixture.checkin('k2')).toMatchObject({
      pointsAwarded: 6,
      checkin: { checkedInToday: true, streak: 6, cycleDay: 6 },
    });
  });

  it('o dia é o de São Paulo: 23:59 ainda é hoje, e à meia-noite o check-in abre de novo', () => {
    checkinFixture.checkin('k1');
    // 23:59:59 de São Paulo do dia 10.
    setFixtureNow(new Date('2026-11-11T02:59:59.000Z'));
    expect(checkinFixture.state()).toMatchObject({
      checkedInToday: true,
      resetsAt: '2026-11-11T03:00:00.000Z',
    });
    expect(checkinFixture.checkin('k2').pointsAwarded).toBe(0);
    // Meia-noite de São Paulo do dia 11.
    setFixtureNow(new Date('2026-11-11T03:00:00.000Z'));
    expect(checkinFixture.state()).toMatchObject({
      checkedInToday: false,
      streak: 5,
      resetsAt: '2026-11-12T03:00:00.000Z',
    });
    expect(checkinFixture.checkin('k3').pointsAwarded).toBe(6);
  });

  it('depois do dia 7, o ciclo recomeça do 1 e a sequência continua contando', () => {
    // Dias 5, 6 e 7 do ciclo: 5, 6 e 15 pontos.
    expect(checkinFixture.checkin('d5').pointsAwarded).toBe(5);
    goToDay(1);
    expect(checkinFixture.checkin('d6').pointsAwarded).toBe(6);
    goToDay(2);
    expect(checkinFixture.checkin('d7')).toMatchObject({
      pointsAwarded: 15,
      checkin: { streak: 7, cycleDay: 7 },
    });
    goToDay(3);
    expect(checkinFixture.state()).toMatchObject({ streak: 7, cycleDay: 1, todayPoints: 3 });
    expect(checkinFixture.checkin('d8')).toMatchObject({
      pointsAwarded: 3,
      checkin: { streak: 8, best: 8, cycleDay: 1 },
    });
    expect(fixtureWallet.get().balance).toBe(BALANCE + 5 + 6 + 15 + 3);
  });

  it('um dia pulado zera a sequência: o estado mostra 0 e o check-in recomeça do dia 1', () => {
    checkinFixture.checkin('k1');
    // Pulou o dia 11: no dia 12, a sequência de 5 já não vale.
    goToDay(2);
    expect(checkinFixture.state()).toMatchObject({
      checkedInToday: false,
      streak: 0,
      // O recorde fica.
      best: 5,
      cycleDay: 1,
      todayPoints: 3,
    });
    expect(checkinFixture.checkin('k2')).toMatchObject({
      pointsAwarded: 3,
      checkin: { checkedInToday: true, streak: 1, best: 5, cycleDay: 1 },
    });
    // Os pontos de antes ficam.
    expect(fixtureWallet.get().balance).toBe(BALANCE + 5 + 3);
  });

  it('o relógio que volta não desfaz o check-in: o dia já feito segue feito', () => {
    goToDay(1);
    checkinFixture.checkin('k1');
    goToDay(0);
    expect(checkinFixture.state()).toMatchObject({ checkedInToday: true, streak: 5 });
    expect(checkinFixture.checkin('k2').pointsAwarded).toBe(0);
  });
});

describe('a chave e o fim da sessão nas fixtures', () => {
  it('com a carteira na API, o check-in de exemplo não rende ponto, mas a sequência anda', () => {
    turnOn();
    mockWalletSource = 'api';
    expect(checkinFixture.checkin('k1')).toMatchObject({
      pointsAwarded: 0,
      checkin: { checkedInToday: true, streak: 5 },
    });
    expect(fixtureWallet.get().balance).toBe(BALANCE);
  });

  it('a chave de exemplo nasce desligada, como a do servidor: sem ninguém ligar, o estado vem zerado e o toque é recusado com o 409', () => {
    expect(CHECKIN_FIXTURE_ENABLED).toBe(false);
    expect(checkinFixture.state()).toEqual({
      enabled: false,
      checkedInToday: false,
      streak: 0,
      best: 0,
      cycle: [],
      cycleDay: 0,
      todayPoints: 0,
      resetsAt: '2026-11-11T03:00:00.000Z',
    });
    let refusal: unknown;
    try {
      checkinFixture.checkin('k1');
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal).toMatchObject({ status: 409, code: 'checkin_disabled' });
    expect(fixtureWallet.get().balance).toBe(BALANCE);
    // Ligada (uma demonstração, um teste), a sequência de ontem está viva: nada andou com ela desligada.
    checkinFixture.setEnabled(true);
    expect(checkinFixture.state()).toMatchObject({ enabled: true, streak: 4, cycleDay: 5 });
    // Desligada de novo, some outra vez.
    checkinFixture.setEnabled(false);
    expect(checkinFixture.state()).toMatchObject({ enabled: false, streak: 0, cycle: [] });
  });

  it('o reset e o fim da sessão voltam ao início: a chave desligada, o exemplo do seed e nenhuma resposta guardada', () => {
    turnOn();
    const first = checkinFixture.checkin('k1');
    checkinFixture.reset();
    // A chave volta ao padrão, desligada.
    expect(checkinFixture.state()).toMatchObject({ enabled: false, streak: 0, cycle: [] });
    turnOn();
    expect(checkinFixture.state()).toMatchObject({ enabled: true, streak: 4, cycleDay: 5 });
    // A chave de idempotência de antes não vale mais: é outro fã.
    expect(checkinFixture.checkin('k1')).toEqual(first);
    expect(fixtureWallet.get().balance).toBe(BALANCE + 10);

    resetFixtureSession();
    expect(checkinFixture.state()).toMatchObject({ enabled: false, streak: 0, cycle: [] });
    turnOn();
    expect(checkinFixture.state()).toMatchObject({ checkedInToday: false, streak: 4 });
    expect(fixtureWallet.get().balance).toBe(BALANCE);
  });
});
