import AsyncStorage from '@react-native-async-storage/async-storage';

import { StorageKeys } from '@/storage/storage';

import {
  bindPendingInvite,
  BOUND_INVITE_TTL_MS,
  clearBoundInvite,
  PENDING_INVITE_TTL_MS,
  readBoundInvite,
  readPendingInvite,
  savePendingInvite,
  subscribePendingInvite,
} from '..';

// Relógio fixo: as datas do convite vêm dele, nunca do dia real.
const NOW = Date.parse('2026-10-05T14:02:11.000Z');
const LINK = { path: '/post/p-clipe', utm: { source: 'instagram', campaign: 'sao-joao' } };

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('convite pendente (o link que abriu o app)', () => {
  it('guarda o código normalizado com a origem; o primeiro convite vale', async () => {
    await savePendingInvite('k7p3-m9qx', LINK, NOW);
    await savePendingInvite('OUTRO123', { path: '/', utm: {} }, NOW + 1000);
    expect(await readPendingInvite(NOW + 2000)).toEqual({
      code: 'K7P3M9QX',
      receivedAt: '2026-10-05T14:02:11.000Z',
      origin: LINK,
    });
  });

  it('código fora do formato não é guardado', async () => {
    await savePendingInvite('a!', LINK, NOW);
    expect(await readPendingInvite(NOW)).toBeNull();
  });

  it('vencido (mais de 7 dias), sai na leitura, e o link seguinte vale', async () => {
    await savePendingInvite('K7P3M9QX', LINK, NOW);
    expect(await readPendingInvite(NOW + PENDING_INVITE_TTL_MS)).not.toBeNull();
    expect(await readPendingInvite(NOW + PENDING_INVITE_TTL_MS + 1)).toBeNull();
    expect(await AsyncStorage.getItem(StorageKeys.PendingInvite)).toBeNull();

    await savePendingInvite('OUTRO123', { path: '/', utm: {} }, NOW + PENDING_INVITE_TTL_MS + 2);
    expect((await readPendingInvite(NOW + PENDING_INVITE_TTL_MS + 3))?.code).toBe('OUTRO123');
  });

  it('a v1 (só o código) é apagada na primeira leitura, sem migração', async () => {
    await AsyncStorage.setItem(
      StorageKeys.LegacyPendingInvite,
      JSON.stringify({ code: 'ABC123', receivedAt: '2026-10-01T10:00:00.000Z' }),
    );
    expect(await readPendingInvite(NOW)).toBeNull();
    expect(await AsyncStorage.getItem(StorageKeys.LegacyPendingInvite)).toBeNull();
  });

  it('avisa quem assina quando um convite novo é guardado (a sincronização roda na hora)', async () => {
    const listener = jest.fn();
    const stop = subscribePendingInvite(listener);
    await savePendingInvite('K7P3M9QX', LINK, NOW);
    expect(listener).toHaveBeenCalledTimes(1);
    // O segundo link não troca o primeiro, e ninguém é avisado.
    await savePendingInvite('OUTRO123', LINK, NOW);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe('convite amarrado à conta (bindPendingInvite)', () => {
  it('o mesmo código do link: via link, com a origem e a chave do link', async () => {
    await savePendingInvite('K7P3M9QX', LINK, NOW);
    const bound = await bindPendingInvite('uid-bia', 'K7P3M9QX', NOW + 60_000);
    expect(bound).toEqual({
      uid: 'uid-bia',
      code: 'K7P3M9QX',
      via: 'link',
      origin: LINK,
      receivedAt: '2026-10-05T14:02:11.000Z',
      boundAt: '2026-10-05T14:03:11.000Z',
      idempotencyKey: 'invite-K7P3M9QX-2026-10-05T14:02:11.000Z',
    });
    // O pendente sai do aparelho: não vai para a próxima conta.
    expect(await readPendingInvite(NOW + 60_000)).toBeNull();
    expect(await readBoundInvite('uid-bia', NOW + 60_000)).toEqual(bound);
  });

  it.each(['k7p3m9qx', 'K7P3-M9QX', ' k7p3 m9qx '])(
    'o mesmo código digitado em minúsculas ou com hífen (%j) também é via link',
    async (typed) => {
      await savePendingInvite('K7P3M9QX', LINK, NOW);
      expect(await bindPendingInvite('uid-bia', typed, NOW)).toMatchObject({
        via: 'link',
        origin: LINK,
      });
    },
  );

  it('outro código (digitado): via code, sem origem, com o receivedAt igual ao boundAt', async () => {
    await savePendingInvite('K7P3M9QX', LINK, NOW);
    expect(await bindPendingInvite('uid-bia', 'camila12', NOW + 5_000)).toEqual({
      uid: 'uid-bia',
      code: 'CAMILA12',
      via: 'code',
      origin: null,
      receivedAt: '2026-10-05T14:02:16.000Z',
      boundAt: '2026-10-05T14:02:16.000Z',
      idempotencyKey: 'invite-CAMILA12-2026-10-05T14:02:16.000Z',
    });
    expect(await readPendingInvite(NOW + 5_000)).toBeNull();
  });

  it('código vazio descarta o pendente e não amarra nada', async () => {
    await savePendingInvite('K7P3M9QX', LINK, NOW);
    expect(await bindPendingInvite('uid-bia', '', NOW)).toBeNull();
    expect(await readPendingInvite(NOW)).toBeNull();
    expect(await readBoundInvite('uid-bia', NOW)).toBeNull();
  });

  it('o convite amarrado a um uid não aparece para outro', async () => {
    await savePendingInvite('K7P3M9QX', LINK, NOW);
    await bindPendingInvite('uid-bia', 'K7P3M9QX', NOW);
    expect(await readBoundInvite('uid-alan', NOW)).toBeNull();
    await clearBoundInvite('uid-alan');
    expect(await readBoundInvite('uid-bia', NOW)).not.toBeNull();
  });

  it('a chave fica a mesma em toda leitura; amarrar de novo com outro código troca a chave', async () => {
    await bindPendingInvite('uid-bia', 'CAMILA12', NOW);
    const first = await readBoundInvite('uid-bia', NOW + 1);
    expect((await readBoundInvite('uid-bia', NOW + 2))?.idempotencyKey).toBe(first?.idempotencyKey);
    const again = await bindPendingInvite('uid-bia', 'CAMILA12', NOW + 3_000);
    expect(again?.idempotencyKey).not.toBe(first?.idempotencyKey);
  });

  it('vale 7 dias desde o boundAt; vencido, sai', async () => {
    await bindPendingInvite('uid-bia', 'CAMILA12', NOW);
    expect(await readBoundInvite('uid-bia', NOW + BOUND_INVITE_TTL_MS)).not.toBeNull();
    expect(await readBoundInvite('uid-bia', NOW + BOUND_INVITE_TTL_MS + 1)).toBeNull();
    expect(await AsyncStorage.getItem(StorageKeys.InviteClaims)).toBeNull();
  });

  it('tirar com a chave só tira se ainda for o mesmo convite', async () => {
    const first = await bindPendingInvite('uid-bia', 'CAMILA12', NOW);
    await bindPendingInvite('uid-bia', 'OUTRO123', NOW + 1_000);
    await clearBoundInvite('uid-bia', first!.idempotencyKey);
    expect((await readBoundInvite('uid-bia', NOW + 2_000))?.code).toBe('OUTRO123');
  });
});
