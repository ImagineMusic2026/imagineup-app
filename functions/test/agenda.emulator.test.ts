import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { RSVPS_PER_DAY } from '../src/moderation';
import { DEFAULT_POINTS_CONFIG, dayKey, staticConfigSource } from '../src/points';
import {
  central,
  daysSince,
  http,
  localApi,
  post,
  show,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
} from './support';

/**
 * A agenda do bloco 6 nos emuladores (docs/arquitetura-api.md, 21.15): a
 * `api` de verdade e o handler no processo, com o relógio fixo perto da
 * meia-noite de São Paulo para o corte do que já passou.
 */
const env = useEmulators('agenda', ['api', 'createUserProfile']);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();
const DAY_MS = 24 * 60 * 60 * 1000;

describe('agenda (GET /agenda)', () => {
  it('em ordem, com o corte do começo do dia de São Paulo, o destaque mais próximo e a agenda de uma central', async () => {
    const fan = await signUpFan(db);
    const [netto, nenho, draft] = [
      await central(env),
      await central(env),
      await central(env, { status: 'draft' }),
    ];
    // 23:59 de 05/10 em São Paulo; depois, 0:00:30 de 06/10.
    const before = Date.parse('2026-10-06T02:59:00.000Z');
    const after = Date.parse('2026-10-06T03:00:30.000Z');
    const yesterday22 = await show(env, [netto], Date.parse('2026-10-06T01:00:00.000Z'), {
      featured: true,
    });
    const later = await show(env, [nenho, netto], Date.parse('2026-11-22T01:00:00.000Z'), {
      featured: true,
      venue: 'Praça da Matriz',
    });
    const soon = await show(env, [draft, nenho], Date.parse('2026-10-20T01:00:00.000Z'));
    await show(env, [netto], Date.parse('2026-10-25T01:00:00.000Z'), { status: 'draft' });
    const postId = await post(env, netto, { kind: 'event', eventId: yesterday22 });

    const at = (now: number) => localApi(env, { now: () => now });
    const page = await at(before)('GET', '/agenda', { token: fan.token });
    expect(page.status).toBe(200);
    expect((page.body.items as { id: string }[]).map((item) => item.id)).toEqual([
      yesterday22,
      soon,
      later,
    ]);
    expect((page.body.featured as { id: string }).id).toBe(yesterday22);
    expect((await at(before)('GET', `/posts/${postId}`, { token: fan.token })).body.event).toEqual({
      id: yesterday22,
      title: `Show ${yesterday22}`,
      startsAt: '2026-10-06T01:00:00.000Z',
      city: 'Irará, BA',
    });

    const next = await at(after)('GET', '/agenda', { token: fan.token });
    expect((next.body.items as { id: string }[]).map((item) => item.id)).toEqual([soon, later]);
    expect(next.body.featured).toMatchObject({
      id: later,
      artists: [
        { id: nenho, name: `Central ${nenho}` },
        { id: netto, name: `Central ${netto}` },
      ],
      venue: 'Praça da Matriz',
      invitePointsPerSignup: 10,
    });
    // O show de ontem sai do post e do "Eu vou" à 0:00.
    expect(
      (await at(after)('GET', `/posts/${postId}`, { token: fan.token })).body.event,
    ).toBeNull();
    expect(
      await at(after)('PUT', `/events/${yesterday22}/rsvp`, {
        token: fan.token,
        key: unique('chave-rsvp-'),
      }),
    ).toMatchObject({
      status: 404,
      body: { code: 'event_not_found', details: { reason: 'ended' } },
    });
    // Só as centrais no ar na linha do show.
    const soonView = (next.body.items as { id: string; artists: unknown[] }[]).find(
      (item) => item.id === soon,
    );
    expect(soonView?.artists).toEqual([{ id: nenho, name: `Central ${nenho}` }]);

    // A agenda de uma central: sem destaque; central fora do ar é 404.
    const byArtist = await at(after)('GET', '/agenda', {
      token: fan.token,
      query: { artistId: netto },
    });
    expect(byArtist.body.featured).toBeNull();
    expect((byArtist.body.items as { id: string }[]).map((item) => item.id)).toEqual([later]);
    expect(
      (await at(after)('GET', '/agenda', { token: fan.token, query: { artistId: draft } })).status,
    ).toBe(404);

    // Paginada: de 1 em 1, com o cursor.
    const one = await at(after)('GET', '/agenda', { token: fan.token, query: { limit: '1' } });
    const two = await at(after)('GET', '/agenda', {
      token: fan.token,
      query: { limit: '1', cursor: one.body.nextCursor as string },
    });
    expect((two.body.items as { id: string }[])[0]?.id).toBe(later);
    expect(two.body.featured).toBeNull();
  });
});

describe('"Eu vou" (PUT e DELETE /events/:eventId/rsvp)', () => {
  it('paga uma vez por show; desfazer não tira e deixa going: false com o firstGoingAt', async () => {
    const fan = await signUpFan(db);
    const netto = await central(env);
    const eventId = await show(env, [netto], Date.now() + 10 * DAY_MS);
    const call = localApi(env, {
      config: staticConfigSource({
        points: { ...DEFAULT_POINTS_CONFIG, values: { ...DEFAULT_POINTS_CONFIG.values, rsvp: 5 } },
      }),
    });
    const put = () =>
      call('PUT', `/events/${eventId}/rsvp`, { token: fan.token, key: unique('chave-r-') });
    const del = () =>
      call('DELETE', `/events/${eventId}/rsvp`, { token: fan.token, key: unique('chave-d-') });

    expect(await put()).toMatchObject({
      status: 200,
      body: { eventId, going: true, pointsAwarded: 5 },
    });
    expect(await put()).toMatchObject({ body: { going: true, pointsAwarded: 0 } });
    const first = await read(`users/${fan.uid}/eventRsvps/${eventId}`);
    expect(first).toMatchObject({ going: true, artistIds: [netto] });
    expect(await read(`wallets/${fan.uid}/ledger/rsvp:${eventId}`)).toMatchObject({
      points: 5,
      artistId: netto,
    });
    expect(await del()).toMatchObject({ body: { going: false, pointsAwarded: 0 } });
    const undone = await read(`users/${fan.uid}/eventRsvps/${eventId}`);
    expect(undone).toMatchObject({ going: false });
    expect(undone!.firstGoingAt).toEqual(first!.firstGoingAt);
    expect(await put()).toMatchObject({ body: { pointsAwarded: 0 } });
    expect(await read(`wallets/${fan.uid}`)).toMatchObject({ balance: 5 });
    expect((await http(env, '/me/rsvps', { token: fan.token })).body).toEqual({
      eventIds: [eventId],
    });
  });

  it('soma 1 no rsvp_set só na troca; no teto, 429 sem gravar a presença nem a chave; desfazer passa', async () => {
    const fan = await signUpFan(db);
    const netto = await central(env);
    const [first, second] = [
      await show(env, [netto], Date.now() + 10 * DAY_MS),
      await show(env, [netto], Date.now() + 11 * DAY_MS),
    ];
    const day = dayKey(Date.now());
    const rsvp = (eventId: string, method = 'PUT') =>
      http(env, `/events/${eventId}/rsvp`, { method, token: fan.token, key: unique('chave-r-') });
    const counted = async () =>
      (await read(`wallets/${fan.uid}`))?.days?.[day]?.count?.rsvp_set as number | undefined;

    expect((await rsvp(first)).status).toBe(200);
    // Já confirmado: sucesso sem efeito, sem contar.
    expect(await rsvp(first)).toMatchObject({ status: 200, body: { going: true } });
    expect(await counted()).toBe(1);

    await db.doc(`wallets/${fan.uid}`).update({ [`days.${day}.count.rsvp_set`]: RSVPS_PER_DAY });
    const capped = await rsvp(second);
    expect(capped.status).toBe(429);
    expect(capped.body).toMatchObject({
      code: 'too_many_requests',
      details: { limit: RSVPS_PER_DAY, action: 'rsvp' },
    });
    expect(Number(capped.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await read(`users/${fan.uid}/eventRsvps/${second}`)).toBeUndefined();
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(2);
    expect(await counted()).toBe(RSVPS_PER_DAY);
    // Desfazer nunca é recusado.
    expect(await rsvp(first, 'DELETE')).toMatchObject({ status: 200, body: { going: false } });
  });

  it('show fora do ar ou que não existe: 404 missing; desfazer vale em qualquer status', async () => {
    const fan = await signUpFan(db);
    const netto = await central(env);
    const eventId = await show(env, [netto], Date.now() + 10 * DAY_MS);
    const put = (id: string) =>
      http(env, `/events/${id}/rsvp`, { method: 'PUT', token: fan.token, key: unique('chave-r-') });
    expect((await put(eventId)).status).toBe(200);
    await db.doc(`events/${eventId}`).update({ status: 'unpublished' });
    expect(await put(eventId)).toMatchObject({
      status: 404,
      body: { code: 'event_not_found', details: { reason: 'missing' } },
    });
    expect((await put(unique('nao-existe'))).status).toBe(404);
    // O post de show perde a linha do show; /me/rsvps não traz show fora do ar.
    expect((await http(env, '/me/rsvps', { token: fan.token })).body).toEqual({ eventIds: [] });
    const undo = await http(env, `/events/${eventId}/rsvp`, {
      method: 'DELETE',
      token: fan.token,
      key: unique('chave-d-'),
    });
    expect(undo).toMatchObject({ status: 200, body: { going: false } });
  });

  it('com a primeira central em rascunho, paga na segunda (no ar) e não soma agregado na de rascunho', async () => {
    const fan = await signUpFan(db);
    const [draft, live] = [await central(env, { status: 'draft' }), await central(env)];
    const eventId = await show(env, [draft, live], Date.now() + 10 * DAY_MS);
    const started = Date.now();
    const call = localApi(env, {
      config: staticConfigSource({
        points: { ...DEFAULT_POINTS_CONFIG, values: { ...DEFAULT_POINTS_CONFIG.values, rsvp: 1 } },
      }),
    });
    await call('PUT', `/events/${eventId}/rsvp`, { token: fan.token, key: unique('chave-r-') });
    expect(await read(`wallets/${fan.uid}/ledger/rsvp:${eventId}`)).toMatchObject({
      artistId: live,
    });
    expect(await read(`wallets/${fan.uid}/centralPoints/${draft}`)).toBeUndefined();
    const days = daysSince(started);
    expect(await statsSum(db, days, (d) => d.byArtist?.[live]?.rsvps ?? 0)).toBe(1);
    expect(await statsSum(db, days, (d) => d.byArtist?.[draft]?.rsvps ?? 0)).toBe(0);
    expect(await statsSum(db, days, (d) => d.totals?.rsvps ?? 0)).toBe(1);
  });

  it('/me/rsvps lê até 1.000 presenças: a confirmada primeiro, num show distante, continua', async () => {
    const fan = await signUpFan(db);
    const netto = await central(env);
    const distant = await show(env, [netto], Date.now() + 300 * DAY_MS);
    const old = Timestamp.fromMillis(Date.now() - 30 * DAY_MS);
    await db.doc(`users/${fan.uid}/eventRsvps/${distant}`).set({
      uid: fan.uid,
      eventId: distant,
      going: true,
      artistIds: [netto],
      firstGoingAt: old,
      updatedAt: old,
      schemaVersion: 1,
    });
    const batch = db.batch();
    for (let index = 0; index < 120; index += 1) {
      const id = unique('outro-show-');
      batch.set(db.doc(`users/${fan.uid}/eventRsvps/${id}`), {
        uid: fan.uid,
        eventId: id,
        going: false,
        artistIds: [],
        firstGoingAt: Timestamp.now(),
        updatedAt: Timestamp.fromMillis(Date.now() - index * 1000),
        schemaVersion: 1,
      });
    }
    await batch.commit();
    expect((await http(env, '/me/rsvps', { token: fan.token })).body).toEqual({
      eventIds: [distant],
    });
  });

  it('o post de show monta o event a partir do show e o perde quando o show sai do ar', async () => {
    const fan = await signUpFan(db);
    const nenho = await central(env);
    const eventId = await show(env, [nenho], Date.now() + 5 * DAY_MS, {
      city: 'Aracaju',
      state: 'SE',
    });
    const postId = await post(env, nenho, { kind: 'event', eventId });
    const before = await http(env, `/posts/${postId}`, { token: fan.token });
    expect(before.body.event).toMatchObject({ id: eventId, city: 'Aracaju, SE' });
    await db.doc(`events/${eventId}`).update({ status: 'unpublished' });
    const after = await http(env, `/posts/${postId}`, { token: fan.token });
    expect(after.body).toMatchObject({ id: postId, event: null });
    expect(dayKey(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
