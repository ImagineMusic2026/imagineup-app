import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { leaveAllCentrals } from './centrals/service';
import { detachReferrals, removeInviteData } from './invites/service';
import { removeFanEngagement } from './posts/service';
import { createProfile, deleteUserData } from './store';

// A ordem da exclusão de conta é o que impede o fanCount 1 acima para sempre
// (docs/arquitetura-api.md, 19.12) e o marcador de visita debaixo de um
// convidante excluído (20.10): o perfil sai sozinho antes de tudo, o código do
// convite logo depois, os vínculos e o engajamento do mural (21.12) antes do
// recursiveDelete, e os convidados
// do fã são desligados depois. Nos emuladores, as entradas terminam antes da
// exclusão, e a ordem trocada passaria; aqui um Firestore falso anota cada
// passo.
vi.mock('./centrals/service', () => ({ leaveAllCentrals: vi.fn() }));
vi.mock('./posts/service', () => ({ removeFanEngagement: vi.fn() }));
vi.mock('./invites/service', () => ({
  removeInviteData: vi.fn(),
  detachReferrals: vi.fn(),
  referralRef: (db: Firestore, uid: string) => db.collection('referrals').doc(uid),
}));

const UID = 'uid-camila';

function fakeDb(steps: string[]): Firestore {
  const empty = { docs: [], empty: true, size: 0 };
  const doc = (path: string) => ({
    path,
    delete: async () => {
      steps.push(`delete ${path}`);
    },
  });
  const reservation = {
    ref: {
      delete: async () => {
        steps.push('delete usernames/camilarib');
      },
    },
    updateTime: 'lido',
  };
  const collection = (name: string) => ({
    doc: (id: string) => doc(`${name}/${id}`),
    where: () => ({
      get: async () =>
        name === 'usernames' ? { docs: [reservation], empty: false, size: 1 } : empty,
      limit: () => ({ get: async () => empty }),
    }),
  });
  return {
    collection,
    recursiveDelete: async (ref: { path: string }) => {
      steps.push(`recursiveDelete ${ref.path}`);
    },
  } as unknown as Firestore;
}

describe('exclusão de conta (deleteUserData)', () => {
  beforeEach(() => {
    vi.mocked(leaveAllCentrals).mockReset();
    vi.mocked(removeInviteData).mockReset();
    vi.mocked(detachReferrals).mockReset();
    vi.mocked(removeFanEngagement).mockReset();
  });

  it('o perfil sai sozinho primeiro, o convite logo depois e os convidados depois do perfil', async () => {
    const steps: string[] = [];
    vi.mocked(leaveAllCentrals).mockImplementation(async (_db, uid) => {
      steps.push(`leaveAllCentrals ${uid}`);
      return 0;
    });
    vi.mocked(removeInviteData).mockImplementation(async (_db, uid) => {
      steps.push(`removeInviteData ${uid}`);
    });
    vi.mocked(detachReferrals).mockImplementation(async (_db, uid) => {
      steps.push(`detachReferrals ${uid}`);
      return 0;
    });
    vi.mocked(removeFanEngagement).mockImplementation(async (_db, uid) => {
      steps.push(`removeFanEngagement ${uid}`);
      return { likes: 0, comments: 0, reports: 0, blocks: 0 };
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps).toEqual([
      'delete usernames/camilarib',
      `delete users/${UID}`,
      `removeInviteData ${UID}`,
      `leaveAllCentrals ${UID}`,
      `removeFanEngagement ${UID}`,
      `recursiveDelete users/${UID}`,
      `delete referrals/${UID}`,
      `detachReferrals ${UID}`,
      `recursiveDelete wallets/${UID}`,
      `delete staff/${UID}`,
    ]);
  });

  it('a saída das centrais termina antes de o recursiveDelete começar', async () => {
    const steps: string[] = [];
    vi.mocked(leaveAllCentrals).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      steps.push('leaveAllCentrals terminou');
      return 2;
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps.indexOf('leaveAllCentrals terminou')).toBeLessThan(
      steps.indexOf(`recursiveDelete users/${UID}`),
    );
  });

  it('curtidas, comentários, denúncias e bloqueios saem depois do perfil e antes do recursiveDelete (21.12)', async () => {
    const steps: string[] = [];
    vi.mocked(removeFanEngagement).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      steps.push('removeFanEngagement terminou');
      return { likes: 1, comments: 1, reports: 0, blocks: 0 };
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps.indexOf(`delete users/${UID}`)).toBeLessThan(
      steps.indexOf('removeFanEngagement terminou'),
    );
    expect(steps.indexOf('removeFanEngagement terminou')).toBeLessThan(
      steps.indexOf(`recursiveDelete users/${UID}`),
    );
  });

  it('o código do convite sai antes dos vínculos, e só depois do perfil', async () => {
    const steps: string[] = [];
    vi.mocked(removeInviteData).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      steps.push('removeInviteData terminou');
    });
    vi.mocked(leaveAllCentrals).mockImplementation(async () => {
      steps.push('leaveAllCentrals');
      return 0;
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps.indexOf(`delete users/${UID}`)).toBeLessThan(
      steps.indexOf('removeInviteData terminou'),
    );
    expect(steps.indexOf('removeInviteData terminou')).toBeLessThan(
      steps.indexOf('leaveAllCentrals'),
    );
  });
});

// --- Cadastro do dia (bloco 5, 20.7) ----------------------------------------------

type Write = { op: 'create' | 'set'; path: string; data: Record<string, unknown> };

/** Firestore falso com uma transação: o perfil existe ou não, e os @ estão livres. */
function profileDb(profileExists: boolean): { db: Firestore; writes: Write[] } {
  const writes: Write[] = [];
  const ref = (path: string) => ({
    path,
    id: path.split('/').at(-1)!,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(work: (tx: unknown) => Promise<T>) =>
      work({
        get: async (target: { path: string }) => ({
          exists: profileExists && target.path.startsWith('users/'),
        }),
        getAll: async (...targets: { path: string; id: string }[]) =>
          targets.map((target) => ({ exists: false, ref: target, id: target.id })),
        create: (target: { path: string }, data: Record<string, unknown>) =>
          writes.push({ op: 'create', path: target.path, data }),
        set: (target: { path: string }, data: Record<string, unknown>) =>
          writes.push({ op: 'set', path: target.path, data }),
      }),
  } as unknown as Firestore;
  return { db, writes };
}

// Segunda-feira, meio-dia em São Paulo.
const NOW = Date.parse('2026-10-05T15:00:00.000Z');

describe('cadastro do dia no createProfile', () => {
  it('perfil novo: soma 1 em signups.total no shard do dia e marca o perfil (signupCounted)', async () => {
    const { db, writes } = profileDb(false);
    const result = await createProfile(db, { uid: UID, displayName: 'Camila Ribeiro' }, undefined, {
      now: () => NOW,
      shardRandom: () => 0.5,
    });
    expect(result).toEqual({ status: 'created', username: 'camilarib' });
    expect(writes.find((write) => write.path === `users/${UID}`)?.data).toMatchObject({
      username: 'camilarib',
      signupCounted: true,
    });
    const shard = writes.find((write) => write.path.startsWith('statsDaily/'));
    expect(shard).toEqual({
      op: 'set',
      path: 'statsDaily/2026-10-05/statsShards/32',
      data: expect.objectContaining({
        day: '2026-10-05',
        signups: { total: FieldValue.increment(1) },
      }),
    });
    // Só o cadastro: nada de pontos, convites nem atividade no shard.
    expect(Object.keys(shard!.data).sort()).toEqual(['day', 'signups', 'updatedAt']);
  });

  it('entrega repetida (o perfil já existe): não grava nada nem soma de novo', async () => {
    const { db, writes } = profileDb(true);
    const result = await createProfile(db, { uid: UID, displayName: 'Camila Ribeiro' }, undefined, {
      now: () => NOW,
    });
    expect(result).toEqual({ status: 'exists' });
    expect(writes).toEqual([]);
  });
});
