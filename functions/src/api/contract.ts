// Tipos das respostas da API, espelho dos types.ts do app
// (src/domains/*/types.ts). Mudou um, mude o outro. Campo novo na resposta é
// sempre opcional para o app: app instalado não pode quebrar.

/** `Wallet` de src/domains/profile/types.ts. */
export type Wallet = {
  /** Saldo para trocar por recompensas; cai no resgate. */
  balance: number;
  /** Pontos de nível, que nunca caem. */
  xp: number;
  /** Pontos da temporada, que contam no ranking. */
  seasonPoints: number;
};

/** `Level` de src/domains/profile/types.ts. */
export type Level = { number: number; name: string; minXp: number };

/** `FanStats` de src/domains/profile/types.ts. */
export type FanStats = { linksCreated: number; peopleBrought: number; seasons: number };

/** `MyProgress` de src/domains/profile/types.ts. */
export type MyProgress = {
  xp: number;
  level: Level;
  /** null no nível máximo. */
  nextLevel: Level | null;
  /** Ganhos dos últimos 7 dias, sem descontar resgates. */
  weekEarned: number;
  stats: FanStats;
};

/** `Page<T>` do app: `nextCursor` null na última página; o cursor é texto opaco. */
export type Page<T> = { items: T[]; nextCursor: string | null };

/** Uma linha do extrato (/me/ledger). O app monta o texto a partir de `source` e `subject` (bloco 7). */
export type LedgerEntry = {
  id: string;
  kind: 'earn' | 'spend' | 'adjust';
  source: string;
  points: number;
  xpDelta: number;
  seasonDelta: number;
  artistId: string | null;
  centralSeasonDelta: number;
  centralTotalDelta: number;
  subject: { type: string; id: string } | null;
  /** ISO 8601 UTC. */
  createdAt: string;
};
