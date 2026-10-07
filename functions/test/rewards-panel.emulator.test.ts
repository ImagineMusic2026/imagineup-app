import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { createConfigSource, runAward, SEED_ACTOR } from '../src/points';
import {
  callable,
  http,
  seedMember,
  show,
  signUpFan,
  unique,
  useEmulators,
  type Fan,
  type Member,
} from './support';

/**
 * As callables da loja do bloco 10 nos emuladores (docs/arquitetura-api.md,
 * 25.8 e 25.14): as recompensas com a seção rewards, a foto conferida no
 * emulador do Storage, as transições dos pedidos conferidas no servidor, os
 * contatos de quem resgatou só dos pedidos abertos, a auditoria em
 * staffAudit, o `event-has-rewards` do deleteEvent e a chave nova do
 * updatePointsConfig.
 */
const REWARD_FUNCTIONS = [
  'createReward',
  'updateReward',
  'setRewardStatus',
  'setRewardStock',
  'reorderRewards',
  'deleteReward',
  'setRedemptionStatus',
  'getRedemptionContacts',
];
const env = useEmulators('loja-painel', [
  'api',
  'createUserProfile',
  'deleteEvent',
  'updatePointsConfig',
  ...REWARD_FUNCTIONS,
]);
const { db, bucket } = env;

const DAY_MS = 24 * 60 * 60 * 1000;
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

async function ok<T = Record<string, unknown>>(name: string, data: unknown, member: Member) {
  const { result, error } = await callable<T>(env, name, data, member.token);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

async function failure(name: string, data: unknown, member?: Member) {
  const { error } = await callable(env, name, data, member?.token);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error.details as Record<string, unknown> & { reason?: string };
}

async function audits(action: string) {
  const snap = await db.collection('staffAudit').where('action', '==', action).get();
  return snap.docs.map((doc) => doc.data());
}

async function upload(
  path: string,
  contentType = 'image/webp',
  size?: { width: number; height: number },
) {
  await bucket.file(path).save(Buffer.from(`arquivo ${path}`), {
    resumable: false,
    contentType,
    metadata: size ? { metadata: { width: String(size.width), height: String(size.height) } } : {},
  });
}

async function folder(prefix: string): Promise<string[]> {
  const [files] = await bucket.getFiles({ prefix });
  return files.map((file) => file.name).sort();
}

const BASE = {
  kind: 'ticket',
  title: 'Par de ingressos',
  subtitle: 'Pra Encher e Derramar',
  cost: 6_000,
  instructions: 'Retire na bilheteria com este código.',
};

/** Recompensa pelo createReward e publicada pelo setRewardStatus. */
async function published(member: Member, extra: Record<string, unknown> = {}): Promise<string> {
  const { rewardId } = await ok<{ rewardId: string }>(
    'createReward',
    { ...BASE, ...extra },
    member,
  );
  await ok('setRewardStatus', { rewardId, status: 'published' }, member);
  return rewardId;
}

async function fund(fan: Fan, balance: number): Promise<void> {
  const { points } = await createConfigSource(db, { ttlMs: 0 }).get();
  await runAward(
    db,
    fan.uid,
    [{ kind: 'adjust', source: 'seed', eventId: unique('saldo-'), balance }],
    { now: Date.now(), config: points, actor: SEED_ACTOR },
  );
}

async function redeemCode(fan: Fan, rewardId: string, cost: number): Promise<string> {
  const response = await http(env, `/rewards/${rewardId}/redeem`, {
    method: 'POST',
    token: fan.token,
    key: unique('resgate-'),
    body: { expectedCost: cost },
  });
  if (response.status !== 200) throw new Error(`Resgate falhou: ${JSON.stringify(response.body)}`);
  return response.body.code as string;
}

describe('quem usa as callables da loja', () => {
  it('admin e editora com rewards criam; leitora, editora sem a seção, desativada e fã não', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const viewer = await seedMember(env, 'Leitora', 'viewer', ['rewards']);
    const other = await seedMember(env, 'Conteúdo', 'editor', ['artists']);
    const disabled = await seedMember(env, 'Desativada', 'editor', ['rewards'], 'disabled');
    const fan = await signUpFan(db);

    for (const member of [admin, editor]) {
      const { rewardId } = await ok<{ rewardId: string }>('createReward', BASE, member);
      expect(await read(`rewards/${rewardId}`)).toMatchObject({
        ...BASE,
        description: null,
        featured: false,
        scarcity: false,
        stockTotal: null,
        redeemedCount: 0,
        perFanLimit: 1,
        eventId: null,
        photo: null,
        status: 'draft',
        publishedAt: null,
        closedAt: null,
        createdBy: member.uid,
        schemaVersion: 1,
      });
    }
    expect(await failure('createReward', BASE, viewer)).toMatchObject({ reason: 'no-section' });
    expect(await failure('createReward', BASE, other)).toMatchObject({ reason: 'no-section' });
    expect(await failure('createReward', BASE, disabled)).toMatchObject({ reason: 'not-staff' });
    expect(
      await failure('createReward', BASE, { ...admin, token: fan.token, uid: fan.uid }),
    ).toMatchObject({ reason: 'not-staff' });
    expect(await failure('createReward', BASE)).toMatchObject({ reason: 'unauthenticated' });
    expect(await audits('reward.created')).toHaveLength(2);
  });
});

describe('recompensas (createReward, updateReward, setRewardStatus, setRewardStock, reorderRewards, deleteReward)', () => {
  it('criar com o id do painel não cria outro na nova tentativa; sem o id, o servidor gera; o fim da ordem', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const rewardId = unique('rec');
    expect(await ok('createReward', { ...BASE, rewardId }, editor)).toEqual({ rewardId });
    expect(await ok('createReward', { ...BASE, rewardId, title: 'Outra' }, editor)).toEqual({
      rewardId,
    });
    expect((await read(`rewards/${rewardId}`))!.title).toBe('Par de ingressos');
    const generated = await ok<{ rewardId: string }>('createReward', BASE, editor);
    expect(generated.rewardId).not.toBe(rewardId);
    expect((await read(`rewards/${rewardId}`))!.order).toBe(0);
    expect((await read(`rewards/${generated.rewardId}`))!.order).toBe(1);
    expect(await audits('reward.created')).toHaveLength(2);
    expect(await failure('createReward', { ...BASE, rewardId: 'a/b' }, editor)).toMatchObject({
      reason: 'invalid-request',
      field: 'rewardId',
    });
    expect(await failure('createReward', { ...BASE, eventId: 'nao-existe' }, editor)).toMatchObject(
      { reason: 'event-not-found' },
    );
    expect(await failure('createReward', { ...BASE, cost: 0 }, editor)).toMatchObject({
      reason: 'invalid-request',
      field: 'cost',
    });
  });

  it('editar cada campo; nada mudou não grava nem audita; o estoque não muda por aqui', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const event = await show(env, ['nettobrito'], Date.now() + 10 * DAY_MS);
    const { rewardId } = await ok<{ rewardId: string }>('createReward', BASE, editor);
    const change = {
      kind: 'meet',
      title: 'Meet & greet',
      subtitle: 'Camarim',
      description: 'Um encontro rápido.',
      cost: 10_000,
      featured: true,
      scarcity: true,
      perFanLimit: null,
      eventId: event,
      instructions: 'Mostre o código no camarim.',
    };
    expect(await ok('updateReward', { rewardId, ...change }, editor)).toEqual({ ok: true });
    expect(await read(`rewards/${rewardId}`)).toMatchObject({ ...change, updatedBy: editor.uid });
    const [entry] = await audits('reward.updated');
    expect(entry!.details).toEqual({
      rewardId,
      changed: [
        'kind',
        'title',
        'subtitle',
        'description',
        'cost',
        'featured',
        'scarcity',
        'perFanLimit',
        'eventId',
        'instructions',
      ],
    });
    expect(await ok('updateReward', { rewardId, ...change }, editor)).toEqual({ ok: true });
    expect(await audits('reward.updated')).toHaveLength(1);
    expect(await failure('updateReward', { rewardId, stockTotal: 5 }, editor)).toMatchObject({
      reason: 'invalid-request',
      field: 'stockTotal',
    });
    expect(
      await failure('updateReward', { rewardId, eventId: 'nao-existe' }, editor),
    ).toMatchObject({ reason: 'event-not-found' });
    expect(
      await failure('updateReward', { rewardId: 'nao-existe', cost: 1 }, editor),
    ).toMatchObject({ reason: 'reward-not-found' });
  });

  it('a foto conferida no Storage, com a pasta limpa depois da troca e ao tirar', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const { rewardId } = await ok<{ rewardId: string }>('createReward', BASE, editor);
    const prefix = `rewards/${rewardId}/`;
    const first = `${prefix}photo-${unique('')}-1200.webp`;
    await upload(first, 'image/webp', { width: 1200, height: 643 });
    await upload(`${prefix}abandonada.webp`);
    await ok('updateReward', { rewardId, photo: { photoPath: first } }, editor);
    expect((await read(`rewards/${rewardId}`))!.photo).toEqual({
      path: first,
      width: 1200,
      height: 643,
      url: expect.any(String),
    });
    expect(await folder(prefix)).toEqual([first]);

    const second = `${prefix}photo-${unique('')}-1200.webp`;
    await upload(second);
    await ok('updateReward', { rewardId, photo: { photoPath: second } }, editor);
    // Sem medidas no metadado: a paisagem sugerida.
    expect((await read(`rewards/${rewardId}`))!.photo).toMatchObject({
      path: second,
      width: 1200,
      height: 643,
    });
    expect(await folder(prefix)).toEqual([second]);

    expect(
      await failure('updateReward', { rewardId, photo: { photoPath: 'events/x/a.webp' } }, editor),
    ).toMatchObject({ reason: 'invalid-photo' });
    expect(
      await failure(
        'updateReward',
        { rewardId, photo: { photoPath: `${prefix}nada.webp` } },
        editor,
      ),
    ).toMatchObject({ reason: 'photo-not-found' });
    await upload(`${prefix}texto.txt`, 'text/plain');
    expect(
      await failure(
        'updateReward',
        { rewardId, photo: { photoPath: `${prefix}texto.txt` } },
        editor,
      ),
    ).toMatchObject({ reason: 'invalid-photo' });

    await ok('updateReward', { rewardId, photo: null }, editor);
    expect((await read(`rewards/${rewardId}`))!.photo).toBeNull();
    expect(await folder(prefix)).toEqual([]);
  });

  it('publicar, encerrar e reabrir no fim da ordem; com o show fechado, event-not-open', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const a = await published(editor);
    const b = await published(editor);
    const draft = await ok<{ rewardId: string }>('createReward', BASE, editor);
    expect(await read(`rewards/${a}`)).toMatchObject({
      status: 'published',
      publishedAt: expect.any(Timestamp),
    });
    expect(
      await failure('setRewardStatus', { rewardId: draft.rewardId, status: 'closed' }, editor),
    ).toMatchObject({ reason: 'not-published' });
    expect(
      await failure('setRewardStatus', { rewardId: a, status: 'draft' }, editor),
    ).toMatchObject({ reason: 'invalid-status' });

    await ok('setRewardStatus', { rewardId: a, status: 'closed' }, editor);
    const closed = await read(`rewards/${a}`);
    expect(closed).toMatchObject({ status: 'closed', closedAt: expect.any(Timestamp) });
    // O mesmo status: sem gravar nem auditar.
    await ok('setRewardStatus', { rewardId: a, status: 'closed' }, editor);
    expect(await audits('reward.closed')).toHaveLength(1);

    await ok('setRewardStatus', { rewardId: a, status: 'published' }, editor);
    const reopened = await read(`rewards/${a}`);
    expect(reopened).toMatchObject({ status: 'published', publishedAt: closed!.publishedAt });
    // No fim da ordem: depois do b e do rascunho.
    expect(reopened!.order).toBeGreaterThan((await read(`rewards/${draft.rewardId}`))!.order);
    expect(reopened!.order).toBeGreaterThan((await read(`rewards/${b}`))!.order);
    const published_ = await audits('reward.published');
    expect(published_.filter((entry) => entry.details.reopened === true)).toHaveLength(1);

    const draftShow = await show(env, ['nenho'], Date.now() + 5 * DAY_MS, {
      status: 'draft',
      publishedAt: null,
    });
    const offShow = await show(env, ['nenho'], Date.now() + 5 * DAY_MS, { status: 'unpublished' });
    const pastShow = await show(env, ['nenho'], Date.now() - 2 * DAY_MS);
    for (const eventId of [draftShow, offShow, pastShow]) {
      const { rewardId } = await ok<{ rewardId: string }>(
        'createReward',
        { ...BASE, eventId },
        editor,
      );
      expect(
        await failure('setRewardStatus', { rewardId, status: 'published' }, editor),
      ).toMatchObject({ reason: 'event-not-open' });
    }
    const open = await show(env, ['nenho'], Date.now() + 5 * DAY_MS);
    await published(editor, { eventId: open });
  });

  it('o estoque: nunca abaixo do resgatado, o null sem limite e o que sobra na resposta', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const rewardId = await published(editor, { cost: 1_000, perFanLimit: null, stockTotal: 5 });
    const fan = await signUpFan(db);
    await fund(fan, 10_000);
    await redeemCode(fan, rewardId, 1_000);
    await redeemCode(fan, rewardId, 1_000);
    expect(await failure('setRewardStock', { rewardId, stockTotal: 1 }, editor)).toMatchObject({
      reason: 'stock-below-redeemed',
      redeemed: 2,
    });
    expect(await ok('setRewardStock', { rewardId, stockTotal: 2 }, editor)).toEqual({
      ok: true,
      remaining: 0,
    });
    expect(await ok('setRewardStock', { rewardId, stockTotal: 10 }, editor)).toEqual({
      ok: true,
      remaining: 8,
    });
    expect(await ok('setRewardStock', { rewardId, stockTotal: null }, editor)).toEqual({
      ok: true,
      remaining: null,
    });
    // O mesmo total: sem gravar nem auditar.
    await ok('setRewardStock', { rewardId, stockTotal: null }, editor);
    expect(await read(`rewards/${rewardId}`)).toMatchObject({ stockTotal: null, redeemedCount: 2 });
    const entries = await audits('reward.stock.updated');
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.details.after).sort()).toEqual([10, 2, null].sort());
    expect(await failure('setRewardStock', { rewardId, stockTotal: -1 }, editor)).toMatchObject({
      reason: 'invalid-request',
      field: 'stockTotal',
    });
    expect(await failure('setRewardStock', { rewardId }, editor)).toMatchObject({
      reason: 'invalid-request',
      field: 'stockTotal',
    });
  });

  it('a ordem só com rascunhos e no ar; com uma encerrada ou faltando um rascunho, invalid-request', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const a = await published(editor);
    const b = await published(editor);
    const draft = (await ok<{ rewardId: string }>('createReward', BASE, editor)).rewardId;
    const closed = await published(editor);
    await ok('setRewardStatus', { rewardId: closed, status: 'closed' }, editor);
    const closedOrder = (await read(`rewards/${closed}`))!.order;

    expect(
      await failure('reorderRewards', { rewardIds: [b, a, draft, closed] }, editor),
    ).toMatchObject({ reason: 'invalid-request', field: 'rewardIds' });
    expect(await failure('reorderRewards', { rewardIds: [b, a] }, editor)).toMatchObject({
      reason: 'invalid-request',
      field: 'rewardIds',
    });
    await ok('reorderRewards', { rewardIds: [draft, b, a] }, editor);
    expect([
      (await read(`rewards/${draft}`))!.order,
      (await read(`rewards/${b}`))!.order,
      (await read(`rewards/${a}`))!.order,
      (await read(`rewards/${closed}`))!.order,
    ]).toEqual([0, 1, 2, closedOrder]);
    await ok('reorderRewards', { rewardIds: [draft, b, a] }, editor);
    expect(await audits('reward.reordered')).toHaveLength(1);
  });

  it('apagar só o rascunho sem pedido, com a pasta; o publicado e o com pedido, não', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const draft = (await ok<{ rewardId: string }>('createReward', BASE, editor)).rewardId;
    await upload(`rewards/${draft}/photo-1.webp`);
    await ok('deleteReward', { rewardId: draft }, editor);
    expect(await exists(`rewards/${draft}`)).toBe(false);
    expect(await folder(`rewards/${draft}/`)).toEqual([]);
    expect(await audits('reward.deleted')).toHaveLength(1);
    expect(await failure('deleteReward', { rewardId: draft }, editor)).toMatchObject({
      reason: 'reward-not-found',
    });

    const live = await published(editor);
    await ok('setRewardStatus', { rewardId: live, status: 'closed' }, editor);
    expect(await failure('deleteReward', { rewardId: live }, editor)).toMatchObject({
      reason: 'was-published',
    });

    const withOrder = (await ok<{ rewardId: string }>('createReward', BASE, editor)).rewardId;
    await db
      .doc('redemptions/UP-ZZZZZZ')
      .set({ code: 'UP-ZZZZZZ', rewardId: withOrder, status: 'requested' });
    expect(await failure('deleteReward', { rewardId: withOrder }, editor)).toMatchObject({
      reason: 'has-redemptions',
    });
  });

  it('o deleteEvent recusa o show citado por uma recompensa e passa depois de tirar o show dela', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const eventId = await show(env, ['nenho'], Date.now() + 5 * DAY_MS, {
      status: 'draft',
      publishedAt: null,
    });
    const { rewardId } = await ok<{ rewardId: string }>(
      'createReward',
      { ...BASE, eventId },
      admin,
    );
    expect(await failure('deleteEvent', { eventId }, admin)).toMatchObject({
      reason: 'event-has-rewards',
      rewardIds: [rewardId],
    });
    await ok('updateReward', { rewardId, eventId: null }, admin);
    expect(await ok('deleteEvent', { eventId }, admin)).toEqual({ ok: true });
    expect(await exists(`events/${eventId}`)).toBe(false);
  });
});

describe('pedidos (setRedemptionStatus)', () => {
  async function order(editor: Member, fan: Fan): Promise<string> {
    const rewardId = await published(editor, { cost: 100, perFanLimit: null, stockTotal: 50 });
    return redeemCode(fan, rewardId, 100);
  }

  it('cada transição válida; o mesmo status sem efeito; uma auditoria por mudança, sem uid nem e-mail', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const fan = await signUpFan(db);
    await fund(fan, 10_000);
    const paths: [string, string[]][] = [
      ['requested>approved', ['approved']],
      ['requested>delivered', ['delivered']],
      ['requested>refused', ['refused']],
      ['approved>delivered', ['approved', 'delivered']],
      ['approved>refused', ['approved', 'refused']],
    ];
    const balance = async () => (await read(`wallets/${fan.uid}`))!.balance as number;
    for (const [name, steps] of paths) {
      const code = await order(editor, fan);
      const { rewardId } = (await read(`redemptions/${code}`))!;
      const before = await balance();
      for (const status of steps) {
        const result = await ok<{ status: string }>(
          'setRedemptionStatus',
          { redemptionId: code, status },
          editor,
        );
        expect(result.status, name).toBe(status);
      }
      const doc = await read(`redemptions/${code}`);
      expect(doc, name).toMatchObject({
        status: steps.at(-1),
        statusAt: expect.any(Timestamp),
        updatedBy: { uid: editor.uid, name: 'Editora' },
      });
      if (steps.includes('approved')) expect(doc!.approvedAt).toEqual(expect.any(Timestamp));

      // A recusa devolve os pontos e a vaga também a partir do aprovado (decisão 5).
      const refused = steps.at(-1) === 'refused';
      expect(await balance(), name).toBe(before + (refused ? 100 : 0));
      expect((await read(`rewards/${rewardId}`))!.redeemedCount, name).toBe(refused ? 0 : 1);
      expect(await exists(`wallets/${fan.uid}/ledger/redeem_refund:${code}`), name).toBe(refused);
      if (refused) {
        expect(doc, name).toMatchObject({ refundedPoints: 100, restocked: true });
        // A auditoria deste pedido, pelo código: a consulta não tem ordem.
        const entry = (await audits('redemption.refused')).find(
          (item) => item.details.code === code,
        );
        expect(entry?.details, name).toMatchObject({
          from: steps.length > 1 ? 'approved' : 'requested',
          restocked: true,
          refundedPoints: 100,
          hasReason: false,
        });
      }
      // De novo: sem efeito.
      await ok('setRedemptionStatus', { redemptionId: code, status: steps.at(-1) }, editor);
    }
    // 5 pedidos de 100 e 2 devoluções.
    expect(await balance()).toBe(9_700);
    const all = [
      ...(await audits('redemption.approved')),
      ...(await audits('redemption.delivered')),
      ...(await audits('redemption.refused')),
    ];
    expect(all).toHaveLength(7);
    for (const entry of all) {
      expect(entry).toMatchObject({ targetEmail: '', targetUid: null, actorUid: editor.uid });
      expect(JSON.stringify(entry)).not.toContain(fan.uid);
      expect(JSON.stringify(entry)).not.toContain(fan.email);
      expect(entry.details).toMatchObject({ code: expect.any(String), from: expect.any(String) });
    }
  });

  it('as inválidas: entregue, recusado e cancelado não mudam; voltar para solicitado não é pedido aceito', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const fan = await signUpFan(db);
    await fund(fan, 10_000);
    const delivered = await order(editor, fan);
    await ok('setRedemptionStatus', { redemptionId: delivered, status: 'delivered' }, editor);
    const refused = await order(editor, fan);
    await ok('setRedemptionStatus', { redemptionId: refused, status: 'refused' }, editor);
    const canceled = await order(editor, fan);
    await db.doc(`redemptions/${canceled}`).update({ status: 'canceled' });

    for (const [code, from, targets] of [
      [delivered, 'delivered', ['approved', 'refused']],
      [refused, 'refused', ['approved', 'delivered']],
      [canceled, 'canceled', ['approved', 'delivered', 'refused']],
    ] as const) {
      for (const status of targets) {
        expect(
          await failure('setRedemptionStatus', { redemptionId: code, status }, editor),
        ).toMatchObject({ reason: 'invalid-transition', from, to: status });
      }
    }
    const approved = await order(editor, fan);
    await ok('setRedemptionStatus', { redemptionId: approved, status: 'approved' }, editor);
    expect(
      await failure('setRedemptionStatus', { redemptionId: approved, status: 'requested' }, editor),
    ).toMatchObject({ reason: 'invalid-request', field: 'status' });
    expect(
      await failure('setRedemptionStatus', { redemptionId: approved, status: 'canceled' }, editor),
    ).toMatchObject({ reason: 'invalid-request', field: 'status' });
    expect(
      await failure(
        'setRedemptionStatus',
        { redemptionId: 'UP-ZZZZZZ', status: 'approved' },
        editor,
      ),
    ).toMatchObject({ reason: 'redemption-not-found' });
  });

  it('motivo e restock só na recusa; a recusa grava o motivo e o restocked', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const viewer = await seedMember(env, 'Leitora', 'viewer', ['rewards']);
    const fan = await signUpFan(db);
    await fund(fan, 10_000);
    const code = await order(editor, fan);
    expect(
      await failure(
        'setRedemptionStatus',
        { redemptionId: code, status: 'approved', reason: 'x' },
        editor,
      ),
    ).toMatchObject({ reason: 'reason-not-allowed' });
    expect(
      await failure(
        'setRedemptionStatus',
        { redemptionId: code, status: 'delivered', restock: false },
        editor,
      ),
    ).toMatchObject({ reason: 'reason-not-allowed' });
    expect(
      await failure('setRedemptionStatus', { redemptionId: code, status: 'refused' }, viewer),
    ).toMatchObject({ reason: 'no-section' });
    await ok(
      'setRedemptionStatus',
      { redemptionId: code, status: 'refused', reason: 'Show cancelado.', restock: false },
      editor,
    );
    expect(await read(`redemptions/${code}`)).toMatchObject({
      refusalReason: 'Show cancelado.',
      restocked: false,
      refundedPoints: 100,
    });
    const [entry] = await audits('redemption.refused');
    expect(entry!.details).toMatchObject({ restocked: false, hasReason: true });
    expect(JSON.stringify(entry)).not.toContain('Show cancelado.');
  });
});

describe('contatos de quem resgatou (getRedemptionContacts)', () => {
  it('o nome, o @ e o e-mail de agora dos abertos; os fechados fora; a conta que sumiu, tudo null', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['rewards']);
    const viewer = await seedMember(env, 'Leitora', 'viewer', ['rewards']);
    const other = await seedMember(env, 'Conteúdo', 'editor', ['artists']);
    const camila = await signUpFan(db, 'Camila Ribeiro');
    await fund(camila, 10_000);
    const rewardId = await published(editor, { cost: 100, perFanLimit: null });
    const requested = await redeemCode(camila, rewardId, 100);
    const approved = await redeemCode(camila, rewardId, 100);
    const delivered = await redeemCode(camila, rewardId, 100);
    const refused = await redeemCode(camila, rewardId, 100);
    const canceled = await redeemCode(camila, rewardId, 100);
    // O pedido aberto de uma conta que já não existe no Auth (a exclusão ainda
    // não passou por ele), gravado direto: excluir pela API do Auth dispararia
    // o deleteUserProfile, que cancelaria o pedido no meio do teste.
    const orphan = 'UP-RSTVWX';
    await db.doc(`redemptions/${orphan}`).set({
      code: orphan,
      rewardId,
      status: 'requested',
      uid: 'uid-que-sumiu',
      fanName: 'Conta Que Sumiu',
      fanUsername: 'sumiu',
      points: 100,
      requestedAt: Timestamp.now(),
      statusAt: Timestamp.now(),
    });
    await ok('setRedemptionStatus', { redemptionId: approved, status: 'approved' }, editor);
    await ok('setRedemptionStatus', { redemptionId: delivered, status: 'delivered' }, editor);
    await ok('setRedemptionStatus', { redemptionId: refused, status: 'refused' }, editor);
    await db.doc(`redemptions/${canceled}`).update({ status: 'canceled' });
    // A Camila troca o @ depois do pedido: o contato vem com o novo.
    await db.doc(`users/${camila.uid}`).update({ username: 'camila_nova' });

    const codes = [requested, approved, delivered, refused, canceled, orphan];
    const { contacts } = await ok<{ contacts: Record<string, unknown>[] }>(
      'getRedemptionContacts',
      { redemptionIds: codes },
      editor,
    );
    const byCode = Object.fromEntries(contacts.map((contact) => [contact.redemptionId, contact]));
    expect(Object.keys(byCode).sort()).toEqual([approved, orphan, requested].sort());
    expect(byCode[requested]).toEqual({
      redemptionId: requested,
      name: 'Camila Ribeiro',
      username: 'camila_nova',
      email: camila.email,
    });
    expect(byCode[approved]).toMatchObject({ email: camila.email });
    expect(byCode[orphan]).toEqual({
      redemptionId: orphan,
      name: null,
      username: null,
      email: null,
    });

    expect(
      await failure('getRedemptionContacts', { redemptionIds: [requested] }, viewer),
    ).toMatchObject({ reason: 'no-section' });
    expect(
      await failure('getRedemptionContacts', { redemptionIds: [requested] }, other),
    ).toMatchObject({ reason: 'no-section' });
    const many = Array.from(
      { length: 51 },
      (_, index) =>
        `UP-${'BCDFGHJKMNPQRSTVWXYZ23456789'[index % 28]!.repeat(5)}${'BCDFG'[index % 5]}`,
    );
    expect(await failure('getRedemptionContacts', { redemptionIds: many }, editor)).toMatchObject({
      reason: 'invalid-request',
      field: 'redemptionIds',
    });

    const viewed = await audits('redemption.contacts.viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0]!.details).toEqual({ codes: expect.any(Array), count: 3 });
    expect(JSON.stringify(viewed[0])).not.toContain(camila.email);
    expect(JSON.stringify(viewed[0])).not.toContain('camila_nova');
  });
});

describe('o teto dos resgates na régua (updatePointsConfig)', () => {
  it('aceita actionCaps.reward_redeem, com o mesmo limite das outras chaves', async () => {
    const editor = await seedMember(env, 'Editora', 'editor', ['missions']);
    expect(
      await ok(
        'updatePointsConfig',
        { expectedVersion: 0, actionCaps: { reward_redeem: 3 } },
        editor,
      ),
    ).toEqual({ ok: true, version: 1 });
    expect(await read('config/points')).toMatchObject({ actionCaps: { reward_redeem: 3 } });
    expect(
      await failure(
        'updatePointsConfig',
        { expectedVersion: 1, actionCaps: { reward_redeem: 0 } },
        editor,
      ),
    ).toMatchObject({ reason: 'invalid-request', field: 'actionCaps.reward_redeem' });
  });
});
