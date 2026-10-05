import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { zonedLocalToUtc, type BrazilState, type BrazilTimeZone } from './model';
import { eventRef } from './store';

// Shows de teste no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build): os mesmos da agenda de exemplo do app
// (buildAgendaEventsFixture, em src/domains/agenda/fixtures.ts), com os
// mesmos ids e a mesma regra de datas, na hora local do lugar, todos no ar.
// Nunca roda em produção: o script fixa o emulador. docs/arquitetura-api.md, 21.14.

/** Quando o show acontece, relativo ao "agora" no fuso do lugar (a regra das fixtures). */
type SeedWhen =
  | { kind: 'nextSaturday'; hour: number }
  | { kind: 'monthDay'; monthsAhead: number; day: number; hour: number };

type SeedEvent = {
  id: string;
  title: string;
  artistIds: string[];
  city: string;
  state: BrazilState;
  timeZone: BrazilTimeZone;
  when: SeedWhen;
  featured: boolean;
  status: 'draft' | 'published';
};

export const SEED_EVENTS: readonly SeedEvent[] = [
  {
    // O show do post de show do Nenho na home ("Sábado tem show em Aracaju!").
    id: 'arrocha-na-praia',
    title: 'Arrocha na Praia',
    artistIds: ['nenho'],
    city: 'Aracaju',
    state: 'SE',
    timeZone: 'America/Maceio',
    when: { kind: 'nextSaturday', hour: 22 },
    featured: false,
    status: 'published',
  },
  {
    // O destaque: o mesmo da missão de presença e do meet & greet da loja.
    id: 'sao-joao-irara',
    title: 'São João de Irará',
    artistIds: ['nettobrito', 'nenho'],
    city: 'Irará',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 1, day: 21, hour: 22 },
    featured: true,
    status: 'published',
  },
  {
    id: 'pra-encher-e-derramar',
    title: 'Pra Encher e Derramar',
    artistIds: ['nettobrito'],
    city: 'Feira de Santana',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 1, day: 28, hour: 21 },
    featured: false,
    status: 'published',
  },
  {
    id: 'festa-do-vaqueiro',
    title: 'Festa do Vaqueiro',
    artistIds: ['juninhomoraes'],
    city: 'Serrinha',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 2, day: 12, hour: 20 },
    featured: false,
    status: 'published',
  },
  {
    id: 'vaquejada-de-serrinha',
    title: 'Vaquejada de Serrinha',
    artistIds: ['rocksalles'],
    city: 'Serrinha',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 3, day: 2, hour: 22 },
    featured: false,
    status: 'published',
  },
  {
    id: 'arrocha-do-nenho',
    title: 'Arrocha do Nenho',
    artistIds: ['nenho'],
    city: 'Salvador',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 3, day: 16, hour: 22 },
    featured: false,
    status: 'published',
  },
  {
    id: 'verao-arrochado',
    title: 'Verão Arrochado',
    artistIds: ['nettobrito'],
    city: 'Salvador',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 4, day: 10, hour: 21 },
    featured: false,
    status: 'published',
  },
  {
    id: 'festival-do-sertao',
    title: 'Festival do Sertão',
    artistIds: ['juninhomoraes', 'rocksalles'],
    city: 'Vitória da Conquista',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 4, day: 24, hour: 20 },
    featured: false,
    status: 'published',
  },
  {
    id: 'carnaval-do-nenho',
    title: 'Carnaval do Nenho',
    artistIds: ['nenho'],
    city: 'Recife',
    state: 'PE',
    timeZone: 'America/Recife',
    when: { kind: 'monthDay', monthsAhead: 5, day: 13, hour: 22 },
    featured: false,
    status: 'published',
  },
  {
    // Rascunho: o app não mostra.
    id: 'show-rascunho',
    title: 'Show em rascunho',
    artistIds: ['nettobrito'],
    city: 'Salvador',
    state: 'BA',
    timeZone: 'America/Bahia',
    when: { kind: 'monthDay', monthsAhead: 2, day: 5, hour: 21 },
    featured: false,
    status: 'draft',
  },
];

/** A data de hoje no fuso, `[ano, mês, dia]`. */
function todayIn(now: number, timeZone: string): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(now))
    .split('-')
    .map(Number);
  return [parts[0]!, parts[1]!, parts[2]!];
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A data e a hora locais do show, na regra das fixtures do app: o sábado
 * seguinte (o `nextSaturday` do date-fns: num sábado, o da semana que vem) ou
 * o dia N do mês M meses depois do atual.
 */
export function seedEventLocal(when: SeedWhen, now: number, timeZone: string): string {
  const [year, month, day] = todayIn(now, timeZone);
  let date: Date;
  if (when.kind === 'nextSaturday') {
    const today = new Date(Date.UTC(year, month - 1, day));
    const ahead = (6 - today.getUTCDay() + 7) % 7 || 7;
    date = new Date(Date.UTC(year, month - 1, day + ahead));
  } else {
    date = new Date(Date.UTC(year, month - 1 + when.monthsAhead, when.day));
  }
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(when.hour)}:00`;
}

/**
 * Cria cada show que ainda não existe, no formato das callables (sem foto e
 * sem local, como as fixtures). O que já existe fica como o desenvolvedor
 * deixou no painel. Devolve quantos criou.
 */
export async function seedEvents(db: Firestore, now: number = Date.now()): Promise<number> {
  const at = Timestamp.fromMillis(now);
  let created = 0;
  for (const event of SEED_EVENTS) {
    const local = seedEventLocal(event.when, now, event.timeZone);
    const startsAt = zonedLocalToUtc(local, event.timeZone);
    if (startsAt === null)
      throw new Error(`Data do show de teste ${event.id} não existe: ${local}.`);
    const ref = eventRef(db, event.id);
    created += await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return 0;
      tx.create(ref, {
        title: event.title,
        artistIds: event.artistIds,
        city: event.city,
        state: event.state,
        venue: null,
        startsAt: Timestamp.fromMillis(startsAt),
        startsAtLocal: local,
        timeZone: event.timeZone,
        photo: null,
        featured: event.featured,
        status: event.status,
        publishedAt: event.status === 'published' ? at : null,
        createdAt: at,
        updatedAt: at,
        createdBy: 'seed',
        updatedBy: 'seed',
        schemaVersion: 1,
      });
      return 1;
    });
  }
  return created;
}
