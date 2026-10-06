import { describe, expect, it } from 'vitest';

import { buildLoadedConfig, DEFAULT_POINTS_CONFIG } from './config';
import { emptyWallet, type WalletState } from './model';
import { decodeLedgerCursor, encodeLedgerCursor, progressView, walletView } from './wallet';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T15:00:00.000Z');
const season = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startsAt: NOW - 18 * DAY_MS,
  endsAt: NOW + 12 * DAY_MS,
  leaderTitle: null,
};
const config = (withSeason = true) =>
  buildLoadedConfig({
    points: DEFAULT_POINTS_CONFIG,
    season: { version: 1, season: withSeason ? season : null },
  });

const camila: WalletState = {
  ...emptyWallet(),
  exists: true,
  balance: 12_480,
  xp: 12_480,
  seasonId: season.id,
  seasonPoints: 4_120,
  pastSeasons: 2,
  days: {
    '2026-09-29': { earned: 200, count: { mission: 1 } },
    '2026-10-01': { earned: 240, count: { mission: 1 } },
    '2026-10-03': { earned: 300, count: { mission: 1 } },
    '2026-10-04': { earned: 100, count: { mission: 1 } },
  },
};

describe('carteira e progresso', () => {
  it('a carteira da Camila, como o perfil mostra hoje', () => {
    expect(walletView(camila, config())).toEqual({
      balance: 12_480,
      xp: 12_480,
      seasonPoints: 4_120,
    });
  });

  it('pontos de outra temporada (a carteira ainda não trocou) ou sem temporada mostram 0', () => {
    expect(walletView({ ...camila, seasonId: 'carnaval' }, config()).seasonPoints).toBe(0);
    expect(walletView(camila, config(false)).seasonPoints).toBe(0);
  });

  it('temporada que acabou e continua na configuração mostra os pontos dela, congelados', () => {
    const ended = buildLoadedConfig({
      points: DEFAULT_POINTS_CONFIG,
      season: { version: 1, season: { ...season, endsAt: NOW - DAY_MS } },
    });
    expect(walletView(camila, ended).seasonPoints).toBe(4_120);
  });

  it('o progresso da Camila: Purainha, Xodó a seguir, +840 na semana e 3 temporadas', () => {
    expect(progressView(camila, config(), NOW)).toEqual({
      xp: 12_480,
      level: { number: 7, name: 'Purainha', minXp: 7_000 },
      nextLevel: { number: 8, name: 'Xodó', minXp: 15_000 },
      weekEarned: 840,
      stats: { linksCreated: 0, peopleBrought: 0, seasons: 3 },
    });
  });
});

describe('cursor do extrato', () => {
  it('ida e volta', () => {
    const cursor = { createdAt: NOW, id: 'mission:seed-camila-4' };
    const text = encodeLedgerCursor(cursor);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLedgerCursor(text)).toEqual(cursor);
  });

  it.each([
    'não-é-base64!',
    Buffer.from('{"a":1}').toString('base64url'),
    Buffer.from('[1.5,"x"]').toString('base64url'),
    Buffer.from('[1,"a/b"]').toString('base64url'),
    Buffer.from('[1,""]').toString('base64url'),
    // O instante passa do maior Timestamp do Firestore (o startAfter lançaria).
    Buffer.from('[100000000000000000000,"mission:m1"]').toString('base64url'),
    Buffer.from('[253402300800000,"mission:m1"]').toString('base64url'),
    // O id não é de lançamento (`<origem>:<evento>`).
    Buffer.from('[1,"sem-origem"]').toString('base64url'),
    Buffer.from('[1,"Mission:m1"]').toString('base64url'),
    Buffer.from(`[1,"mission:${'m'.repeat(201)}"]`).toString('base64url'),
    'x'.repeat(601),
  ])('recusa %s', (text) => {
    expect(decodeLedgerCursor(text)).toBeNull();
  });

  it('aceita o último instante do Timestamp do Firestore e id com dois-pontos no evento', () => {
    const cursor = { createdAt: 253_402_300_799_999, id: 'invite_signup:CAMILA12:uid-a' };
    expect(decodeLedgerCursor(encodeLedgerCursor(cursor))).toEqual(cursor);
  });
});
