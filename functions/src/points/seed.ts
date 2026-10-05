import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { runAward, walletRef } from './award';
import { createConfigSource, seasonConfigRef } from './config';
import { dayKey, shiftDay, type Actor, type AwardEntry } from './model';

// Carteira da Camila no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build): gravada pelo mesmo award das funções, para o perfil (1e)
// mostrar os números do servidor iguais aos do protótipo. Nunca roda em
// produção: o script fixa o emulador. docs/arquitetura-api.md, seção 14.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Temporada de exemplo, nas datas do buildSeasonFixture do app (18 dias atrás a 12 dias à frente). */
export const SEED_SEASON = {
  id: 'temporada-sao-joao',
  name: 'São João',
  startedDaysAgo: 18,
  endsInDays: 12,
} as const;

/**
 * O que a Camila tem no protótipo. Os pontos das centrais somam mais que os
 * da temporada, então a base entra por ajustes (um contador de cada vez) e a
 * semana por ganhos de verdade (os +840).
 */
export const CAMILA_SEED = {
  balance: 12_480,
  xp: 12_480,
  seasonPoints: 4_120,
  centrals: { nettobrito: 4_120, nenho: 2_980 },
  weekEarned: 840,
  pastSeasons: 2,
} as const;

type Step = { daysAgo: number; entries: AwardEntry[] };

const STEPS: Step[] = [
  {
    daysAgo: 8,
    entries: [
      {
        kind: 'adjust',
        source: 'seed',
        eventId: 'camila-base',
        balance: 11_640,
        xp: 11_640,
        season: 3_280,
      },
      {
        kind: 'adjust',
        source: 'seed',
        eventId: 'camila-base-netto',
        central: { artistId: 'nettobrito', season: 3_620, total: 3_620 },
      },
      {
        kind: 'adjust',
        source: 'seed',
        eventId: 'camila-base-nenho',
        central: { artistId: 'nenho', season: 2_640, total: 2_640 },
      },
    ],
  },
  { daysAgo: 6, entries: [mission('seed-camila-1', 200, 'nettobrito')] },
  { daysAgo: 4, entries: [mission('seed-camila-2', 240, 'nenho')] },
  { daysAgo: 2, entries: [mission('seed-camila-3', 300, 'nettobrito')] },
  { daysAgo: 1, entries: [mission('seed-camila-4', 100, 'nenho')] },
];

function mission(eventId: string, points: number, artistId: string): AwardEntry {
  return { kind: 'earn', source: 'mission', eventId, points, artistId };
}

const SEED_ACTOR: Actor = { type: 'system', uid: null, name: null };

/** Meio-dia de São Paulo (15:00 UTC) do dia `daysAgo` antes de `now`. */
function noonDaysAgo(now: number, daysAgo: number): number {
  return Date.parse(`${shiftDay(dayKey(now), -daysAgo)}T15:00:00.000Z`);
}

/** Grava config/season (versão 1) se ainda não existe. */
async function ensureSeedSeason(db: Firestore, now: number): Promise<void> {
  const ref = seasonConfigRef(db);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    const doc = {
      version: 1,
      season: {
        id: SEED_SEASON.id,
        name: SEED_SEASON.name,
        startsAt: Timestamp.fromMillis(now - SEED_SEASON.startedDaysAgo * DAY_MS),
        endsAt: Timestamp.fromMillis(now + SEED_SEASON.endsInDays * DAY_MS),
        leaderTitle: null,
      },
      updatedAt: Timestamp.fromMillis(now),
      updatedBy: null,
    };
    tx.create(ref, doc);
    tx.create(ref.collection('versions').doc('1'), doc);
  });
}

/**
 * Carteira, extrato e pontos por central da Camila, pelo runAward (sem marcar
 * atividade). Rodar de novo não muda nada: os lançamentos voltam duplicate e
 * nada é gravado. `stats.pastSeasons` ainda não tem caminho de servidor
 * (temporadas passadas são do bloco 8): vai direto, 2 (a 1e mostra 3).
 */
export async function seedCamilaWallet(
  db: Firestore,
  uid: string,
  options: { now?: number } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  await ensureSeedSeason(db, now);
  const { points } = await createConfigSource(db, { ttlMs: 0 }).get();
  for (const step of STEPS) {
    await runAward(db, uid, step.entries, {
      now: noonDaysAgo(now, step.daysAgo),
      config: points,
      actor: SEED_ACTOR,
    });
  }
  const wallet = await walletRef(db, uid).get();
  if (wallet.get('stats.pastSeasons') !== CAMILA_SEED.pastSeasons) {
    await wallet.ref.update({ 'stats.pastSeasons': CAMILA_SEED.pastSeasons });
  }
}
