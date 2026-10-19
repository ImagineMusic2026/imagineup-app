import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FILTERED_NAME, isBlockedText } from '../content-filter';
import { FAN_PROFILE_SYNC_WINDOW_MS } from './model';
import { fanSearchKeys } from './search';
import {
  queueFanPhotoPurge,
  queueFanProfileSync,
  runFanProfileSync,
  type FanProfileQueue,
} from './sync';

// O gatilho do perfil e a fila das cópias (24.7) com um Firestore falso: o
// perfil existe ou não, o orçamento guardado, e as gravações anotadas (as do
// `searchKeys`, bloco 11, em `updates`).

// O filtro do que o fã publica (seção 30) trocado por um de palavras neutras:
// nenhum termo da lista de verdade entra no repositório (30.11).
vi.mock('../content-filter', async (importOriginal) => {
  const { fakeContentFilter } = await import('../../test/content-filter-fake.js');
  return fakeContentFilter(await importOriginal());
});

const UID = 'uidCamila';
// 15:04:03 em UTC, meio-dia em São Paulo.
const EVENT_TIME = Date.parse('2026-10-07T15:04:03.250Z');
const WINDOW = Math.floor(EVENT_TIME / FAN_PROFILE_SYNC_WINDOW_MS);

const BEFORE = { displayName: 'Camila', city: null, photoURL: null, photoPath: null };
const AFTER = { ...BEFORE, displayName: 'Camila Ribeiro' };

function fakeDb(options: { profile?: DocumentData | null; budget?: DocumentData } = {}) {
  const profile: DocumentData | null = options.profile === undefined ? AFTER : options.profile;
  const writes: { path: string; data: unknown }[] = [];
  const updates: { path: string; data: unknown }[] = [];
  const ref = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({
      exists: profile !== null && path === `users/${UID}`,
      get: (field: string) => profile?.[field],
    }),
  });
  const snap = (path: string) => {
    const data =
      path === `users/${UID}`
        ? (profile ?? undefined)
        : path.endsWith('/profileSync/budget')
          ? options.budget
          : undefined;
    return {
      exists: data !== undefined,
      data: () => data,
      get: (field: string) => data?.[field],
      ref: { path },
    };
  };
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: async (target: { path: string }) => snap(target.path),
        getAll: async (...refs: { path: string }[]) => refs.map((target) => snap(target.path)),
        set: (target: { path: string }, data: unknown) => writes.push({ path: target.path, data }),
        update: (target: { path: string }, data: unknown) =>
          updates.push({ path: target.path, data }),
      }),
  };
  return { db: db as unknown as Firestore, writes, updates };
}

function fakeQueue(enqueue: FanProfileQueue['enqueue'] = async () => {}) {
  return { enqueue: vi.fn(enqueue) };
}

const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const noFiles = { remove: vi.fn(async () => {}) };

describe('gatilho queueFanProfileSync', () => {
  it('o nome mudou: grava o orçamento e põe a tarefa da janela de 5 min', async () => {
    const { db, writes, updates } = fakeDb();
    const queue = fakeQueue();
    const result = await queueFanProfileSync(
      db,
      queue,
      noFiles,
      { uid: UID, before: BEFORE, after: AFTER, eventTime: EVENT_TIME },
      { emulator: false, log: quiet() },
    );
    expect(result).toEqual({ photo: null, task: 'queued', searchKeys: 'written' });
    // O `searchKeys` do perfil de agora, sem `updatedAt` (bloco 11, 26.5).
    expect(updates).toEqual([
      { path: `users/${UID}`, data: { searchKeys: fanSearchKeys('Camila Ribeiro', undefined) } },
    ]);
    expect(writes).toEqual([
      {
        path: `users/${UID}/profileSync/budget`,
        data: { day: '2026-10-07', windows: 1, lastWindow: WINDOW },
      },
    ]);
    expect(queue.enqueue).toHaveBeenCalledWith(
      { uid: UID },
      {
        id: `fanprofile-${UID}-${WINDOW}`,
        scheduleTime: new Date('2026-10-07T15:05:01.000Z'),
      },
    );
  });

  it('no emulador, a tarefa vai sem id e sem horário (o orçamento conta igual)', async () => {
    const { db, writes } = fakeDb();
    const queue = fakeQueue();
    await queueFanProfileSync(
      db,
      queue,
      noFiles,
      { uid: UID, before: BEFORE, after: AFTER, eventTime: EVENT_TIME },
      { emulator: true },
    );
    expect(queue.enqueue).toHaveBeenCalledWith({ uid: UID });
    expect(writes).toHaveLength(1);
  });

  it('depois do orçamento do dia, a janela de 1 h, sem gravar', async () => {
    const { db, writes } = fakeDb({
      budget: { day: '2026-10-07', windows: 12, lastWindow: WINDOW - 1 },
    });
    const queue = fakeQueue();
    await queueFanProfileSync(
      db,
      queue,
      noFiles,
      { uid: UID, before: BEFORE, after: AFTER, eventTime: EVENT_TIME },
      { emulator: false },
    );
    expect(writes).toEqual([]);
    expect(queue.enqueue).toHaveBeenCalledWith(
      { uid: UID },
      {
        id: `fanprofileh-${UID}-${Math.floor(EVENT_TIME / 3_600_000)}`,
        scheduleTime: new Date('2026-10-07T16:00:01.000Z'),
      },
    );
  });

  it('a cidade, o updatedAt e o searchKeys sozinhos não põem tarefa; o @ põe (seção 34)', async () => {
    const { db, writes } = fakeDb();
    const queue = fakeQueue();
    for (const after of [
      { ...BEFORE, city: 'Irará' },
      { ...BEFORE, updatedAt: 1 },
      { ...BEFORE, searchKeys: ['ca', 'cam'] },
    ]) {
      expect(
        await queueFanProfileSync(
          db,
          queue,
          noFiles,
          { uid: UID, before: BEFORE, after, eventTime: EVENT_TIME },
          { emulator: false },
        ),
      ).toEqual({ photo: null, task: 'unchanged' });
    }
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    // O @ trocado acerta o `searchKeys` e, desde o fã-clube (seção 34, 34.5),
    // põe a tarefa: o fã-clube e a candidatura copiam o @.
    expect(
      await queueFanProfileSync(
        db,
        queue,
        noFiles,
        {
          uid: UID,
          before: BEFORE,
          after: { ...BEFORE, username: 'camilaribeiro' },
          eventTime: EVENT_TIME,
        },
        { emulator: false },
      ),
    ).toEqual({ photo: null, task: 'queued', searchKeys: 'written' });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
  });

  it('o searchKeys sai do perfil relido, nunca do evento, e só grava quando muda', async () => {
    // Evento velho (o nome "Camila" de antes) entregue depois do novo: as
    // chaves ficam as do nome de agora, que já estão gravadas.
    const now = { ...AFTER, searchKeys: fanSearchKeys('Camila Ribeiro', undefined) };
    const { db, updates } = fakeDb({ profile: now });
    const result = await queueFanProfileSync(
      db,
      fakeQueue(),
      noFiles,
      { uid: UID, before: AFTER, after: BEFORE, eventTime: EVENT_TIME },
      { emulator: false },
    );
    expect(result.searchKeys).toBe('unchanged');
    expect(updates).toEqual([]);
  });

  it('sem perfil (conta sendo excluída): não grava orçamento nem põe tarefa', async () => {
    const { db, writes, updates } = fakeDb({ profile: null });
    const queue = fakeQueue();
    expect(
      await queueFanProfileSync(
        db,
        queue,
        noFiles,
        { uid: UID, before: BEFORE, after: AFTER, eventTime: EVENT_TIME },
        { emulator: false },
      ),
    ).toEqual({ photo: null, task: 'no-profile', searchKeys: 'no-profile' });
    expect(writes).toEqual([]);
    expect(updates).toEqual([]);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('id repetido é ignorado; outro erro lança, e o gatilho repete', async () => {
    const exists = fakeQueue(async () => {
      throw Object.assign(new Error('exists'), { code: 'functions/task-already-exists' });
    });
    const input = { uid: UID, before: BEFORE, after: AFTER, eventTime: EVENT_TIME };
    expect(
      await queueFanProfileSync(fakeDb().db, exists, noFiles, input, { emulator: false }),
    ).toEqual({ photo: null, task: 'exists', searchKeys: 'written' });
    const failure = Object.assign(new Error('permission denied'), {
      code: 'functions/permission-denied',
    });
    const denied = fakeQueue(async () => {
      throw failure;
    });
    await expect(
      queueFanProfileSync(fakeDb().db, denied, noFiles, input, { emulator: false }),
    ).rejects.toBe(failure);
  });

  it('a foto trocada sai na hora (relido o perfil); a que voltou a ser a foto fica', async () => {
    const oldPath = `fans/${UID}/photo-antiga001.jpg`;
    const newPath = `fans/${UID}/photo-nova00001.jpg`;
    const before = { ...BEFORE, photoURL: 'https://x/antiga', photoPath: oldPath };
    const after = { ...BEFORE, photoURL: 'https://x/nova', photoPath: newPath };
    const files = { remove: vi.fn(async () => {}) };
    const { db } = fakeDb({ profile: after });
    const result = await queueFanProfileSync(
      db,
      fakeQueue(),
      files,
      { uid: UID, before, after, eventTime: EVENT_TIME },
      { emulator: false },
    );
    expect(result).toEqual({ photo: 'removed', task: 'queued' });
    expect(files.remove).toHaveBeenCalledWith(oldPath);

    const kept = { remove: vi.fn(async () => {}) };
    const back = await queueFanProfileSync(
      fakeDb({ profile: before }).db,
      fakeQueue(),
      kept,
      { uid: UID, before, after, eventTime: EVENT_TIME },
      { emulator: false },
    );
    expect(back.photo).toBe('kept');
    expect(kept.remove).not.toHaveBeenCalled();
  });

  it('caminho antigo fora da pasta do fã: só o log, nada apagado', async () => {
    const files = { remove: vi.fn(async () => {}) };
    const log = quiet();
    const result = await queueFanProfileSync(
      fakeDb().db,
      fakeQueue(),
      files,
      {
        uid: UID,
        before: { ...BEFORE, photoPath: 'artists/nenho/foto.webp' },
        after: BEFORE,
        eventTime: EVENT_TIME,
      },
      { emulator: false, log },
    );
    expect(result.photo).toBe('invalid');
    expect(files.remove).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('uid fora do formato: só o log', async () => {
    const log = quiet();
    const queue = fakeQueue();
    expect(
      await queueFanProfileSync(
        fakeDb().db,
        queue,
        noFiles,
        { uid: 'uid-com-hifen', before: BEFORE, after: AFTER, eventTime: EVENT_TIME },
        { emulator: false, log },
      ),
    ).toEqual({ photo: null, task: 'invalid' });
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledOnce();
  });
});

// Pela opção (b') do dono (seção 30, decisão 11), com o filtro falso: o
// "pepino" e a forma "pepina" são palavra, e o "chuchu azedo" é frase.
describe('o nome barrado no gatilho do perfil (seção 30, decisão 11)', () => {
  const NO_NAME = { ...BEFORE, displayName: null, username: 'fa123456' };

  beforeEach(() => {
    vi.mocked(isBlockedText).mockClear();
  });

  it('o nome barrado gravado pela regra vira "Fã", com o searchKeys e sem updatedAt', async () => {
    for (const name of ['Camila Pepino', 'Pepina', 'Bia Chuchu Azedo']) {
      // O primeiro nome, como a regra firstProfileName grava: com o updatedAt.
      const after = { ...NO_NAME, displayName: name, updatedAt: 1 };
      const { db, updates } = fakeDb({ profile: after });
      const queue = fakeQueue();
      const result = await queueFanProfileSync(
        db,
        queue,
        noFiles,
        { uid: UID, before: NO_NAME, after, eventTime: EVENT_TIME },
        { emulator: false, log: quiet() },
      );
      // A tarefa das cópias vai como em toda troca de nome, e lê o "Fã" de agora.
      expect(result, name).toEqual({ photo: null, task: 'queued', searchKeys: 'written' });
      expect(updates, name).toEqual([
        {
          path: `users/${UID}`,
          data: {
            displayName: FILTERED_NAME,
            searchKeys: fanSearchKeys(FILTERED_NAME, 'fa123456'),
          },
        },
      ]);
      expect(isBlockedText).toHaveBeenLastCalledWith(name, 'displayName');
    }
  });

  it('o "Fã" gravado dispara o gatilho, que não troca de novo nem confere o "Fã"', async () => {
    const now = {
      ...NO_NAME,
      displayName: FILTERED_NAME,
      searchKeys: fanSearchKeys(FILTERED_NAME, 'fa123456'),
    };
    const { db, updates } = fakeDb({ profile: now });
    const result = await queueFanProfileSync(
      db,
      fakeQueue(),
      noFiles,
      {
        uid: UID,
        before: { ...NO_NAME, displayName: 'Camila Pepino' },
        after: now,
        eventTime: EVENT_TIME,
      },
      { emulator: false },
    );
    expect(result.searchKeys).toBe('unchanged');
    expect(updates).toEqual([]);
    expect(isBlockedText).not.toHaveBeenCalled();
  });

  it('a troca só do @ não confere o nome que já estava (sem retroatividade)', async () => {
    const before = { ...BEFORE, displayName: 'Camila Pepino', username: 'camila' };
    const after = { ...before, username: 'camilanova' };
    const { db, updates } = fakeDb({ profile: after });
    const result = await queueFanProfileSync(
      db,
      fakeQueue(),
      noFiles,
      { uid: UID, before, after, eventTime: EVENT_TIME },
      { emulator: false },
    );
    expect(result).toEqual({ photo: null, task: 'queued', searchKeys: 'written' });
    expect(updates).toEqual([
      { path: `users/${UID}`, data: { searchKeys: fanSearchKeys('Camila Pepino', 'camilanova') } },
    ]);
    expect(isBlockedText).not.toHaveBeenCalled();
  });

  it('o nome conferido é o do perfil de agora, nunca o do evento', async () => {
    // Evento velho com um nome barrado, entregue depois de o fã trocar o nome pela API.
    const now = { ...AFTER, searchKeys: fanSearchKeys('Camila Ribeiro', undefined) };
    const { db, updates } = fakeDb({ profile: now });
    const result = await queueFanProfileSync(
      db,
      fakeQueue(),
      noFiles,
      {
        uid: UID,
        before: BEFORE,
        after: { ...BEFORE, displayName: 'Camila Pepino' },
        eventTime: EVENT_TIME,
      },
      { emulator: false },
    );
    expect(result.searchKeys).toBe('unchanged');
    expect(updates).toEqual([]);
    expect(isBlockedText).toHaveBeenCalledWith('Camila Ribeiro', 'displayName');
  });
});

describe('tarefa syncFanProfile', () => {
  it('uid fora do formato: log de erro e termina sem erro (a fila não repete)', async () => {
    const log = quiet();
    const db = {} as Firestore;
    const files = {} as never;
    expect(await runFanProfileSync(db, files, { uid: '../x' }, { log })).toBeNull();
    expect(await runFanProfileSync(db, files, null, { log })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('erro na última tentativa fica no log e lança; antes dela, só lança', async () => {
    const failure = new Error('Firestore fora do ar');
    const db = {
      collection: () => {
        throw failure;
      },
    } as unknown as Firestore;
    const log = quiet();
    await expect(
      runFanProfileSync(db, {} as never, { uid: UID }, { retryCount: 1, log }),
    ).rejects.toBe(failure);
    expect(log.error).not.toHaveBeenCalled();
    await expect(
      runFanProfileSync(db, {} as never, { uid: UID }, { retryCount: 4, log }),
    ).rejects.toBe(failure);
    expect(log.error).toHaveBeenCalledOnce();
  });
});

describe('segunda limpeza da exclusão (queueFanPhotoPurge)', () => {
  const NOW = Date.parse('2026-10-07T15:00:00.000Z');

  it('põe a tarefa com o id -deleted, 1 h depois', async () => {
    const queue = fakeQueue();
    expect(await queueFanPhotoPurge(queue, UID, { now: NOW, emulator: false })).toBe('queued');
    expect(queue.enqueue).toHaveBeenCalledWith(
      { uid: UID },
      { id: `fanprofile-${UID}-deleted`, scheduleTime: new Date('2026-10-07T16:00:00.000Z') },
    );
  });

  it('no emulador, sem id e sem horário', async () => {
    const queue = fakeQueue();
    await queueFanPhotoPurge(queue, UID, { now: NOW, emulator: true });
    expect(queue.enqueue).toHaveBeenCalledWith({ uid: UID });
  });

  it('id repetido é ignorado; outro erro só vai para o log', async () => {
    const exists = fakeQueue(async () => {
      throw Object.assign(new Error('exists'), { code: 'functions/task-already-exists' });
    });
    expect(await queueFanPhotoPurge(exists, UID, { now: NOW, emulator: false })).toBe('exists');
    const log = quiet();
    const broken = fakeQueue(async () => {
      throw new Error('fila fora do ar');
    });
    expect(await queueFanPhotoPurge(broken, UID, { now: NOW, emulator: false, log })).toBe(
      'failed',
    );
    expect(log.error).toHaveBeenCalledOnce();
  });
});
