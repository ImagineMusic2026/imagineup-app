import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';

import { shownPoints, shownSeason } from '../ranking/model';
import { walletFromDoc, walletRef } from './award';
import type { LoadedConfig } from './config';
import {
  LEDGER_ID_PATTERN,
  levelForXp,
  seasonsPlayed,
  weekEarned,
  type Level,
  type PointsSource,
  type Subject,
  type WalletState,
} from './model';

// Leituras da carteira para as rotas (GET), fora de transação: uma leitura da
// carteira e a configuração do cache. docs/arquitetura-api.md, seção 6.

export type WalletView = { balance: number; xp: number; seasonPoints: number };

export type ProgressView = {
  xp: number;
  level: Level;
  nextLevel: Level | null;
  weekEarned: number;
  stats: { linksCreated: number; peopleBrought: number; seasons: number };
};

export type LedgerItem = {
  id: string;
  kind: 'earn' | 'spend' | 'adjust';
  source: PointsSource;
  points: number;
  xpDelta: number;
  seasonDelta: number;
  artistId: string | null;
  centralSeasonDelta: number;
  centralTotalDelta: number;
  subject: Subject | null;
  createdAt: string;
  /** O nome da central (bloco 7); null sem central ou com ela apagada. */
  artistName: string | null;
  /** Só na missão: o título dela quando concluiu (bloco 7). */
  subjectTitle: string | null;
};

export type LedgerPage = { items: LedgerItem[]; nextCursor: string | null };

export async function readWallet(db: Firestore, uid: string): Promise<WalletState> {
  return walletFromDoc((await walletRef(db, uid).get()).data());
}

/**
 * Os pontos da temporada mostrada (bloco 8, decisão 4 de 23.1): a que já
 * começou na configuração ou, antes de a próxima começar, a última fechada.
 * Pontos guardados de outra temporada (a carteira ainda não trocou) mostram
 * 0; temporada que já acabou mostra os pontos dela, congelados.
 */
export function visibleSeasonPoints(
  wallet: WalletState,
  config: LoadedConfig,
  now: number,
): number {
  return shownPoints(wallet, shownSeason(config.season, now));
}

export function walletView(wallet: WalletState, config: LoadedConfig, now: number): WalletView {
  return {
    balance: wallet.balance,
    xp: wallet.xp,
    seasonPoints: visibleSeasonPoints(wallet, config, now),
  };
}

/** Os números do convite do fã (bloco 5): contados fora da carteira (`countInviteStats`). */
export type InviteStats = { linksCreated: number; peopleBrought: number };

/**
 * Nível pela régua da configuração (sai do XP a cada leitura), ganhos dos
 * últimos 7 dias e os números do fã. Links e pessoas trazidas vêm do convite
 * (bloco 5), contados à parte; sem eles, 0.
 */
export function progressView(
  wallet: WalletState,
  config: LoadedConfig,
  now: number,
  invites: InviteStats = { linksCreated: 0, peopleBrought: 0 },
): ProgressView {
  const { level, nextLevel } = levelForXp(wallet.xp, config.points.levels);
  return {
    xp: wallet.xp,
    level,
    nextLevel,
    weekEarned: weekEarned(wallet.days, now),
    stats: {
      linksCreated: invites.linksCreated,
      peopleBrought: invites.peopleBrought,
      seasons: seasonsPlayed(wallet),
    },
  };
}

export const LEDGER_LIMIT_DEFAULT = 20;
export const LEDGER_LIMIT_MAX = 50;

export type LedgerCursor = { createdAt: number; id: string };

/** Cursor opaco para o app: base64url de `[createdAtEmMs, entryId]`. */
export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), 'utf8').toString('base64url');
}

/**
 * O maior instante que o Timestamp do Firestore aceita (9999-12-31T23:59:59.999Z):
 * acima dele, o `Timestamp.fromMillis` do `startAfter` lança, e o cursor montado à
 * mão viraria 500 em vez de 400.
 */
const MAX_TIMESTAMP_MS = 253_402_300_799_999;

/** null quando o texto não é um cursor nosso. */
export function decodeLedgerCursor(value: string): LedgerCursor | null {
  if (!/^[A-Za-z0-9_-]{1,600}$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      Number.isInteger(parsed[0]) &&
      parsed[0] >= 0 &&
      parsed[0] <= MAX_TIMESTAMP_MS &&
      typeof parsed[1] === 'string' &&
      LEDGER_ID_PATTERN.test(parsed[1])
    ) {
      return { createdAt: parsed[0], id: parsed[1] };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Extrato do mais novo ao mais antigo, com o id do documento desempatando.
 * Desde o bloco 7, cada linha leva o nome da central (um getAll das centrais
 * distintas da página, em qualquer status) e o título que o lançamento de
 * missão guardou (22.2).
 */
export async function readLedgerPage(
  db: Firestore,
  uid: string,
  options: { limit: number; cursor: LedgerCursor | null },
): Promise<LedgerPage> {
  let query = walletRef(db, uid)
    .collection('ledger')
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');
  if (options.cursor) {
    query = query.startAfter(Timestamp.fromMillis(options.cursor.createdAt), options.cursor.id);
  }
  const snapshot = await query.limit(options.limit + 1).get();
  const docs = snapshot.docs.slice(0, options.limit);
  const items = docs.map((doc): LedgerItem => {
    const data = doc.data();
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0;
    return {
      id: doc.id,
      kind: data.kind,
      source: data.source,
      points: data.points ?? 0,
      xpDelta: data.xpDelta ?? 0,
      seasonDelta: data.seasonDelta ?? 0,
      artistId: data.artistId ?? null,
      centralSeasonDelta: data.centralSeasonDelta ?? 0,
      centralTotalDelta: data.centralTotalDelta ?? 0,
      subject: data.subject ?? null,
      createdAt: new Date(createdAt).toISOString(),
      artistName: null,
      subjectTitle: typeof data.subjectTitle === 'string' ? data.subjectTitle : null,
    };
  });
  const artistIds = [
    ...new Set(items.map((item) => item.artistId).filter((id): id is string => !!id)),
  ];
  if (artistIds.length > 0) {
    const artists = await db.getAll(...artistIds.map((id) => db.collection('artists').doc(id)));
    const names = new Map(
      artistIds.map((id, index) => {
        const name = artists[index]?.exists ? artists[index]!.get('name') : null;
        return [id, typeof name === 'string' ? name : null] as const;
      }),
    );
    for (const item of items)
      item.artistName = item.artistId ? (names.get(item.artistId) ?? null) : null;
  }
  const last = docs.at(-1);
  const nextCursor =
    snapshot.docs.length > options.limit && last
      ? encodeLedgerCursor({
          createdAt: (last.get('createdAt') as Timestamp).toMillis(),
          id: last.id,
        })
      : null;
  return { items, nextCursor };
}
