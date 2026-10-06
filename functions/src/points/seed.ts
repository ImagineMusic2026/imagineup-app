import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { runAward, walletRef } from './award';
import { createConfigSource, seasonConfigRef } from './config';
import { dayKey, shiftDay, type Actor, type AwardEntry } from './model';

// Carteira da Camila no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build): gravada pelo mesmo award das funções, para o perfil (1e)
// mostrar os números do servidor iguais aos do protótipo. Nunca roda em
// produção: o script fixa o emulador. docs/arquitetura-api.md, seções 14 e
// 22.13 (os 12 lançamentos de missão da meta da temporada, com o título).

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
 * semana por ganhos de verdade (os +840). Desde o bloco 7, 8 missões de 50
 * entram antes da semana, sem central, e a base desce o mesmo tanto: a meta da
 * temporada dá 12 de 20 pelo extrato, e os totais não mudam (22.13).
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

/**
 * Títulos que o extrato mostra (`subjectTitle`). São desafios antigos, já
 * arquivados, e não as missões do catálogo de hoje: os valores aqui são
 * maiores que os do catálogo, e um título igual ao de uma missão de +10
 * mostraria "+240" no extrato da demonstração.
 */
const DIARIO = 'Desafio diário do São João';
const COMENTARIOS = 'Desafio: 10 comentários na central do Netto';
const PESSOAS = 'Desafio: leve 10 pessoas para a central do Nenho';
const AMIGOS = 'Desafio da semana: 5 amigos novos no app';
const CURTIDAS = 'Desafio: curta 20 posts do Nenho';

/** As 8 missões de antes da semana: de 17 a 10 dias atrás, uma por dia, 50 cada. */
const EARLY_MISSIONS: Step[] = Array.from({ length: 8 }, (_, index) => ({
  daysAgo: 17 - index,
  entries: [mission(`seed-camila-${index + 5}`, 50, null, DIARIO)],
}));

const STEPS: Step[] = [
  ...EARLY_MISSIONS,
  {
    daysAgo: 8,
    entries: [
      {
        kind: 'adjust',
        source: 'seed',
        eventId: 'camila-base',
        balance: 11_240,
        xp: 11_240,
        season: 2_880,
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
  { daysAgo: 6, entries: [mission('seed-camila-1', 200, 'nettobrito', COMENTARIOS)] },
  { daysAgo: 4, entries: [mission('seed-camila-2', 240, 'nenho', PESSOAS)] },
  { daysAgo: 2, entries: [mission('seed-camila-3', 300, 'nettobrito', AMIGOS)] },
  { daysAgo: 1, entries: [mission('seed-camila-4', 100, 'nenho', CURTIDAS)] },
];

function mission(
  eventId: string,
  points: number,
  artistId: string | null,
  title: string,
): AwardEntry {
  return {
    kind: 'earn',
    source: 'mission',
    eventId,
    points,
    artistId,
    title,
  };
}

/** Quem lança no seed: o sistema, que não marca atividade. */
export const SEED_ACTOR: Actor = { type: 'system', uid: null, name: null };

/** Meio-dia de São Paulo (15:00 UTC) do dia `daysAgo` antes de `now`. */
export function noonDaysAgo(now: number, daysAgo: number): number {
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
 * atividade), com o jogo da configuração (bloco 7): a primeira missão dá o
 * "Missão cumprida" e a base, que leva o XP de 400 a 11.640 (nível 7), dá o
 * "Pé de serra", o "Sanfona" e o "Purainha". Rodar de novo não muda nada: os
 * lançamentos voltam duplicate e nada é gravado. `stats.pastSeasons` ainda
 * não tem caminho de servidor (temporadas passadas são do bloco 8): vai
 * direto, 2 (a 1e mostra 3).
 */
export async function seedCamilaWallet(
  db: Firestore,
  uid: string,
  options: { now?: number } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  await ensureSeedSeason(db, now);
  const { points, game } = await createConfigSource(db, { ttlMs: 0 }).get();
  for (const step of STEPS) {
    await runAward(db, uid, step.entries, {
      now: noonDaysAgo(now, step.daysAgo),
      config: points,
      actor: SEED_ACTOR,
      game,
    });
  }
  const wallet = await walletRef(db, uid).get();
  if (wallet.get('stats.pastSeasons') !== CAMILA_SEED.pastSeasons) {
    await wallet.ref.update({ 'stats.pastSeasons': CAMILA_SEED.pastSeasons });
  }
}
