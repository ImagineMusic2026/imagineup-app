import { addMonths, nextSaturday, set, startOfMonth } from 'date-fns';

import { missionsFixture } from '@/domains/missions';
import { ApiError } from '@/services/api/errors';
import { fixtureNow, onFixtureSessionEnd } from '@/services/fixtures';

import type { AgendaArtist, AgendaEvent, AgendaPage, MyRsvps, RsvpResult } from './types';

/**
 * Shows de exemplo da agenda (1m) enquanto a API (M2) não existe: os do
 * protótipo, com os meses relativos a `now` (junho a agosto do protótipo já
 * passaram). O destaque é o São João de Irará, dia 21 do mês seguinte às
 * 22 h, o mesmo da missão de presença (1g) e do meet & greet da loja (1h). O
 * Arrocha na Praia é o show do post do Nenho na home ("Sábado tem show em
 * Aracaju!"): o sábado seguinte, às 22 h, como lá. Os artistas das linhas e
 * a segunda página são exemplo. Sem foto: o destaque mostra o bloco ciano.
 */

export const AGENDA_PAGE_SIZE = 6;

// Pontos por cadastro pelo link do "Chamar amigos" (exemplo; vem do painel).
const INVITE_POINTS_PER_SIGNUP = 10;
// O show marcado no painel para o topo da agenda.
const FEATURED_ID = 'sao-joao-irara';

const NETTO: AgendaArtist = { id: 'nettobrito', name: 'Netto Brito' };
const NENHO: AgendaArtist = { id: 'nenho', name: 'Nenho' };
const JUNINHO: AgendaArtist = { id: 'juninhomoraes', name: 'Juninho Moraes' };
const ROCK: AgendaArtist = { id: 'rocksalles', name: 'Rock Salles' };

interface Sample {
  id: string;
  title: string;
  artists: AgendaArtist[];
  city: string;
  state: string;
  /** Meses depois do atual (1 é o seguinte). */
  monthsAhead: number;
  day: number;
  hours: number;
}

const SAMPLES: readonly Sample[] = [
  {
    id: 'sao-joao-irara',
    title: 'São João de Irará',
    artists: [NETTO, NENHO],
    city: 'Irará',
    state: 'BA',
    monthsAhead: 1,
    day: 21,
    hours: 22,
  },
  {
    id: 'pra-encher-e-derramar',
    title: 'Pra Encher e Derramar',
    artists: [NETTO],
    city: 'Feira de Santana',
    state: 'BA',
    monthsAhead: 1,
    day: 28,
    hours: 21,
  },
  {
    id: 'festa-do-vaqueiro',
    title: 'Festa do Vaqueiro',
    artists: [JUNINHO],
    city: 'Serrinha',
    state: 'BA',
    monthsAhead: 2,
    day: 12,
    hours: 20,
  },
  {
    id: 'vaquejada-de-serrinha',
    title: 'Vaquejada de Serrinha',
    artists: [ROCK],
    city: 'Serrinha',
    state: 'BA',
    monthsAhead: 3,
    day: 2,
    hours: 22,
  },
  {
    id: 'arrocha-do-nenho',
    title: 'Arrocha do Nenho',
    artists: [NENHO],
    city: 'Salvador',
    state: 'BA',
    monthsAhead: 3,
    day: 16,
    hours: 22,
  },
  {
    id: 'verao-arrochado',
    title: 'Verão Arrochado',
    artists: [NETTO],
    city: 'Salvador',
    state: 'BA',
    monthsAhead: 4,
    day: 10,
    hours: 21,
  },
  {
    id: 'festival-do-sertao',
    title: 'Festival do Sertão',
    artists: [JUNINHO, ROCK],
    city: 'Vitória da Conquista',
    state: 'BA',
    monthsAhead: 4,
    day: 24,
    hours: 20,
  },
  {
    id: 'carnaval-do-nenho',
    title: 'Carnaval do Nenho',
    artists: [NENHO],
    city: 'Recife',
    state: 'PE',
    monthsAhead: 5,
    day: 13,
    hours: 22,
  },
];

const AT_HOUR = { minutes: 0, seconds: 0, milliseconds: 0 } as const;

/** O show do post do Nenho na home: o sábado seguinte a `now`, às 22 h. */
function nextSaturdayShow(now: Date): AgendaEvent {
  return {
    id: 'arrocha-na-praia',
    title: 'Arrocha na Praia',
    artists: [NENHO],
    city: 'Aracaju',
    state: 'SE',
    startsAt: set(nextSaturday(now), { hours: 22, ...AT_HOUR }).toISOString(),
    imageUrl: null,
    invitePointsPerSignup: INVITE_POINTS_PER_SIGNUP,
  };
}

function fromSample(sample: Sample, now: Date): AgendaEvent {
  const month = addMonths(startOfMonth(now), sample.monthsAhead);
  return {
    id: sample.id,
    title: sample.title,
    artists: sample.artists.map((artist) => ({ ...artist })),
    city: sample.city,
    state: sample.state,
    startsAt: set(month, { date: sample.day, hours: sample.hours, ...AT_HOUR }).toISOString(),
    imageUrl: null,
    invitePointsPerSignup: INVITE_POINTS_PER_SIGNUP,
  };
}

/** Todos os shows de exemplo, em ordem de data; objetos novos a cada chamada. */
export function buildAgendaEventsFixture(now: Date): AgendaEvent[] {
  const events = [nextSaturdayShow(now), ...SAMPLES.map((sample) => fromSample(sample, now))];
  return events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/**
 * Uma página da agenda: o cursor é a posição do primeiro show da página. O
 * destaque vem só na primeira, fora da paginação, e também na lista, na data
 * dele (a tela não o repete).
 */
export function buildAgendaPageFixture(now: Date, cursor: string | null): AgendaPage {
  const events = buildAgendaEventsFixture(now);
  const start = cursor === null ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0);
  const end = start + AGENDA_PAGE_SIZE;
  const featured = cursor === null ? events.find((event) => event.id === FEATURED_ID) : undefined;
  return {
    featured: featured ?? null,
    items: events.slice(start, end),
    nextCursor: end < events.length ? String(end) : null,
  };
}

/**
 * Os shows de uma central (aba Agenda da 1d): os mesmos da agenda, só os em
 * que o artista toca, sem destaque, em páginas do mesmo tamanho.
 */
export function buildArtistAgendaPageFixture(
  now: Date,
  artistId: string,
  cursor: string | null,
): AgendaPage {
  const events = buildAgendaEventsFixture(now).filter((event) =>
    event.artists.some((artist) => artist.id === artistId),
  );
  const start = cursor === null ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0);
  const end = start + AGENDA_PAGE_SIZE;
  return {
    featured: null,
    items: events.slice(start, end),
    nextCursor: end < events.length ? String(end) : null,
  };
}

let going = new Set<string>();
// Chave de idempotência já vista e o que ela devolveu, como o servidor faria.
let answered = new Map<string, RsvpResult>();

/**
 * Estado de "servidor" das presenças do fã. Fica em memória e volta ao início
 * quando o app reabre ou a sessão termina. Só aceita os shows da agenda, como
 * a API.
 *
 * Confirmar presença conta na missão "Confirme presença em um show" (1g): o
 * servidor das missões diz quantos pontos a confirmação rendeu (os da missão,
 * quando ela conclui; zero depois disso) e já os põe na carteira.
 */
export const rsvpFixture = {
  /** Confirma ou desfaz; a mesma chave de novo devolve a resposta da primeira vez. */
  set(eventId: string, confirm: boolean, idempotencyKey: string): RsvpResult {
    const previous = answered.get(idempotencyKey);
    if (previous) return { ...previous };

    if (!buildAgendaEventsFixture(fixtureNow()).some((event) => event.id === eventId)) {
      throw new ApiError('notFound', `Show ${eventId} não existe nas fixtures.`, 404);
    }

    let pointsAwarded = 0;
    if (confirm) {
      going.add(eventId);
      pointsAwarded = missionsFixture.record('rsvp');
    } else {
      going.delete(eventId);
    }
    const result: RsvpResult = { eventId, going: confirm, pointsAwarded };
    answered.set(idempotencyKey, result);
    return { ...result };
  },

  mine(): MyRsvps {
    return { eventIds: [...going] };
  },

  /** Volta ao início (fim da sessão e testes). As missões voltam com `missionsFixture.reset()`. */
  reset(): void {
    going = new Set();
    answered = new Map();
  },
};

onFixtureSessionEnd(() => rsvpFixture.reset());
