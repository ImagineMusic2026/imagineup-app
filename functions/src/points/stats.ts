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
  /** Fãs que entraram na central no dia (fluxo, bloco 4). */
  joined: number;
  /** Fãs que saíram da central no dia (fluxo; a exclusão de conta não conta). */
  left: number;
  /** Engajamento do dia nos posts e shows da central (fluxo, bloco 6, 21.10). */
  likes: number;
  unlikes: number;
  comments: number;
  rsvps: number;
  rsvpsUndone: number;
  reports: number;
  bySource: Record<string, Count>;
};

/**
 * Fluxos de engajamento do bloco 6 (21.10): trocas para curtido, para não
 * curtido, comentários, trocas para "Eu vou" e para não vou, e denúncias, no
 * total e por central; os bloqueios, só no total (não são de uma central).
 */
export type EngagementKind =
  'likes' | 'unlikes' | 'comments' | 'rsvps' | 'rsvpsUndone' | 'reports' | 'blocks';

/** O que uma transação soma no shard. Só números: o award.ts troca por increments. */
export type ShardDelta = {
  totals: {
    earned: number;
    earnedEvents: number;
    spent: number;
    spentEvents: number;
    adjusted: number;
    adjustedEvents: number;
    /** Entradas em centrais no dia, somadas de todas (bloco 4). */
    joined: number;
    /** Saídas de centrais no dia. `joined - left` não é o número de membros: esse é o fanCount. */
    left: number;
    /** Engajamento do dia (bloco 6): fluxo, a exclusão de conta não desconta. */
    likes: number;
    unlikes: number;
    comments: number;
    rsvps: number;
    rsvpsUndone: number;
    reports: number;
    blocks: number;
  };
  bySource: Record<string, Count>;
  byArtist: Record<string, ArtistCount>;
  actives: { day: number; newInWeek: number; newInMonth: number };
  cohorts: Record<string, { active: number }>;
  /** Cadastros do dia (bloco 5, docs/arquitetura-api.md, 20.7). */
  signups: {
    /** Contas de fã criadas no dia (gatilho de cadastro). */
    total: number;
    /** Claims aceitos no dia: a conta entrou por convite (o dia é o do claim). */
    invited: number;
  };
  invites: {
    /** Pessoas contadas como visitantes de um convidante (o marcador nasceu), do claim e do app. */
    visits: number;
    /** Links novos registrados. */
    links: number;
  };
  /** A origem dos fãs: tipo de link em tudo; `utm_source` e `utm_campaign` só nos cadastros. */
  byOrigin: {
    kind: Record<string, OriginCount>;
    utmSource: Record<string, { signups: number }>;
    utmCampaign: Record<string, { signups: number }>;
  };
};

/** Cadastros, visitas e links de um tipo de link. */
export type OriginCount = { signups: number; visits: number; links: number };

export function emptyShardDelta(): ShardDelta {
  return {
    totals: {
      earned: 0,
      earnedEvents: 0,
      spent: 0,
      spentEvents: 0,
      adjusted: 0,
      adjustedEvents: 0,
      joined: 0,
      left: 0,
      likes: 0,
      unlikes: 0,
      comments: 0,
      rsvps: 0,
      rsvpsUndone: 0,
      reports: 0,
      blocks: 0,
    },
    bySource: {},
    byArtist: {},
    actives: { day: 0, newInWeek: 0, newInMonth: 0 },
    cohorts: {},
    signups: { total: 0, invited: 0 },
    invites: { visits: 0, links: 0 },
    byOrigin: { kind: {}, utmSource: {}, utmCampaign: {} },
  };
}

function emptyArtistCount(): ArtistCount {
  return {
    earned: 0,
    earnedEvents: 0,
    spent: 0,
    spentEvents: 0,
    joined: 0,
    left: 0,
    likes: 0,
    unlikes: 0,
    comments: 0,
    rsvps: 0,
    rsvpsUndone: 0,
    reports: 0,
    bySource: {},
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
  const artist = entry.artistId ? (delta.byArtist[entry.artistId] ??= emptyArtistCount()) : null;
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

/**
 * Soma uma entrada (`joined`) ou uma saída (`left`) de central, no total e na
 * central (bloco 4). São fluxo, como o resto do shard: o estoque é o fanCount.
 */
export function addMembershipToShard(
  delta: ShardDelta,
  artistId: string,
  kind: 'joined' | 'left',
): void {
  delta.totals[kind] += 1;
  const artist = (delta.byArtist[artistId] ??= emptyArtistCount());
  artist[kind] += 1;
}

/**
 * Soma 1 de engajamento (bloco 6, 21.10) no total e em cada central de
 * `artistIds` (as centrais no ar da ação). O bloqueio não é de uma central:
 * conta só no total. São fluxo, como o resto do shard.
 */
export function addEngagementToShard(
  delta: ShardDelta,
  kind: EngagementKind,
  artistIds: readonly string[],
): void {
  delta.totals[kind] += 1;
  if (kind === 'blocks') return;
  for (const artistId of new Set(artistIds)) {
    const artist = (delta.byArtist[artistId] ??= emptyArtistCount());
    artist[kind] += 1;
  }
}

/** Tipo do link de onde veio o fã: o caminho classificado, ou `code` para o código digitado. */
export type OriginKind = 'invite' | 'post' | 'artist' | 'agenda' | 'other' | 'code';

/** Chave dos recortes de `utm_*` nos shards. */
export const ORIGIN_KEY_MAX = 40;

/** Sem valor (o link não tinha a `utm_*`). Nunca `__x__`, que o Firestore reserva. */
export const ORIGIN_NONE = '_none';

/**
 * A chave de um valor de `utm_*` nos shards: o valor já normalizado
 * (`normalizeUtm`, de invites/model.ts, que só deixa `[a-z0-9._~-]`) cortado
 * em 40 caracteres; sem valor, `_none`.
 */
export function originKey(value: string | null | undefined): string {
  return value ? value.slice(0, ORIGIN_KEY_MAX) : ORIGIN_NONE;
}

/** Um evento do convite para os agregados do painel (bloco 5, 20.7). */
export type InviteShardEvent = {
  event: 'signup' | 'visit' | 'link';
  kind: OriginKind;
  /** Só no cadastro. */
  utmSource?: string | null;
  /** Só no cadastro. */
  utmCampaign?: string | null;
};

/**
 * Soma um evento do convite: 1 no total (cadastro convidado, visita ou link)
 * e no tipo do link; os recortes por `utm_source` e `utm_campaign` só no
 * cadastro, porque quem cria o link escolhe o valor, e cada valor novo é uma
 * chave nova no shard (um cadastro custa uma conta nova; a visita e o link,
 * bem menos).
 */
export function addInviteToShard(delta: ShardDelta, change: InviteShardEvent): void {
  const origin = (delta.byOrigin.kind[change.kind] ??= { signups: 0, visits: 0, links: 0 });
  if (change.event === 'signup') {
    delta.signups.invited += 1;
    origin.signups += 1;
    const source = (delta.byOrigin.utmSource[originKey(change.utmSource)] ??= { signups: 0 });
    source.signups += 1;
    const campaign = (delta.byOrigin.utmCampaign[originKey(change.utmCampaign)] ??= {
      signups: 0,
    });
    campaign.signups += 1;
  } else if (change.event === 'visit') {
    delta.invites.visits += 1;
    origin.visits += 1;
  } else {
    delta.invites.links += 1;
    origin.links += 1;
  }
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
