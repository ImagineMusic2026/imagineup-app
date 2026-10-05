import { describe, expect, it, vi } from 'vitest';

import { followedAfter, sumCentralPoints, type FollowRead } from './service';
import { artistRecord } from './model';

describe('"PTS DA CENTRAL" (sumCentralPoints)', () => {
  it('soma do grupo centralPoints', async () => {
    const log = { error: vi.fn() };
    expect(await sumCentralPoints('nettobrito', async () => 7_100, log)).toBe(7_100);
    expect(log.error).not.toHaveBeenCalled();
  });

  it('sem o índice (código 9, só em produção): vale 0 e o erro vai para o log com o link', async () => {
    const log = { error: vi.fn() };
    const missingIndex = Object.assign(
      new Error('9 FAILED_PRECONDITION: The query requires an index. https://console...'),
      { code: 9 },
    );
    const points = await sumCentralPoints(
      'nettobrito',
      async () => {
        throw missingIndex;
      },
      log,
    );
    expect(points).toBe(0);
    expect(log.error).toHaveBeenCalledWith(expect.any(String), {
      artistId: 'nettobrito',
      error: expect.stringContaining('requires an index'),
    });
  });

  it('outro erro segue (500 de sempre)', async () => {
    const log = { error: vi.fn() };
    const busy = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    await expect(
      sumCentralPoints(
        'nettobrito',
        async () => {
          throw busy;
        },
        log,
      ),
    ).rejects.toBe(busy);
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('centrais seguidas depois do POST /me/artists (followedAfter)', () => {
  const published = (id: string, order: number) =>
    artistRecord(id, { name: id, status: 'published', order });

  it('as de antes e as novas, só as publicadas, na ordem de "Suas centrais"', () => {
    const read: FollowRead = {
      artists: new Map([
        ['nettobrito', published('nettobrito', 0)],
        ['nenho', published('nenho', 1)],
        ['rocksalles', published('rocksalles', 3)],
        [
          'artista8',
          artistRecord('artista8', { name: 'Artista 8', status: 'unpublished', order: 7 }),
        ],
      ]),
      members: new Set(['nenho', 'artista8']),
      followed: [
        { artistId: 'nenho', joinedAt: 100 },
        { artistId: 'artista8', joinedAt: 50 },
      ],
    };
    expect(followedAfter(read, ['rocksalles', 'nettobrito'], 200)).toEqual([
      'nenho',
      'nettobrito',
      'rocksalles',
    ]);
  });
});
