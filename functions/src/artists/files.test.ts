import { describe, expect, it } from 'vitest';

import { bucketFiles, removeFiles, type Bucket } from './files';

/**
 * Bucket de mentira com o que importa do GCS aqui: apagar o que não existe dá
 * 404 (a não ser com ignoreNotFound), e um caminho pode falhar de propósito.
 */
function fakeBucket(names: string[], failing: Record<string, Error> = {}) {
  const stored = new Set(names);
  const bucket = {
    file: (path: string) => ({
      async delete(options?: { ignoreNotFound?: boolean }) {
        const failure = failing[path];
        if (failure) throw failure;
        if (!stored.has(path)) {
          if (options?.ignoreNotFound) return [{}];
          throw Object.assign(new Error(`No such object: ${path}`), { code: 404 });
        }
        stored.delete(path);
        return [{}];
      },
    }),
    async getFiles({ prefix }: { prefix: string }) {
      return [[...stored].filter((name) => name.startsWith(prefix)).map((name) => ({ name }))];
    },
  };
  return { stored, files: bucketFiles(() => bucket as unknown as Bucket) };
}

describe('removeFiles', () => {
  it('um arquivo que falha não impede os outros e volta com o caminho e o motivo', async () => {
    const paths = ['a', 'b', 'c', 'd'].map((name) => `artists/trio/${name}.webp`);
    const { stored, files } = fakeBucket(paths, {
      'artists/trio/b.webp': new Error('503 Service Unavailable'),
    });
    expect(await removeFiles(files, await files.list('artists/trio/'))).toEqual([
      { path: 'artists/trio/b.webp', error: '503 Service Unavailable' },
    ]);
    // Os que vêm depois do que falhou também saem.
    expect([...stored]).toEqual(['artists/trio/b.webp']);
  });

  it('arquivo que já sumiu (outra limpeza levou antes) conta como apagado', async () => {
    const { stored, files } = fakeBucket(['artists/trio/a.webp']);
    expect(
      await removeFiles(files, ['artists/trio/ja-foi.webp', 'artists/trio/a.webp']),
    ).toEqual([]);
    expect(stored.size).toBe(0);
  });

  it('motivo que não é Error vira texto; sem caminho, nada a fazer', async () => {
    const removed: string[] = [];
    const files = {
      async remove(path: string) {
        if (path === 'artists/trio/x.webp') throw 'quota';
        removed.push(path);
      },
    };
    expect(await removeFiles(files, ['artists/trio/x.webp', 'artists/trio/y.webp'])).toEqual([
      { path: 'artists/trio/x.webp', error: 'quota' },
    ]);
    expect(removed).toEqual(['artists/trio/y.webp']);
    expect(await removeFiles(files, [])).toEqual([]);
  });
});
