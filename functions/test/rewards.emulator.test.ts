import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { seedEvents } from '../src/agenda';
import type { ApiRoute } from '../src/api';
import { seedCentrals } from '../src/centrals';
import {
  createConfigSource,
  dayKey,
  DEFAULT_POINTS_CONFIG,
  runAward,
  SEED_ACTOR,
  seedCamilaWallet,
  shiftDay,
  staticConfigSource,
} from '../src/points';
import {
  cancelFanRedemptions,
  eveningDaysAgo,
  newRewardDoc,
  REDEMPTION_CODE_PATTERN,
  redeemReward,
  runRedeemReward,
  runRedemptionStatus,
  SEED_REWARDS,
  seedCamilaRedemptions,
  seedRewards,
} from '../src/rewards';
import type { RewardFields } from '../src/rewards/model';
import { deleteUserData } from '../src/store';
import {
  callable,
  http,
  localApi,
  seedMember,
  show,
  signIn,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
  type Fan,
  type HttpResult,
  type Member,
} from './support';

/**
 * A loja e o resgate do bloco 10 nos emuladores (docs/arquitetura-api.md,
 * 25.14): a `api` de verdade pelo HTTP do emulador, com o ID token do Auth, e
 * o handler no processo quando o teste precisa do relógio ou dos tetos fixos;
 * a recusa pela callable setRedemptionStatus, como o painel chama; a exclusão
 * de conta pelo deleteUserData; e o seed inteiro.
 */
const env = useEmulators('loja', ['api', 'createUserProfile', 'setRedemptionStatus']);
const { db, auth } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type RewardExtra = Partial<RewardFields> & {
  status?: 'draft' | 'published' | 'closed';
  order?: number;
  redeemedCount?: number;
};

/** Recompensa gravada direto, no formato das callables (no ar por padrão). */
async function reward(extra: RewardExtra = {}, id: string = unique('recompensa')): Promise<string> {
  const { status = 'published', order = 1, redeemedCount, ...fields } = extra;
  const doc = newRewardDoc(
    {
      kind: 'ticket',
      title: `Recompensa ${id}`,
      subtitle: 'Subtítulo',
      description: null,
      cost: 1_000,
      featured: false,
      scarcity: false,
      stockTotal: null,
      perFanLimit: null,
      eventId: null,
      instructions: 'Retire com este código.',
      ...fields,
    },
    { order, status: status === 'closed' ? 'published' : status, now: Date.now(), by: 'teste' },
  );
  await db.doc(`rewards/${id}`).set({
    ...doc,
    ...(status === 'closed' ? { status: 'closed', closedAt: Timestamp.now() } : {}),
    ...(redeemedCount !== undefined ? { redeemedCount } : {}),
  });
  return id;
}

/** A temporada que vale agora, para conferir que o resgate não mexe nela. */
async function seasonNow(): Promise<void> {
  await db.doc('config/season').set({
    version: 1,
    season: {
      id: 'temporada-teste',
      name: 'Temporada de teste',
      startsAt: Timestamp.fromMillis(Date.now() - 10 * DAY_MS),
      endsAt: Timestamp.fromMillis(Date.now() + 10 * DAY_MS),
      leaderTitle: null,
    },
  });
}

/** Saldo (e, se pedir, XP, temporada e uma central) pelo núcleo, como o seed. */
async function fund(
  fan: Fan,
  balance: number,
  extra: { xp?: number; season?: number; central?: string } = {},
): Promise<void> {
  const { points } = await createConfigSource(db, { ttlMs: 0 }).get();
  await runAward(
    db,
    fan.uid,
    [
      {
        kind: 'adjust',
        source: 'seed',
        eventId: unique('saldo-'),
        balance,
        ...(extra.xp ? { xp: extra.xp } : {}),
        ...(extra.season ? { season: extra.season } : {}),
        ...(extra.central ? { central: { artistId: extra.central, total: 100, season: 100 } } : {}),
      },
    ],
    { now: Date.now(), config: points, actor: SEED_ACTOR },
  );
}

const redeem = (fan: { token: string }, rewardId: string, cost: number, key = unique('resgate-')) =>
  http(env, `/rewards/${rewardId}/redeem`, {
    method: 'POST',
    token: fan.token,
    key,
    body: { expectedCost: cost },
  });

type ShopReward = {
  id: string;
  status: string;
  featured: boolean;
  stock: { total: number; remaining: number } | null;
  event: { name: string; startsAt: string } | null;
  limitReached: boolean;
  perFanLimit: number | null;
  redemptions: {
    code: string;
    status: string;
    refundedPoints: number;
    refusalReason: string | null;
    instructions: string;
  }[];
};

async function shop(fan: { token: string }) {
  const response = await http(env, '/rewards', { token: fan.token });
  expect(response.status).toBe(200);
  return response.body as { rulesUrl: string | null; rewards: ShopReward[] };
}

const byId = (rewards: ShopReward[], id: string) => rewards.find((item) => item.id === id);

/** Repete o mesmo pedido enquanto a disputa sobrar das tentativas (503), como o app faz. */
async function settle(run: () => Promise<HttpResult>): Promise<HttpResult> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await run();
    if (result.status !== 503) return result;
  }
  throw new Error('A disputa não assentou em 10 tentativas.');
}

async function redemptionsOf(rewardId: string) {
  const snap = await db.collection('redemptions').where('rewardId', '==', rewardId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function ledgerIds(uid: string): Promise<string[]> {
  return (await db.collection(`wallets/${uid}/ledger`).get()).docs.map((doc) => doc.id).sort();
}

async function setStatus(member: Member, data: Record<string, unknown>) {
  return callable<{ ok: true; status: string; refundedPoints: number }>(
    env,
    'setRedemptionStatus',
    data,
    member.token,
  );
}

describe('a loja (GET /rewards)', () => {
  it('a ordem do painel, sem rascunho, com o esgotado, o show aberto e o regulamento', async () => {
    const fan = await signUpFan(db);
    const event = await show(env, ['nettobrito'], Date.now() + 20 * DAY_MS);
    const past = await show(env, ['nettobrito'], Date.now() - 2 * DAY_MS);
    const off = await show(env, ['nettobrito'], Date.now() + 5 * DAY_MS, {
      status: 'unpublished',
    });
    const second = await reward({ order: 2, featured: true });
    const first = await reward({ order: 1, eventId: event, stockTotal: 20, scarcity: true });
    await reward({ order: 0, status: 'draft' });
    const empty = await reward({ order: 3, stockTotal: 2, redeemedCount: 2 });
    const pastShow = await reward({ order: 4, eventId: past });
    const offShow = await reward({ order: 5, eventId: off });
    const closed = await reward({ order: 6, status: 'closed' });

    const body = await shop(fan);
    expect(body.rulesUrl).toBeNull();
    expect(body.rewards.map((item) => item.id)).toEqual([first, second, empty, pastShow, offShow]);
    expect(byId(body.rewards, first)).toMatchObject({
      status: 'available',
      stock: { total: 20, remaining: 20 },
      event: { name: `Show ${event}` },
      limitReached: false,
      redemptions: [],
    });
    expect(byId(body.rewards, second)).toMatchObject({ featured: true, status: 'available' });
    expect(byId(body.rewards, empty)).toMatchObject({
      status: 'soldOut',
      stock: { total: 2, remaining: 0 },
    });
    // O show que passou e o fora do ar esgotam a recompensa, sem o show.
    expect(byId(body.rewards, pastShow)).toMatchObject({ status: 'soldOut', event: null });
    expect(byId(body.rewards, offShow)).toMatchObject({ status: 'soldOut', event: null });
    expect(byId(body.rewards, closed)).toBeUndefined();
  });

  it('a encerrada só para quem tem pedido, como esgotada; os pedidos só de quem chama', async () => {
    const [camila, alan] = [await signUpFan(db, 'Camila Ribeiro'), await signUpFan(db, 'Alan')];
    await fund(camila, 10_000);
    await fund(alan, 10_000);
    const id = await reward({ cost: 1_000, perFanLimit: 1, featured: true });
    expect((await redeem(camila, id, 1_000)).status).toBe(200);
    expect((await redeem(alan, id, 1_000)).status).toBe(200);
    await db.doc(`rewards/${id}`).update({ status: 'closed', closedAt: Timestamp.now() });

    const mine = byId((await shop(camila)).rewards, id)!;
    expect(mine).toMatchObject({ status: 'soldOut', featured: false, limitReached: true });
    expect(mine.redemptions).toHaveLength(1);
    expect(mine.redemptions[0]!.code).toMatch(REDEMPTION_CODE_PATTERN);
    const alanCode = byId((await shop(alan)).rewards, id)!.redemptions[0]!.code;
    expect(alanCode).not.toBe(mine.redemptions[0]!.code);

    const other = await signUpFan(db);
    expect(byId((await shop(other)).rewards, id)).toBeUndefined();
  });
});

describe('o resgate (POST /rewards/:id/redeem)', () => {
  it('o pedido, o estoque, só o saldo, o extrato com o título, o shard e a resposta', async () => {
    await seasonNow();
    const fan = await signUpFan(db, 'Camila Ribeiro');
    await fund(fan, 12_480, { xp: 12_480, season: 4_120, central: 'nettobrito' });
    const before = await read(`wallets/${fan.uid}`);
    const central = await read(`wallets/${fan.uid}/centralPoints/nettobrito`);
    const id = await reward({
      title: 'Par de ingressos',
      kind: 'ticket',
      cost: 6_000,
      stockTotal: 5,
      perFanLimit: 2,
      instructions: 'Retire na bilheteria.',
    });
    const started = Date.now();

    const response = await redeem(fan, id, 6_000);
    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body).toEqual({
      redemptionId: expect.stringMatching(REDEMPTION_CODE_PATTERN),
      rewardId: id,
      code: body.redemptionId,
      balance: 6_480,
      instructions: 'Retire na bilheteria.',
      redeemedAt: expect.any(String),
      status: 'requested',
    });
    const code = body.code as string;

    expect(await read(`redemptions/${code}`)).toMatchObject({
      code,
      rewardId: id,
      rewardTitle: 'Par de ingressos',
      rewardKind: 'ticket',
      points: 6_000,
      uid: fan.uid,
      fanName: 'Camila Ribeiro',
      fanUsername: expect.any(String),
      status: 'requested',
      instructions: 'Retire na bilheteria.',
      refusalReason: null,
      refundedPoints: 0,
      updatedBy: null,
      accountDeleted: false,
    });
    expect((await read(`rewards/${id}`))!.redeemedCount).toBe(1);
    expect((await read(`rewards/${id}`))!.updatedAt).toEqual(
      (await read(`rewards/${id}`))!.createdAt,
    );
    const after = await read(`wallets/${fan.uid}`);
    expect(after).toMatchObject({
      balance: 6_480,
      xp: before!.xp,
      seasonPoints: before!.seasonPoints,
      spentTotal: 6_000,
    });
    expect(await read(`wallets/${fan.uid}/centralPoints/nettobrito`)).toMatchObject({
      totalPoints: central!.totalPoints,
      seasonPoints: central!.seasonPoints,
    });
    expect(await read(`wallets/${fan.uid}/ledger/redeem:${code}`)).toMatchObject({
      kind: 'spend',
      source: 'redeem',
      points: -6_000,
      xpDelta: 0,
      seasonDelta: 0,
      subject: { type: 'reward', id },
      subjectTitle: 'Par de ingressos',
    });
    const days = [dayKey(started), dayKey(Date.now())];
    expect(await statsSum(db, days, (data) => data.totals?.spent ?? 0)).toBe(6_000);
    expect(await statsSum(db, days, (data) => data.totals?.redeemRequested ?? 0)).toBe(1);
    expect(await statsSum(db, days, (data) => data.byReward?.[id]?.spent ?? 0)).toBe(6_000);
    expect(await statsSum(db, days, (data) => data.byReward?.[id]?.requested ?? 0)).toBe(1);
    // O teto do dia conta o resgate que gravou.
    expect(after!.days[dayKey(Date.now())].count.reward_redeem).toBe(1);

    // O extrato pela API leva o título no subjectTitle.
    const ledger = await http(env, '/me/ledger', { token: fan.token });
    expect(ledger.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `redeem:${code}`, subjectTitle: 'Par de ingressos' }),
      ]),
    );
  });

  it('a mesma chave devolve a mesma resposta, também em paralelo; com outro custo é 422', async () => {
    const fan = await signUpFan(db);
    await fund(fan, 50_000);
    const id = await reward({ cost: 1_000, perFanLimit: null });
    const key = unique('mesma-chave-');
    const [a, b] = await Promise.all([
      settle(() => redeem(fan, id, 1_000, key)),
      settle(() => redeem(fan, id, 1_000, key)),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body).toEqual(b.body);
    const again = await redeem(fan, id, 1_000, key);
    expect(again.status).toBe(200);
    expect(again.headers.get('Idempotency-Replayed')).toBe('true');
    expect(again.body).toEqual(a.body);
    expect(await redemptionsOf(id)).toHaveLength(1);
    expect((await read(`wallets/${fan.uid}`))!.balance).toBe(49_000);

    const reused = await redeem(fan, id, 2_000, key);
    expect(reused).toMatchObject({ status: 422, body: { code: 'idempotency_key_reused' } });
  });

  it('o mesmo fã com duas chaves: dois pedidos sem limite; com limite 1, um só, também em paralelo', async () => {
    const fan = await signUpFan(db);
    await fund(fan, 50_000);
    const free = await reward({ cost: 1_000, perFanLimit: null });
    expect((await redeem(fan, free, 1_000)).status).toBe(200);
    expect((await redeem(fan, free, 1_000)).status).toBe(200);
    expect(await redemptionsOf(free)).toHaveLength(2);
    expect((await read(`rewards/${free}`))!.redeemedCount).toBe(2);

    const once = await reward({ cost: 1_000, perFanLimit: 1 });
    const results = await Promise.all([
      settle(() => redeem(fan, once, 1_000, 'limite-chave-a')),
      settle(() => redeem(fan, once, 1_000, 'limite-chave-b')),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(results.find((item) => item.status === 409)!.body).toMatchObject({
      code: 'redeem_limit_reached',
      details: { limit: 1 },
    });
    expect(await redemptionsOf(once)).toHaveLength(1);
    expect((await read(`wallets/${fan.uid}`))!.balance).toBe(47_000);
  });

  it('saldo curto: 409 com o saldo e o custo, sem pedido, estoque, lançamento nem chave', async () => {
    const fan = await signUpFan(db);
    await fund(fan, 500);
    const id = await reward({ cost: 1_000, stockTotal: 3 });
    const key = unique('chave-curto-');
    expect(await redeem(fan, id, 1_000, key)).toMatchObject({
      status: 409,
      body: { code: 'insufficient_points', details: { balance: 500, cost: 1_000 } },
    });
    expect(await redemptionsOf(id)).toHaveLength(0);
    expect((await read(`rewards/${id}`))!.redeemedCount).toBe(0);
    expect((await ledgerIds(fan.uid)).filter((item) => item.startsWith('redeem:'))).toEqual([]);
    expect((await db.collection('idempotency').where('uid', '==', fan.uid).get()).size).toBe(0);
  });

  it('sem vaga, encerrada e show fechado dão sold_out; rascunho e id que não existe, 404; custo mudado, 409', async () => {
    const fan = await signUpFan(db);
    await fund(fan, 50_000);
    const yesterday = await show(env, ['nenho'], Date.now() - 2 * DAY_MS);
    const off = await show(env, ['nenho'], Date.now() + 3 * DAY_MS, { status: 'unpublished' });
    const cases: [string, Record<string, unknown>][] = [
      [
        await reward({ stockTotal: 1, redeemedCount: 1 }),
        { code: 'sold_out', details: { reason: 'stock' } },
      ],
      [await reward({ status: 'closed' }), { code: 'sold_out', details: { reason: 'closed' } }],
      [await reward({ eventId: yesterday }), { code: 'sold_out', details: { reason: 'event' } }],
      [await reward({ eventId: off }), { code: 'sold_out', details: { reason: 'event' } }],
    ];
    for (const [id, body] of cases) {
      expect(await redeem(fan, id, 1_000)).toMatchObject({ status: 409, body });
    }
    expect(await redeem(fan, await reward({ status: 'draft' }), 1_000)).toMatchObject({
      status: 404,
      body: { code: 'reward_not_found' },
    });
    expect(await redeem(fan, 'nao-existe', 1_000)).toMatchObject({
      status: 404,
      body: { code: 'reward_not_found' },
    });
    expect(await redeem(fan, await reward({ cost: 2_000 }), 1_000)).toMatchObject({
      status: 409,
      body: { code: 'reward_changed', details: { cost: 2_000 } },
    });
    expect((await read(`wallets/${fan.uid}`))!.balance).toBe(50_000);
  });

  it('o teto do dia: 429 com o Retry-After, antes de tudo do resgate, sem gravar', async () => {
    const fan = await signUpFan(db);
    await fund(fan, 50_000);
    const id = await reward({ cost: 100, perFanLimit: null });
    const call = localApi(env, {
      now: () => Date.now(),
      config: staticConfigSource({
        points: {
          ...DEFAULT_POINTS_CONFIG,
          actionCaps: { ...DEFAULT_POINTS_CONFIG.actionCaps, reward_redeem: 2 },
        },
      }),
    });
    const post = (rewardId: string) =>
      call('POST', `/rewards/${rewardId}/redeem`, {
        token: fan.token,
        key: unique('chave-teto-'),
        body: { expectedCost: 100 },
      });
    expect((await post(id)).status).toBe(200);
    expect((await post(id)).status).toBe(200);
    const third = await post(id);
    expect(third).toMatchObject({
      status: 429,
      body: { code: 'too_many_requests', details: { limit: 2, action: 'redeem' } },
    });
    // No teto, a recompensa que não existe também é 429: o teto vem antes de ler.
    expect(await post('nao-existe')).toMatchObject({ status: 429 });
    expect(await redemptionsOf(id)).toHaveLength(2);
  });

  it('a colisão do código roda o pedido de novo uma vez, com o sorteio seguinte, e debita uma vez', async () => {
    const fan = await signUpFan(db);
    await fund(fan, 10_000);
    const id = await reward({ cost: 1_000, perFanLimit: null });
    const taken = await reward({ cost: 1_000, perFanLimit: null });
    expect((await redeem(fan, taken, 1_000)).status).toBe(200);
    const [existing] = await redemptionsOf(taken);
    const codes = [existing!.id, 'UP-BBBBBB'];
    let draws = 0;
    const route: ApiRoute = {
      method: 'POST',
      pattern: '/teste/colisao/:rewardId',
      writes: true,
      async handle(ctx) {
        const { plan, result } = await redeemReward(ctx.tx, ctx.deps.db, {
          fan: ctx.fan,
          award: ctx.award,
          rewardId: ctx.params.rewardId!,
          expectedCost: 1_000,
          profile: ctx.profile,
          drawCode: () => codes[Math.min(draws++, codes.length - 1)]!,
        });
        return { body: result, plan };
      },
    };
    const call = localApi(env, { now: () => Date.now(), routes: [route] });
    const response = await call('POST', `/teste/colisao/${id}`, {
      token: fan.token,
      key: unique('colisao-'),
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ code: 'UP-BBBBBB', balance: 8_000 });
    expect(draws).toBe(2);
    expect((await read(`redemptions/${existing!.id}`))!.rewardId).toBe(taken);
    expect((await redemptionsOf(id)).map((item) => item.id)).toEqual(['UP-BBBBBB']);
    expect((await read(`wallets/${fan.uid}`))!.balance).toBe(8_000);
  });

  it('perfil ausente: 503; conta só da equipe: 403; nada gravado', async () => {
    const id = await reward({ cost: 100 });
    const fan = await signUpFan(db);
    await fund(fan, 1_000);
    await db.doc(`users/${fan.uid}`).delete();
    expect(await redeem(fan, id, 100)).toMatchObject({
      status: 503,
      body: { code: 'profile_not_ready' },
    });
    const uid = unique('equipe');
    await db
      .doc(`staff/${uid}`)
      .set({ uid, role: 'viewer', status: 'active', accountCreatedByInvite: true });
    await auth.createUser({ uid, email: `${uid}@teste.dev`, password: 'senha-da-equipe' });
    const token = await signIn(`${uid}@teste.dev`, 'senha-da-equipe');
    expect(await redeem({ token }, id, 100)).toMatchObject({
      status: 403,
      body: { code: 'not_fan' },
    });
    expect(await redemptionsOf(id)).toHaveLength(0);
  });
});

describe('a disputa pelo estoque (25.6)', () => {
  it('dois fãs pelo último item: um pedido, um sold_out, um débito', async () => {
    const [a, b] = await Promise.all([signUpFan(db), signUpFan(db)]);
    await Promise.all([fund(a, 5_000), fund(b, 5_000)]);
    const id = await reward({ cost: 1_000, stockTotal: 1, perFanLimit: 1 });
    const results = await Promise.all(
      [a, b].map((fan) => {
        const key = unique('chave-ultimo-');
        return settle(() => redeem(fan, id, 1_000, key));
      }),
    );
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(results.find((item) => item.status === 409)!.body).toMatchObject({
      code: 'sold_out',
      details: { reason: 'stock' },
    });
    expect((await read(`rewards/${id}`))!.redeemedCount).toBe(1);
    const balances = [
      (await read(`wallets/${a.uid}`))!.balance,
      (await read(`wallets/${b.uid}`))!.balance,
    ].sort();
    expect(balances).toEqual([4_000, 5_000]);
  });

  it('dez fãs por 3 vagas: 3 pedidos, nunca 4, e a contagem igual aos pedidos', async () => {
    const fans = await Promise.all(Array.from({ length: 10 }, () => signUpFan(db)));
    await Promise.all(fans.map((fan) => fund(fan, 5_000)));
    const id = await reward({ cost: 1_000, stockTotal: 3, perFanLimit: 1 });
    const results = await Promise.all(
      fans.map((fan) => {
        const key = unique('disputa-');
        return settle(() => redeem(fan, id, 1_000, key));
      }),
    );
    expect(results.filter((item) => item.status === 200)).toHaveLength(3);
    expect(
      results.filter((item) => item.status === 409 && item.body.code === 'sold_out'),
    ).toHaveLength(7);
    expect(await redemptionsOf(id)).toHaveLength(3);
    expect((await read(`rewards/${id}`))!.redeemedCount).toBe(3);
  });
});

describe('a recusa pelo painel (setRedemptionStatus)', () => {
  it('devolve o saldo e a vaga uma vez, com o extrato, a carteira no instante do status e o motivo na loja', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const fan = await signUpFan(db);
    await fund(fan, 10_000);
    const id = await reward({ title: 'Videochamada', cost: 8_500, stockTotal: 2, perFanLimit: 1 });
    const { code } = (await redeem(fan, id, 8_500)).body as { code: string };
    expect((await read(`wallets/${fan.uid}`))!.balance).toBe(1_500);

    const reason = 'A agenda de videochamadas deste mês fechou antes do seu pedido.';
    const [first, second] = await Promise.all([
      setStatus(editor, { redemptionId: code, status: 'refused', reason }),
      setStatus(editor, { redemptionId: code, status: 'refused', reason }),
    ]);
    expect(first.result).toEqual({ ok: true, status: 'refused', refundedPoints: 8_500 });
    expect(second.result).toEqual({ ok: true, status: 'refused', refundedPoints: 8_500 });
    // De novo, sem efeito, com o mesmo refundedPoints da primeira.
    expect((await setStatus(editor, { redemptionId: code, status: 'refused' })).result).toEqual({
      ok: true,
      status: 'refused',
      refundedPoints: 8_500,
    });

    const wallet = await read(`wallets/${fan.uid}`);
    expect(wallet).toMatchObject({ balance: 10_000, spentTotal: 0 });
    const redemption = await read(`redemptions/${code}`);
    expect(redemption).toMatchObject({
      status: 'refused',
      refusalReason: reason,
      refundedPoints: 8_500,
      restocked: true,
      updatedBy: { uid: editor.uid, name: 'Editora' },
    });
    expect((wallet!.updatedAt as Timestamp).toMillis()).toBe(
      (redemption!.statusAt as Timestamp).toMillis(),
    );
    expect(await read(`wallets/${fan.uid}/ledger/redeem_refund:${code}`)).toMatchObject({
      kind: 'refund',
      points: 8_500,
      subjectTitle: 'Videochamada',
      actor: { type: 'staff', uid: editor.uid, name: 'Editora' },
    });
    expect((await read(`rewards/${id}`))!.redeemedCount).toBe(0);
    expect((await read(`rewards/${id}`))!.stockTotal).toBe(2);
    expect(
      (await db.collection('staffAudit').where('action', '==', 'redemption.refused').get()).size,
    ).toBe(1);

    const listed = byId((await shop(fan)).rewards, id)!;
    expect(listed.limitReached).toBe(false);
    expect(listed.redemptions[0]).toMatchObject({
      code,
      status: 'refused',
      refusalReason: reason,
      refundedPoints: 8_500,
    });
  });

  it('com restock false: o resgatado e o total descem 1, e o que sobra não muda; sem total, só o resgatado', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const [a, b] = await Promise.all([signUpFan(db), signUpFan(db)]);
    await Promise.all([fund(a, 5_000), fund(b, 5_000)]);
    const id = await reward({ cost: 1_000, stockTotal: 2, perFanLimit: 1 });
    const codeA = ((await redeem(a, id, 1_000)).body as { code: string }).code;
    expect((await redeem(b, id, 1_000)).status).toBe(200);
    expect(byId((await shop(a)).rewards, id)!.status).toBe('soldOut');
    await setStatus(editor, { redemptionId: codeA, status: 'refused', restock: false });
    expect(await read(`rewards/${id}`)).toMatchObject({ redeemedCount: 1, stockTotal: 1 });
    // Continua esgotada para todos.
    expect(byId((await shop(b)).rewards, id)).toMatchObject({
      status: 'soldOut',
      stock: { total: 1, remaining: 0 },
    });

    const open = await reward({ cost: 1_000, stockTotal: null, perFanLimit: null });
    const code = ((await redeem(a, open, 1_000)).body as { code: string }).code;
    await setStatus(editor, { redemptionId: code, status: 'refused', restock: false });
    expect(await read(`rewards/${open}`)).toMatchObject({ redeemedCount: 0, stockTotal: null });
  });

  it('o fã sem perfil não recebe nada, e o pedido fica recusado com 0 devolvido', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const fan = await signUpFan(db);
    await fund(fan, 5_000);
    const id = await reward({ cost: 1_000 });
    const { code } = (await redeem(fan, id, 1_000)).body as { code: string };
    await db.doc(`users/${fan.uid}`).delete();
    expect((await setStatus(editor, { redemptionId: code, status: 'refused' })).result).toEqual({
      ok: true,
      status: 'refused',
      refundedPoints: 0,
    });
    expect(await read(`redemptions/${code}`)).toMatchObject({
      status: 'refused',
      refundedPoints: 0,
    });
    expect((await read(`wallets/${fan.uid}`))!.balance).toBe(4_000);
    expect(await exists(`wallets/${fan.uid}/ledger/redeem_refund:${code}`)).toBe(false);
  });
});

describe('a exclusão de conta (25.11)', () => {
  it('cancela os abertos com a vaga de volta, tira o dado pessoal de todos e roda de novo sem mudar nada', async () => {
    const fan = await signUpFan(db, 'Camila Ribeiro');
    await fund(fan, 50_000);
    const ids = {
      requested: await reward({ stockTotal: 5, perFanLimit: 1 }),
      approved: await reward({ stockTotal: 5, perFanLimit: 1 }),
      delivered: await reward({ stockTotal: 5, perFanLimit: 1 }),
      refused: await reward({ stockTotal: 5, perFanLimit: 1 }),
    };
    const codes: Record<string, string> = {};
    for (const [status, id] of Object.entries(ids)) {
      codes[status] = ((await redeem(fan, id, 1_000)).body as { code: string }).code;
    }
    const { points: config } = await createConfigSource(db, { ttlMs: 0 }).get();
    const move = (code: string, to: 'approved' | 'delivered' | 'refused') =>
      runRedemptionStatus(
        db,
        {
          code,
          to,
          reason: to === 'refused' ? 'Motivo' : null,
          restock: true,
          expectFrom: 'requested',
        },
        { now: Date.now(), config },
      );
    await move(codes.approved!, 'approved');
    await move(codes.delivered!, 'delivered');
    await move(codes.refused!, 'refused');
    const started = Date.now();

    await deleteUserData(db, fan.uid);

    const after = Object.fromEntries(
      await Promise.all(
        Object.entries(codes).map(async ([status, code]) => [
          status,
          await read(`redemptions/${code}`),
        ]),
      ),
    );
    expect(after.requested).toMatchObject({
      status: 'canceled',
      canceledAt: expect.any(Timestamp),
    });
    expect(after.approved).toMatchObject({ status: 'canceled' });
    expect(after.delivered).toMatchObject({ status: 'delivered' });
    expect(after.refused).toMatchObject({ status: 'refused', refusalReason: null });
    for (const item of Object.values(after)) {
      expect(item).toMatchObject({
        uid: null,
        fanName: null,
        fanUsername: null,
        refusalReason: null,
        accountDeleted: true,
        points: 1_000,
      });
    }
    expect((await read(`rewards/${ids.requested}`))!.redeemedCount).toBe(0);
    expect((await read(`rewards/${ids.approved}`))!.redeemedCount).toBe(0);
    expect((await read(`rewards/${ids.delivered}`))!.redeemedCount).toBe(1);
    expect((await read(`rewards/${ids.refused}`))!.redeemedCount).toBe(0);
    expect((await db.collection('redemptions').where('uid', '==', fan.uid).get()).size).toBe(0);
    const days = [dayKey(started), dayKey(Date.now())];
    expect(await statsSum(db, days, (data) => data.totals?.redeemCanceled ?? 0)).toBe(2);

    const snapshot = JSON.stringify(after);
    await deleteUserData(db, fan.uid);
    const again = Object.fromEntries(
      await Promise.all(
        Object.entries(codes).map(async ([status, code]) => [
          status,
          await read(`redemptions/${code}`),
        ]),
      ),
    );
    expect(JSON.stringify(again)).toBe(snapshot);
    expect(await statsSum(db, days, (data) => data.totals?.redeemCanceled ?? 0)).toBe(2);

    // Com o perfil fora, nenhum resgate novo passa.
    expect(await redeem(fan, ids.requested, 1_000)).toMatchObject({
      status: 503,
      body: { code: 'profile_not_ready' },
    });
  });

  it('a recusa da equipe entre a consulta e a transação fica recusada, e a vaga volta uma vez só', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const [fan, other] = await Promise.all([signUpFan(db), signUpFan(db)]);
    await Promise.all([fund(fan, 5_000), fund(other, 5_000)]);
    const id = await reward({ cost: 1_000, stockTotal: 5, perFanLimit: null });
    const refusedCode = ((await redeem(fan, id, 1_000)).body as { code: string }).code;
    const canceledCode = ((await redeem(fan, id, 1_000)).body as { code: string }).code;
    // O pedido de outra pessoa segura uma vaga: o desconto em dobro não some no 0.
    expect((await redeem(other, id, 1_000)).status).toBe(200);
    expect((await read(`rewards/${id}`))!.redeemedCount).toBe(3);
    const started = Date.now();
    // O passo 1 da exclusão (24.11): o perfil sai antes de tudo.
    await db.doc(`users/${fan.uid}`).delete();

    let pages = 0;
    const result = await cancelFanRedemptions(db, fan.uid, {
      onPage: async (codes) => {
        pages += 1;
        expect([...codes].sort()).toEqual([refusedCode, canceledCode].sort());
        // A equipe recusa pelo painel depois da consulta e antes da transação.
        const refusal = await setStatus(editor, {
          redemptionId: refusedCode,
          status: 'refused',
          reason: 'Motivo',
        });
        expect(refusal.result).toEqual({ ok: true, status: 'refused', refundedPoints: 0 });
      },
    });

    expect(pages).toBe(1);
    expect(result).toEqual({ canceled: 1, anonymized: 2 });
    expect(await read(`redemptions/${refusedCode}`)).toMatchObject({
      status: 'refused',
      canceledAt: null,
      refundedPoints: 0,
      uid: null,
      refusalReason: null,
      accountDeleted: true,
    });
    expect(await read(`redemptions/${canceledCode}`)).toMatchObject({
      status: 'canceled',
      uid: null,
      accountDeleted: true,
    });
    // A recusa e o cancelamento devolvem uma vaga cada; a de outra pessoa fica.
    expect((await read(`rewards/${id}`))!.redeemedCount).toBe(1);
    const days = [dayKey(started), dayKey(Date.now())];
    const counted = (field: string) =>
      statsSum(db, days, (data) => data.byReward?.[id]?.[field] ?? 0);
    expect(await counted('refused')).toBe(1);
    expect(await counted('canceled')).toBe(1);
    expect(await statsSum(db, days, (data) => data.totals?.redeemCanceled ?? 0)).toBe(1);
    // Sem perfil, a recusa não devolve ponto.
    expect(await exists(`wallets/${fan.uid}/ledger/redeem_refund:${refusedCode}`)).toBe(false);
  });
});

describe('o seed da loja (25.13)', () => {
  it('o catálogo, os pedidos e o extrato da Camila; a loja dela e a do Alan; rodar de novo não muda nada', async () => {
    await seedCentrals(db);
    await seedEvents(db);
    expect(await seedRewards(db)).toBe(SEED_REWARDS.length);
    const camila = await signUpFan(db, 'Camila Ribeiro');
    const alan = await signUpFan(db, 'Alan Ferreira');
    const now = Date.now();
    await seedCamilaWallet(db, camila.uid, { now });
    expect(await seedCamilaRedemptions(db, camila.uid, now)).toEqual({
      redeemed: 4,
      transitions: 4,
    });

    expect(await read(`wallets/${camila.uid}`)).toMatchObject({ balance: 12_480, xp: 12_480 });
    expect(await read('redemptions/UP-4KD9TM')).toMatchObject({
      rewardId: 'ingressos',
      status: 'delivered',
      updatedBy: null,
    });
    expect(await read('redemptions/UP-9FJT6V')).toMatchObject({
      rewardId: 'videochamada',
      status: 'refused',
      refundedPoints: 8_500,
      refusalReason: 'A agenda de videochamadas deste mês fechou antes do seu pedido.',
    });
    expect(await read('redemptions/UP-7QXH2R')).toMatchObject({ status: 'approved' });
    expect(await read('redemptions/UP-C3NWPB')).toMatchObject({ status: 'requested' });
    expect((await read('redemptions/UP-4KD9TM'))!.requestedAt).toEqual(
      Timestamp.fromMillis(eveningDaysAgo(now, 7)),
    );
    const counts = Object.fromEntries(
      await Promise.all(
        ['meet-netto', 'ingressos', 'videochamada', 'camisa', 'telao', 'passagem-de-som'].map(
          async (id) => [id, (await read(`rewards/${id}`))!.redeemedCount],
        ),
      ),
    );
    expect(counts).toEqual({
      'meet-netto': 0,
      ingressos: 1,
      videochamada: 0,
      camisa: 1,
      telao: 0,
      'passagem-de-som': 1,
    });

    const store = await shop(camila);
    expect(store.rewards.map((item) => item.id)).toEqual([
      'meet-netto',
      'ingressos',
      'videochamada',
      'camisa',
      'telao',
      'passagem-de-som',
    ]);
    expect(byId(store.rewards, 'meet-netto')).toMatchObject({
      featured: true,
      status: 'available',
      stock: { total: 20, remaining: 20 },
      event: { name: 'São João de Irará' },
    });
    expect(byId(store.rewards, 'ingressos')).toMatchObject({
      perFanLimit: 2,
      limitReached: false,
      redemptions: [{ code: 'UP-4KD9TM', status: 'delivered' }],
    });
    expect(byId(store.rewards, 'videochamada')).toMatchObject({
      limitReached: false,
      redemptions: [{ code: 'UP-9FJT6V', status: 'refused', refundedPoints: 8_500 }],
    });
    expect(byId(store.rewards, 'camisa')).toMatchObject({
      perFanLimit: null,
      redemptions: [{ code: 'UP-C3NWPB', status: 'requested' }],
    });
    expect(byId(store.rewards, 'passagem-de-som')).toMatchObject({
      status: 'soldOut',
      stock: { total: 1, remaining: 0 },
      limitReached: true,
      redemptions: [{ code: 'UP-7QXH2R', status: 'approved' }],
    });
    const alanStore = await shop(alan);
    expect(
      alanStore.rewards.map((item) => [item.id, item.status, item.redemptions.length]),
    ).toEqual([
      ['meet-netto', 'available', 0],
      ['ingressos', 'available', 0],
      ['videochamada', 'available', 0],
      ['camisa', 'available', 0],
      ['telao', 'available', 0],
      ['passagem-de-som', 'soldOut', 0],
    ]);

    // O extrato: os 6 lançamentos da loja, às 18:00 de São Paulo de cada dia.
    const page = await http(env, '/me/ledger?limit=50', { token: camila.token });
    type Line = { id: string; points: number; subjectTitle: string | null; createdAt: string };
    const items = (page.body.items as Line[]).filter(
      (item) => item.id.startsWith('redeem') || item.id === 'seed:camila-loja',
    );
    expect(items.map((item) => [item.id, item.points, item.subjectTitle])).toEqual([
      ['redeem:UP-C3NWPB', -15_000, 'Camisa oficial'],
      ['redeem:UP-7QXH2R', -3_000, 'Passagem de som'],
      ['redeem_refund:UP-9FJT6V', 8_500, 'Videochamada'],
      ['redeem:UP-9FJT6V', -8_500, 'Videochamada'],
      ['redeem:UP-4KD9TM', -6_000, 'Par de ingressos'],
      ['seed:camila-loja', 24_000, null],
    ]);
    expect(items[0]!.createdAt).toBe(`${shiftDay(dayKey(now), -2)}T21:00:00.000Z`);

    const days = Array.from({ length: 9 }, (_, index) => shiftDay(dayKey(now), -index));
    expect(await statsSum(db, days, (data) => data.totals?.redeemRequested ?? 0)).toBe(4);
    expect(await statsSum(db, days, (data) => data.totals?.redeemApproved ?? 0)).toBe(2);
    expect(await statsSum(db, days, (data) => data.totals?.redeemDelivered ?? 0)).toBe(1);
    expect(await statsSum(db, days, (data) => data.totals?.redeemRefused ?? 0)).toBe(1);
    expect(await statsSum(db, days, (data) => data.totals?.refunded ?? 0)).toBe(8_500);
    expect(
      await statsSum(db, days, (data) =>
        Object.values((data.byReward ?? {}) as Record<string, { spent?: number }>).reduce(
          (sum, item) => sum + (item.spent ?? 0),
          0,
        ),
      ),
    ).toBe(32_500);

    // Rodar de novo: nada muda, nada lança, nenhuma auditoria.
    const wallet = await read(`wallets/${camila.uid}`);
    expect(await seedRewards(db)).toBe(0);
    expect(await seedCamilaRedemptions(db, camila.uid, now)).toEqual({
      redeemed: 0,
      transitions: 0,
    });
    expect((await read(`wallets/${camila.uid}`))!.balance).toBe(wallet!.balance);
    expect((await db.collection('redemptions').get()).size).toBe(4);
    expect((await db.collection('staffAudit').get()).size).toBe(0);
  });

  it('o seed que parou depois de criar um pedido termina as transições dele na rodada seguinte', async () => {
    await seedCentrals(db);
    await seedEvents(db);
    await seedRewards(db);
    const camila = await signUpFan(db, 'Camila Ribeiro');
    const now = Date.now();
    await seedCamilaWallet(db, camila.uid, { now });
    const { points: config } = await createConfigSource(db, { ttlMs: 0 }).get();
    // A rodada anterior gravou o primeiro pedido e parou antes das transições.
    await runRedeemReward(
      db,
      camila.uid,
      { rewardId: 'ingressos', expectedCost: 6_000, code: 'UP-4KD9TM' },
      { now: eveningDaysAgo(now, 7), config, actor: SEED_ACTOR },
    );
    expect(await seedCamilaRedemptions(db, camila.uid, now)).toEqual({
      redeemed: 3,
      transitions: 4,
    });
    expect(await read('redemptions/UP-4KD9TM')).toMatchObject({ status: 'delivered' });
    expect((await read(`wallets/${camila.uid}`))!.balance).toBe(12_480);
  });
});
