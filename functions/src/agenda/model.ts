import { Timestamp } from 'firebase-admin/firestore';

import type { AgendaEvent, PostEvent } from '../api/contract';
import { isHandleFormat } from '../artists/model';
import { isPublished, type ArtistRecord } from '../centrals/model';
import { isContentId } from '../page-cursor';
import { nextDayStart } from '../points/model';
import { isVisibleLine } from '../visible-line';
import { eventPanelError } from './errors';

// Agenda do bloco 6, puro: nada aqui lê ou grava o Firestore. O service.ts
// lê, chama daqui e grava. Contrato em docs/arquitetura-api.md, seção 21.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Agenda: 20 por página sem `limit`. */
export const AGENDA_LIMIT_DEFAULT = 20;

/**
 * Presenças lidas no `GET /me/rsvps` (21.2): o teto alto, para a presença
 * antiga num show distante não sumir da resposta.
 */
export const RSVP_READ_MAX = 1_000;

/** Centrais de um show: de 1 a 6, a primeira é a principal. */
export const EVENT_ARTISTS_MAX = 6;
export const EVENT_TITLE_MAX = 80;
export const EVENT_CITY_MAX = 60;
export const EVENT_VENUE_MAX = 80;

/** Um show pode ser marcado até 2 anos à frente. */
export const EVENT_FUTURE_MAX_MS = 2 * 366 * DAY_MS;

/** Um show pode ser criado ou ter a data mudada até 24 h depois do começo. */
export const EVENT_PAST_GRACE_MS = DAY_MS;

/** As 27 UFs, as mesmas do BRAZIL_STATE_NAMES do app. */
export const BRAZIL_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
export type BrazilState = (typeof BRAZIL_STATES)[number];

/** Os fusos IANA do Brasil que o painel oferece. */
export const BRAZIL_TIME_ZONES = [
  'America/Noronha',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Araguaina',
  'America/Maceio',
  'America/Bahia',
  'America/Sao_Paulo',
  'America/Campo_Grande',
  'America/Cuiaba',
  'America/Santarem',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Manaus',
  'America/Eirunepe',
  'America/Rio_Branco',
] as const;
export type BrazilTimeZone = (typeof BRAZIL_TIME_ZONES)[number];

/** O fuso sugerido pela UF, que o painel copia para preencher o campo. */
export const DEFAULT_TIME_ZONE_BY_STATE: Readonly<Record<BrazilState, BrazilTimeZone>> = {
  AC: 'America/Rio_Branco',
  AL: 'America/Maceio',
  AP: 'America/Belem',
  AM: 'America/Manaus',
  BA: 'America/Bahia',
  CE: 'America/Fortaleza',
  DF: 'America/Sao_Paulo',
  ES: 'America/Sao_Paulo',
  GO: 'America/Sao_Paulo',
  MA: 'America/Fortaleza',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  MG: 'America/Sao_Paulo',
  PA: 'America/Belem',
  PB: 'America/Fortaleza',
  PR: 'America/Sao_Paulo',
  PE: 'America/Recife',
  PI: 'America/Fortaleza',
  RJ: 'America/Sao_Paulo',
  RN: 'America/Fortaleza',
  RS: 'America/Sao_Paulo',
  RO: 'America/Porto_Velho',
  RR: 'America/Boa_Vista',
  SC: 'America/Sao_Paulo',
  SP: 'America/Sao_Paulo',
  SE: 'America/Maceio',
  TO: 'America/Araguaina',
};

export type AgendaErrorReason = 'event_not_found';

/**
 * Recusa do núcleo da agenda: o show que não existe, fora do ar
 * (`details.reason: 'missing'`) ou encerrado (`'ended'`). A API traduz para o
 * 404 `event_not_found`.
 */
export class AgendaError extends Error {
  readonly reason: AgendaErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: AgendaErrorReason, details?: Record<string, unknown>) {
    super('Show não encontrado.');
    this.name = 'AgendaError';
    this.reason = reason;
    this.details = details;
  }
}

// --- Datas e fusos ---------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Os campos de data e hora de um instante num fuso, como números. */
function zonedParts(ms: number, timeZone: string): number[] {
  const parts = formatterOf(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')];
}

/** Quanto o fuso está adiantado em relação ao UTC naquele instante, em ms. */
function zoneOffset(ms: number, timeZone: string): number {
  const [year, month, day, hour, minute, second] = zonedParts(ms, timeZone);
  return Date.UTC(year!, month! - 1, day!, hour!, minute!, second!) - Math.floor(ms / 1000) * 1000;
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * O instante de uma data e hora locais (`2026-11-21T22:00`) num fuso IANA,
 * só com o `Intl`: o deslocamento do fuso naquele instante, calculado duas
 * vezes para cobrir uma mudança de horário. null quando a data não existe
 * (31 de fevereiro, 25 h) ou cai num buraco de horário de verão.
 */
export function zonedLocalToUtc(local: string, timeZone: string): number | null {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (hour > 23 || minute > 59) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(guess);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  try {
    const first = guess - zoneOffset(guess, timeZone);
    const result = guess - zoneOffset(first, timeZone);
    const [y, mo, d, h, mi] = zonedParts(result, timeZone);
    if (y !== year || mo !== month || d !== day || h !== hour || mi !== minute) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * O corte do que "já passou" (21.1, decisão 14): o começo do dia de hoje em
 * São Paulo. Vale na lista da agenda, no destaque, no `event` do post, no
 * "Eu vou" e no `/me/rsvps`: o show de hoje fica até o dia virar, porque a
 * hora de começo não diz quando ele acaba (a regra do `isUpcoming` do app).
 */
export function agendaCutoff(now: number): number {
  return nextDayStart(now - DAY_MS);
}

// --- Shows ---------------------------------------------------------------------

export type EventStatus = 'draft' | 'published' | 'unpublished';

/** events/{eventId} como o servidor usa, com as datas em ms. */
export type EventRecord = {
  id: string;
  title: string;
  artistIds: string[];
  city: string;
  state: string;
  venue: string | null;
  /** O instante do começo, em ms; null em documento estranho. */
  startsAt: number | null;
  photoUrl: string | null;
  featured: boolean;
  status: EventStatus | null;
  publishedAt: number | null;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

function millis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

export function eventRecord(id: string, data: Record<string, unknown>): EventRecord {
  const photo = data.photo as { url?: unknown } | null | undefined;
  const status = data.status;
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    artistIds: Array.isArray(data.artistIds)
      ? data.artistIds.filter((value): value is string => isHandleFormat(value))
      : [],
    city: typeof data.city === 'string' ? data.city : '',
    state: typeof data.state === 'string' ? data.state : '',
    venue: text(data.venue),
    startsAt: millis(data.startsAt),
    photoUrl: typeof photo === 'object' && photo !== null ? text(photo.url) : null,
    featured: data.featured === true,
    status:
      status === 'draft' || status === 'published' || status === 'unpublished' ? status : null,
    publishedAt: millis(data.publishedAt),
  };
}

/**
 * Show aberto: no ar e não encerrado (começou depois do corte). É o que entra
 * na agenda, no `event` do post de show, no "Eu vou" e no `/me/rsvps`.
 */
export function isEventOpen(event: EventRecord | null | undefined, now: number): boolean {
  return (
    !!event &&
    event.status === 'published' &&
    event.startsAt !== null &&
    event.startsAt >= agendaCutoff(now)
  );
}

/** As centrais do show que estão no ar, na ordem dele (a primeira é a principal). */
export function publishedArtistsOf(
  event: EventRecord,
  artists: ReadonlyMap<string, ArtistRecord | null>,
): ArtistRecord[] {
  return event.artistIds.flatMap((id) => {
    const artist = artists.get(id);
    return isPublished(artist) ? [artist] : [];
  });
}

/**
 * A central que recebe os pontos da presença (21.1, decisão 10): a primeira
 * do show que está no ar; nenhuma no ar, paga sem central.
 */
export function payerArtistId(
  event: EventRecord,
  artists: ReadonlyMap<string, ArtistRecord | null>,
): string | null {
  return publishedArtistsOf(event, artists)[0]?.id ?? null;
}

/** O `AgendaEvent` do app: só as centrais no ar, com o nome delas. */
export function eventView(
  event: EventRecord,
  artists: ReadonlyMap<string, ArtistRecord | null>,
  invitePointsPerSignup: number,
): AgendaEvent {
  return {
    id: event.id,
    title: event.title,
    artists: publishedArtistsOf(event, artists).map((artist) => ({
      id: artist.id,
      name: artist.name,
    })),
    city: event.city,
    state: event.state,
    startsAt: new Date(event.startsAt ?? 0).toISOString(),
    imageUrl: event.photoUrl,
    invitePointsPerSignup: invitePointsPerSignup > 0 ? invitePointsPerSignup : null,
    venue: event.venue,
  };
}

/** O show do post de show, quando aberto ("Aracaju, SE"); senão null (21.1, decisão 15). */
export function postEventView(event: EventRecord | null, now: number): PostEvent | null {
  if (!event || !isEventOpen(event, now)) return null;
  return {
    id: event.id,
    title: event.title,
    startsAt: new Date(event.startsAt!).toISOString(),
    city: event.state ? `${event.city}, ${event.state}` : event.city,
  };
}

/**
 * O destaque da agenda (21.1, decisão 13): o show marcado mais próximo depois
 * do corte, empate pelo id. Mais de um marcado não é erro.
 */
export function pickFeatured(events: readonly EventRecord[], now: number): EventRecord | null {
  const cutoff = agendaCutoff(now);
  const candidates = events
    .filter((event) => event.featured && isEventOpen(event, now) && event.startsAt! >= cutoff)
    .sort((a, b) => a.startsAt! - b.startsAt! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates[0] ?? null;
}

// --- Callables do painel (21.9) ----------------------------------------------------

// Isolantes bidi (U+2066 a U+2069): vêm em texto colado, e a linha visível os recusa.
const BIDI_ISOLATES = /[⁦-⁩]/g;

/** Texto de uma linha: sem os isolantes colados, em NFC e sem espaço nas pontas. */
function oneLine(value: string): string {
  return value.replace(BIDI_ISOLATES, '').normalize('NFC').trim();
}

function lineOf(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const line = oneLine(value);
  return line.length >= 1 && line.length <= max && isVisibleLine(line) ? line : null;
}

export function parseEventId(value: unknown): string {
  if (!isContentId(value)) throw eventPanelError('event-not-found');
  return value;
}

export function parseEventTitle(value: unknown): string {
  const title = lineOf(value, EVENT_TITLE_MAX);
  if (title === null) throw eventPanelError('invalid-title');
  return title;
}

export function parseEventCity(value: unknown): string {
  const city = lineOf(value, EVENT_CITY_MAX);
  if (city === null) throw eventPanelError('invalid-city');
  return city;
}

/** O local: opcional; null ou texto vazio limpa. */
export function parseEventVenue(value: unknown): string | null {
  if (value === null || (typeof value === 'string' && oneLine(value) === '')) return null;
  const venue = lineOf(value, EVENT_VENUE_MAX);
  if (venue === null) throw eventPanelError('invalid-venue');
  return venue;
}

export function parseEventState(value: unknown): BrazilState {
  if (!(BRAZIL_STATES as readonly unknown[]).includes(value)) {
    throw eventPanelError('invalid-state');
  }
  return value as BrazilState;
}

export function parseTimeZone(value: unknown): BrazilTimeZone {
  if (!(BRAZIL_TIME_ZONES as readonly unknown[]).includes(value)) {
    throw eventPanelError('invalid-time-zone');
  }
  return value as BrazilTimeZone;
}

/** De 1 a 6 @ de centrais, sem repetir; a primeira é a principal. */
export function parseEventArtistIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > EVENT_ARTISTS_MAX ||
    !value.every(isHandleFormat) ||
    new Set(value).size !== value.length
  ) {
    throw eventPanelError('invalid-artists');
  }
  return [...(value as string[])];
}

/** `YYYY-MM-DDTHH:mm`, uma data que existe. */
export function parseStartsAtLocal(value: unknown): string {
  if (typeof value !== 'string' || !LOCAL_PATTERN.test(value)) {
    throw eventPanelError('invalid-starts-at');
  }
  if (zonedLocalToUtc(value, 'UTC') === null) throw eventPanelError('invalid-starts-at');
  return value;
}

/**
 * O instante do show a partir da data local e do fuso. Mais de 24 h no
 * passado é `event-in-past`; mais de 2 anos à frente, ou uma hora que não
 * existe no fuso, `invalid-starts-at`.
 */
export function eventInstant(local: string, timeZone: string, now: number): number {
  const startsAt = zonedLocalToUtc(local, timeZone);
  if (startsAt === null) throw eventPanelError('invalid-starts-at');
  if (startsAt < now - EVENT_PAST_GRACE_MS) throw eventPanelError('event-in-past');
  if (startsAt > now + EVENT_FUTURE_MAX_MS) throw eventPanelError('invalid-starts-at');
  return startsAt;
}

export function parseFlagOr(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw eventPanelError('invalid-request');
  return value;
}

/** Pasta da foto de um show no bucket. */
export function eventPrefix(eventId: string): string {
  return `events/${eventId}/`;
}
