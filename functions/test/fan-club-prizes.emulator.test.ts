import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { dayKey } from '../src/day';
import { decideFanClub, FAN_CLUB_RULES_VERSION } from '../src/fan-clubs';
import { staticConfigSource } from '../src/points';
import {
  callable,
  central,
  localApi,
  seedMember,
  signUpFan,
  statsSum,
  unique,
  useEmulators,
  type Fan,
  type Member,
} from './support';

/**
 * O Destaque e o prêmio no servidor, a etapa 5 de 34.14
 * (docs/arquitetura-api.md, seção 34, decisões 40 a 51, 34.13): a recompensa
 * "Só para prêmios de fã-clube" na loja (o status `prize`, o tipo `discount`,
 * o custo 0, fora da ordem, fora da loja e sem resgate); o Recompensar da
 * `decideFanClub` (os pontos só no saldo, com a origem `fanclub_prize`, o
 * teto do papel e o orçamento do dia somados com o Ajuste; o pedido de prêmio
 * com o código, o cupom e a mensagem, Aprovado ou Entregue; o registro e o
 * `lastReward`; a repetição pelo `grantId`; as três travas; as seções a mais;
 * a recompensa que não é de prêmio e a sem vaga; a colisão do código); o
 * `prizes` do `GET /rewards`; os contatos do gestor; e o cancelamento pelo
 * Recusar da aba Pedidos. O Destaque (`feature` e `unfeature`) entrou na
 * etapa 1 e tem os testes no `fan-clubs.emulator.test.ts`.
 */
const env = useEmulators('fa-clube-premios', [
  'api',
  'createUserProfile',
  'decideFanClub',
  'createReward',
  'updateReward',
  'setRewardStatus',
  'reorderRewards',
  'setRedemptionStatus',
  'getRedemptionContacts',
  'adjustFanPoints',
]);
const { db } = env;

const read = async (path: string) => (await db.doc(path).get()).data();

type Api = ReturnType<typeof localApi>;

async function ok<T = Record<string, unknown>>(name: string, data: unknown, who: Member) {
  const { result, error } = await callable<T>(env, name, data, who.token);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

async function failure(name: string, data: unknown, who: Member) {
  const { error } = await callable(env, name, data, who.token);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error.details as Record<string, unknown> & { reason?: string };
}

async function audits(action: string) {
  const snap = await db.collection('staffAudit').where('action', '==', action).get();
  return snap.docs.map((doc) => doc.data());
}

/** Uma central no ar com a autorização de imagem (as caixas valem ligadas, decisão 9). */
async function openArtist(): Promise<string> {
  const artistId = await central(env);
  await db.doc(`artistPrivate/${artistId}`).set({ imageRightsConfirmed: true });
  return artistId;
}

type Owner = { fan: Fan; clubId: string; artistId: string };

/** O gestor de um fã-clube ativo: entra na central, se candidata e a equipe aprova. */
async function manager(call: Api, admin: Member): Promise<Owner> {
  const artistId = await openArtist();
  const fan = await signUpFan(db, 'Camila Ribeiro');
  const joined = await call('PUT', `/me/centrals/${artistId}`, {
    token: fan.token,
    key: unique('chave-entra-'),
  });
  expect(joined.status).toBe(200);
  const applied = await call('POST', '/me/fan-club/application', {
    token: fan.token,
    key: unique('chave-candidata-'),
    body: {
      artistId,
      name: unique('Turma '),
      instagram: 'camila.teste.up',
      whatsapp: '(75) 99123-4567',
      pitch: 'Divulgo o artista nos stories e no grupo dos fãs da cidade.',
      adult: true,
      rulesVersion: FAN_CLUB_RULES_VERSION,
    },
  });
  expect(applied.status).toBe(200);
  await ok(
    'decideFanClub',
    { subject: 'application', id: fan.uid, decision: 'approve', expected: 1 },
    admin,
  );
  const clubId = (await read(`fanClubApplications/${fan.uid}`))?.clubId as string;
  expect(clubId).toEqual(expect.any(String));
  return { fan, clubId, artistId };
}

const PRIZE = {
  prize: true,
  kind: 'ticket',
  title: 'Ingresso de cortesia',
  subtitle: 'São João de Irará',
  instructions: 'Retire na bilheteria com este código e um documento com foto.',
};

/** A recompensa "Só para prêmios" pelo createReward com o `prize: true`. */
async function prizeReward(admin: Member, extra: Record<string, unknown> = {}): Promise<string> {
  const { rewardId } = await ok<{ rewardId: string }>(
    'createReward',
    { ...PRIZE, ...extra },
    admin,
  );
  return rewardId;
}

/** O pedido do Recompensar, com os campos de 34.3. */
function reward(owner: Owner, fields: Record<string, unknown>) {
  return {
    subject: 'club',
    id: owner.clubId,
    decision: 'reward',
    expected: 'active',
    grantId: unique('concessao-'),
    note: 'Divulgou o show de Irará.',
    ...fields,
  };
}

const today = () => [dayKey(Date.now())];

describe('a recompensa "Só para prêmios de fã-clube" na loja (decisões 40 a 42)', () => {
  it('nasce com o status prize, custo 0 e fora da ordem; o Desconto só nela; não vai ao ar nem muda o custo', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const rewardId = await prizeReward(admin, { kind: 'discount', cost: 0, stockTotal: 2 });
    const doc = await read(`rewards/${rewardId}`);
    expect(doc).toMatchObject({
      status: 'prize',
      kind: 'discount',
      cost: 0,
      stockTotal: 2,
      redeemedCount: 0,
      publishedAt: null,
    });
    // Sem o `order`: o painel de antes lista o catálogo pelo `orderBy('order')`.
    expect(doc).not.toHaveProperty('order');
    expect(await audits('reward.created')).toEqual([
      expect.objectContaining({ details: expect.objectContaining({ rewardId, prize: true }) }),
    ]);
    // O mesmo id de novo, a repetição do painel, não cria outra.
    expect(await ok('createReward', { ...PRIZE, rewardId }, admin)).toEqual({ rewardId });

    // O Desconto e o custo 0 só no prêmio; no prêmio, o custo é 0.
    const store = {
      kind: 'ticket',
      title: 'Par',
      subtitle: 'Show',
      cost: 100,
      instructions: 'Retire.',
    };
    expect(await failure('createReward', { ...store, kind: 'discount' }, admin)).toMatchObject({
      reason: 'invalid-request',
      field: 'kind',
    });
    expect(await failure('createReward', { ...store, cost: 0 }, admin)).toMatchObject({
      reason: 'invalid-request',
      field: 'cost',
    });
    expect(await failure('createReward', { ...PRIZE, cost: 50 }, admin)).toMatchObject({
      reason: 'invalid-request',
      field: 'cost',
    });

    // Publicar e encerrar recusam; editar muda o texto, e o custo fica 0.
    for (const status of ['published', 'closed']) {
      expect(await failure('setRewardStatus', { rewardId, status }, admin)).toMatchObject({
        reason: 'reward-is-prize',
      });
    }
    expect(await failure('updateReward', { rewardId, cost: 10 }, admin)).toMatchObject({
      reason: 'invalid-request',
      field: 'cost',
    });
    await ok('updateReward', { rewardId, title: 'Desconto de 20%', kind: 'ticket' }, admin);
    expect(await read(`rewards/${rewardId}`)).toMatchObject({
      title: 'Desconto de 20%',
      kind: 'ticket',
      status: 'prize',
      cost: 0,
    });

    // A da loja não vira Desconto nem custo 0; a ordem segue só com ela.
    const { rewardId: storeId } = await ok<{ rewardId: string }>('createReward', store, admin);
    expect(
      await failure('updateReward', { rewardId: storeId, kind: 'discount' }, admin),
    ).toMatchObject({ reason: 'invalid-request', field: 'kind' });
    expect(await failure('updateReward', { rewardId: storeId, cost: 0 }, admin)).toMatchObject({
      reason: 'invalid-request',
      field: 'cost',
    });
    await ok('reorderRewards', { rewardIds: [storeId] }, admin);
    expect(
      await failure('reorderRewards', { rewardIds: [storeId, rewardId] }, admin),
    ).toMatchObject({ reason: 'invalid-request', field: 'rewardIds' });
  });

  it('não aparece na loja e o resgate responde 404, como o rascunho', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const rewardId = await prizeReward(admin, { stockTotal: 2 });
    const fan = await signUpFan(db, 'Bia Santos');
    const call = localApi(env, { now: () => Date.now() });
    const shop = await call('GET', '/rewards', { token: fan.token });
    expect(shop).toMatchObject({ status: 200, body: { rewards: [], prizes: [] } });
    const redeemed = await call('POST', `/rewards/${rewardId}/redeem`, {
      token: fan.token,
      key: unique('chave-resgate-'),
      body: { expectedCost: 1 },
    });
    expect(redeemed).toMatchObject({ status: 404, body: { code: 'reward_not_found' } });
  });
});

describe('o Recompensar (decisões 43 a 46)', () => {
  it('os pontos só no saldo e o prêmio Aprovado: o pedido, o registro, o lastReward, a auditoria e os shards', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 2 });
    const before = await read(`wallets/${owner.fan.uid}`);
    const input = reward(owner, {
      points: 200,
      prize: {
        rewardId,
        delivered: false,
        coupon: ' CORTESIA-IRARA ',
        message: 'Parabéns!\n\nObrigado.',
      },
    });

    const result = await ok<Record<string, unknown>>('decideFanClub', input, admin);
    expect(result).toEqual({
      ok: true,
      subject: 'club',
      id: owner.clubId,
      status: 'active',
      grantId: input.grantId,
      code: expect.stringMatching(/^UP-[A-Z0-9]{6}$/),
      points: 200,
    });
    const code = result.code as string;

    // Os pontos: um `adjust` com a origem nova, só no saldo.
    expect(
      await read(`wallets/${owner.fan.uid}/ledger/fanclub_prize:${input.grantId}`),
    ).toMatchObject({
      kind: 'adjust',
      source: 'fanclub_prize',
      points: 200,
      xpDelta: 0,
      seasonDelta: 0,
      note: 'Divulgou o show de Irará.',
      actor: { type: 'staff', uid: admin.uid },
    });
    const after = await read(`wallets/${owner.fan.uid}`);
    expect(after?.balance).toBe((before?.balance ?? 0) + 200);
    expect(after?.xp).toBe(before?.xp ?? 0);

    // O pedido: a origem, 0 ponto, Aprovado, o cupom limpo e a mensagem.
    expect(await read(`redemptions/${code}`)).toMatchObject({
      code,
      rewardId,
      rewardTitle: 'Ingresso de cortesia',
      points: 0,
      uid: owner.fan.uid,
      fanName: 'Camila Ribeiro',
      status: 'approved',
      approvedAt: expect.any(Timestamp),
      deliveredAt: null,
      requestedAt: expect.any(Timestamp),
      statusAt: expect.any(Timestamp),
      origin: 'prize',
      fanClubId: owner.clubId,
      grantId: input.grantId,
      coupon: 'CORTESIA-IRARA',
      message: 'Parabéns!\n\nObrigado.',
      updatedBy: { uid: admin.uid, name: 'Admin da Equipe' },
    });
    expect((await read(`rewards/${rewardId}`))?.redeemedCount).toBe(1);

    // O registro, sem o código nem o cupom; o resumo no fã-clube.
    const record = await read(`fanClubs/${owner.clubId}/prizes/${input.grantId}`);
    expect(record).toMatchObject({
      grantId: input.grantId,
      clubId: owner.clubId,
      artistId: owner.artistId,
      points: 200,
      ledgerId: `fanclub_prize:${input.grantId}`,
      prize: {
        rewardId,
        rewardTitle: 'Ingresso de cortesia',
        rewardKind: 'ticket',
        delivered: false,
      },
      note: 'Divulgou o show de Irará.',
      by: { uid: admin.uid, name: 'Admin da Equipe' },
    });
    expect(JSON.stringify(record)).not.toContain(code);
    expect(JSON.stringify(record)).not.toContain('CORTESIA');
    expect((await read(`fanClubs/${owner.clubId}`))?.lastReward).toEqual({
      at: expect.any(Timestamp),
      points: 200,
      prize: true,
    });

    // A auditoria, com os alvos e sem o cupom nem a mensagem.
    const [entry] = await audits('fanClub.rewarded');
    expect(entry?.details).toEqual({
      clubId: owner.clubId,
      artistId: owner.artistId,
      fanUid: owner.fan.uid,
      grantId: input.grantId,
      points: 200,
      rewardId,
      code,
      note: 'Divulgou o show de Irará.',
    });
    expect(entry?.targets).toEqual(
      expect.arrayContaining([
        `fanClub:${owner.clubId}`,
        `fan:${owner.fan.uid}`,
        `redemption:${code}`,
      ]),
    );
    expect(JSON.stringify(entry)).not.toContain('CORTESIA');

    // Os shards: o passo `prize` e o Aprovado na recompensa, nunca nos totais da
    // Loja; os pontos no total de ajustes e na origem nova.
    const sum = (pick: (data: Record<string, any>) => number) => statsSum(db, today(), pick);
    expect(await sum((data) => data.byReward?.[rewardId]?.prizes ?? 0)).toBe(1);
    expect(await sum((data) => data.byReward?.[rewardId]?.approved ?? 0)).toBe(1);
    expect(await sum((data) => data.byReward?.[rewardId]?.requested ?? 0)).toBe(0);
    for (const total of ['redeemRequested', 'redeemApproved', 'redeemDelivered']) {
      expect(await sum((data) => data.totals?.[total] ?? 0), total).toBe(0);
    }
    expect(await sum((data) => data.bySource?.fanclub_prize?.points ?? 0)).toBe(200);

    // O gestor: o `prizes` da loja, sem a recompensa em `rewards`, e o
    // `lastReward` do "Meu fã-clube".
    const shop = await call('GET', '/rewards', { token: owner.fan.token });
    expect(shop.status).toBe(200);
    expect(shop.body.rewards).toEqual([]);
    expect(shop.body.prizes).toEqual([
      {
        id: code,
        code,
        status: 'approved',
        statusAt: expect.any(String),
        grantedAt: expect.any(String),
        coupon: 'CORTESIA-IRARA',
        message: 'Parabéns!\n\nObrigado.',
        refusalReason: null,
        reward: {
          id: rewardId,
          kind: 'ticket',
          title: 'Ingresso de cortesia',
          imageUrl: null,
          instructions: 'Retire na bilheteria com este código e um documento com foto.',
        },
      },
    ]);
    const mine = await call('GET', '/me/fan-club', { token: owner.fan.token });
    expect(mine.body.club).toMatchObject({
      lastReward: { at: expect.any(String), points: 200, prize: true },
    });
  });

  it('a repetição do mesmo grantId responde o que foi feito, sem dobrar; com outros campos, grant-id-reused', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 5 });
    const input = reward(owner, {
      points: 150,
      prize: { rewardId, delivered: false, coupon: 'CUPOM', message: null },
    });
    const first = await ok<{ code: string }>('decideFanClub', input, admin);
    const again = await ok<{ code: string }>('decideFanClub', input, admin);
    expect(again).toEqual(first);
    const orders = await db.collection('redemptions').where('grantId', '==', input.grantId).get();
    expect(orders.size).toBe(1);
    expect((await read(`rewards/${rewardId}`))?.redeemedCount).toBe(1);
    expect(await audits('fanClub.rewarded')).toHaveLength(1);
    expect(
      (await read(`wallets/${owner.fan.uid}/ledger/fanclub_prize:${input.grantId}`))?.points,
    ).toBe(150);

    for (const changed of [
      { points: 151 },
      { note: 'Outra nota.' },
      { prize: { rewardId, delivered: true, coupon: 'CUPOM', message: null } },
      { prize: { rewardId, delivered: false, coupon: 'OUTRO', message: null } },
      { prize: null },
    ]) {
      expect(
        await failure('decideFanClub', { ...input, ...changed }, admin),
        JSON.stringify(changed),
      ).toMatchObject({
        reason: 'grant-id-reused',
      });
    }
  });

  it('o prêmio Entregue ("O cupom já é o prêmio"), sem pontos e sem a seção Fãs; o entregue não se cancela', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['fanClubs', 'rewards']);
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { kind: 'discount', cost: 0 });
    const input = reward(owner, {
      prize: { rewardId, delivered: true, coupon: 'DESCONTO20', message: null },
    });
    const result = await ok<{ code: string; points: number | null }>(
      'decideFanClub',
      input,
      editor,
    );
    expect(result.points).toBeNull();
    expect(await read(`redemptions/${result.code}`)).toMatchObject({
      status: 'delivered',
      deliveredAt: expect.any(Timestamp),
      approvedAt: null,
      rewardKind: 'discount',
    });
    expect(await read(`fanClubs/${owner.clubId}/prizes/${input.grantId}`)).toMatchObject({
      points: null,
      ledgerId: null,
    });
    expect((await read(`fanClubs/${owner.clubId}`))?.lastReward).toMatchObject({
      points: null,
      prize: true,
    });
    expect(await statsSum(db, today(), (data) => data.byReward?.[rewardId]?.delivered ?? 0)).toBe(
      1,
    );
    expect(await statsSum(db, today(), (data) => data.totals?.redeemDelivered ?? 0)).toBe(0);
    expect(
      await failure(
        'setRedemptionStatus',
        { redemptionId: result.code, status: 'refused', reason: 'Cancelado' },
        admin,
      ),
    ).toMatchObject({ reason: 'invalid-transition' });
    // O app recebe o Desconto só no `prizes`.
    const shop = await call('GET', '/rewards', { token: owner.fan.token });
    expect(shop.body.prizes).toEqual([
      expect.objectContaining({
        status: 'delivered',
        coupon: 'DESCONTO20',
        reward: expect.objectContaining({ kind: 'discount' }),
      }),
    ]);
  });

  it('cada parte pede a seção dela; o Leitor e o gestor da equipe não; o teto do papel e o orçamento do dia somados com o Ajuste', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 5 });
    const onlyClubs = await seedMember(env, 'Só Fã-clubes', 'editor', ['fanClubs']);
    const withFans = await seedMember(env, 'Com Fãs', 'editor', ['fanClubs', 'fans']);
    const viewer = await seedMember(env, 'Leitora', 'viewer', ['fanClubs', 'fans', 'rewards']);
    const prize = { rewardId, delivered: false, coupon: null, message: null };

    expect(await failure('decideFanClub', reward(owner, { points: 10 }), onlyClubs)).toMatchObject({
      reason: 'no-section',
    });
    expect(await failure('decideFanClub', reward(owner, { prize }), withFans)).toMatchObject({
      reason: 'no-section',
    });
    expect(await failure('decideFanClub', reward(owner, { points: 10 }), viewer)).toMatchObject({
      reason: 'no-section',
    });
    expect(await failure('decideFanClub', reward(owner, {}), admin)).toMatchObject({
      reason: 'invalid-request',
      field: 'points',
    });
    // O teto do editor por lançamento, como no Ajuste.
    expect(
      await failure('decideFanClub', reward(owner, { points: 50_001 }), withFans),
    ).toMatchObject({
      reason: 'adjust-above-limit',
      max: 50_000,
    });
    // O orçamento do dia: dois ajustes de 49.950 no saldo de outro fã, e o
    // prêmio de 200 passa do limite de 100.000.
    const other = await signUpFan(db, 'Bia Santos');
    for (let n = 0; n < 2; n += 1) {
      await ok(
        'adjustFanPoints',
        { uid: other.uid, adjustmentId: unique('ajuste-dia-'), note: 'Correção', balance: 49_950 },
        withFans,
      );
    }
    expect(await failure('decideFanClub', reward(owner, { points: 200 }), withFans)).toMatchObject({
      reason: 'adjust-daily-limit',
      counter: 'balance',
      remaining: 100,
    });
    await ok('decideFanClub', reward(owner, { points: 100 }), withFans);
    expect(
      (await read(`staffLimits/${withFans.uid}_${dayKey(Date.now())}`))?.adjusted,
    ).toMatchObject({
      balance: 100_000,
    });

    // O gestor que é da equipe não se recompensa.
    const ownerStaff = owner.fan.uid;
    await db.doc(`staff/${ownerStaff}`).set({
      uid: ownerStaff,
      email: owner.fan.email,
      displayName: 'Camila Ribeiro',
      role: 'admin',
      sections: [],
      status: 'active',
      accountCreatedByInvite: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    const self = { ...admin, uid: ownerStaff, token: owner.fan.token } as Member;
    expect(await failure('decideFanClub', reward(owner, { points: 10 }), self)).toMatchObject({
      reason: 'self',
    });
  });

  it('as três travas, o status da tela, a recompensa que não é de prêmio, a que não existe e a sem vaga', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 1 });
    const prize = { rewardId, delivered: false, coupon: null, message: null };

    expect(
      await failure('decideFanClub', reward(owner, { points: 10, expected: 'paused' }), admin),
    ).toMatchObject({ reason: 'stale-decision' });

    await db.doc(`fanClubApplications/${owner.fan.uid}`).update({ adultDeclared: false });
    expect(await failure('decideFanClub', reward(owner, { points: 10 }), admin)).toMatchObject({
      reason: 'prize-not-allowed',
      problem: 'not_adult',
    });
    await db.doc(`fanClubApplications/${owner.fan.uid}`).update({ adultDeclared: true });

    await db.doc(`users/${owner.fan.uid}`).update({ suspendedAt: Timestamp.now() });
    expect(await failure('decideFanClub', reward(owner, { prize }), admin)).toMatchObject({
      reason: 'prize-not-allowed',
      problem: 'owner_suspended',
    });
    await db.doc(`users/${owner.fan.uid}`).update({ suspendedAt: null });

    // A recompensa da loja, a que não existe e a sem vaga.
    const { rewardId: storeId } = await ok<{ rewardId: string }>(
      'createReward',
      { kind: 'ticket', title: 'Par', subtitle: 'Show', cost: 100, instructions: 'Retire.' },
      admin,
    );
    expect(
      await failure(
        'decideFanClub',
        reward(owner, { prize: { ...prize, rewardId: storeId } }),
        admin,
      ),
    ).toMatchObject({ reason: 'reward-not-prize' });
    expect(
      await failure(
        'decideFanClub',
        reward(owner, { prize: { ...prize, rewardId: 'nao-existe' } }),
        admin,
      ),
    ).toMatchObject({ reason: 'reward-not-found' });
    await ok('decideFanClub', reward(owner, { prize }), admin);
    expect(await failure('decideFanClub', reward(owner, { prize }), admin)).toMatchObject({
      reason: 'sold-out',
    });

    // O fã-clube pausado: o prêmio pede o ativo.
    await ok(
      'decideFanClub',
      { subject: 'club', id: owner.clubId, decision: 'pause', expected: 'active' },
      admin,
    );
    expect(
      await failure('decideFanClub', reward(owner, { points: 10, expected: 'paused' }), admin),
    ).toMatchObject({ reason: 'prize-not-allowed', problem: 'club_not_active' });
  });

  it('o grantId já usado noutro fã-clube, o lançamento sem o registro, o gestor sem perfil e a lápide', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const first = await manager(call, admin);
    const second = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 5 });
    const prize = { rewardId, delivered: false, coupon: null, message: null };

    // O mesmo grantId de um prêmio noutro fã-clube: o pedido é achado só por ele.
    const grantId = unique('concessao-dupla-');
    await ok('decideFanClub', reward(first, { grantId, prize }), admin);
    expect(await failure('decideFanClub', reward(second, { grantId, prize }), admin)).toMatchObject(
      { reason: 'grant-id-reused' },
    );
    expect((await db.collection('redemptions').where('grantId', '==', grantId).get()).size).toBe(1);
    expect(await read(`fanClubs/${second.clubId}/prizes/${grantId}`)).toBeUndefined();

    // O lançamento `fanclub_prize:<grantId>` do gestor sem o registro deste fã-clube.
    const ledgerOnly = unique('concessao-extrato-');
    await db.doc(`wallets/${second.fan.uid}/ledger/fanclub_prize:${ledgerOnly}`).set({
      kind: 'adjust',
      source: 'fanclub_prize',
      points: 50,
    });
    const before = (await read(`wallets/${second.fan.uid}`))?.balance;
    expect(
      await failure('decideFanClub', reward(second, { grantId: ledgerOnly, points: 10 }), admin),
    ).toMatchObject({ reason: 'grant-id-reused' });
    expect(await read(`fanClubs/${second.clubId}/prizes/${ledgerOnly}`)).toBeUndefined();
    expect((await read(`wallets/${second.fan.uid}`))?.balance).toBe(before);

    // O perfil que sumiu no meio da exclusão: o fã-clube ainda ativo.
    await db.doc(`users/${second.fan.uid}`).delete();
    expect(await failure('decideFanClub', reward(second, { points: 10 }), admin)).toMatchObject({
      reason: 'fan-not-found',
    });

    // A lápide (decisão 21): encerrada e sem o dono.
    await db.doc(`fanClubs/${first.clubId}`).update({ status: 'closed', ownerUid: null });
    expect(
      await failure('decideFanClub', reward(first, { points: 10, expected: 'closed' }), admin),
    ).toMatchObject({ reason: 'prize-not-allowed', problem: 'club_not_active' });
    expect(await audits('fanClub.rewarded')).toHaveLength(1);
  });

  it('o código sorteado que já existe: a nova tentativa sorteia outro, e o prêmio nasce uma vez', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 5 });
    await db.doc('redemptions/UP-BCDFGH').set({ code: 'UP-BCDFGH', status: 'delivered' });
    const codes = ['UP-BCDFGH', 'UP-BCDFGJ'];
    let draws = 0;
    const input = reward(owner, {
      points: 50,
      prize: { rewardId, delivered: false, coupon: null, message: null },
    });
    const result = await decideFanClub(
      {
        db,
        config: staticConfigSource(),
        drawCode: () => codes[Math.min(draws++, codes.length - 1)]!,
      },
      { uid: admin.uid, token: { auth_time: Math.floor(Date.now() / 1000) } },
      input,
    );
    expect(result).toMatchObject({ code: 'UP-BCDFGJ', points: 50 });
    expect(draws).toBe(2);
    expect((await read('redemptions/UP-BCDFGH'))?.status).toBe('delivered');
    expect((await read(`rewards/${rewardId}`))?.redeemedCount).toBe(1);
    expect(await audits('fanClub.rewarded')).toHaveLength(1);
  });
});

describe('o pedido de prêmio na aba Pedidos e nos contatos (decisões 43 e 49)', () => {
  it('os contatos: o WhatsApp e o Instagram do gestor no pedido de prêmio; o resgate dele na loja, sem o Instagram', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 5 });
    const granted = await ok<{ code: string }>(
      'decideFanClub',
      reward(owner, {
        points: 100,
        prize: { rewardId, delivered: false, coupon: null, message: null },
      }),
      admin,
    );
    // Um resgate comum dele, com os pontos do prêmio.
    const { rewardId: storeId } = await ok<{ rewardId: string }>(
      'createReward',
      { kind: 'ticket', title: 'Par', subtitle: 'Show', cost: 100, instructions: 'Retire.' },
      admin,
    );
    await ok('setRewardStatus', { rewardId: storeId, status: 'published' }, admin);
    const redeemed = await call('POST', `/rewards/${storeId}/redeem`, {
      token: owner.fan.token,
      key: unique('chave-resgate-'),
      body: { expectedCost: 100 },
    });
    expect(redeemed.status).toBe(200);
    const storeCode = redeemed.body.code as string;

    const { contacts } = await ok<{ contacts: Record<string, unknown>[] }>(
      'getRedemptionContacts',
      { redemptionIds: [granted.code, storeCode] },
      admin,
    );
    const byCode = Object.fromEntries(contacts.map((contact) => [contact.redemptionId, contact]));
    expect(byCode[granted.code]).toEqual({
      redemptionId: granted.code,
      name: 'Camila Ribeiro',
      username: expect.any(String),
      email: owner.fan.email,
      whatsapp: '+5575991234567',
      instagram: 'camila.teste.up',
    });
    expect(byCode[storeCode]).toMatchObject({ whatsapp: '+5575991234567', instagram: null });
    const [viewed] = await audits('redemption.contacts.viewed');
    expect(JSON.stringify(viewed)).not.toContain('camila.teste.up');
  });

  it('cancelar é o Recusar: nenhum lançamento, a vaga volta, os pontos ficam, e o gestor vê o recusado sem o cupom', async () => {
    const admin = await seedMember(env, 'Admin da Equipe', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const owner = await manager(call, admin);
    const rewardId = await prizeReward(admin, { stockTotal: 1 });
    const input = reward(owner, {
      points: 300,
      prize: { rewardId, delivered: false, coupon: 'CUPOM-X', message: 'Parabéns!' },
    });
    const granted = await ok<{ code: string }>('decideFanClub', input, admin);
    const balance = (await read(`wallets/${owner.fan.uid}`))?.balance as number;

    expect(
      await ok(
        'setRedemptionStatus',
        { redemptionId: granted.code, status: 'refused', reason: 'O show foi adiado.' },
        admin,
      ),
    ).toEqual({ ok: true, status: 'refused', refundedPoints: 0 });
    expect(await read(`redemptions/${granted.code}`)).toMatchObject({
      status: 'refused',
      refundedPoints: 0,
      restocked: true,
    });
    expect(
      await read(`wallets/${owner.fan.uid}/ledger/redeem_refund:${granted.code}`),
    ).toBeUndefined();
    expect((await read(`wallets/${owner.fan.uid}`))?.balance).toBe(balance);
    expect((await read(`rewards/${rewardId}`))?.redeemedCount).toBe(0);
    // O registro não muda: o status mora no pedido.
    expect(await read(`fanClubs/${owner.clubId}/prizes/${input.grantId}`)).toMatchObject({
      prize: expect.objectContaining({ delivered: false }),
    });
    expect(await statsSum(db, today(), (data) => data.byReward?.[rewardId]?.refused ?? 0)).toBe(1);
    expect(await statsSum(db, today(), (data) => data.totals?.redeemRefused ?? 0)).toBe(0);
    const shop = await call('GET', '/rewards', { token: owner.fan.token });
    expect(shop.body.prizes).toEqual([
      expect.objectContaining({
        code: granted.code,
        status: 'refused',
        coupon: null,
        message: 'Parabéns!',
        refusalReason: 'O show foi adiado.',
      }),
    ]);
    // A vaga voltou: outro prêmio cabe.
    await ok(
      'decideFanClub',
      reward(owner, { prize: { rewardId, delivered: false, coupon: null, message: null } }),
      admin,
    );
  });
});
