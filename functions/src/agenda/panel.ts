import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { isImageContentType, imageSize } from '../artists/model';
import { removeFiles, type ArtistFiles } from '../artists/files';
import { artistRef } from '../centrals/service';
import { isFileIn, isRetriedDraft, parseContentStatus, staleFiles } from '../posts/model';
import { PANEL_CONTENT_SECTION, panelContentId, type ContentDeps } from '../posts/panel';
import { postsRef } from '../posts/store';
import { requestFields } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import { eventPanelError } from './errors';
import {
  eventInstant,
  eventPrefix,
  parseEventArtistIds,
  parseEventCity,
  parseEventId,
  parseEventState,
  parseEventTitle,
  parseEventVenue,
  parseFlagOr,
  parseStartsAtLocal,
  parseTimeZone,
} from './model';
import { eventRef, eventsRef } from './store';

// Callables do painel para a agenda (bloco 6, docs/arquitetura-api.md, 21.9):
// admin, ou editor com a seção artists, cadastra, edita, publica, tira do ar
// e apaga o rascunho que nunca foi ao ar. A data chega na hora local do lugar
// com o fuso IANA, e o servidor guarda o instante. A foto sobe do navegador
// para events/{eventId}/ e a função confere o arquivo. As telas são do bloco
// 11 (imagineup-admin).

/** Foto do show sem largura e altura no upload: a paisagem sugerida. */
const EVENT_PHOTO_SIZE = { width: 1200, height: 675 } as const;

/** Posts lidos ao conferir quem aponta para o show (o `details.postIds` da recusa). */
const EVENT_POSTS_READ = 20;

/** Recompensas lidas ao conferir quem cita o show (o `details.rewardIds`, bloco 10, 25.9). */
const EVENT_REWARDS_READ = 20;

const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();

function audit(
  tx: Transaction,
  db: Firestore,
  action: AuditAction,
  actor: PanelActor,
  details: Record<string, unknown>,
  now: Timestamp,
): void {
  writeAudit(
    tx,
    db,
    {
      action,
      actorUid: actor.uid,
      actorName: actor.name,
      targetEmail: '',
      targetUid: null,
      details,
    },
    now,
  );
}

const editor = (deps: ContentDeps, caller: CallerAuth | undefined) =>
  readPanelActor(directRead, deps.db, caller, PANEL_CONTENT_SECTION, 'edit');

const editorIn = (tx: Transaction, deps: ContentDeps, caller: CallerAuth | undefined) =>
  readPanelActor(transactionRead(tx), deps.db, caller, PANEL_CONTENT_SECTION, 'edit');

/** As centrais do show existem (em qualquer status). */
async function requireArtists(tx: Transaction, db: Firestore, artistIds: string[]): Promise<void> {
  const snaps = await tx.getAll(...artistIds.map((id) => artistRef(db, id)));
  const missing = artistIds.filter((_, index) => !snaps[index]!.exists);
  if (missing.length > 0) throw eventPanelError('artist-not-found', { artistIds: missing });
}

/**
 * Os posts que apontam para o show (até `EVENT_POSTS_READ`). Com `artistIds`,
 * só os dessas centrais: o updateEvent procura só nas centrais que saem, senão
 * um post da central que sai depois do 20º passaria.
 */
async function postsOfEvent(
  tx: Transaction,
  db: Firestore,
  eventId: string,
  artistIds?: readonly string[],
): Promise<string[]> {
  let query = postsRef(db).where('eventId', '==', eventId);
  // Até 6 centrais por show (parseEventArtistIds): cabem no `in`.
  if (artistIds) query = query.where('artistId', 'in', [...artistIds]);
  const snap = await tx.get(query.limit(EVENT_POSTS_READ));
  return snap.docs.map((doc) => doc.id);
}

/**
 * As recompensas da loja que citam o show, em qualquer status (até
 * `EVENT_REWARDS_READ`; índice automático de `eventId`). Bloco 10, 25.9: o
 * show apagado deixaria a recompensa com o `eventId` solto, esgotada para
 * todos sem a equipe saber por quê.
 */
async function rewardsOfEvent(tx: Transaction, db: Firestore, eventId: string): Promise<string[]> {
  const snap = await tx.get(
    db.collection('rewards').where('eventId', '==', eventId).limit(EVENT_REWARDS_READ),
  );
  return snap.docs.map((doc) => doc.id);
}

/**
 * createEvent: o show nasce rascunho, com o instante da data local no fuso
 * (mais de 24 h no passado é `event-in-past`), as centrais conferidas (em
 * qualquer status) e o destaque desmarcado por padrão. O `eventId` pode vir do
 * painel: o mesmo id de novo, com o rascunho ainda rascunho, de quem chama e
 * das mesmas centrais, responde sem gravar nem auditar; o id de qualquer outro
 * documento é `invalid-request` (`field: 'eventId'`). Bloco 11, 26.5.
 */
export async function addEvent(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ eventId: string }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const title = parseEventTitle(input.title);
  const artistIds = parseEventArtistIds(input.artistIds);
  const city = parseEventCity(input.city);
  const state = parseEventState(input.state);
  const venue = input.venue === undefined ? null : parseEventVenue(input.venue);
  const startsAtLocal = parseStartsAtLocal(input.startsAtLocal);
  const timeZone = parseTimeZone(input.timeZone);
  const featured = parseFlagOr(input.featured, false);
  const startsAt = eventInstant(startsAtLocal, timeZone, clock(deps));
  let given: string | null;
  try {
    given = panelContentId(input.eventId, 'eventId');
  } catch {
    throw eventPanelError('invalid-request', { field: 'eventId' });
  }

  return db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const ref = given ? eventRef(db, given) : eventsRef(db).doc();
    if (given) {
      const existing = await tx.get(ref);
      if (existing.exists) {
        if (!isRetriedDraft(existing.data(), actor.uid, { artistIds })) {
          throw eventPanelError('invalid-request', { field: 'eventId' });
        }
        return { eventId: ref.id };
      }
    }
    await requireArtists(tx, db, artistIds);
    const now = Timestamp.fromMillis(clock(deps));
    tx.create(ref, {
      title,
      artistIds,
      city,
      state,
      venue,
      startsAt: Timestamp.fromMillis(startsAt),
      startsAtLocal,
      timeZone,
      photo: null,
      featured,
      status: 'draft',
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      schemaVersion: 1,
    });
    audit(tx, db, 'event.created', actor, { eventId: ref.id, title, artistIds }, now);
    return { eventId: ref.id };
  });
}

type EventPhoto = { url: string; path: string; width: number; height: number };

/** `photo` do updateEvent: null tira; senão `{ photoPath }`, um arquivo direto da pasta do show. */
async function parsePhoto(
  files: ArtistFiles,
  value: unknown,
  eventId: string,
): Promise<EventPhoto | null> {
  if (value === null) return null;
  const path = (value as { photoPath?: unknown } | undefined)?.photoPath;
  if (typeof value !== 'object' || Array.isArray(value) || !isFileIn(path, eventPrefix(eventId))) {
    throw eventPanelError('invalid-photo');
  }
  const file = await files.describe(path);
  if (!file) throw eventPanelError('photo-not-found');
  if (!isImageContentType(file.contentType)) throw eventPanelError('invalid-photo');
  const url = await files.downloadUrl(path);
  return { url, path, ...imageSize(file.customMetadata, EVENT_PHOTO_SIZE) };
}

/** Limpa a pasta do show depois de trocar ou tirar a foto (como a dos posts), sem travar. */
async function pruneEventFiles(deps: ContentDeps, eventId: string, keep: string[]): Promise<void> {
  try {
    const prefix = eventPrefix(eventId);
    const paths = await deps.files.list(prefix);
    const current = await eventRef(deps.db, eventId).get();
    const photoPath = (current.get('photo') as { path?: unknown } | null)?.path;
    const stale = staleFiles(paths, prefix, [
      ...keep,
      typeof photoPath === 'string' ? photoPath : null,
    ]);
    const leftovers = await removeFiles(deps.files, stale);
    if (leftovers.length > 0) {
      logger.warn('Fotos antigas de um show ficaram no Storage.', {
        eventId,
        paths: leftovers.map((leftover) => leftover.path),
      });
    }
  } catch (error) {
    logger.warn('A limpeza da pasta de um show no Storage falhou.', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * updateEvent: ausente não muda; `venue` null ou vazio limpa; data e fuso
 * novos recalculam o instante (data mais de 24 h no passado é
 * `event-in-past`). Trocar as centrais não pode tirar a central de um post
 * que aponta para o show (`event-has-posts`, com os ids): a equipe tira o post
 * do ar e troca o show dele antes. Nada mudou: ok, sem gravar nem auditar.
 */
export async function editEvent(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const eventId = parseEventId(input.eventId);
  const patch = {
    title: input.title === undefined ? undefined : parseEventTitle(input.title),
    artistIds: input.artistIds === undefined ? undefined : parseEventArtistIds(input.artistIds),
    city: input.city === undefined ? undefined : parseEventCity(input.city),
    state: input.state === undefined ? undefined : parseEventState(input.state),
    venue: input.venue === undefined ? undefined : parseEventVenue(input.venue),
    startsAtLocal:
      input.startsAtLocal === undefined ? undefined : parseStartsAtLocal(input.startsAtLocal),
    timeZone: input.timeZone === undefined ? undefined : parseTimeZone(input.timeZone),
    featured: input.featured === undefined ? undefined : parseFlagOr(input.featured, false),
  };
  const photo =
    input.photo === undefined ? undefined : await parsePhoto(deps.files, input.photo, eventId);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(eventRef(db, eventId));
    if (!snap.exists) throw eventPanelError('event-not-found');
    const current = snap.data() ?? {};
    const changes: Record<string, unknown> = {};
    const changed: string[] = [];
    const set = (field: string, value: unknown, same: boolean) => {
      if (value === undefined || same) return;
      changes[field] = value;
      changed.push(field);
    };

    if (patch.artistIds) {
      const before: unknown[] = Array.isArray(current.artistIds) ? current.artistIds : [];
      const same =
        before.length === patch.artistIds.length &&
        patch.artistIds.every((id, index) => before[index] === id);
      if (!same) {
        const removed = before.filter(
          (id): id is string => typeof id === 'string' && !patch.artistIds!.includes(id),
        );
        const broken = removed.length > 0 ? await postsOfEvent(tx, db, eventId, removed) : [];
        await requireArtists(tx, db, patch.artistIds);
        if (broken.length > 0) throw eventPanelError('event-has-posts', { postIds: broken });
        set('artistIds', patch.artistIds, false);
      }
    }
    set('title', patch.title, patch.title === current.title);
    set('city', patch.city, patch.city === current.city);
    set('state', patch.state, patch.state === current.state);
    set('venue', patch.venue, patch.venue === (current.venue ?? null));
    set('featured', patch.featured, patch.featured === (current.featured === true));

    const local = patch.startsAtLocal ?? String(current.startsAtLocal ?? '');
    const zone = patch.timeZone ?? String(current.timeZone ?? '');
    if (
      (patch.startsAtLocal !== undefined && patch.startsAtLocal !== current.startsAtLocal) ||
      (patch.timeZone !== undefined && patch.timeZone !== current.timeZone)
    ) {
      const startsAt = eventInstant(local, zone, clock(deps));
      changes.startsAt = Timestamp.fromMillis(startsAt);
      changes.startsAtLocal = local;
      changes.timeZone = zone;
      changed.push('startsAt');
    }
    const currentPhoto = (current.photo as { path?: unknown } | null) ?? null;
    if (photo === null && currentPhoto) set('photo', null, false);
    else if (photo && photo.path !== currentPhoto?.path) set('photo', photo, false);

    if (changed.length === 0) return;
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(snap.ref, { ...changes, updatedAt: now, updatedBy: actor.uid });
    audit(
      tx,
      db,
      'event.updated',
      actor,
      { eventId, title: (changes.title as string | undefined) ?? current.title ?? '', changed },
      now,
    );
  });

  if (photo !== undefined) await pruneEventFiles(deps, eventId, photo ? [photo.path] : []);
  return { ok: true };
}

/**
 * setEventStatus: publicar não exige foto nem central no ar; a primeira
 * publicação grava `publishedAt`. Tirar do ar não apaga presenças; o post de
 * show perde a linha do show. O mesmo status, ou tirar do ar um rascunho, é
 * ok sem gravar.
 */
export async function changeEventStatus(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const eventId = parseEventId(input.eventId);
  let status: 'published' | 'unpublished';
  try {
    status = parseContentStatus(input.status);
  } catch {
    throw eventPanelError('invalid-status');
  }

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(eventRef(db, eventId));
    if (!snap.exists) throw eventPanelError('event-not-found');
    const from = snap.get('status');
    if (from === status) return;
    if (status === 'unpublished' && from === 'draft') return;
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(snap.ref, {
      status,
      ...(status === 'published' && !snap.get('publishedAt') ? { publishedAt: now } : {}),
      updatedAt: now,
      updatedBy: actor.uid,
    });
    audit(
      tx,
      db,
      status === 'published' ? 'event.published' : 'event.unpublished',
      actor,
      { eventId, title: snap.get('title') ?? '', from },
      now,
    );
  });
  return { ok: true };
}

/**
 * deleteEvent: só o show que nunca foi ao ar (`was-published`), para o qual
 * nenhum post aponta (`event-has-posts`, com os ids) e que nenhuma recompensa
 * da loja cita (`event-has-rewards`, com os ids, desde o bloco 10). Solta as
 * centrais do show (o `has-content` do deleteArtist). A pasta da foto sai
 * depois.
 */
export async function removeEvent(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const eventId = parseEventId(requestFields(data).eventId);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(eventRef(db, eventId));
    if (!snap.exists) throw eventPanelError('event-not-found');
    const [posts, rewards] = await Promise.all([
      postsOfEvent(tx, db, eventId),
      rewardsOfEvent(tx, db, eventId),
    ]);
    if (snap.get('publishedAt')) throw eventPanelError('was-published');
    if (posts.length > 0) throw eventPanelError('event-has-posts', { postIds: posts });
    if (rewards.length > 0) throw eventPanelError('event-has-rewards', { rewardIds: rewards });
    const now = Timestamp.fromMillis(clock(deps));
    tx.delete(snap.ref);
    audit(
      tx,
      db,
      'event.deleted',
      actor,
      { eventId, title: snap.get('title') ?? '', artistIds: snap.get('artistIds') ?? [] },
      now,
    );
  });

  try {
    const paths = await deps.files.list(eventPrefix(eventId));
    await removeFiles(deps.files, paths);
  } catch (error) {
    logger.warn('A limpeza da pasta de um show apagado falhou.', {
      eventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { ok: true };
}
