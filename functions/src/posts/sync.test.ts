import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import {
  postCountsSyncTask,
  queuePostCountSync,
  runPostCountSync,
  type PostCountsQueue,
} from './sync';

const EVENT_TIME = Date.parse('2026-10-05T15:00:03.250Z');

function fakeQueue(
  enqueue: PostCountsQueue['enqueue'],
): PostCountsQueue & { enqueue: ReturnType<typeof vi.fn> } {
  return { enqueue: vi.fn(enqueue) };
}

describe('gatilho queuePostCountSync', () => {
  it('põe na fila a tarefa da janela da gravação, com id e horário', async () => {
    const queue = fakeQueue(async () => {});
    expect(await queuePostCountSync(queue, 'p-clipe', EVENT_TIME, { emulator: false })).toBe(
      'queued',
    );
    const task = postCountsSyncTask('p-clipe', EVENT_TIME);
    expect(task.id).toBe(`postcounts-p-clipe-${Math.floor(EVENT_TIME / 10_000)}`);
    expect(queue.enqueue).toHaveBeenCalledWith(
      { postId: 'p-clipe' },
      { id: task.id, scheduleTime: task.scheduleTime },
    );
  });

  it('id repetido é ignorado; outro erro lança', async () => {
    const exists = fakeQueue(async () => {
      throw Object.assign(new Error('existe'), { code: 'functions/task-already-exists' });
    });
    expect(await queuePostCountSync(exists, 'p-clipe', EVENT_TIME, { emulator: false })).toBe(
      'exists',
    );
    const failure = Object.assign(new Error('negado'), { code: 'functions/permission-denied' });
    const broken = fakeQueue(async () => {
      throw failure;
    });
    await expect(
      queuePostCountSync(broken, 'p-clipe', EVENT_TIME, { emulator: false }),
    ).rejects.toBe(failure);
  });

  it('postId fora do formato: log de erro, sem lançar e sem fila', async () => {
    const queue = fakeQueue(async () => {});
    const log = { error: vi.fn() };
    expect(await queuePostCountSync(queue, '__x__', EVENT_TIME, { emulator: false, log })).toBe(
      'invalid',
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('no emulador, enfileira sem id e sem horário', async () => {
    const queue = fakeQueue(async () => {});
    await queuePostCountSync(queue, 'p-clipe', EVENT_TIME, { emulator: true });
    expect(queue.enqueue).toHaveBeenCalledWith({ postId: 'p-clipe' });
  });
});

describe('tarefa syncPostCounts', () => {
  it('postId fora do formato: log de erro e termina sem erro', async () => {
    const log = { error: vi.fn() };
    expect(await runPostCountSync({} as Firestore, { postId: 'a/b' }, { log })).toBeNull();
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('erro na última tentativa fica no log e lança; antes dela, só lança', async () => {
    const failure = new Error('Firestore fora do ar');
    const db = {
      collection: () => {
        throw failure;
      },
    } as unknown as Firestore;
    const log = { error: vi.fn() };
    await expect(runPostCountSync(db, { postId: 'p-clipe' }, { retryCount: 0, log })).rejects.toBe(
      failure,
    );
    expect(log.error).not.toHaveBeenCalled();
    await expect(runPostCountSync(db, { postId: 'p-clipe' }, { retryCount: 4, log })).rejects.toBe(
      failure,
    );
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
