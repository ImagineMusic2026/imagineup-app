import type { Firestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { leaveAllCentrals } from './centrals/service';
import { deleteUserData } from './store';

// A ordem da exclusão de conta é o que impede o fanCount 1 acima para sempre
// (docs/arquitetura-api.md, 19.12): o perfil sai sozinho antes de listar os
// vínculos, e o recursiveDelete vem depois. Nos emuladores, as entradas
// terminam antes da exclusão, e a ordem trocada passaria; aqui um Firestore
// falso anota cada passo.
vi.mock('./centrals/service', () => ({ leaveAllCentrals: vi.fn() }));

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
  });

  it('o perfil sai sozinho antes dos vínculos, e o resto do perfil depois deles', async () => {
    const steps: string[] = [];
    vi.mocked(leaveAllCentrals).mockImplementation(async (_db, uid) => {
      steps.push(`leaveAllCentrals ${uid}`);
      return 0;
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps).toEqual([
      'delete usernames/camilarib',
      `delete users/${UID}`,
      `leaveAllCentrals ${UID}`,
      `recursiveDelete users/${UID}`,
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
});
