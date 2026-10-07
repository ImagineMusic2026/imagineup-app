import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';

import type { SeasonInfo } from '../points/model';
import type { ShownSeason } from './model';
import { liveCentralRank, profileView } from './service';

const SEASON: SeasonInfo = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: 0,
  endsAt: Date.parse('2026-10-18T20:00:00.000Z'),
  leaderTitle: null,
  topTarget: 10,
  endedEarly: null,
};
const SHOWN: ShownSeason = { season: SEASON, source: 'live', status: 'active' };

/** Firestore falso: a transação só de leitura falha com o erro dado. */
function failingDb(error: Error): Firestore {
  return {
    runTransaction: vi.fn(async () => {
      throw error;
    }),
  } as unknown as Firestore;
}

describe('posição de "Suas centrais" (liveCentralRank)', () => {
  it('sem o índice (código 9, só em produção): null, com o erro e o link no log', async () => {
    const log = { error: vi.fn() };
    const missingIndex = Object.assign(
      new Error('9 FAILED_PRECONDITION: The query requires an index. https://console...'),
      { code: 9 },
    );
    const rank = await liveCentralRank(failingDb(missingIndex), 'uid-camila', SHOWN, 'nenho', log);
    expect(rank).toBeNull();
    expect(log.error).toHaveBeenCalledWith(expect.any(String), {
      artistId: 'nenho',
      error: expect.stringContaining('requires an index'),
    });
  });

  it('outro erro segue (a rota responde 500 como sempre)', async () => {
    const log = { error: vi.fn() };
    const busy = Object.assign(new Error('14 UNAVAILABLE'), { code: 14 });
    await expect(liveCentralRank(failingDb(busy), 'uid-camila', SHOWN, 'nenho', log)).rejects.toBe(
      busy,
    );
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('o perfil da linha (profileView)', () => {
  const snap = (data: Record<string, unknown> | undefined) =>
    ({ exists: data !== undefined, get: (field: string) => data?.[field] }) as never;

  it('nome, foto e cidade do perfil; texto vazio vale null', () => {
    expect(
      profileView(
        snap({ displayName: 'Camila Ribeiro', photoURL: '', city: 'Feira de Santana, BA' }),
      ),
    ).toEqual({ displayName: 'Camila Ribeiro', photoURL: null, city: 'Feira de Santana, BA' });
  });

  it('perfil que sumiu (conta sendo excluída): os três null, e a linha fica ("Fã" no app)', () => {
    expect(profileView(snap(undefined))).toEqual({ displayName: null, photoURL: null, city: null });
    expect(profileView(undefined)).toEqual({ displayName: null, photoURL: null, city: null });
  });
});
