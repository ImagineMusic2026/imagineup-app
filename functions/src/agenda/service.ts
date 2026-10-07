import {
  FieldPath,
  Timestamp,
  type Firestore,
  type Query,
  type Transaction,
} from 'firebase-admin/firestore';

import type { AgendaPage, MyRsvps } from '../api/contract';
import { artistRecord, CentralError, type ArtistRecord } from '../centrals/model';
import { artistRef } from '../centrals/service';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import { encodePageCursor, type PageCursor } from '../page-cursor';
import {
  addEngagementCounts,
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import {
  AgendaError,
  agendaCutoff,
  eventView,
  isEventOpen,
  pickFeatured,
  publishedArtistsOf,
  RSVP_READ_MAX,
  type EventRecord,
} from './model';
import { eventOf, eventRef, eventsRef, rsvpRef, rsvpsRef } from './store';

// A agenda no Firestore (bloco 6): as leituras das rotas e o "Eu vou" (com os
// pontos pelo núcleo, o teto do dia e os fluxos do painel). A ordem de uma
// rota que grava é a de sempre: chave e fã (runIdempotent), leituras do
// domínio, planAwards, gravações do domínio. docs/arquitetura-api.md, seção 21.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

/** Os shows no ar e não encerrados, em ordem de data, com o cursor `[startsAt, id]`. */
function upcoming(query: Query, now: number): Query {
  return query
    .where('status', '==', 'published')
    .where('startsAt', '>=', tsOf(agendaCutoff(now)))
    .orderBy('startsAt')
    .orderBy(FieldPath.documentId());
}

/** As centrais citadas nos shows, num getAll. */
async function readArtists(
  db: Firestore,
  events: readonly EventRecord[],
): Promise<Map<string, ArtistRecord | null>> {
  const ids = [...new Set(events.flatMap((event) => event.artistIds))];
  if (ids.length === 0) return new Map();
  const snaps = await db.getAll(...ids.map((id) => artistRef(db, id)));
  return new Map(
    ids.map((id, index) => {
      const snap = snaps[index]!;
      return [id, snap.exists ? artistRecord(id, snap.data() ?? {}) : null];
    }),
  );
}

/**
 * A agenda (`GET /agenda`): os shows no ar a partir do começo do dia de hoje
 * em São Paulo (21.1, decisão 14), 20 por página. Na primeira página da
 * agenda geral, também o destaque: o show marcado mais próximo, com o mesmo
 * corte. Com `artistId`, só os shows da central (que precisa estar no ar), e
 * sem destaque.
 */
export async function readAgenda(
  db: Firestore,
  options: {
    artistId: string | null;
    limit: number;
    cursor: PageCursor | null;
    now: number;
    invitePointsPerSignup: number;
  },
): Promise<AgendaPage> {
  const { artistId, limit, cursor, now } = options;
  if (artistId !== null) {
    const artist = await artistRef(db, artistId).get();
    if (!artist.exists || artist.get('status') !== 'published') {
      throw new CentralError('artist_not_found', { artistId });
    }
  }
  let list = upcoming(
    artistId === null
      ? eventsRef(db)
      : eventsRef(db).where('artistIds', 'array-contains', artistId),
    now,
  );
  if (cursor) list = list.startAfter(tsOf(cursor.at), cursor.id);
  const wantsFeatured = artistId === null && cursor === null;
  const [page, featuredSnap] = await Promise.all([
    list.limit(limit + 1).get(),
    wantsFeatured
      ? upcoming(eventsRef(db).where('featured', '==', true), now)
          .limit(1)
          .get()
      : Promise.resolve(null),
  ]);
  const items = page.docs.slice(0, limit).map((doc) => eventOf(doc)!);
  const featured = featuredSnap
    ? pickFeatured(
        featuredSnap.docs.map((doc) => eventOf(doc)!),
        now,
      )
    : null;
  const artists = await readArtists(db, featured ? [...items, featured] : items);
  const view = (event: EventRecord) => eventView(event, artists, options.invitePointsPerSignup);
  const last = items.at(-1);
  return {
    featured: featured ? view(featured) : null,
    items: items.map(view),
    nextCursor:
      page.docs.length > limit && last
        ? encodePageCursor({ at: last.startsAt ?? 0, id: last.id })
        : null,
  };
}

/**
 * As presenças do fã (`GET /me/rsvps`): todas as dele até `RSVP_READ_MAX`,
 * pela última troca, as ativas, e só as de shows abertos (no ar e não
 * encerrados). Fã sem presença: a lista vazia.
 */
export async function readMyRsvps(db: Firestore, uid: string, now: number): Promise<MyRsvps> {
  const list = await rsvpsRef(db, uid).orderBy('updatedAt', 'desc').limit(RSVP_READ_MAX).get();
  const going = list.docs.filter((doc) => doc.get('going') === true).map((doc) => doc.id);
  if (going.length === 0) return { eventIds: [] };
  const snaps = await db.getAll(...going.map((id) => eventRef(db, id)));
  return {
    eventIds: going.filter((_, index) => isEventOpen(eventOf(snaps[index]), now)),
  };
}

export type RsvpOutcome = { plan: AwardPlan; going: boolean };

/**
 * "Eu vou" (`PUT /events/:eventId/rsvp`): show que não existe ou fora do ar
 * é 404 (`missing`), encerrado também (`ended`); já confirmado, nada além da
 * atividade; o teto do dia (50 trocas para "Eu vou"); `rsvp:<eventId>` pelo
 * núcleo, uma vez por show, pago na primeira central do show que está no ar
 * (sem nenhuma, sem central), e a unidade `rsvp` das missões na troca para
 * "Eu vou" (o show conta uma vez por missão e período, bloco 7); a presença nasce (ou volta a `going: true`, com
 * o `firstGoingAt` da primeira) com as centrais no ar copiadas, o fluxo
 * `rsvps` em cada uma delas e o contador do teto.
 */
export async function rsvpEvent(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; eventId: string },
): Promise<RsvpOutcome> {
  const { fan, award, eventId } = options;
  const presenceRef = rsvpRef(db, fan.uid, eventId);
  const [eventSnap, presence] = await tx.getAll(eventRef(db, eventId), presenceRef);
  const event = eventOf(eventSnap);
  const artistSnaps =
    event && event.artistIds.length > 0
      ? await tx.getAll(...event.artistIds.map((id) => artistRef(db, id)))
      : [];
  if (!event || event.status !== 'published') {
    throw new AgendaError('event_not_found', { reason: 'missing' });
  }
  if (!isEventOpen(event, award.now)) {
    throw new AgendaError('event_not_found', { reason: 'ended' });
  }
  if (presence!.exists && presence!.get('going') === true) {
    return {
      plan: await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award),
      going: true,
    };
  }
  enforceDailyCap(fan, award, 'rsvp');
  const artists = new Map(
    event.artistIds.map((id, index) => {
      const snap = artistSnaps[index]!;
      return [id, snap.exists ? artistRecord(id, snap.data() ?? {}) : null] as const;
    }),
  );
  const live = publishedArtistsOf(event, artists).map((artist) => artist.id);
  const payer = live[0] ?? null;
  const plan = await planAwards(
    tx,
    db,
    [
      {
        uid: fan.uid,
        fan,
        entries: [
          {
            kind: 'earn',
            source: 'rsvp',
            eventId,
            artistId: payer,
            subject: { type: 'event', id: eventId },
          },
        ],
        ticks: [{ action: 'rsvp', key: eventId, on: { eventId, artistIds: live } }],
      },
    ],
    award,
  );
  const at = tsOf(award.now);
  if (presence!.exists) {
    tx.update(presenceRef, { going: true, artistIds: live, updatedAt: at });
  } else {
    tx.create(presenceRef, {
      uid: fan.uid,
      eventId,
      going: true,
      artistIds: live,
      firstGoingAt: at,
      updatedAt: at,
      schemaVersion: 1,
    });
  }
  addEngagementCounts(plan, [{ kind: 'rsvps', artistIds: live }]);
  countDailyAction(plan, fan, award, 'rsvp');
  return { plan, going: true };
}

/**
 * Desfazer a presença (`DELETE /events/:eventId/rsvp`): vale em qualquer
 * status do show (não lê o show). Com a presença ativa, ela fica com
 * `going: false` e o fluxo `rsvpsUndone` nas centrais copiadas nela. Não mexe
 * em ponto.
 */
export async function unrsvpEvent(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; eventId: string },
): Promise<RsvpOutcome> {
  const { fan, award, eventId } = options;
  const presenceRef = rsvpRef(db, fan.uid, eventId);
  const presence = await tx.get(presenceRef);
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  if (!presence.exists || presence.get('going') !== true) return { plan, going: false };
  tx.update(presenceRef, { going: false, updatedAt: tsOf(award.now) });
  const copied = presence.get('artistIds');
  addEngagementCounts(plan, [
    {
      kind: 'rsvpsUndone',
      artistIds: Array.isArray(copied)
        ? copied.filter((id): id is string => typeof id === 'string')
        : [],
    },
  ]);
  return { plan, going: false };
}

/** "Eu vou" fora da API (seed). */
export function runRsvp(
  db: Firestore,
  uid: string,
  eventId: string,
  options: RunOptions,
): Promise<RsvpOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) => rsvpEvent(tx, db, { fan, award, eventId }));
}
