import { describe, expect, it } from 'vitest';

import {
  FAN_CLUB_COPY_BUDGET_MS,
  FAN_CLUB_COPY_CONCURRENCY,
  FAN_CLUB_COPY_MAX,
  fanClubMonthOf,
  isFeatureExpired,
  monthOf,
  monthTurn,
  type FanClubCopyCounts,
} from './model';

// A cópia da noite do fã-clube (docs/arquitetura-api.md, seção 34, decisões
// 35 e 37; 34.13): o retrato do mês e o destaque vencido, puros. A leitura
// dos números, a transação e a falha de um que não para os outros ficam no
// teste de emulador (functions/test/fan-club-follows.emulator.test.ts).

const counts = (values: Partial<FanClubCopyCounts>): FanClubCopyCounts => ({
  followers: 0,
  followers30d: 0,
  newAccounts: 0,
  automaticUsername: 0,
  byOwnerCode: 0,
  joins: 0,
  retained: 0,
  signups: 0,
  visits: 0,
  links: 0,
  ...values,
});

/** 00:20 de São Paulo (03:20 em UTC) de um dia: a hora do `closeStatsDays`. */
const at = (day: string) => Date.parse(`${day}T03:20:00.000Z`);

describe('os limites da cópia (decisão 37)', () => {
  it('até 500 por noite, 10 de cada vez, até os 270 s do handler de 300 s', () => {
    expect(FAN_CLUB_COPY_MAX).toBe(500);
    expect(FAN_CLUB_COPY_CONCURRENCY).toBe(10);
    expect(FAN_CLUB_COPY_BUDGET_MS).toBe(270_000);
  });
});

describe('o retrato do mês (decisão 37)', () => {
  it('o mês é o de São Paulo: 00:20 do dia 1 já é o mês novo, e 23:30 do dia 31 ainda é o velho', () => {
    expect(monthOf(at('2026-11-01'))).toBe('2026-11');
    expect(monthOf(Date.parse('2026-11-01T02:30:00.000Z'))).toBe('2026-10');
  });

  it('a primeira cópia do fã-clube só grava o monthStart', () => {
    expect(monthTurn(null, counts({ followers: 4, joins: 2, links: 1 }), at('2026-10-20'))).toEqual(
      {
        monthStart: { month: '2026-10', followers: 4, joins: 2, signups: 0, visits: 0, links: 1 },
        lastMonth: null,
      },
    );
  });

  it('a primeira cópia do mês fecha o anterior (o de agora menos o monthStart); a segunda não', () => {
    const october = { month: '2026-10', followers: 4, joins: 2, signups: 1, visits: 5, links: 1 };
    const now = counts({ followers: 3, joins: 6, signups: 4, visits: 9, links: 2, retained: 5 });
    const turn = monthTurn(october, now, at('2026-11-01'));
    expect(turn).toEqual({
      monthStart: { month: '2026-11', followers: 3, joins: 6, signups: 4, visits: 9, links: 2 },
      // Os seguidores são o saldo do mês: quem deixou de seguir desconta.
      lastMonth: { month: '2026-10', followers: -1, joins: 4, signups: 3, visits: 4, links: 1 },
    });
    expect(monthTurn(turn!.monthStart, now, at('2026-11-02'))).toBeNull();
  });

  it('o mês que a cópia pulou (sem vaga nas 500): o lastMonth leva o mês do monthStart', () => {
    const august = { month: '2026-08', followers: 1, joins: 0, signups: 0, visits: 0, links: 0 };
    expect(monthTurn(august, counts({ followers: 5 }), at('2026-10-01'))?.lastMonth).toEqual({
      month: '2026-08',
      followers: 4,
      joins: 0,
      signups: 0,
      visits: 0,
      links: 0,
    });
  });

  it('o retrato gravado: os números estranhos contam 0; sem mês no formato, nenhum', () => {
    expect(
      fanClubMonthOf({ month: '2026-10', followers: 3.7, joins: 'x', signups: null, visits: 2 }),
    ).toEqual({ month: '2026-10', followers: 3, joins: 0, signups: 0, visits: 2, links: 0 });
    for (const value of [null, undefined, {}, { month: '2026-10-01' }, { month: 202610 }, []]) {
      expect(fanClubMonthOf(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('o destaque vencido (decisão 35)', () => {
  it('vence depois do dia do prazo, pelo dia de São Paulo', () => {
    const now = at('2026-10-20');
    expect(isFeatureExpired({ featured: true, featuredUntil: '2026-10-19' }, now)).toBe(true);
    expect(isFeatureExpired({ featured: true, featuredUntil: '2026-10-20' }, now)).toBe(false);
    expect(isFeatureExpired({ featured: true, featuredUntil: '2026-11-19' }, now)).toBe(false);
    // Marcado sem prazo não vale na leitura: a cópia desliga.
    expect(isFeatureExpired({ featured: true, featuredUntil: null }, now)).toBe(true);
    expect(isFeatureExpired({ featured: false, featuredUntil: '2026-10-01' }, now)).toBe(false);
  });
});
