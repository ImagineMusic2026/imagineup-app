import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  capOriginKeys,
  CLOSE_DAY_GRACE_MS,
  CLOSE_MAX_DAYS,
  daysToClose,
  lastClosedOf,
  ORIGIN_KEYS_MAX,
  ORIGIN_OTHER,
  seasonOfDay,
  STATS_FIRST_DAY,
  sumStatsDocs,
  type StatsTree,
} from './close';
import type { ClosedSeason } from './config';
import { shiftDay, type SeasonInfo } from './model';

// As partes puras do fechamento do dia (26.3): a soma dos shards, o corte das
// origens, os dias de cada rodada, com a folga depois da meia-noite, e a
// temporada do retrato.

/** Um instante pela hora de São Paulo (UTC-3, sem horário de verão). */
const sp = (local: string) => Date.parse(`${local}-03:00`);

describe('sumStatsDocs', () => {
  it('soma toda folha numérica em qualquer profundidade, com o ausente valendo 0', () => {
    const sum = sumStatsDocs([
      {
        day: '2026-10-05',
        totals: { earned: 10, earnedEvents: 2 },
        byArtist: { nenho: { joined: 1, bySource: { like: { points: 0, events: 3 } } } },
        actives: { day: 4, newInWeek: 1 },
        updatedAt: Timestamp.fromMillis(sp('2026-10-05T12:00:00')),
      },
      {
        day: '2026-10-05',
        totals: { earned: 5, spent: 7 },
        byArtist: { nenho: { joined: 2 }, nettobrito: { left: 1 } },
        actives: { day: 1, newInMonth: 1 },
      },
    ]);
    expect(sum).toEqual({
      totals: { earned: 15, earnedEvents: 2, spent: 7 },
      byArtist: {
        nenho: { joined: 3, bySource: { like: { points: 0, events: 3 } } },
        nettobrito: { left: 1 },
      },
      // O `actives.day` é contagem: só o `day` do topo fica de fora.
      actives: { day: 5, newInWeek: 1, newInMonth: 1 },
    });
  });

  it('ignora day, updatedAt e backfill do topo, datas, textos e números estranhos', () => {
    const sum = sumStatsDocs([
      {
        day: '2026-10-05',
        backfill: true,
        signups: { total: 3 },
        updatedAt: Timestamp.fromMillis(0),
        marca: 'texto',
        quando: Timestamp.fromMillis(1_000),
        lista: [1, 2, 3],
        totals: { earned: Number.NaN, spent: Infinity, refunded: 2 },
      },
      null,
      'não é documento',
      { signups: { total: 2, invited: 1 } },
    ]);
    expect(sum).toEqual({ signups: { total: 5, invited: 1 }, totals: { refunded: 2 } });
  });

  it('campo novo nos shards entra na soma sem mudar código', () => {
    expect(
      sumStatsDocs([
        { novidade: { porCentral: { nenho: 2 } } },
        { novidade: { porCentral: { nenho: 3 } } },
      ]),
    ).toEqual({ novidade: { porCentral: { nenho: 5 } } });
  });

  it('sem shard, a soma é vazia', () => {
    expect(sumStatsDocs([])).toEqual({});
  });
});

describe('capOriginKeys', () => {
  const campaigns = (count: number): StatsTree =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `campanha-${String(index).padStart(3, '0')}`,
        { signups: index + 1 },
      ]),
    );

  it.each([499, 500])('com %s chaves, nada muda', (count) => {
    const sum = { byOrigin: { utmCampaign: campaigns(count), utmSource: campaigns(count) } };
    expect(capOriginKeys(sum)).toEqual(sum);
  });

  it('com 501 chaves, ficam as 500 maiores e a menor vai para _other', () => {
    const sum = { byOrigin: { utmCampaign: campaigns(501), kind: { invite: { signups: 9 } } } };
    const capped = capOriginKeys(sum);
    const map = (capped.byOrigin as StatsTree).utmCampaign as StatsTree;
    expect(Object.keys(map)).toHaveLength(ORIGIN_KEYS_MAX + 1);
    expect(map['campanha-000']).toBeUndefined();
    expect(map['campanha-500']).toEqual({ signups: 501 });
    expect(map[ORIGIN_OTHER]).toEqual({ signups: 1 });
    // O tipo do link não é cortado.
    expect((capped.byOrigin as StatsTree).kind).toEqual({ invite: { signups: 9 } });
  });

  it('o resto soma com um _other que já existia, que não conta entre as 500', () => {
    const map = { ...campaigns(502), [ORIGIN_OTHER]: { signups: 10 } };
    const capped = capOriginKeys({ byOrigin: { utmSource: map } });
    const source = (capped.byOrigin as StatsTree).utmSource as StatsTree;
    expect(Object.keys(source)).toHaveLength(ORIGIN_KEYS_MAX + 1);
    expect(source[ORIGIN_OTHER]).toEqual({ signups: 10 + 1 + 2 });
  });

  it('no empate, a ordem das chaves decide, e o resultado é sempre o mesmo', () => {
    const map = Object.fromEntries(
      Array.from({ length: 3 }, (_, index) => [`c${index}`, { signups: 1 }]),
    );
    const capped = capOriginKeys({ byOrigin: { utmCampaign: map } }, 2);
    expect((capped.byOrigin as StatsTree).utmCampaign).toEqual({
      c0: { signups: 1 },
      c1: { signups: 1 },
      [ORIGIN_OTHER]: { signups: 1 },
    });
  });

  it('sem byOrigin, devolve a soma como veio', () => {
    expect(capOriginKeys({ totals: { earned: 1 } })).toEqual({ totals: { earned: 1 } });
  });
});

describe('daysToClose', () => {
  it('constantes do desenho', () => {
    expect(STATS_FIRST_DAY).toBe('2026-09-29');
    expect(CLOSE_MAX_DAYS).toBe(31);
    // Passa dos 540 s do rankingTick, o maior tempo de quem grava shard com o "agora" do começo.
    expect(CLOSE_DAY_GRACE_MS).toBe(10 * 60_000);
    expect(CLOSE_DAY_GRACE_MS).toBeGreaterThan(540_000);
  });

  it.each([
    ['00:05', ['2026-10-05']],
    ['00:09:59', ['2026-10-05']],
    ['00:10', ['2026-10-05', '2026-10-06']],
    ['00:20', ['2026-10-05', '2026-10-06']],
    ['23:59', ['2026-10-05', '2026-10-06']],
  ])('às %s de 07/10, fecha %j (ontem só depois da folga)', (time, days) => {
    expect(daysToClose('2026-10-04', sp(`2026-10-07T${time.padEnd(8, ':00')}`))).toEqual(days);
  });

  it('nada a fechar quando ontem já fechou, ou quando ontem ainda está na folga', () => {
    expect(daysToClose('2026-10-06', sp('2026-10-07T00:20:00'))).toEqual([]);
    expect(daysToClose('2026-10-05', sp('2026-10-07T00:05:00'))).toEqual([]);
  });

  it('no máximo 31 por rodada, em ordem; a rodada seguinte continua do seguinte', () => {
    const now = sp('2026-12-15T00:20:00');
    const first = daysToClose('2026-09-28', now);
    expect(first).toHaveLength(31);
    expect(first[0]).toBe('2026-09-29');
    expect(first[30]).toBe('2026-10-29');
    const second = daysToClose(first.at(-1)!, now);
    expect(second[0]).toBe('2026-10-30');
    expect(second.at(-1)).toBe('2026-11-29');
    const third = daysToClose(second.at(-1)!, now);
    expect(third.at(-1)).toBe('2026-12-14');
    expect(third).toHaveLength(15);
  });

  it('atravessa a virada do ano', () => {
    expect(daysToClose('2026-12-30', sp('2027-01-01T00:15:00'))).toEqual(['2026-12-31']);
    expect(daysToClose('2026-12-30', sp('2027-01-01T00:05:00'))).toEqual([]);
    expect(daysToClose('2026-12-31', sp('2027-01-02T00:10:00'))).toEqual(['2027-01-01']);
  });

  it('o teto da rodada vale com outro valor', () => {
    expect(daysToClose('2026-09-28', sp('2026-10-07T00:20:00'), 3)).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
    expect(shiftDay('2026-09-29', -1)).toBe('2026-09-28');
  });
});

describe('lastClosedOf', () => {
  it.each([
    ['2026-10-05', '2026-10-05'],
    ['2026-10-5', null],
    [null, null],
    [20261005, null],
  ])('%j vira %j', (value, expected) => {
    expect(lastClosedOf(value)).toBe(expected);
  });
});

describe('seasonOfDay', () => {
  const season = (id: string, startsAt: string, endsAt: string): SeasonInfo => ({
    id,
    name: id,
    startsAt: sp(startsAt),
    endsAt: sp(endsAt),
    leaderTitle: null,
    topTarget: 10,
    endedEarly: null,
  });
  const closed = (info: SeasonInfo, closedAt: string): ClosedSeason => ({
    ...info,
    closedAt: sp(closedAt),
  });
  const SJ = season('sao-joao', '2026-09-07T00:00:00', '2026-10-07T00:00:00');
  const PRIMAVERA = season('primavera', '2026-10-07T00:00:00', '2026-11-07T00:00:00');

  it('a temporada em andamento cobre o dia inteiro', () => {
    expect(seasonOfDay({ season: SJ, lastClosed: null }, '2026-10-05')?.id).toBe('sao-joao');
  });

  it('a que termina à meia-noite vale no último dia dela, com a virada feita ou não', () => {
    // A virada já rodou: a São João está em lastClosed e a próxima em season.
    expect(
      seasonOfDay(
        { season: PRIMAVERA, lastClosed: closed(SJ, '2026-10-07T00:05:00') },
        '2026-10-06',
      )?.id,
    ).toBe('sao-joao');
    // A virada ainda não rodou: a São João continua em season, encerrada.
    expect(seasonOfDay({ season: SJ, lastClosed: null }, '2026-10-06')?.id).toBe('sao-joao');
    // Sem próxima: a virada deixa season vazia.
    expect(
      seasonOfDay({ season: null, lastClosed: closed(SJ, '2026-10-07T00:05:00') }, '2026-10-06')
        ?.id,
    ).toBe('sao-joao');
  });

  it('a próxima vale do primeiro dia dela; dia sem temporada, null', () => {
    expect(
      seasonOfDay(
        { season: PRIMAVERA, lastClosed: closed(SJ, '2026-10-07T00:05:00') },
        '2026-10-07',
      )?.id,
    ).toBe('primavera');
    expect(
      seasonOfDay({ season: null, lastClosed: closed(SJ, '2026-10-07T00:05:00') }, '2026-10-07'),
    ).toBeNull();
    expect(seasonOfDay({ season: PRIMAVERA, lastClosed: null }, '2026-10-05')).toBeNull();
    expect(seasonOfDay({ season: null, lastClosed: null }, '2026-10-06')).toBeNull();
  });

  it('a encerrada antes da hora no meio do dia vale nele; a que começa depois no mesmo dia passa à frente', () => {
    const ended = season('sao-joao', '2026-09-07T00:00:00', '2026-10-06T15:00:00');
    expect(seasonOfDay({ season: ended, lastClosed: null }, '2026-10-06')?.id).toBe('sao-joao');
    expect(seasonOfDay({ season: ended, lastClosed: null }, '2026-10-07')).toBeNull();
    const next = season('primavera', '2026-10-06T18:00:00', '2026-11-06T18:00:00');
    expect(
      seasonOfDay({ season: next, lastClosed: closed(ended, '2026-10-06T15:10:00') }, '2026-10-06')
        ?.id,
    ).toBe('primavera');
  });
});
