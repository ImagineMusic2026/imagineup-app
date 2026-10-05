import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from 'firebase-admin/firestore';

import type { ActivityMarks, AwardEntry } from './model';

// Contadores agregados do painel (Visão geral e Crescimento): um documento por
// dia em SHARD_COUNT shards, statsDaily/{dia}/statsShards/{n}. Cada transação
// que lança ponto ou marca atividade nova grava num shard sorteado, uma vez.
// Formato e teto de escrita em docs/arquitetura-api.md, seção 7.

/**
 * Shards por dia. Com o limite de ~1 gravação por segundo por documento, o
 * dia aguenta perto de 64 transações com ponto por segundo. Quem lê lista a
 * subcoleção e nunca supõe este número: dá para subir sem migrar nada.
 */
export const SHARD_COUNT = 64;

export type Count = { points: number; events: number };

export type ArtistCount = {
  earned: number;
  earnedEvents: number;
  spent: number;
  spentEvents: number;
  bySource: Record<string, Count>;
};

/** O que uma transação soma no shard. Só números: o award.ts troca por increments. */
export type ShardDelta = {
  totals: {
    earned: number;
    earnedEvents: number;
    spent: number;
    spentEvents: number;
    adjusted: number;
    adjustedEvents: number;
  };
  bySource: Record<string, Count>;
  byArtist: Record<string, ArtistCount>;
  actives: { day: number; newInWeek: number; newInMonth: number };
  cohorts: Record<string, { active: number }>;
};

export function emptyShardDelta(): ShardDelta {
  return {
    totals: {
      earned: 0,
      earnedEvents: 0,
      spent: 0,
      spentEvents: 0,
      adjusted: 0,
      adjustedEvents: 0,
    },
    bySource: {},
    byArtist: {},
    actives: { day: 0, newInWeek: 0, newInMonth: 0 },
    cohorts: {},
  };
}

function addCount(map: Record<string, Count>, key: string, points: number): void {
  const count = map[key] ?? { points: 0, events: 0 };
  count.points += points;
  count.events += 1;
  map[key] = count;
}

/**
 * Soma um lançamento aplicado. `balanceDelta` é quanto o saldo mexeu
 * (positivo no ganho, negativo no resgate, o delta no ajuste). Ganho e
 * resgate contam por origem e, com central, por artista; ajuste e seed contam
 * só no total de ajustes e por origem, nunca por artista.
 */
export function addEntryToShard(delta: ShardDelta, entry: AwardEntry, balanceDelta: number): void {
  if (entry.kind === 'adjust') {
    delta.totals.adjusted += balanceDelta;
    delta.totals.adjustedEvents += 1;
    addCount(delta.bySource, entry.source, balanceDelta);
    return;
  }
  const points = Math.abs(balanceDelta);
  const artist = entry.artistId
    ? (delta.byArtist[entry.artistId] ??= {
        earned: 0,
        earnedEvents: 0,
        spent: 0,
        spentEvents: 0,
        bySource: {},
      })
    : null;
  if (entry.kind === 'earn') {
    delta.totals.earned += points;
    delta.totals.earnedEvents += 1;
    if (artist) {
      artist.earned += points;
      artist.earnedEvents += 1;
    }
  } else {
    delta.totals.spent += points;
    delta.totals.spentEvents += 1;
    if (artist) {
      artist.spent += points;
      artist.spentEvents += 1;
    }
  }
  addCount(delta.bySource, entry.source, points);
  if (artist) addCount(artist.bySource, entry.source, points);
}

/**
 * Soma as marcas de atividade de quem chama: dia novo conta no `actives.day`,
 * semana nova no `newInWeek` e na coorte da semana do cadastro, mês novo no
 * `newInMonth`.
 */
export function addActivity(delta: ShardDelta, marks: ActivityMarks): void {
  if (marks.newDay) delta.actives.day += 1;
  if (marks.newWeek) {
    delta.actives.newInWeek += 1;
    if (marks.cohort) {
      const cohort = delta.cohorts[marks.cohort] ?? { active: 0 };
      cohort.active += 1;
      delta.cohorts[marks.cohort] = cohort;
    }
  }
  if (marks.newMonth) delta.actives.newInMonth += 1;
}

type Tree = { [key: string]: number | Tree };

/** Sem as folhas zeradas e sem os mapas que ficaram vazios. */
export function pruneZeros(tree: Tree): Tree {
  const out: Tree = {};
  for (const [key, value] of Object.entries(tree)) {
    if (typeof value === 'number') {
      if (value !== 0) out[key] = value;
    } else {
      const child = pruneZeros(value);
      if (Object.keys(child).length > 0) out[key] = child;
    }
  }
  return out;
}

export function isEmptyShardDelta(delta: ShardDelta): boolean {
  return Object.keys(pruneZeros(delta as unknown as Tree)).length === 0;
}

function toIncrements(tree: Tree): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] = typeof value === 'number' ? FieldValue.increment(value) : toIncrements(value);
  }
  return out;
}

export function shardRef(db: Firestore, day: string, shard: number): DocumentReference {
  return db.collection('statsDaily').doc(day).collection('statsShards').doc(String(shard));
}

/**
 * O documento para `tx.set(ref, ..., { merge: true })`: os números como
 * increments, em objetos aninhados (nunca caminhos com ponto: o merge junta os
 * mapas e soma em cada folha).
 */
export function shardWrite(delta: ShardDelta, day: string, now: number): Record<string, unknown> {
  return {
    day,
    ...toIncrements(pruneZeros(delta as unknown as Tree)),
    updatedAt: Timestamp.fromMillis(now),
  };
}

/** Shard sorteado, de 0 até SHARD_COUNT menos 1. */
export function pickShard(random: () => number): number {
  return Math.min(SHARD_COUNT - 1, Math.floor(random() * SHARD_COUNT));
}
