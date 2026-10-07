import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { seedEvents } from '../src/agenda';
import { CAMILA_CENTRALS, seedCamilaCentrals, seedCentrals } from '../src/centrals';
import {
  CAMILA_INVITE_CODE,
  EMULATOR_INVITE_KEY,
  personKey,
  seedCamilaInvite,
  seedInviteClaims,
  seedInviteVisits,
  SEED_INVITEES,
  SEED_VISITORS,
} from '../src/invites';
import {
  catalogDoc,
  seedMissionsCatalog,
  type MissionRecord,
  type SeasonGoalConfig,
} from '../src/missions';
import {
  createConfigSource,
  dayKey,
  runAward,
  SEED_ACTOR,
  seedCamilaWallet,
  DEFAULT_POINTS_CONFIG,
} from '../src/points';
import { seedCamilaLikes, seedEngagement, seedPosts } from '../src/posts';
import { deleteUserData } from '../src/store';
import {
  central,
  localApi,
  post,
  show,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
} from './support';

/**
 * As missões, as conquistas, o nível e o extrato do bloco 7 nos emuladores
 * (docs/arquitetura-api.md, 22.14): o handler da `api` no processo do teste,
 * com o ID token de verdade do emulador de Auth, o Firestore do emulador, a
 * configuração lida sem cache (o catálogo muda no meio dos testes) e o
 * relógio fixo quando a virada importa.
 */
const env = useEmulators('missoes', ['api', 'createUserProfile', 'deleteUserProfile']);
const { db } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Segunda-feira, 5 de outubro de 2026, meio-dia em São Paulo.
const T0 = Date.parse('2026-10-05T15:00:00.000Z');

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

/** O handler com o relógio dado (o padrão: agora) e a configuração sem cache. */
function apiAt(now: () => number = () => Date.now()) {
  return localApi(env, { now, config: createConfigSource(db, { ttlMs: 0 }) });
}

type Api = ReturnType<typeof apiAt>;

function mission(extra: Partial<MissionRecord> & Pick<MissionRecord, 'id'>): MissionRecord {
  return {
    title: `Missão ${extra.id}`,
    action: 'like',
    target: null,
    goal: 3,
    period: 'daily',
    rewardPoints: 10,
    featured: false,
    startsAt: Date.parse('2026-01-01T00:00:00.000Z'),
    endsAt: null,
    status: 'active',
    activatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    ...extra,
  };
}

/** O catálogo gravado como as callables gravariam (a versão sobe a cada troca). */
async function writeCatalog(
  missions: MissionRecord[],
  seasonGoal: SeasonGoalConfig | null = null,
): Promise<void> {
  const ref = db.doc('config/missions');
  const version = ((await ref.get()).get('version') as number | undefined) ?? 0;
  await ref.set({
    ...catalogDoc(missions, seasonGoal),
    version: version + 1,
    updatedAt: Timestamp.now(),
    updatedBy: null,
  });
}

async function writeSeason(id: string, startsAt: number, endsAt: number): Promise<void> {
  await db.doc('config/season').set({
    version: 1,
    season: {
      id,
      name: 'Temporada de teste',
      startsAt: Timestamp.fromMillis(startsAt),
      endsAt: Timestamp.fromMillis(endsAt),
      leaderTitle: null,
    },
  });
}

async function writePoints(change: Record<string, unknown>): Promise<void> {
  await db.doc('config/points').set({ version: 1, ...change });
}

const key = (prefix: string) => unique(`${prefix}-chave-`);

const like = (api: Api, fan: Fan, postId: string, k = key('curtir')) =>
  api('PUT', `/posts/${postId}/like`, { token: fan.token, key: k });
const unlike = (api: Api, fan: Fan, postId: string) =>
  api('DELETE', `/posts/${postId}/like`, { token: fan.token, key: key('descurtir') });
const comment = (api: Api, fan: Fan, postId: string) =>
  api('POST', `/posts/${postId}/comments`, {
    token: fan.token,
    key: key('comentar'),
    body: { text: 'Que música boa!' },
  });
const rsvp = (api: Api, fan: Fan, eventId: string) =>
  api('PUT', `/events/${eventId}/rsvp`, { token: fan.token, key: key('eu-vou') });
const missionsOf = async (api: Api, fan: Fan) =>
  (await api('GET', '/missions', { token: fan.token })).body as {
    season: Record<string, unknown> | null;
    missions: { id: string; progress: { current: number }; status: string; featured: boolean }[];
  };
const progressOf = async (api: Api, fan: Fan, id: string) =>
  (await missionsOf(api, fan)).missions.find((item) => item.id === id);

/** A carteira lida direto (o fã não lê a própria pelo Firestore; o teste lê pelo Admin SDK). */
const wallet = (fan: Fan) => read(`wallets/${fan.uid}`);

describe('rotas das missões', () => {
  it('catálogo vazio: listas vazias, sem meta e sem missão do dia', async () => {
    const fan = await signUpFan(db);
    const api = apiAt();
    expect(await api('GET', '/missions', { token: fan.token })).toEqual({
      status: 200,
      body: { season: null, missions: [] },
    });
    expect((await api('GET', '/missions/daily', { token: fan.token })).body).toEqual({
      mission: null,
    });
  });
});

describe('curtir, comentar, "Eu vou" e entrar andam as missões', () => {
  it('curtir os posts da central conclui na meta e paga na mesma resposta, uma vez por período', async () => {
    const nenho = await central(env);
    const posts = [await post(env, nenho), await post(env, nenho), await post(env, nenho)];
    const other = await post(env, await central(env));
    await writeCatalog([
      mission({
        id: 'm-curtir',
        title: 'Curta 3 posts',
        target: { postId: null, artistId: nenho, eventId: null },
      }),
    ]);
    let clock = T0;
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);

    // Em outra central não conta.
    expect((await like(api, fan, other)).body).toMatchObject({ missionsChanged: false });
    expect((await like(api, fan, posts[0]!)).body).toEqual({
      pointsAwarded: 0,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: true,
    });
    // Descurtir e curtir de novo no mesmo dia não anda.
    expect((await unlike(api, fan, posts[0]!)).body).toEqual({ pointsAwarded: 0 });
    expect((await like(api, fan, posts[0]!)).body).toMatchObject({ missionsChanged: false });
    expect((await progressOf(api, fan, 'm-curtir'))!.progress.current).toBe(1);
    await like(api, fan, posts[1]!);
    const done = await like(api, fan, posts[2]!);
    expect(done.body).toMatchObject({
      pointsAwarded: 10,
      completedMissions: [
        {
          id: 'm-curtir',
          title: 'Curta 3 posts',
          rewardPoints: 10,
          completedAt: new Date(T0).toISOString(),
        },
      ],
      unlockedAchievements: [{ id: 'missao-cumprida', title: 'Missão cumprida' }],
      missionsChanged: true,
    });
    expect(await read(`wallets/${fan.uid}/ledger/mission:m-curtir:2026-10-05`)).toMatchObject({
      points: 10,
      artistId: nenho,
      subjectTitle: 'Curta 3 posts',
    });
    expect(await progressOf(api, fan, 'm-curtir')).toMatchObject({ status: 'completed' });

    // No dia seguinte, o mesmo post conta de novo, do zero.
    clock = T0 + DAY_MS;
    await unlike(api, fan, posts[0]!);
    expect((await like(api, fan, posts[0]!)).body).toMatchObject({ missionsChanged: true });
    expect(await progressOf(api, fan, 'm-curtir')).toMatchObject({
      status: 'active',
      progress: { current: 1 },
    });
  });

  it('comentar 3 vezes no mesmo post anda 1; em 3 posts conclui', async () => {
    const netto = await central(env);
    const posts = [await post(env, netto), await post(env, netto), await post(env, netto)];
    await writeCatalog([
      mission({
        id: 'm-comentar',
        title: 'Comente em 3 posts da central',
        action: 'comment',
        target: { postId: null, artistId: netto, eventId: null },
        rewardPoints: 20,
      }),
    ]);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    for (let index = 0; index < 3; index += 1) await comment(api, fan, posts[0]!);
    expect((await progressOf(api, fan, 'm-comentar'))!.progress.current).toBe(1);
    await comment(api, fan, posts[1]!);
    const third = await comment(api, fan, posts[2]!);
    // Comentar vale 2 (padrão); o terceiro post conclui e paga 20 junto.
    expect(third.body).toMatchObject({ pointsAwarded: 22, missionsChanged: true });
    expect((third.body.completedMissions as unknown[]).length).toBe(1);
  });

  it('o "Eu vou" em outro show não anda; no show alvo conclui com o "Eu vou" valendo 0, e na semana seguinte a missão some', async () => {
    const netto = await central(env);
    const target = await show(env, [netto], T0 + 40 * DAY_MS);
    const otherShow = await show(env, [netto], T0 + 41 * DAY_MS);
    await writeCatalog([
      mission({
        id: 'm-show',
        title: 'Confirme presença no show',
        action: 'rsvp',
        target: { postId: null, artistId: null, eventId: target },
        goal: 1,
        period: 'weekly',
        rewardPoints: 15,
      }),
    ]);
    let clock = T0;
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    expect((await rsvp(api, fan, otherShow)).body).toMatchObject({
      pointsAwarded: 0,
      missionsChanged: false,
      unlockedAchievements: [{ id: 'fa-de-show', title: 'Fã de show' }],
    });
    const done = await rsvp(api, fan, target);
    expect(done.body).toMatchObject({
      eventId: target,
      going: true,
      pointsAwarded: 15,
      completedMissions: [{ id: 'm-show', rewardPoints: 15 }],
      unlockedAchievements: [{ id: 'missao-cumprida', title: 'Missão cumprida' }],
    });
    // O desfazer não leva os campos de recompensa.
    clock = T0 + 7 * DAY_MS;
    expect(await progressOf(api, fan, 'm-show')).toBeUndefined();
    const other = await signUpFan(db);
    expect(await progressOf(api, other, 'm-show')).toMatchObject({ status: 'active' });
    expect(
      (await api('DELETE', `/events/${target}/rsvp`, { token: fan.token, key: key('desfaz') }))
        .body,
    ).toEqual({ eventId: target, going: false, pointsAwarded: 0 });
  });

  it('entrar numa central anda o join; sair e entrar de novo no mesmo dia não', async () => {
    const juninho = await central(env);
    await writeCatalog([
      mission({
        id: 'm-entrar',
        title: 'Entre na central do Juninho',
        action: 'join',
        target: { postId: null, artistId: juninho, eventId: null },
        goal: 1,
        rewardPoints: 5,
      }),
    ]);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    const join = () =>
      api('PUT', `/me/centrals/${juninho}`, { token: fan.token, key: key('entrar') });
    const first = await join();
    // A entrada paga 10 (padrão) e a missão 5.
    expect(first.body).toMatchObject({
      artistId: juninho,
      pointsAwarded: 15,
      missionsChanged: true,
    });
    await api('DELETE', `/me/centrals/${juninho}`, { token: fan.token, key: key('sair') });
    expect((await join()).body).toMatchObject({ pointsAwarded: 0, missionsChanged: false });
    // A missão de alvo único some para quem já está na central.
    expect(await progressOf(api, fan, 'm-entrar')).toMatchObject({ status: 'completed' });
  });

  it('a aberta de alvo único some para quem já curtiu o post ou já está na central, e volta depois de desfazer', async () => {
    const nenho = await central(env);
    const juninho = await central(env);
    const target = await post(env, nenho);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    const stranger = await signUpFan(db);
    // Antes de as missões existirem, a fã curte o post e entra na central.
    await like(api, fan, target);
    await api('PUT', `/me/centrals/${juninho}`, { token: fan.token, key: key('entrar') });
    await writeCatalog([
      mission({
        id: 'm-curtir-post',
        goal: 1,
        target: { postId: target, artistId: nenho, eventId: null },
      }),
      mission({
        id: 'm-entrar',
        action: 'join',
        goal: 1,
        target: { postId: null, artistId: juninho, eventId: null },
      }),
    ]);
    const shown = async (who: Fan) =>
      (await missionsOf(api, who)).missions.map((item) => [item.id, item.status]);

    expect(await shown(fan)).toEqual([]);
    expect(await shown(stranger)).toEqual([
      ['m-curtir-post', 'active'],
      ['m-entrar', 'active'],
    ]);
    // Descurtir (a curtida fica com `liked: false`) e sair trazem as duas de volta, abertas.
    await unlike(api, fan, target);
    await api('DELETE', `/me/centrals/${juninho}`, { token: fan.token, key: key('sair') });
    expect(await shown(fan)).toEqual([
      ['m-curtir-post', 'active'],
      ['m-entrar', 'active'],
    ]);
  });

  it('a mesma chave devolve a mesma resposta, sem contar de novo', async () => {
    const nenho = await central(env);
    const p1 = await post(env, nenho);
    await writeCatalog([
      mission({ id: 'm-curtir', target: { postId: null, artistId: nenho, eventId: null } }),
    ]);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    const first = await like(api, fan, p1, 'mesma-chave-0001');
    const again = await like(api, fan, p1, 'mesma-chave-0001');
    expect(again.body).toEqual(first.body);
    expect((await progressOf(api, fan, 'm-curtir'))!.progress.current).toBe(1);
  });

  it('duas curtidas em paralelo que fecham a meta pagam uma vez', async () => {
    const nenho = await central(env);
    const posts = await Promise.all([1, 2, 3].map(() => post(env, nenho)));
    await writeCatalog([
      mission({ id: 'm-curtir', target: { postId: null, artistId: nenho, eventId: null } }),
    ]);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    await like(api, fan, posts[0]!);
    const results = await Promise.all([like(api, fan, posts[1]!), like(api, fan, posts[2]!)]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    const paid = results.filter((result) => (result.body.pointsAwarded as number) > 0);
    expect(paid).toHaveLength(1);
    expect((await wallet(fan))?.balance).toBe(10);
    expect((await db.collection(`wallets/${fan.uid}/ledger`).get()).size).toBe(1);
  });
});

describe('períodos', () => {
  it('a virada da meia-noite zera o diário e a de segunda, o semanal', async () => {
    const nenho = await central(env);
    const posts = await Promise.all([1, 2, 3].map(() => post(env, nenho)));
    await writeCatalog([
      mission({ id: 'm-dia', target: { postId: null, artistId: nenho, eventId: null } }),
      mission({
        id: 'm-semana',
        period: 'weekly',
        goal: 10,
        target: { postId: null, artistId: nenho, eventId: null },
      }),
    ]);
    // Domingo, 11 de outubro, 23:00 de São Paulo.
    let clock = Date.parse('2026-10-12T02:00:00.000Z');
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    await like(api, fan, posts[0]!);
    expect((await missionsOf(api, fan)).missions.map((item) => item.progress.current)).toEqual([
      1, 1,
    ]);
    // Segunda, 0:30: o dia e a semana viraram.
    clock = Date.parse('2026-10-12T03:30:00.000Z');
    expect((await missionsOf(api, fan)).missions.map((item) => item.progress.current)).toEqual([
      0, 0,
    ]);
    await like(api, fan, posts[1]!);
    expect((await wallet(fan))?.missions).toMatchObject({
      daily: { key: '2026-10-12' },
      weekly: { key: '2026-W42' },
    });
  });

  it('com a ordem invertida perto da virada, o período novo fica e o tick do velho não conta', async () => {
    const nenho = await central(env);
    const posts = await Promise.all([1, 2].map(() => post(env, nenho)));
    await writeCatalog([
      mission({ id: 'm-dia', target: { postId: null, artistId: nenho, eventId: null } }),
    ]);
    const fan = await signUpFan(db);
    // O pedido de 0:00:00,010 grava antes...
    const after = Date.parse('2026-10-06T03:00:00.010Z');
    await like(
      apiAt(() => after),
      fan,
      posts[0]!,
    );
    // ...e o de 23:59:59,950 depois.
    const before = Date.parse('2026-10-06T02:59:59.950Z');
    expect(
      (
        await like(
          apiAt(() => before),
          fan,
          posts[1]!,
        )
      ).body,
    ).toMatchObject({
      missionsChanged: false,
    });
    expect((await wallet(fan))?.missions.daily).toMatchObject({
      key: '2026-10-06',
      items: { 'm-dia': { current: 1 } },
    });
  });

  it('missão em rascunho, fora da janela ou arquivada não conta', async () => {
    const nenho = await central(env);
    const p1 = await post(env, nenho);
    const target = { postId: null, artistId: nenho, eventId: null };
    await writeCatalog([
      mission({ id: 'm-rascunho', status: 'draft', target }),
      mission({ id: 'm-depois', startsAt: T0 + HOUR_MS, target }),
      mission({ id: 'm-acabou', endsAt: T0 - HOUR_MS, startsAt: T0 - DAY_MS, target }),
    ]);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    expect((await like(api, fan, p1)).body).toMatchObject({ missionsChanged: false });
    expect((await missionsOf(api, fan)).missions).toEqual([]);
  });

  it('alvo fora do ar esconde a aberta e mantém a concluída; a concluída fica depois do endsAt até o dia virar', async () => {
    const nenho = await central(env);
    const target = await post(env, nenho);
    await writeCatalog([
      mission({
        id: 'm-post',
        goal: 1,
        featured: true,
        endsAt: T0 + HOUR_MS,
        startsAt: T0 - DAY_MS,
        target: { postId: target, artistId: nenho, eventId: null },
      }),
      mission({
        id: 'm-segunda',
        featured: true,
        target: { postId: null, artistId: nenho, eventId: null },
      }),
    ]);
    let clock = T0;
    const api = apiAt(() => clock);
    const fan = await signUpFan(db);
    const watcher = await signUpFan(db);
    expect((await missionsOf(api, fan)).missions.map((item) => [item.id, item.featured])).toEqual([
      ['m-post', true],
      ['m-segunda', false],
    ]);
    await like(api, fan, target);
    await db.doc(`posts/${target}`).update({ status: 'unpublished' });
    clock = T0 + 2 * HOUR_MS;
    // Para quem concluiu, fica (e continua o destaque); para quem não, some.
    expect((await missionsOf(api, fan)).missions.map((item) => [item.id, item.featured])).toEqual([
      ['m-post', true],
      ['m-segunda', false],
    ]);
    expect(
      (await missionsOf(api, watcher)).missions.map((item) => [item.id, item.featured]),
    ).toEqual([['m-segunda', true]]);
    expect((await api('GET', '/missions/daily', { token: watcher.token })).body).toMatchObject({
      mission: { id: 'm-segunda' },
    });
  });
});

describe('convite e link andam as missões de quem convidou', () => {
  async function inviterWithCode(api: Api): Promise<{ inviter: Fan; code: string }> {
    const inviter = await signUpFan(db, 'Camila Ribeiro');
    const invite = await api('GET', '/me/invite', { token: inviter.token });
    return { inviter, code: invite.body.code as string };
  }
  const claim = (api: Api, fan: Fan, code: string, path: string | null) =>
    api('POST', '/invites/claim', {
      token: fan.token,
      key: key('claim'),
      body:
        path === null
          ? { code, via: 'code', link: null }
          : { code, via: 'link', link: { path }, openedAt: new Date().toISOString() },
    });
  const visit = (api: Api, fan: Fan, code: string, path: string) =>
    api('POST', '/invites/visit', {
      token: fan.token,
      key: key('visita'),
      body: { code, link: { path } },
    });

  it('claim e visita pelo link do post andam o share; a quinta pessoa paga 20 a quem convidou, sem central', async () => {
    const netto = await central(env);
    const clip = await post(env, netto);
    await writeCatalog([
      mission({
        id: 'm-clipe',
        title: 'Leve 5 pessoas para o clipe',
        action: 'share',
        goal: 5,
        rewardPoints: 20,
        target: { postId: clip, artistId: netto, eventId: null },
      }),
    ]);
    const api = apiAt();
    const { inviter, code } = await inviterWithCode(api);
    const people = await Promise.all([1, 2, 3, 4, 5].map(() => signUpFan(db)));
    expect((await claim(api, people[0]!, code, `/post/${clip}`)).status).toBe(200);
    for (const person of people.slice(1, 4)) await visit(api, person, code, `/post/${clip}`);
    const fifth = await visit(api, people[4]!, code, `/post/${clip}`);
    // Quem visita não ganha nada, e a resposta é sempre a mesma.
    expect(fifth.body).toEqual({ status: 'received' });
    const ledger = await read(
      `wallets/${inviter.uid}/ledger/mission:m-clipe:${dayKey(Date.now())}`,
    );
    expect(ledger).toMatchObject({
      points: 20,
      artistId: null,
      subjectTitle: 'Leve 5 pessoas para o clipe',
    });
    // Visitar de novo não conta (o marcador da pessoa já existe).
    await visit(api, people[1]!, code, `/post/${clip}`);
    expect((await wallet(inviter))?.missions.daily.items['m-clipe'].current).toBe(5);
    // O "Boca a boca" veio com a primeira pessoa pelo link.
    expect((await wallet(inviter))?.achievements).toHaveProperty('boca-a-boca');
  });

  it('o link de um post do Netto anda a missão de link com a central do Netto como alvo', async () => {
    const netto = await central(env);
    const p1 = await post(env, netto);
    await writeCatalog([
      mission({
        id: 'm-link-netto',
        action: 'share',
        goal: 3,
        target: { postId: null, artistId: netto, eventId: null },
      }),
    ]);
    const api = apiAt();
    const { inviter, code } = await inviterWithCode(api);
    await visit(api, await signUpFan(db), code, `/post/${p1}`);
    await visit(api, await signUpFan(db), code, `/artista/${netto}`);
    await visit(api, await signUpFan(db), code, '/agenda');
    expect((await wallet(inviter))?.missions.daily.items['m-link-netto'].current).toBe(2);
  });

  it('o link de um post com id reservado (__x__) não derruba o claim nem a visita', async () => {
    const netto = await central(env);
    // A missão de link com central no ar faz o claim e a visita lerem o post.
    await writeCatalog([
      mission({
        id: 'm-link-netto',
        action: 'share',
        goal: 3,
        target: { postId: null, artistId: netto, eventId: null },
      }),
    ]);
    const api = apiAt();
    const { inviter, code } = await inviterWithCode(api);
    expect(await visit(api, await signUpFan(db), code, '/post/__x__')).toEqual({
      status: 200,
      body: { status: 'received' },
    });
    expect(await claim(api, await signUpFan(db), code, '/post/__x__')).toEqual({
      status: 200,
      body: { status: 'claimed' },
    });
    // O link vira `other`: a pessoa conta para o convite, não para a missão da central.
    expect((await wallet(inviter))?.missions?.daily?.items?.['m-link-netto']).toBeUndefined();
  });

  it('o código digitado anda só o invite; quem visitou antes e se cadastra depois anda o invite', async () => {
    await writeCatalog([
      mission({ id: 'm-amigos', action: 'invite', goal: 3, period: 'weekly' }),
      mission({ id: 'm-link', action: 'share', goal: 3 }),
    ]);
    const api = apiAt();
    const { inviter, code } = await inviterWithCode(api);
    await claim(api, await signUpFan(db), code, null);
    const visitor = await signUpFan(db);
    await visit(api, visitor, code, '/');
    let state = (await wallet(inviter))?.missions;
    expect(state.weekly.items['m-amigos'].current).toBe(1);
    expect(state.daily.items['m-link'].current).toBe(1);
    await claim(api, visitor, code, '/');
    state = (await wallet(inviter))?.missions;
    expect(state.weekly.items['m-amigos'].current).toBe(2);
    expect(state.daily.items['m-link'].current).toBe(1);
    expect(
      await read(
        `fanInvites/${inviter.uid}/inviteVisitors/${personKey(visitor.email, visitor.uid, EMULATOR_INVITE_KEY)}`,
      ),
    ).toMatchObject({ via: 'visit', signupAt: expect.any(Timestamp) });
  });

  it('a conta recriada com o mesmo e-mail não anda o invite de novo, também com o cadastro valendo 0', async () => {
    await writePoints({ values: { invite_signup: 0, invite_visit: 0 } });
    await writeCatalog([mission({ id: 'm-amigos', action: 'invite', goal: 3, period: 'weekly' })]);
    const api = apiAt();
    const { inviter, code } = await inviterWithCode(api);
    const person = await signUpFan(db);
    await claim(api, person, code, null);
    await deleteUserData(db, person.uid);
    await env.auth.deleteUser(person.uid);
    const again = await signUpFan(db, 'Fã de Teste', person.email);
    expect((await claim(api, again, code, null)).body).toEqual({ status: 'claimed' });
    expect((await wallet(inviter))?.missions.weekly.items['m-amigos'].current).toBe(1);
  });
});

describe('meta da temporada', () => {
  it('por missões e por pontos, com a marca, a consulta e o texto do prêmio; sem temporada, null', async () => {
    const nenho = await central(env);
    const posts = await Promise.all([1, 2, 3].map(() => post(env, nenho)));
    await writeSeason('temporada-teste', T0 - 10 * DAY_MS, T0 + 10 * DAY_MS);
    const goal: SeasonGoalConfig = {
      seasonId: 'temporada-teste',
      title: 'Semana do arrocha',
      description: 'Complete 1 missão.',
      reachedDescription: 'Meta cumprida: lote garantido.',
      metric: 'missions',
      target: 1,
    };
    await writeCatalog(
      [
        mission({
          id: 'm-curtir',
          goal: 1,
          target: { postId: null, artistId: nenho, eventId: null },
        }),
      ],
      goal,
    );
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    expect((await missionsOf(api, fan)).season).toMatchObject({
      id: 'temporada-teste',
      completedCount: 0,
      targetCount: 1,
      description: 'Complete 1 missão.',
      metric: 'missions',
    });
    await like(api, fan, posts[0]!);
    expect((await missionsOf(api, fan)).season).toMatchObject({
      completedCount: 1,
      description: 'Meta cumprida: lote garantido.',
    });
    expect((await wallet(fan))?.goalReached).toEqual({
      seasonId: 'temporada-teste',
      at: Timestamp.fromMillis(T0),
    });
    const winners = await db
      .collection('wallets')
      .where('goalReached.seasonId', '==', 'temporada-teste')
      .get();
    expect(winners.docs.map((doc) => doc.id)).toEqual([fan.uid]);

    // Por pontos: os pontos da temporada.
    await writePoints({ values: { like: 7 } });
    await writeCatalog([], { ...goal, metric: 'points', target: 5, reachedDescription: null });
    const other = await signUpFan(db);
    await like(api, other, posts[1]!);
    expect((await missionsOf(api, other)).season).toMatchObject({
      completedCount: 7,
      targetCount: 5,
      metric: 'points',
      description: 'Complete 1 missão.',
    });
    expect((await wallet(other))?.goalReached).toMatchObject({ seasonId: 'temporada-teste' });
    // Com a meta já cumprida e nenhuma missão no catálogo, a curtida seguinte
    // não conta unidade, mas o anel da 1g é dos pontos da temporada: a
    // resposta manda o app buscar as missões de novo.
    expect((await like(api, other, posts[2]!)).body).toMatchObject({
      pointsAwarded: 7,
      completedMissions: [],
      missionsChanged: true,
    });
    expect((await missionsOf(api, other)).season).toMatchObject({ completedCount: 14 });

    // Sem temporada ativa, o card some.
    await db.doc('config/season').delete();
    expect((await missionsOf(api, other)).season).toBeNull();
  });
});

describe('conquistas e nível', () => {
  it('um lançamento que cruza o nível 8 manda levelUp e destrava Backstage; os de baixo entram sem anúncio', async () => {
    const netto = await central(env);
    const p1 = await post(env, netto);
    const fan = await signUpFan(db);
    await runAward(
      db,
      fan.uid,
      [{ kind: 'adjust', source: 'seed', eventId: 'base', xp: 14_990, balance: 14_990 }],
      {
        now: T0 - DAY_MS,
        config: DEFAULT_POINTS_CONFIG,
        actor: SEED_ACTOR,
      },
    );
    await writePoints({ values: { comment: 20 } });
    const api = apiAt(() => T0);
    const result = await comment(api, fan, p1);
    expect(result.body).toMatchObject({
      pointsAwarded: 20,
      levelUp: { number: 8, name: 'Xodó', minXp: 15_000 },
      unlockedAchievements: [
        { id: 'puxa-conversa', title: 'Puxa conversa' },
        { id: 'backstage', title: 'Backstage' },
      ],
    });
    const achievements = await api('GET', '/me/achievements', { token: fan.token });
    // De 10: o Top 20 está no ar desde o bloco 8 (23.9).
    expect(achievements.body).toMatchObject({ unlockedCount: 5, totalCount: 10 });
    // As de nível que já valiam entram com a data da carteira lida (o seed, ontem).
    expect(((await wallet(fan))?.achievements['pe-de-serra'] as Timestamp).toMillis()).toBe(
      T0 - DAY_MS,
    );
  });

  it('baixar o minXp do nível 8 mostra Backstage na hora e a ação seguinte grava com a mesma data, sem anúncio', async () => {
    const netto = await central(env);
    const posts = await Promise.all([1, 2].map(() => post(env, netto)));
    const fan = await signUpFan(db);
    const api = apiAt(() => T0);
    await runAward(db, fan.uid, [{ kind: 'adjust', source: 'seed', eventId: 'base', xp: 12_480 }], {
      now: T0 - DAY_MS,
      config: DEFAULT_POINTS_CONFIG,
      actor: SEED_ACTOR,
    });
    const updatedAt = ((await wallet(fan))?.updatedAt as Timestamp).toMillis();
    const levels = DEFAULT_POINTS_CONFIG.levels.map((level) =>
      level.number === 8 ? { ...level, minXp: 12_000 } : level,
    );
    await writePoints({ levels });
    const view = await api('GET', '/me/achievements', { token: fan.token });
    const highlights = view.body.highlights as { id: string; unlockedAt: string | null }[];
    expect(highlights[0]).toMatchObject({
      id: 'backstage',
      unlockedAt: new Date(updatedAt).toISOString(),
    });
    const next = await like(api, fan, posts[0]!);
    expect(next.body).toMatchObject({ levelUp: null, unlockedAchievements: [] });
    expect(((await wallet(fan))?.achievements.backstage as Timestamp).toMillis()).toBe(updatedAt);
  });
});

describe('extrato', () => {
  it('cada linha com o nome da central e o título da missão; central apagada é null; o título fica depois de mudar e arquivar', async () => {
    const nenho = await central(env, { name: 'Nenho' });
    const gone = await central(env, { name: 'Vai sumir' });
    const p1 = await post(env, nenho);
    const p2 = await post(env, gone);
    await writeCatalog([
      mission({
        id: 'm-curtir',
        title: 'Curta 1 post do Nenho',
        goal: 1,
        target: { postId: null, artistId: nenho, eventId: null },
      }),
    ]);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    await like(api, fan, p1);
    await comment(api, fan, p2);
    await db.doc(`artists/${gone}`).delete();
    await writeCatalog([]);
    const page = await api('GET', '/me/ledger', { token: fan.token, query: { limit: '50' } });
    const items = page.body.items as {
      id: string;
      source: string;
      artistName: string | null;
      subjectTitle: string | null;
    }[];
    expect(items.find((item) => item.source === 'mission')).toMatchObject({
      artistName: 'Nenho',
      subjectTitle: 'Curta 1 post do Nenho',
    });
    expect(items.find((item) => item.source === 'comment')).toMatchObject({
      artistName: null,
      subjectTitle: null,
    });
  });
});

describe('exclusão de conta', () => {
  it('depois do deleteUserData, as rotas de leitura respondem tudo em 0', async () => {
    const nenho = await central(env);
    const p1 = await post(env, nenho);
    await writeCatalog([
      mission({
        id: 'm-curtir',
        goal: 1,
        target: { postId: null, artistId: nenho, eventId: null },
      }),
    ]);
    const api = apiAt(() => T0);
    const fan = await signUpFan(db);
    await like(api, fan, p1);
    expect(await exists(`wallets/${fan.uid}`)).toBe(true);
    await deleteUserData(db, fan.uid);
    expect(await exists(`wallets/${fan.uid}`)).toBe(false);
    expect((await missionsOf(api, fan)).missions[0]).toMatchObject({
      status: 'active',
      progress: { current: 0 },
    });
    expect((await api('GET', '/me/achievements', { token: fan.token })).body).toMatchObject({
      unlockedCount: 0,
    });
  });
});

describe('seed das missões (22.13)', () => {
  it('a Camila do protótipo: 3 de 5, 2 de 5, 1 de 3, a meta em 12 de 20 e 5 de 10 conquistas; rodar de novo não muda nada', async () => {
    await seedCentrals(db);
    await seedEvents(db);
    await seedPosts(db);
    const camila = await signUpFan(db, 'Camila Ribeiro', 'camila@teste.imagineup');
    await seedCamilaWallet(db, camila.uid);
    await seedCamilaCentrals(db, camila.uid);
    await seedCamilaInvite(db, { uid: camila.uid, email: camila.email });
    const fans: Record<string, Fan> = {};
    for (const { email } of SEED_INVITEES) fans[email] = await signUpFan(db, 'Fã de Teste', email);
    for (const email of SEED_VISITORS) fans[email] = await signUpFan(db, 'Fã de Teste', email);
    const origin = (email: string) => ({
      ...fans[email]!,
      origin: SEED_INVITEES.find((item) => item.email === email)!.origin,
    });

    const seed = async () => {
      await seedInviteClaims(db, [origin('duda@teste.imagineup'), origin('enzo@teste.imagineup')]);
      await seedMissionsCatalog(db);
      await seedInviteClaims(db, [origin('bia@teste.imagineup')]);
      await seedInviteVisits(
        db,
        SEED_VISITORS.map((email) => fans[email]!),
      );
      await seedCamilaLikes(db, camila.uid);
    };
    await seed();
    // O "Eu vou" da Duda no São João (o engajamento dos fãs de teste, sem o jogo).
    await seedEngagement(db, { duda: fans['duda@teste.imagineup']!.uid });

    const api = apiAt();
    const list = await missionsOf(api, camila);
    expect(list.season).toMatchObject({
      id: 'temporada-sao-joao',
      title: 'Semana do arrocha',
      completedCount: 12,
      targetCount: 20,
    });
    expect(
      list.missions.map((item) => [item.id, item.progress.current, item.status, item.featured]),
    ).toEqual([
      ['m-clipe-netto', 3, 'active', true],
      ['m-curtir-nenho', 2, 'active', false],
      ['m-comentar-central', 0, 'active', false],
      ['m-trazer-amigos', 1, 'active', false],
      ['m-presenca-show', 0, 'active', false],
    ]);
    expect((await api('GET', '/missions/daily', { token: camila.token })).body).toMatchObject({
      mission: { id: 'm-clipe-netto', progress: { current: 3, target: 5 }, rewardPoints: 20 },
    });
    const achievements = (await api('GET', '/me/achievements', { token: camila.token })).body as {
      unlockedCount: number;
      totalCount: number;
      highlights: { id: string }[];
    };
    // O Top 20 dela vem do retrato da semana, no seed inteiro (23.15); aqui, 5 de 10.
    expect(achievements.unlockedCount).toBe(5);
    expect(achievements.totalCount).toBe(10);
    expect(achievements.highlights.map((item) => item.id)).toEqual([
      'boca-a-boca',
      'purainha',
      'sanfona',
      'backstage',
    ]);
    const before = await wallet(camila);
    expect(before).toMatchObject({
      balance: 12_480,
      xp: 12_480,
      seasonPoints: 4_120,
      seasonMissions: 12,
    });
    const ledger = await db.collection(`wallets/${camila.uid}/ledger`).get();
    expect(ledger.size).toBe(15);
    expect(
      ledger.docs
        .filter((doc) => doc.get('source') === 'mission')
        .every((doc) => doc.get('subjectTitle')),
    ).toBe(true);
    // A Duda, que já vai ao São João, não vê a missão de presença.
    expect(
      (await missionsOf(api, fans['duda@teste.imagineup']!)).missions.map((item) => item.id),
    ).not.toContain('m-presenca-show');
    // O Alan e a Gabi só visitaram: sem carteira.
    for (const email of SEED_VISITORS)
      expect(await exists(`wallets/${fans[email]!.uid}`)).toBe(false);
    expect(CAMILA_CENTRALS).toContain('nenho');
    expect(CAMILA_INVITE_CODE).toBe('CAMILA12');

    // Rodar de novo não muda nada.
    await seed();
    expect(await wallet(camila)).toEqual(before);
  });
});
