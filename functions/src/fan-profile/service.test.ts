import { describe, expect, it, vi } from 'vitest';

import type { FanPhotoFiles } from './files';
import { FAN_PHOTO_DELETE_BATCH } from './model';
import { purgeFanPhotos, removeInBatches } from './service';

// A pasta da foto na exclusão de conta e na tarefa (24.11), com um Storage
// falso: o Storage não ligado (o bucket que não existe ou sem nome na
// configuração) conta como pasta vazia, o arquivo que fica faz a limpeza
// lançar (quem chama tenta de novo) e as exclusões saem em lotes.

const UID = 'uidCamila';
const quiet = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe('purgeFanPhotos', () => {
  it('lista a pasta do fã (com a barra, para não pegar outro uid) e apaga arquivo por arquivo', async () => {
    const removed: string[] = [];
    const files = {
      list: vi.fn(async (prefix: string) => [
        `${prefix}photo-a0000001.jpg`,
        `${prefix}photo-b0000001.jpg`,
      ]),
      remove: vi.fn(async (path: string) => {
        removed.push(path);
      }),
    } as unknown as FanPhotoFiles;
    expect(await purgeFanPhotos(files, UID, quiet())).toBe(2);
    expect(files.list).toHaveBeenCalledWith(`fans/${UID}/`);
    expect(removed).toEqual([`fans/${UID}/photo-a0000001.jpg`, `fans/${UID}/photo-b0000001.jpg`]);
  });

  it('o bucket que não existe (404 na listagem) termina como pasta vazia, com aviso', async () => {
    const log = quiet();
    const files = {
      list: async () => {
        throw Object.assign(new Error('The specified bucket does not exist.'), { code: 404 });
      },
      remove: vi.fn(),
    } as unknown as FanPhotoFiles;
    expect(await purgeFanPhotos(files, UID, log)).toBe(0);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('o bucket sem nome na configuração (storage/invalid-argument do bucket()) também conta como vazia', async () => {
    const log = quiet();
    const files = {
      list: async () => {
        throw Object.assign(new Error('Bucket name not specified or invalid.'), {
          code: 'storage/invalid-argument',
        });
      },
      remove: vi.fn(),
    } as unknown as FanPhotoFiles;
    expect(await purgeFanPhotos(files, UID, log)).toBe(0);
    expect(log.warn).toHaveBeenCalledOnce();
    expect(files.remove).not.toHaveBeenCalled();
  });

  it('outro erro na listagem lança', async () => {
    const failure = Object.assign(new Error('503'), { code: 503 });
    const files = {
      list: async () => {
        throw failure;
      },
      remove: vi.fn(),
    } as unknown as FanPhotoFiles;
    await expect(purgeFanPhotos(files, UID, quiet())).rejects.toBe(failure);
  });

  it('um arquivo que falha ao apagar não impede os outros, e a limpeza lança no fim', async () => {
    const removed: string[] = [];
    const log = quiet();
    const files = {
      list: async (prefix: string) => [
        `${prefix}photo-a0000001.jpg`,
        `${prefix}photo-b0000001.jpg`,
      ],
      remove: async (path: string) => {
        if (path.endsWith('a0000001.jpg')) throw new Error('503 Service Unavailable');
        removed.push(path);
      },
    } as unknown as FanPhotoFiles;
    await expect(purgeFanPhotos(files, UID, log)).rejects.toThrow(/Ficaram 1 arquivo/);
    expect(removed).toEqual([`fans/${UID}/photo-b0000001.jpg`]);
    expect(log.error).toHaveBeenCalledOnce();
  });
});

describe('exclusões em lotes', () => {
  /** Um Storage falso que conta quantas exclusões estão em andamento ao mesmo tempo. */
  function countingFiles(fail: (path: string) => boolean = () => false) {
    let inFlight = 0;
    let peak = 0;
    const removed: string[] = [];
    const remove = async (path: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      if (fail(path)) throw new Error('503 Service Unavailable');
      removed.push(path);
    };
    return { remove, removed, peak: () => peak };
  }

  it('uma pasta enchida por script sai inteira, sem passar do lote em andamento', async () => {
    const paths = Array.from({ length: 2_345 }, (_, index) => `fans/${UID}/photo-x${index}.jpg`);
    const counting = countingFiles();
    const files = { list: async () => paths, remove: counting.remove } as unknown as FanPhotoFiles;
    expect(await purgeFanPhotos(files, UID, quiet())).toBe(paths.length);
    expect(counting.removed).toHaveLength(paths.length);
    expect(counting.peak()).toBe(FAN_PHOTO_DELETE_BATCH);
  });

  it('os que falham em lotes diferentes voltam todos, e os outros saem', async () => {
    const paths = Array.from({ length: 250 }, (_, index) => `fans/${UID}/photo-y${index}.jpg`);
    const failing = new Set([paths[3], paths[150], paths[249]]);
    const counting = countingFiles((path) => failing.has(path));
    const leftovers = await removeInBatches({ remove: counting.remove }, paths);
    expect(leftovers.map((leftover) => leftover.path)).toEqual([...failing]);
    expect(counting.removed).toHaveLength(paths.length - failing.size);
    expect(counting.peak()).toBeLessThanOrEqual(FAN_PHOTO_DELETE_BATCH);
  });
});
