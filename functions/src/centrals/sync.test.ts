import { describe, expect, it, vi } from 'vitest';

import { fanCountSyncTask } from './model';
import { queueFanCountSync, runFanCountSync, type FanCountQueue } from './sync';
import type { Firestore } from 'firebase-admin/firestore';

const EVENT_TIME = Date.parse('2026-10-05T15:00:03.250Z');

function fakeQueue(
  enqueue: FanCountQueue['enqueue'],
): FanCountQueue & { enqueue: ReturnType<typeof vi.fn> } {
  return { enqueue: vi.fn(enqueue) };
}

describe('gatilho queueArtistFanCountSync', () => {
  it('põe na fila a tarefa da janela da gravação, com id e horário', async () => {
    const queue = fakeQueue(async () => {});
    const log = { error: vi.fn() };
    expect(await queueFanCountSync(queue, 'nenho', EVENT_TIME, { emulator: false, log })).toBe(
      'queued',
    );
    const task = fanCountSyncTask('nenho', EVENT_TIME);
    expect(queue.enqueue).toHaveBeenCalledWith(
      { artistId: 'nenho' },
      { id: task.id, scheduleTime: task.scheduleTime },
    );
  });

  it('id repetido (a tarefa da janela já existe) é ignorado', async () => {
    const queue = fakeQueue(async () => {
      throw Object.assign(new Error('A task with ID x already exists'), {
        code: 'functions/task-already-exists',
      });
    });
    expect(await queueFanCountSync(queue, 'nenho', EVENT_TIME, { emulator: false })).toBe('exists');
  });

  it('outro erro lança, e o gatilho repete', async () => {
    const failure = Object.assign(new Error('permission denied'), {
      code: 'functions/permission-denied',
    });
    const queue = fakeQueue(async () => {
      throw failure;
    });
    await expect(queueFanCountSync(queue, 'nenho', EVENT_TIME, { emulator: false })).rejects.toBe(
      failure,
    );
  });

  it('artistId fora do formato: log de erro, sem lançar e sem fila', async () => {
    const queue = fakeQueue(async () => {});
    const log = { error: vi.fn() };
    expect(
      await queueFanCountSync(queue, 'Netto-Brito', EVENT_TIME, { emulator: false, log }),
    ).toBe('invalid');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('no emulador, enfileira sem id e sem horário (ele roda na hora e nunca libera um id)', async () => {
    const queue = fakeQueue(async () => {});
    await queueFanCountSync(queue, 'nenho', EVENT_TIME, { emulator: true });
    expect(queue.enqueue).toHaveBeenCalledWith({ artistId: 'nenho' });
  });
});

describe('tarefa syncArtistFanCount', () => {
  it('artistId fora do formato: log de erro e termina sem erro (a fila não repete)', async () => {
    const log = { error: vi.fn() };
    const db = {} as Firestore;
    expect(await runFanCountSync(db, { artistId: '__x__' }, { log })).toBeNull();
    expect(await runFanCountSync(db, null, { log })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('erro na última tentativa fica no log e lança; antes dela, só lança', async () => {
    const failure = new Error('Firestore fora do ar');
    const db = {
      collection: () => {
        throw failure;
      },
    } as unknown as Firestore;
    const log = { error: vi.fn() };
    await expect(runFanCountSync(db, { artistId: 'nenho' }, { retryCount: 1, log })).rejects.toBe(
      failure,
    );
    expect(log.error).not.toHaveBeenCalled();
    await expect(runFanCountSync(db, { artistId: 'nenho' }, { retryCount: 4, log })).rejects.toBe(
      failure,
    );
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
