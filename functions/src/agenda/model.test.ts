import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import { artistRecord, type ArtistRecord } from '../centrals/model';
import {
  agendaCutoff,
  BRAZIL_STATES,
  BRAZIL_TIME_ZONES,
  DEFAULT_TIME_ZONE_BY_STATE,
  eventInstant,
  eventRecord,
  eventView,
  isEventOpen,
  parseEventArtistIds,
  parseEventCity,
  parseEventTitle,
  parseEventVenue,
  parseStartsAtLocal,
  payerArtistId,
  pickFeatured,
  postEventView,
  zonedLocalToUtc,
  type EventRecord,
} from './model';
import { seedEventLocal } from './seed';

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

function event(id: string, startsAt: string, extra: Record<string, unknown> = {}): EventRecord {
  return eventRecord(id, {
    title: `Show ${id}`,
    artistIds: ['nettobrito', 'nenho'],
    city: 'Irará',
    state: 'BA',
    startsAt: Timestamp.fromMillis(Date.parse(startsAt)),
    featured: false,
    status: 'published',
    ...extra,
  });
}

function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof HttpsError) return (error.details as { reason?: string }).reason;
    throw error;
  }
  return undefined;
}

describe('data local no fuso (zonedLocalToUtc)', () => {
  it.each([
    ['America/Bahia', '2026-11-21T22:00', '2026-11-22T01:00:00.000Z'],
    ['America/Recife', '2026-11-21T22:00', '2026-11-22T01:00:00.000Z'],
    ['America/Manaus', '2026-11-21T22:00', '2026-11-22T02:00:00.000Z'],
    ['America/Noronha', '2026-11-21T22:00', '2026-11-22T00:00:00.000Z'],
    ['America/Rio_Branco', '2026-03-01T00:30', '2026-03-01T05:30:00.000Z'],
  ])('%s %s', (zone, local, expected) => {
    expect(iso(zonedLocalToUtc(local, zone))).toBe(expected);
  });

  it.each(['2026-02-30T20:00', '2026-13-01T20:00', '2026-11-21T24:00', '2026-11-21 22:00', ''])(
    'data que não existe ou fora do formato: %s',
    (local) => {
      expect(zonedLocalToUtc(local, 'America/Bahia')).toBeNull();
    },
  );
});

describe('o corte do que já passou (agendaCutoff e isEventOpen)', () => {
  it('é o começo do dia de hoje em São Paulo', () => {
    expect(iso(agendaCutoff(Date.parse('2026-10-05T15:00:00.000Z')))).toBe(
      '2026-10-05T03:00:00.000Z',
    );
    // 23:59 de 05/10 em São Paulo ainda é o dia 5.
    expect(iso(agendaCutoff(Date.parse('2026-10-06T02:59:00.000Z')))).toBe(
      '2026-10-05T03:00:00.000Z',
    );
    expect(iso(agendaCutoff(Date.parse('2026-10-06T03:00:00.000Z')))).toBe(
      '2026-10-06T03:00:00.000Z',
    );
  });

  it('o show das 23 h fica aberto às 23:59 e encerra à 0:00; o de 0:30 de hoje fica', () => {
    const tonight = event('noite', '2026-10-06T02:00:00.000Z'); // 23 h do dia 5
    expect(isEventOpen(tonight, Date.parse('2026-10-06T02:59:00.000Z'))).toBe(true);
    expect(isEventOpen(tonight, Date.parse('2026-10-06T03:00:00.000Z'))).toBe(false);
    const early = event('madrugada', '2026-10-06T03:30:00.000Z'); // 0:30 do dia 6
    expect(isEventOpen(early, Date.parse('2026-10-06T03:31:00.000Z'))).toBe(true);
  });

  it('fora do ar ou rascunho nunca está aberto', () => {
    const at = Date.parse('2026-10-05T15:00:00.000Z');
    expect(isEventOpen(event('a', '2026-11-01T00:00:00Z', { status: 'unpublished' }), at)).toBe(
      false,
    );
    expect(isEventOpen(event('b', '2026-11-01T00:00:00Z', { status: 'draft' }), at)).toBe(false);
    expect(isEventOpen(null, at)).toBe(false);
  });
});

describe('destaque (pickFeatured)', () => {
  const now = Date.parse('2026-10-06T04:00:00.000Z'); // 1:00 do dia 6 em São Paulo

  it('o marcado mais próximo depois do corte, empate pelo id', () => {
    const events = [
      event('z-depois', '2026-11-01T00:00:00Z', { featured: true }),
      event('b', '2026-10-20T00:00:00Z', { featured: true }),
      event('a', '2026-10-20T00:00:00Z', { featured: true }),
      event('sem-marca', '2026-10-07T00:00:00Z'),
    ];
    expect(pickFeatured(events, now)?.id).toBe('a');
  });

  it('o destaque de ontem às 22 h não volta à 1:00 de hoje', () => {
    const yesterday = event('ontem', '2026-10-06T01:00:00.000Z', { featured: true });
    const next = event('proximo', '2026-12-01T01:00:00.000Z', { featured: true });
    expect(pickFeatured([yesterday, next], now)?.id).toBe('proximo');
    expect(pickFeatured([yesterday], now)).toBeNull();
  });
});

describe('a central que paga a presença e a visão do show', () => {
  const artists = new Map<string, ArtistRecord | null>([
    ['nettobrito', artistRecord('nettobrito', { name: 'Netto Brito', status: 'draft' })],
    ['nenho', artistRecord('nenho', { name: 'Nenho', status: 'published' })],
  ]);

  it('a primeira no ar do show; nenhuma quando todas estão fora', () => {
    expect(payerArtistId(event('s', '2026-11-01T00:00:00Z'), artists)).toBe('nenho');
    expect(
      payerArtistId(event('s', '2026-11-01T00:00:00Z', { artistIds: ['nettobrito'] }), artists),
    ).toBeNull();
  });

  it('só as centrais no ar, invitePointsPerSignup nulo com 0, o local', () => {
    const view = eventView(
      event('s', '2026-11-22T01:00:00.000Z', { venue: 'Praça', photo: { url: 'https://f/x' } }),
      artists,
      0,
    );
    expect(view).toEqual({
      id: 's',
      title: 'Show s',
      artists: [{ id: 'nenho', name: 'Nenho' }],
      city: 'Irará',
      state: 'BA',
      startsAt: '2026-11-22T01:00:00.000Z',
      imageUrl: 'https://f/x',
      invitePointsPerSignup: null,
      venue: 'Praça',
    });
    expect(eventView(event('s', '2026-11-22T01:00:00Z'), artists, 10).invitePointsPerSignup).toBe(
      10,
    );
  });

  it('o show do post de show: "Cidade, UF" quando aberto; null fora do ar ou encerrado', () => {
    const now = Date.parse('2026-10-05T15:00:00.000Z');
    expect(postEventView(event('s', '2026-11-22T01:00:00.000Z'), now)).toEqual({
      id: 's',
      title: 'Show s',
      startsAt: '2026-11-22T01:00:00.000Z',
      city: 'Irará, BA',
    });
    expect(postEventView(event('s', '2026-10-01T01:00:00Z'), now)).toBeNull();
    expect(
      postEventView(event('s', '2026-11-22T01:00:00Z', { status: 'unpublished' }), now),
    ).toBeNull();
  });
});

describe('UFs e fusos', () => {
  it('o fuso sugerido cobre as 27 UFs, sempre um da lista', () => {
    expect(BRAZIL_STATES).toHaveLength(27);
    for (const state of BRAZIL_STATES) {
      expect(BRAZIL_TIME_ZONES).toContain(DEFAULT_TIME_ZONE_BY_STATE[state]);
    }
    expect(DEFAULT_TIME_ZONE_BY_STATE.BA).toBe('America/Bahia');
    expect(DEFAULT_TIME_ZONE_BY_STATE.SE).toBe('America/Maceio');
  });
});

describe('callables de shows: validação', () => {
  const now = Date.parse('2026-10-05T15:00:00.000Z');

  it('título, cidade e local numa linha visível, dentro do tamanho', () => {
    expect(parseEventTitle('  São João de Irará ')).toBe('São João de Irará');
    expect(reasonOf(() => parseEventTitle(''))).toBe('invalid-title');
    expect(reasonOf(() => parseEventTitle('a'.repeat(81)))).toBe('invalid-title');
    expect(reasonOf(() => parseEventTitle('A\nB'))).toBe('invalid-title');
    expect(reasonOf(() => parseEventCity('ㅤ'))).toBe('invalid-city');
    expect(parseEventVenue(null)).toBeNull();
    expect(parseEventVenue('  ')).toBeNull();
    expect(reasonOf(() => parseEventVenue(42))).toBe('invalid-venue');
  });

  it('de 1 a 6 centrais no formato do @, sem repetir', () => {
    expect(parseEventArtistIds(['nenho', 'nettobrito'])).toEqual(['nenho', 'nettobrito']);
    for (const value of [
      [],
      ['nenho', 'nenho'],
      ['Netto'],
      ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'],
      'nenho',
    ]) {
      expect(reasonOf(() => parseEventArtistIds(value))).toBe('invalid-artists');
    }
  });

  it('a data local precisa existir; mais de 24 h no passado é event-in-past; mais de 2 anos à frente, inválida', () => {
    expect(parseStartsAtLocal('2026-11-21T22:00')).toBe('2026-11-21T22:00');
    expect(reasonOf(() => parseStartsAtLocal('2026-02-30T22:00'))).toBe('invalid-starts-at');
    expect(iso(eventInstant('2026-11-21T22:00', 'America/Bahia', now))).toBe(
      '2026-11-22T01:00:00.000Z',
    );
    expect(iso(eventInstant('2026-10-04T13:00', 'America/Bahia', now))).toBe(
      '2026-10-04T16:00:00.000Z',
    );
    expect(reasonOf(() => eventInstant('2026-10-03T12:00', 'America/Bahia', now))).toBe(
      'event-in-past',
    );
    expect(reasonOf(() => eventInstant('2029-01-01T12:00', 'America/Bahia', now))).toBe(
      'invalid-starts-at',
    );
  });
});

describe('datas do seed (a regra das fixtures do app)', () => {
  it('o sábado seguinte às 22 h e o dia N do mês M meses depois, no fuso do lugar', () => {
    // Segunda-feira, 05/10/2026, meio-dia em São Paulo.
    const now = Date.parse('2026-10-05T15:00:00.000Z');
    expect(seedEventLocal({ kind: 'nextSaturday', hour: 22 }, now, 'America/Maceio')).toBe(
      '2026-10-10T22:00',
    );
    expect(
      seedEventLocal({ kind: 'monthDay', monthsAhead: 1, day: 21, hour: 22 }, now, 'America/Bahia'),
    ).toBe('2026-11-21T22:00');
    expect(
      seedEventLocal({ kind: 'monthDay', monthsAhead: 3, day: 2, hour: 22 }, now, 'America/Bahia'),
    ).toBe('2027-01-02T22:00');
  });

  it('num sábado, o sábado seguinte é o da semana que vem (o nextSaturday do date-fns)', () => {
    const saturday = Date.parse('2026-10-10T15:00:00.000Z');
    expect(seedEventLocal({ kind: 'nextSaturday', hour: 22 }, saturday, 'America/Maceio')).toBe(
      '2026-10-17T22:00',
    );
  });
});
