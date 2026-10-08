import { Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';

import { isArtistId } from '../centrals/model';
import { artistRef } from '../centrals/service';
import { dayKey } from '../day';
import { isFanId } from '../moderation/model';
import {
  addStaffLimit,
  ADJUST_COUNTERS,
  checkStaffLimit,
  parseStaffLimit,
  staffLimitRef,
  type AdjustCounter,
} from '../staff/limits';
import { requestFields, type StaffRole } from '../staff/model';
import { directRead, readPanelActor, transactionRead } from '../staff/panel-actor';
import {
  aboveLimitError,
  dailyLimitError,
  negativeCounterError,
  panelError,
  targetFanUid,
} from '../staff/panel-errors';
import { writeAudit, type CallerAuth } from '../staff/service';
import { isVisibleLine } from '../visible-line';
import { ledgerRef, planAwards, runAsFan, type AwardPlan } from './award';
import type { ConfigSource } from './config';
import { ledgerId, PointsError, type Actor, type AwardEntry, type WalletState } from './model';

// O ajuste de pontos da equipe (bloco 11, docs/arquitetura-api.md, 26.4 e a
// seção 9): a callable `adjustFanPoints`, com a seção fans e edição, mexe no
// saldo, no XP, nos pontos da temporada e nos da central de um fã, com o
// motivo obrigatório, que vai para o extrato e para a auditoria. Tetos por
// papel em cada ajuste, orçamento do dia do editor em staffLimits e a recusa
// da própria conta de fã. O lançamento é o núcleo de pontos de sempre (o
// `runAsFan` com o ator da equipe), com o `game` da configuração: o ajuste
// que passa um degrau desbloqueia a conquista de nível.

/** Teto por contador em cada ajuste do editor (decisão 10 de 26.1). */
export const ADJUST_EDITOR_MAX = 50_000;

/** Teto por contador em cada ajuste do admin. */
export const ADJUST_ADMIN_MAX = 1_000_000;

/** Orçamento do editor por contador e dia, somado em valor absoluto (o admin não tem). */
export const ADJUST_EDITOR_DAILY_MAX = 100_000;

/** O motivo do ajuste, de 1 a 200, numa linha visível. */
export const NOTE_MAX = 200;

/** O id da tentativa, gerado pelo painel: é o `eventId` do lançamento `adjustment:<id>`. */
export const ADJUSTMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** O pedido do ajuste, conferido. */
export type AdjustInput = {
  uid: string;
  adjustmentId: string;
  balance?: number;
  xp?: number;
  season?: number;
  central?: { artistId: string; season?: number; total?: number };
  note: string;
};

/** O teto por contador em cada ajuste, pelo papel de quem ajusta. */
export function adjustMaxFor(role: StaffRole): number {
  return role === 'admin' ? ADJUST_ADMIN_MAX : ADJUST_EDITOR_MAX;
}

/** O orçamento do dia de quem ajusta: null é sem orçamento (o admin). */
export function adjustDailyMaxFor(role: StaffRole): number | null {
  return role === 'admin' ? null : ADJUST_EDITOR_DAILY_MAX;
}

/** Os deltas do ajuste por contador (os de `ADJUST_COUNTERS`, o painel e o orçamento usam os mesmos nomes). */
export function adjustDeltas(input: AdjustInput): Partial<Record<AdjustCounter, number>> {
  const deltas: Partial<Record<AdjustCounter, number>> = {};
  if (input.balance !== undefined) deltas.balance = input.balance;
  if (input.xp !== undefined) deltas.xp = input.xp;
  if (input.season !== undefined) deltas.season = input.season;
  if (input.central?.season !== undefined) deltas.centralSeason = input.central.season;
  if (input.central?.total !== undefined) deltas.centralTotal = input.central.total;
  return deltas;
}

const invalid = (field: string) => panelError('invalid-request', { field });

/** Delta ausente fica ausente; presente, inteiro (seguro) e diferente de 0. */
function parseDelta(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value === 0) {
    throw invalid(field);
  }
  return value;
}

/** O motivo, em NFC e sem espaço nas pontas, de 1 a 200, numa linha visível. */
function parseNote(value: unknown): string {
  if (typeof value !== 'string') throw invalid('note');
  const note = value.normalize('NFC').trim();
  if (note.length < 1 || note.length > NOTE_MAX || !isVisibleLine(note)) throw invalid('note');
  return note;
}

/**
 * O teto do papel em cada contador (`adjust-above-limit`, com o teto em
 * `details.max`). A callable confere de novo com o papel relido na transação.
 */
export function assertAdjustCap(input: AdjustInput, role: StaffRole): void {
  const max = adjustMaxFor(role);
  for (const counter of ADJUST_COUNTERS) {
    const delta = adjustDeltas(input)[counter];
    if (delta !== undefined && Math.abs(delta) > max) throw aboveLimitError(max);
  }
}

/**
 * O corpo do `adjustFanPoints` (puro): `uid` no formato do fã, `adjustmentId`
 * no formato da tentativa, deltas inteiros diferentes de 0 (pelo menos um),
 * `central` com o @ e pelo menos um dos dois deltas dela, o `note` de 1 a 200
 * numa linha visível e o teto do papel. Campo fora: `invalid-request` com o
 * campo; acima do teto: `adjust-above-limit`.
 */
export function parseAdjustInput(data: unknown, role: StaffRole): AdjustInput {
  const fields = requestFields(data);
  if (!isFanId(fields.uid)) throw invalid('uid');
  if (typeof fields.adjustmentId !== 'string' || !ADJUSTMENT_ID_PATTERN.test(fields.adjustmentId)) {
    throw invalid('adjustmentId');
  }
  const input: AdjustInput = { uid: fields.uid, adjustmentId: fields.adjustmentId, note: '' };
  const balance = parseDelta(fields.balance, 'balance');
  const xp = parseDelta(fields.xp, 'xp');
  const season = parseDelta(fields.season, 'season');
  if (balance !== undefined) input.balance = balance;
  if (xp !== undefined) input.xp = xp;
  if (season !== undefined) input.season = season;
  if (fields.central !== undefined && fields.central !== null) {
    const central = fields.central;
    if (typeof central !== 'object' || Array.isArray(central)) throw invalid('central');
    const raw = central as Record<string, unknown>;
    if (!isArtistId(raw.artistId)) throw invalid('central.artistId');
    const centralSeason = parseDelta(raw.season, 'central.season');
    const centralTotal = parseDelta(raw.total, 'central.total');
    if (centralSeason === undefined && centralTotal === undefined) throw invalid('central');
    input.central = {
      artistId: raw.artistId,
      ...(centralSeason !== undefined ? { season: centralSeason } : {}),
      ...(centralTotal !== undefined ? { total: centralTotal } : {}),
    };
  }
  if (Object.keys(adjustDeltas(input)).length === 0) throw invalid('balance');
  input.note = parseNote(fields.note);
  assertAdjustCap(input, role);
  return input;
}

/** O lançamento do ajuste no núcleo de pontos. */
export function adjustEntry(input: AdjustInput): AwardEntry {
  return {
    kind: 'adjust',
    source: 'adjustment',
    eventId: input.adjustmentId,
    ...(input.balance !== undefined ? { balance: input.balance } : {}),
    ...(input.xp !== undefined ? { xp: input.xp } : {}),
    ...(input.season !== undefined ? { season: input.season } : {}),
    ...(input.central ? { central: { ...input.central } } : {}),
    note: input.note,
  };
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** O lançamento gravado é o mesmo ajuste do pedido (os deltas, a central e o motivo). */
export function sameAdjustment(stored: DocumentData, input: AdjustInput): boolean {
  return (
    stored.source === 'adjustment' &&
    num(stored.points) === (input.balance ?? 0) &&
    num(stored.xpDelta) === (input.xp ?? 0) &&
    num(stored.seasonDelta) === (input.season ?? 0) &&
    (stored.artistId ?? null) === (input.central?.artistId ?? null) &&
    num(stored.centralSeasonDelta) === (input.central?.season ?? 0) &&
    num(stored.centralTotalDelta) === (input.central?.total ?? 0) &&
    (stored.note ?? null) === input.note
  );
}

/** O lançamento gravado, como o `adjustment-id-reused` mostra em `details.entry`. */
export function adjustmentView(stored: DocumentData): Record<string, unknown> {
  const artistId = typeof stored.artistId === 'string' ? stored.artistId : null;
  const createdAt = stored.createdAt instanceof Timestamp ? stored.createdAt.toMillis() : null;
  return {
    balance: num(stored.points),
    xp: num(stored.xpDelta),
    season: num(stored.seasonDelta),
    central: artistId
      ? { artistId, season: num(stored.centralSeasonDelta), total: num(stored.centralTotalDelta) }
      : null,
    note: typeof stored.note === 'string' ? stored.note : null,
    balanceAfter: num(stored.balanceAfter),
    createdAt: createdAt === null ? null : new Date(createdAt).toISOString(),
  };
}

export type AdjustDeps = {
  db: Firestore;
  /** Valores, régua e o `game` (missões, conquistas e meta), com o cache de sempre. */
  config: ConfigSource;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
  /** Sorteio do shard dos agregados; os testes fixam. */
  random?: () => number;
};

export type AdjustResult = {
  status: 'applied' | 'duplicate';
  balance: number;
  xp: number;
  seasonPoints: number;
};

const numbersOf = (wallet: Pick<WalletState, 'balance' | 'xp' | 'seasonPoints'>) => ({
  balance: wallet.balance,
  xp: wallet.xp,
  seasonPoints: wallet.seasonPoints,
});

/** Recusa do núcleo de pontos para o motivo do painel; o resto sobe como está. */
function adjustError(error: unknown): unknown {
  if (error instanceof HttpsError || !(error instanceof PointsError)) return error;
  if (error.reason === 'not_fan' || error.reason === 'profile_not_ready') {
    return panelError('fan-not-found');
  }
  if (error.reason === 'season_required') return panelError('season-required');
  if (error.reason === 'negative_counter') {
    const counter = error.details?.counter;
    return negativeCounterError(
      (ADJUST_COUNTERS as readonly unknown[]).includes(counter)
        ? (counter as AdjustCounter)
        : 'balance',
    );
  }
  return error;
}

/**
 * adjustFanPoints (26.4): o fã alvo (nunca o de quem chama, `self`), o acesso
 * fora e de novo dentro da transação, o pedido conferido com o teto do papel,
 * e, no `runAsFan` (perfil exigido, sem marcar atividade), nesta ordem: o
 * lançamento desta tentativa já gravado (o mesmo corpo responde `duplicate`
 * sem auditar nem somar no orçamento; outro corpo é `adjustment-id-reused`,
 * com o gravado em `details.entry`), a central (em qualquer status), o
 * orçamento do dia do editor, o plano (temporada, contadores negativos), a
 * soma no orçamento e a auditoria `wallet.adjusted`, com o motivo inteiro.
 * Todas as leituras antes das gravações.
 */
export async function adjustFanPoints(
  deps: AdjustDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<AdjustResult> {
  const { db } = deps;
  const fields = requestFields(data);
  const uid = targetFanUid(caller, fields.uid);
  const first = await readPanelActor(directRead, db, caller, 'fans', 'edit');
  const input = parseAdjustInput(fields, first.role);
  const { points, game } = await deps.config.get();
  const now = (deps.now ?? Date.now)();
  const entryId = ledgerId({ source: 'adjustment', eventId: input.adjustmentId });
  const actorOf = (actor: { uid: string; name: string }): Actor => ({
    type: 'staff',
    uid: actor.uid,
    name: actor.name,
  });

  try {
    const outcome = await runAsFan<{ plan: AwardPlan; result: AdjustResult }>(
      db,
      uid,
      {
        now,
        config: points,
        game,
        actor: actorOf(first),
        ...(deps.random ? { random: deps.random } : {}),
      },
      async (tx, fan, award) => {
        const actor = await readPanelActor(transactionRead(tx), db, caller, 'fans', 'edit');
        assertAdjustCap(input, actor.role);
        const ctx = { ...award, actor: actorOf(actor) };
        const [stored, limitSnap, artist] = await tx.getAll(
          ledgerRef(db, uid, entryId),
          staffLimitRef(db, actor.uid, now),
          ...(input.central ? [artistRef(db, input.central.artistId)] : []),
        );
        if (stored!.exists) {
          if (!sameAdjustment(stored!.data() ?? {}, input)) {
            throw panelError('adjustment-id-reused', {
              entry: adjustmentView(stored!.data() ?? {}),
            });
          }
          const plan = await planAwards(tx, db, [{ uid, fan, entries: [] }], ctx);
          return { plan, result: { status: 'duplicate', ...numbersOf(fan.wallet) } };
        }
        if (input.central && !artist!.exists) throw panelError('artist-not-found');
        const limit = checkStaffLimit(parseStaffLimit(limitSnap!.data(), dayKey(now)), {
          kind: 'adjust',
          deltas: adjustDeltas(input),
          dailyMax: adjustDailyMaxFor(actor.role),
        });
        if (!limit.ok) {
          if (limit.reason === 'adjust-daily-limit') {
            throw dailyLimitError(limit.counter, limit.remaining);
          }
          throw panelError('invalid-request');
        }
        const plan = await planAwards(tx, db, [{ uid, fan, entries: [adjustEntry(input)] }], ctx);
        const state = plan.fans.find((item) => item.uid === uid)?.wallet?.state;
        const applied = plan.results.find((item) => item.entryId === entryId);
        if (applied?.status !== 'applied' || !state) {
          // A leitura do extrato acima vem da mesma transação: não acontece.
          throw new Error(
            `O ajuste ${entryId} não foi aplicado: ${applied?.status ?? 'sem resultado'}.`,
          );
        }
        addStaffLimit(tx, db, actor.uid, now, limit.next);
        writeAudit(
          tx,
          db,
          {
            action: 'wallet.adjusted',
            actorUid: actor.uid,
            actorName: actor.name,
            targetEmail: '',
            targetUid: uid,
            details: {
              entryId,
              ...(input.balance !== undefined ? { balance: input.balance } : {}),
              ...(input.xp !== undefined ? { xp: input.xp } : {}),
              ...(input.season !== undefined ? { season: input.season } : {}),
              ...(input.central ? { central: { ...input.central } } : {}),
              seasonId: plan.activeSeasonId,
              note: input.note,
            },
          },
          Timestamp.fromMillis(now),
        );
        return { plan, result: { status: 'applied', ...numbersOf(state) } };
      },
    );
    return outcome.result;
  } catch (error) {
    throw adjustError(error);
  }
}
