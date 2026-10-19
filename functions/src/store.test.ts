import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { leaveAllCentrals } from './centrals/service';
import { FILTERED_NAME, isBlockedHandle, isBlockedText } from './content-filter';
import { removeFanClubData } from './fan-clubs/service';
import type { FanPhotoFiles } from './fan-profile/files';
import { detachReferrals, removeInviteData } from './invites/service';
import { removeFanEngagement } from './posts/service';
import { cancelFanRedemptions } from './rewards/service';
import { fanSearchKeys } from './fan-profile/search';
import { createProfile, deleteUserData } from './store';

// A ordem da exclusão de conta é o que impede o fanCount 1 acima para sempre
// (docs/arquitetura-api.md, 19.12), o marcador de visita debaixo de um
// convidante excluído (20.10) e, desde o bloco 9 (24.11), a reserva nova de
// uma troca de @ presa a uma conta morta e a foto órfã no Storage: o perfil
// sai sozinho antes de tudo, as reservas de @ logo depois, o código do
// convite logo depois, os vínculos e o engajamento do mural (21.12) antes do
// recursiveDelete, e os convidados
// do fã são desligados depois. A linha do fã no arquivo das temporadas (bloco
// 8, 23.13) sai depois da carteira. Os pedidos da loja (bloco 10, 25.11) são
// cancelados e anonimizados depois do engajamento do mural e antes do
// recursiveDelete, e o fã-clube (seção 34, 34.7) sai antes deles. Nos
// emuladores, as entradas terminam antes da
// exclusão, e a ordem trocada passaria; aqui um Firestore falso anota cada
// passo.
vi.mock('./centrals/service', () => ({ leaveAllCentrals: vi.fn() }));
vi.mock('./posts/service', () => ({ removeFanEngagement: vi.fn() }));
vi.mock('./rewards/service', () => ({ cancelFanRedemptions: vi.fn() }));
vi.mock('./fan-clubs/service', () => ({ removeFanClubData: vi.fn() }));
vi.mock('./invites/service', () => ({
  removeInviteData: vi.fn(),
  detachReferrals: vi.fn(),
  referralRef: (db: Firestore, uid: string) => db.collection('referrals').doc(uid),
}));
// O filtro do que o fã publica (seção 30) trocado por um de palavras neutras:
// nenhum termo da lista de verdade entra no repositório (30.11).
vi.mock('./content-filter', async (importOriginal) => {
  const { fakeContentFilter } = await import('../test/content-filter-fake.js');
  return fakeContentFilter(await importOriginal());
});

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
  const season = (id: string) => ({
    ref: {
      collection: (name: string) => ({ doc: (uid: string) => doc(`seasons/${id}/${name}/${uid}`) }),
    },
  });
  const seasons = [season('temporada-verao'), season('temporada-carnaval')];
  const collection = (name: string) => ({
    doc: (id: string) => doc(`${name}/${id}`),
    where: () => ({
      get: async () =>
        name === 'usernames' ? { docs: [reservation], empty: false, size: 1 } : empty,
      limit: () => ({ get: async () => empty }),
    }),
    select: () => ({
      get: async () =>
        name === 'seasons' ? { docs: seasons, empty: false, size: seasons.length } : empty,
    }),
  });
  return {
    collection,
    batch: () => {
      const deletes: string[] = [];
      return {
        delete: (ref: { path: string }) => deletes.push(ref.path),
        commit: async () => {
          steps.push(`batch ${deletes.join(', ')}`);
        },
      };
    },
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
    vi.mocked(cancelFanRedemptions).mockReset();
    vi.mocked(removeFanClubData).mockReset();
  });

  it('o perfil sai sozinho primeiro, as reservas e o convite logo depois e os convidados depois do perfil', async () => {
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
      return { likes: 0, comments: 0, reports: 0, profileReports: 0, blocks: 0 };
    });
    vi.mocked(cancelFanRedemptions).mockImplementation(async (_db, uid) => {
      steps.push(`cancelFanRedemptions ${uid}`);
      return { canceled: 0, anonymized: 0 };
    });
    vi.mocked(removeFanClubData).mockImplementation(async (_db, uid) => {
      steps.push(`removeFanClubData ${uid}`);
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps).toEqual([
      `delete users/${UID}`,
      'delete usernames/camilarib',
      `removeInviteData ${UID}`,
      `leaveAllCentrals ${UID}`,
      `removeFanEngagement ${UID}`,
      `removeFanClubData ${UID}`,
      `cancelFanRedemptions ${UID}`,
      `recursiveDelete users/${UID}`,
      `delete referrals/${UID}`,
      `detachReferrals ${UID}`,
      `recursiveDelete wallets/${UID}`,
      `batch seasons/temporada-verao/standings/${UID}, seasons/temporada-carnaval/standings/${UID}`,
      `delete staff/${UID}`,
    ]);
  });

  it('com o Storage, a pasta da foto sai por último, arquivo por arquivo (bloco 9)', async () => {
    const steps: string[] = [];
    const files = {
      list: vi.fn(async (prefix: string) => {
        steps.push(`list ${prefix}`);
        return [`${prefix}photo-agora0001.jpg`, `${prefix}photo-falhou01.jpg`];
      }),
      remove: vi.fn(async (path: string) => {
        steps.push(`remove ${path}`);
      }),
    } as unknown as FanPhotoFiles;

    await deleteUserData(fakeDb(steps), UID, { files });

    expect(steps.slice(-4)).toEqual([
      `delete staff/${UID}`,
      `list fans/${UID}/`,
      `remove fans/${UID}/photo-agora0001.jpg`,
      `remove fans/${UID}/photo-falhou01.jpg`,
    ]);
    expect(steps[0]).toBe(`delete users/${UID}`);
  });

  it('arquivo que fica na pasta faz a exclusão lançar (o gatilho tenta de novo); bucket ausente conta como vazio', async () => {
    const failing = {
      list: async (prefix: string) => [`${prefix}photo-agora0001.jpg`],
      remove: async () => {
        throw new Error('503');
      },
    } as unknown as FanPhotoFiles;
    await expect(deleteUserData(fakeDb([]), UID, { files: failing })).rejects.toThrow(
      /Ficaram 1 arquivo/,
    );
    const noBucket = {
      list: async () => {
        throw Object.assign(new Error('The specified bucket does not exist.'), { code: 404 });
      },
      remove: vi.fn(),
    } as unknown as FanPhotoFiles;
    await expect(deleteUserData(fakeDb([]), UID, { files: noBucket })).resolves.toBeUndefined();
  });

  it('sem files (o desfazer do cadastro), nenhuma chamada ao Storage', async () => {
    const steps: string[] = [];
    await deleteUserData(fakeDb(steps), UID);
    expect(steps.some((step) => step.startsWith('list') || step.startsWith('remove'))).toBe(false);
    expect(steps.at(-1)).toBe(`delete staff/${UID}`);
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
      return { likes: 1, comments: 1, reports: 0, profileReports: 0, blocks: 0 };
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps.indexOf(`delete users/${UID}`)).toBeLessThan(
      steps.indexOf('removeFanEngagement terminou'),
    );
    expect(steps.indexOf('removeFanEngagement terminou')).toBeLessThan(
      steps.indexOf(`recursiveDelete users/${UID}`),
    );
  });

  it('os pedidos da loja são cancelados depois do engajamento e antes do recursiveDelete (25.11)', async () => {
    const steps: string[] = [];
    vi.mocked(removeFanEngagement).mockImplementation(async () => {
      steps.push('removeFanEngagement');
      return { likes: 0, comments: 0, reports: 0, profileReports: 0, blocks: 0 };
    });
    vi.mocked(cancelFanRedemptions).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      steps.push('cancelFanRedemptions terminou');
      return { canceled: 1, anonymized: 2 };
    });

    await deleteUserData(fakeDb(steps), UID);

    expect(steps.indexOf('removeFanEngagement')).toBeLessThan(
      steps.indexOf('cancelFanRedemptions terminou'),
    );
    expect(steps.indexOf('cancelFanRedemptions terminou')).toBeLessThan(
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

/**
 * Firestore falso com uma transação: o perfil existe ou não, e os @ estão
 * livres, menos os de `taken`. As reservas lidas ficam em `reads`.
 */
function profileDb(
  profileExists: boolean,
  taken: readonly string[] = [],
): { db: Firestore; writes: Write[]; reads: string[] } {
  const writes: Write[] = [];
  const reads: string[] = [];
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
        getAll: async (...targets: { path: string; id: string }[]) => {
          reads.push(...targets.map((target) => target.path));
          return targets.map((target) => ({
            exists: taken.includes(target.id),
            ref: target,
            id: target.id,
          }));
        },
        create: (target: { path: string }, data: Record<string, unknown>) =>
          writes.push({ op: 'create', path: target.path, data }),
        set: (target: { path: string }, data: Record<string, unknown>) =>
          writes.push({ op: 'set', path: target.path, data }),
      }),
  } as unknown as Firestore;
  return { db, writes, reads };
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
      // A busca de fãs do painel (bloco 11, 26.7): o @ e o nome.
      searchKeys: fanSearchKeys('Camila Ribeiro', 'camilarib'),
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

// --- O nome do cadastro e o @ automático (seção 30, decisão 11) -------------------

// Pela opção (b') do dono, com o filtro falso de palavras neutras: o "pepino" e
// a forma "pepina" são palavra, a "berinjela" vale como trecho, e o "chuchu
// azedo" é frase.
describe('o filtro do que o fã publica no createProfile (seção 30, decisão 11)', () => {
  const sevens = (count: number) => '7'.repeat(count);

  beforeEach(() => {
    vi.mocked(isBlockedText).mockClear();
    vi.mocked(isBlockedHandle).mockClear();
  });

  it('o nome barrado vira "Fã" e o @ vai para o automático, com o searchKeys deles', async () => {
    for (const name of ['Camila Pepino', 'Pepina', 'Bia Chuchu Azedo']) {
      const { db, writes } = profileDb(false);
      const result = await createProfile(db, { uid: UID, displayName: name }, sevens, {
        now: () => NOW,
      });
      expect(result, name).toEqual({ status: 'created', username: 'fa777777' });
      const profile = writes.find((write) => write.path === `users/${UID}`)?.data;
      expect(profile, name).toMatchObject({
        displayName: FILTERED_NAME,
        username: 'fa777777',
        searchKeys: fanSearchKeys(FILTERED_NAME, 'fa777777'),
      });
      expect(profile, name).not.toHaveProperty('updatedAt');
      expect(writes.some((write) => write.path === 'usernames/fa777777')).toBe(true);
      expect(isBlockedText).toHaveBeenLastCalledWith(name, 'displayName');
    }
    // O automático nunca passa pelo filtro (os dígitos do "fa" virariam letras).
    expect(isBlockedHandle).not.toHaveBeenCalled();
  });

  it('o nome limpo com a base do @ barrada: o nome fica, e o @ vai para o automático', async () => {
    // "Pepi No" dá a base "pepino" (a palavra inteira); "Berinjel Ana", a
    // "berinjelana" (o trecho). Nenhum pedaço do nome bate.
    for (const name of ['Pepi No', 'Berinjel Ana']) {
      const { db, writes } = profileDb(false);
      const result = await createProfile(db, { uid: UID, displayName: name }, sevens, {
        now: () => NOW,
      });
      expect(result, name).toEqual({ status: 'created', username: 'fa777777' });
      expect(writes.find((write) => write.path === `users/${UID}`)?.data, name).toMatchObject({
        displayName: name,
        username: 'fa777777',
        searchKeys: fanSearchKeys(name, 'fa777777'),
      });
    }
    expect(vi.mocked(isBlockedText).mock.results.map((call) => call.value)).toEqual([false, false]);
    expect(vi.mocked(isBlockedHandle).mock.calls).toEqual([['pepino'], ['berinjelana']]);
  });

  it('o @ com os dígitos sorteados que bate fica fora dos candidatos; o automático fica no fim', async () => {
    // "pepin" é limpo, mas "pepin05" e "pepin0055" viram "pepinos" (os dígitos
    // no lugar de letras e as letras repetidas): com o "pepin" tomado, nenhum
    // dos dois é lido nem reservado.
    const digits = (count: number) => ({ 2: '05', 4: '0055' })[count] ?? sevens(count);
    const { db, writes, reads } = profileDb(false, ['pepin']);
    const result = await createProfile(db, { uid: UID, displayName: 'Pepin' }, digits, {
      now: () => NOW,
    });
    expect(result).toEqual({ status: 'created', username: 'fa77777777' });
    expect(reads).toEqual(['usernames/pepin', 'usernames/fa77777777']);
    expect(writes.find((write) => write.path === `users/${UID}`)?.data).toMatchObject({
      displayName: 'Pepin',
      username: 'fa77777777',
    });
    expect(vi.mocked(isBlockedHandle).mock.calls.flat()).not.toContain('fa77777777');
  });

  it('o nome limpo fica, com o @ dele; o nome sem letra visível continua null e nem chega ao filtro', async () => {
    const clean = profileDb(false);
    expect(
      await createProfile(clean.db, { uid: UID, displayName: 'Vila Berinjela' }, sevens, {
        now: () => NOW,
      }),
    ).toEqual({ status: 'created', username: 'vilaber' });
    expect(clean.writes.find((write) => write.path === `users/${UID}`)?.data).toMatchObject({
      displayName: 'Vila Berinjela',
    });

    vi.mocked(isBlockedText).mockClear();
    const empty = profileDb(false);
    expect(
      await createProfile(empty.db, { uid: UID, displayName: '\u034F' }, sevens, {
        now: () => NOW,
      }),
    ).toEqual({ status: 'created', username: 'fa777777' });
    expect(empty.writes.find((write) => write.path === `users/${UID}`)?.data).toMatchObject({
      displayName: null,
    });
    expect(isBlockedText).not.toHaveBeenCalled();
  });
});
