import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { DEFAULT_POINTS_CONFIG } from './config';
import { changePointsConfig } from './panel';

// O bloco do check-in diário no `updatePointsConfig` (seção 39), com um
// Firestore falso: o documento de config/points é gravado inteiro (`tx.set`
// sem merge), então o bloco precisa estar no pedido conferido, no documento
// novo e na lista dos campos da auditoria, ou some no salvar de outro bloco.
// O acesso pelas seções, a versão conferida e o resto da régua ficam com o
// teste de emulador (functions/test/game-panel.emulator.test.ts).

const NOW = Date.parse('2026-11-10T15:00:00.000Z');
const CYCLE = [3, 3, 4, 4, 5, 6, 15];
const CALLER = { uid: 'editora', token: { auth_time: 1 } };
const STAFF = {
  'staff/editora': {
    status: 'active',
    role: 'editor',
    sections: ['missions'],
    displayName: 'Editora',
  },
};

/** O config/points que o painel salvou antes de o código conhecer o check-in: sem o bloco. */
const SAVED_BEFORE = {
  version: 7,
  values: { ...DEFAULT_POINTS_CONFIG.values, like: 1 },
  dailyLimits: { like: 40, comment: 20, rsvp: 10, central_join: 10, mission: null },
  levels: DEFAULT_POINTS_CONFIG.levels,
  actionCaps: DEFAULT_POINTS_CONFIG.actionCaps,
};

type Write = { op: 'set' | 'create'; path: string; data: Record<string, unknown> };

/** Firestore falso: `existing` são os documentos que existem; guarda o que a transação grava. */
function fakeDb(existing: Record<string, Record<string, unknown>>) {
  const writes: Write[] = [];
  let auto = 0;
  const snap = (path: string) => ({
    exists: path in existing,
    data: () => existing[path],
    get: (field: string) => existing[path]?.[field],
  });
  const ref = (path: string): unknown => ({
    path,
    get: async () => snap(path),
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (path: string) => ({
    doc: (id?: string) => ref(`${path}/${id ?? `auto-${++auto}`}`),
  });
  const write = (op: Write['op']) => (target: { path: string }, data: Record<string, unknown>) =>
    void writes.push({ op, path: target.path, data });
  const db = {
    collection,
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: async (target: { path: string }) => snap(target.path),
        set: write('set'),
        create: write('create'),
      }),
  } as unknown as Firestore;
  return { db, writes };
}

/** Roda a callable com o documento dado e devolve o resultado, o documento gravado e a auditoria. */
async function change(points: Record<string, unknown> | null, data: Record<string, unknown>) {
  const { db, writes } = fakeDb({ ...STAFF, ...(points ? { 'config/points': points } : {}) });
  const result = await changePointsConfig({ db, now: () => NOW }, CALLER, data);
  return {
    result,
    writes,
    doc: writes.find((write) => write.path === 'config/points')?.data,
    audit: writes.find((write) => write.path.startsWith('staffAudit/'))?.data,
  };
}

describe('updatePointsConfig e o bloco do check-in (seção 39)', () => {
  it('liga só a chave no documento salvo sem o bloco: o resto fica, o ciclo é o padrão e a auditoria leva a chave', async () => {
    const { result, writes, doc, audit } = await change(SAVED_BEFORE, {
      expectedVersion: 7,
      checkin: { enabled: true },
    });
    expect(result).toEqual({ ok: true, version: 8 });
    expect(writes.map((write) => [write.op, write.path])).toEqual([
      ['set', 'config/points'],
      ['set', 'config/points/versions/8'],
      ['create', 'staffAudit/auto-1'],
    ]);
    expect(doc).toMatchObject({
      version: 8,
      values: { like: 1, comment: 2 },
      dailyLimits: { like: 40, mission: null, checkin: null },
      levels: DEFAULT_POINTS_CONFIG.levels,
      actionCaps: DEFAULT_POINTS_CONFIG.actionCaps,
      updatedBy: { uid: 'editora', name: 'Editora' },
    });
    expect(doc!.checkin).toEqual({ enabled: true, cycle: CYCLE });
    // A cópia da versão é o mesmo documento.
    expect(writes[1]!.data).toEqual(doc);
    expect(audit).toMatchObject({
      action: 'points.config.updated',
      actorUid: 'editora',
      section: 'missions',
      details: { fields: ['checkin'], checkinEnabled: true, fromVersion: 7, toVersion: 8 },
    });
  });

  it('salvar outro bloco no documento sem o bloco grava o check-in desligado, sem contar como mudança', async () => {
    const { doc, audit } = await change(SAVED_BEFORE, {
      expectedVersion: 7,
      values: { like: 2 },
    });
    expect(doc!.checkin).toEqual({ enabled: false, cycle: CYCLE });
    expect(doc!.dailyLimits).toMatchObject({ checkin: null, mission: null });
    expect(audit!.details).toEqual({ fields: ['values'], fromVersion: 7, toVersion: 8 });
  });

  it('salvar outro bloco mantém a chave ligada e o ciclo que a equipe gravou', async () => {
    const saved = {
      ...SAVED_BEFORE,
      version: 9,
      checkin: { enabled: true, cycle: [1, 2, 3, 4, 5, 6, 7] },
    };
    const { result, doc, audit } = await change(saved, {
      expectedVersion: 9,
      actionCaps: { like_set: 500 },
    });
    expect(result).toEqual({ ok: true, version: 10 });
    expect(doc!.checkin).toEqual({ enabled: true, cycle: [1, 2, 3, 4, 5, 6, 7] });
    expect(audit!.details).toEqual({ fields: ['actionCaps'], fromVersion: 9, toVersion: 10 });
  });

  it('só o ciclo muda o ciclo e deixa a chave; desligar leva a chave nova na auditoria', async () => {
    const saved = { ...SAVED_BEFORE, version: 9, checkin: { enabled: true, cycle: CYCLE } };
    const cycle = await change(saved, {
      expectedVersion: 9,
      checkin: { cycle: [5, 5, 5, 5, 5, 5, 50] },
    });
    expect(cycle.doc!.checkin).toEqual({ enabled: true, cycle: [5, 5, 5, 5, 5, 5, 50] });
    expect(cycle.audit!.details).toEqual({ fields: ['checkin'], fromVersion: 9, toVersion: 10 });

    const off = await change(saved, {
      expectedVersion: 9,
      values: { comment: 3 },
      checkin: { enabled: false },
    });
    expect(off.doc!.checkin).toEqual({ enabled: false, cycle: CYCLE });
    expect(off.audit!.details).toEqual({
      fields: ['values', 'checkin'],
      checkinEnabled: false,
      fromVersion: 9,
      toVersion: 10,
    });
  });

  it('o bloco igual ao de agora não grava nem audita', async () => {
    const saved = { ...SAVED_BEFORE, version: 9, checkin: { enabled: true, cycle: CYCLE } };
    for (const checkin of [{ enabled: true }, { cycle: CYCLE }, { enabled: true, cycle: CYCLE }]) {
      const { result, writes } = await change(saved, { expectedVersion: 9, checkin });
      expect(result).toEqual({ ok: true, version: 9 });
      expect(writes).toEqual([]);
    }
    // No documento sem o bloco, mandar o padrão também não muda nada.
    const untouched = await change(SAVED_BEFORE, {
      expectedVersion: 7,
      checkin: { enabled: false, cycle: CYCLE },
    });
    expect(untouched.result).toEqual({ ok: true, version: 7 });
    expect(untouched.writes).toEqual([]);
  });

  it('sem config/points, a primeira gravação parte do padrão do código (a versão 1)', async () => {
    const { result, doc } = await change(null, { expectedVersion: 0, checkin: { enabled: true } });
    expect(result).toEqual({ ok: true, version: 1 });
    expect(doc).toMatchObject({
      version: 1,
      values: DEFAULT_POINTS_CONFIG.values,
      dailyLimits: DEFAULT_POINTS_CONFIG.dailyLimits,
    });
    expect(doc!.checkin).toEqual({ enabled: true, cycle: CYCLE });
  });

  it.each([
    [{ enabled: 'sim' }, 'checkin.enabled'],
    [{ cycle: [3, 3, 4] }, 'checkin.cycle'],
    [{ cycle: [0, 3, 4, 4, 5, 6, 15] }, 'checkin.cycle.0'],
    [{}, 'checkin'],
    [null, 'checkin'],
  ])(
    'o bloco %j é recusado com invalid-request em %s, antes de ler ou gravar',
    async (checkin, field) => {
      // Sem o `staff/{uid}`: a recusa do corpo vem antes da leitura de quem chama.
      const { db, writes } = fakeDb({});
      await expect(
        changePointsConfig({ db, now: () => NOW }, CALLER, { expectedVersion: 7, checkin }),
      ).rejects.toMatchObject({ details: { reason: 'invalid-request', field } });
      expect(writes).toEqual([]);
    },
  );
});
