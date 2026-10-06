import { HANDLE_PATTERN } from '../artists/model';
import {
  addActivity,
  addEntryToShard,
  emptyShardDelta,
  isEmptyShardDelta,
  type ShardDelta,
} from './stats';

// Núcleo de pontos, puro: nada aqui lê ou grava o Firestore. O award.ts lê,
// chama computeAwards e grava o resultado. Contrato em docs/arquitetura-api.md
// (seções 4, 5 e 7).

/** Fuso dos dias de pontos: o limite diário, o `days` da carteira, o extrato e os agregados. */
export const TIME_ZONE = 'America/Sao_Paulo';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Origens que rendem pontos. Origem nova é mudança de código: tipo, padrão e a tabela da nota. */
export const EARN_SOURCES = [
  'like',
  'comment',
  'rsvp',
  'central_join',
  'mission',
  'invite_visit',
  'invite_signup',
] as const;
export type EarnSource = (typeof EARN_SOURCES)[number];

/** Origens com valor na configuração. A missão leva os pontos dela, explícitos. */
export const VALUE_SOURCES = [
  'like',
  'comment',
  'rsvp',
  'central_join',
  'invite_visit',
  'invite_signup',
] as const satisfies readonly EarnSource[];
export type ValueSource = (typeof VALUE_SOURCES)[number];

export type PointsSource = EarnSource | 'redeem' | 'adjustment' | 'seed';

/** Um degrau da régua de níveis (o `Level` do app). */
export type Level = { number: number; name: string; minXp: number };

/** Valores, limites e régua (config/points), já completos e validados. */
export type PointsConfig = {
  /** 0 é o padrão do código; o painel grava 1, 2, 3... */
  version: number;
  values: Record<ValueSource, number>;
  /** Eventos pagos por dia de São Paulo; null é sem limite. */
  dailyLimits: Record<EarnSource, number | null>;
  levels: Level[];
};

/** A temporada de config/season, com as datas em ms. */
export type SeasonInfo = {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  leaderTitle: string | null;
};

export type Subject = {
  type: 'post' | 'comment' | 'event' | 'artist' | 'mission' | 'reward' | 'invite';
  id: string;
};

export type AwardEntry =
  | {
      kind: 'earn';
      source: EarnSource;
      eventId: string;
      artistId?: string | null;
      subject?: Subject | null;
      /** Só na missão: os pontos dela. */
      points?: number;
    }
  | {
      kind: 'spend';
      source: 'redeem';
      eventId: string;
      points: number;
      artistId?: string | null;
      subject?: Subject | null;
    }
  | {
      kind: 'adjust';
      source: 'adjustment' | 'seed';
      eventId: string;
      balance?: number;
      xp?: number;
      season?: number;
      central?: { artistId: string; season?: number; total?: number };
      note?: string | null;
    };

export type Actor = { type: 'fan' | 'system' | 'staff'; uid: string | null; name: string | null };

export type AwardStatus = 'applied' | 'duplicate' | 'capped' | 'zero' | 'skipped';

/** `points` é quanto o saldo mexeu: positivo no ganho, negativo no resgate, o delta no ajuste. */
export type AwardResult = { uid: string; entryId: string; status: AwardStatus; points: number };

/**
 * Contadores do dia que não rendem ponto, ao lado das origens em
 * `days[dia].count`: `central_entry` são os pedidos que criaram vínculo com
 * alguma central (o teto diário do bloco 4, docs/arquitetura-api.md, 19.5);
 * `invite_visit_sent` são as visitas a links de convite que a conta mandou, e
 * `invite_link` os links novos que ela registrou (os tetos do bloco 5, 20.4);
 * `like_set`, `comment_sent`, `rsvp_set`, `comment_report` e `fan_block` são
 * as trocas para curtido, os comentários, as trocas para "Eu vou", as
 * denúncias e os bloqueios (os tetos do bloco 6, 21.7).
 */
export type DailyActionKey =
  | 'central_entry'
  | 'invite_visit_sent'
  | 'invite_link'
  | 'like_set'
  | 'comment_sent'
  | 'rsvp_set'
  | 'comment_report'
  | 'fan_block';

export type DayStats = {
  earned: number;
  count: Partial<Record<EarnSource | DailyActionKey, number>>;
};

/** Última atividade do fã: conta os ativos do dia, da semana e do mês sem repetir. */
export type ActivityState = {
  lastDay: string | null;
  lastWeek: string | null;
  lastMonth: string | null;
};

/** wallets/{uid} lido, com as datas em ms. Sem documento: tudo zerado e `exists: false`. */
export type WalletState = {
  exists: boolean;
  balance: number;
  xp: number;
  seasonId: string | null;
  seasonPoints: number;
  seasonPointsAt: number | null;
  earnedTotal: number;
  spentTotal: number;
  days: Record<string, DayStats>;
  pastSeasons: number;
  activity: ActivityState;
};

/** wallets/{uid}/centralPoints/{artistId} lido. */
export type CentralState = {
  exists: boolean;
  artistId: string;
  seasonId: string | null;
  seasonPoints: number;
  seasonPointsAt: number | null;
  totalPoints: number;
};

/** Marcas de atividade de um pedido, calculadas pelo requireFan. */
export type ActivityMarks = {
  day: string;
  week: string;
  month: string;
  newDay: boolean;
  newWeek: boolean;
  newMonth: boolean;
  /** Semana do cadastro (`2026-W40`), da coorte; null se o perfil não tem data. */
  cohort: string | null;
};

export function emptyWallet(): WalletState {
  return {
    exists: false,
    balance: 0,
    xp: 0,
    seasonId: null,
    seasonPoints: 0,
    seasonPointsAt: null,
    earnedTotal: 0,
    spentTotal: 0,
    days: {},
    pastSeasons: 0,
    activity: { lastDay: null, lastWeek: null, lastMonth: null },
  };
}

export function emptyCentral(artistId: string): CentralState {
  return {
    exists: false,
    artistId,
    seasonId: null,
    seasonPoints: 0,
    seasonPointsAt: null,
    totalPoints: 0,
  };
}

export type PointsErrorReason =
  | 'insufficient_points'
  | 'negative_counter'
  | 'season_required'
  | 'invalid_entry'
  | 'not_fan'
  | 'profile_not_ready';

/**
 * Recusa do núcleo de pontos. A API traduz `insufficient_points`, `not_fan` e
 * `profile_not_ready` para o erro combinado com o app; o resto é erro de
 * programação (500) ou do ajuste da equipe (bloco seguinte).
 */
export class PointsError extends Error {
  readonly reason: PointsErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: PointsErrorReason, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PointsError';
    this.reason = reason;
    this.details = details;
  }
}

// --- Datas de São Paulo ------------------------------------------------------

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** O dia de São Paulo de um instante, `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  return dayFormatter.format(new Date(ms));
}

function dayParts(day: string): [number, number, number] {
  const [year, month, date] = day.split('-').map(Number);
  return [year!, month!, date!];
}

/** `day` andando `delta` dias no calendário (conta de calendário, sem fuso). */
export function shiftDay(day: string, delta: number): string {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date) + delta * DAY_MS).toISOString().slice(0, 10);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * O instante em que começa o dia de São Paulo seguinte ao de `now`. Procura a
 * hora cheia, a partir da meia-noite UTC do dia seguinte, em que o `dayKey`
 * vira (os fusos do Brasil são de horas cheias), sem supor o deslocamento.
 */
export function nextDayStart(now: number): number {
  const next = shiftDay(dayKey(now), 1);
  const [year, month, date] = dayParts(next);
  const utcMidnight = Date.UTC(year, month - 1, date);
  for (let hour = -14; hour <= 14; hour += 1) {
    const at = utcMidnight + hour * HOUR_MS;
    if (at > now && dayKey(at) === next) return at;
  }
  throw new RangeError(`Não achei o começo do dia ${next}.`);
}

/** Semana ISO do dia de calendário, `2026-W41`. */
export function weekKey(day: string): string {
  const [year, month, date] = dayParts(day);
  const thursday = new Date(Date.UTC(year, month - 1, date));
  const weekday = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + 4 - weekday);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Mês do dia de calendário, `2026-10`. */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

// --- Níveis e leituras --------------------------------------------------------

/** O degrau mais alto com `minXp <= xp` e o seguinte (null no último), como o levelForXp do app. */
export function levelForXp(
  xp: number,
  levels: readonly Level[],
): { level: Level; nextLevel: Level | null } {
  const index = levels.reduce((found, level, at) => (xp >= level.minXp ? at : found), 0);
  const level = levels[index] ?? levels[0];
  if (!level) throw new RangeError('Régua de níveis vazia.');
  const next = levels[index + 1];
  return { level: { ...level }, nextLevel: next ? { ...next } : null };
}

/** Ganhos de hoje e dos 6 dias anteriores, em dias de São Paulo. Resgate e ajuste não contam. */
export function weekEarned(days: Record<string, DayStats>, now: number): number {
  const today = dayKey(now);
  const first = shiftDay(today, -6);
  return Object.entries(days).reduce(
    (sum, [day, stats]) => (day >= first && day <= today ? sum + stats.earned : sum),
    0,
  );
}

/** Temporadas em que o fã pontuou: as passadas e a dos pontos guardados, se tem ponto. */
export function seasonsPlayed(wallet: Pick<WalletState, 'pastSeasons' | 'seasonPoints'>): number {
  return wallet.pastSeasons + (wallet.seasonPoints > 0 ? 1 : 0);
}

/** A temporada que está valendo agora (`startsAt <= now < endsAt`), ou null. */
export function activeSeason(season: SeasonInfo | null, now: number): SeasonInfo | null {
  return season && season.startsAt <= now && now < season.endsAt ? season : null;
}

/** Marcas de atividade do pedido: o que é novo em relação à última atividade guardada. */
export function activityMarks(
  activity: ActivityState,
  now: number,
  profileCreatedAt: number | null,
): ActivityMarks {
  const day = dayKey(now);
  const week = weekKey(day);
  const month = monthKey(day);
  const isNew = (last: string | null, current: string) => last === null || last < current;
  return {
    day,
    week,
    month,
    newDay: isNew(activity.lastDay, day),
    newWeek: isNew(activity.lastWeek, week),
    newMonth: isNew(activity.lastMonth, month),
    cohort: profileCreatedAt === null ? null : weekKey(dayKey(profileCreatedAt)),
  };
}

export function hasNewActivity(marks: ActivityMarks): boolean {
  return marks.newDay || marks.newWeek || marks.newMonth;
}

/** Atividade guardada depois do pedido: só anda para a frente. */
function nextActivity(activity: ActivityState, marks: ActivityMarks): ActivityState {
  const latest = (last: string | null, current: string) =>
    last !== null && last > current ? last : current;
  return {
    lastDay: latest(activity.lastDay, marks.day),
    lastWeek: latest(activity.lastWeek, marks.week),
    lastMonth: latest(activity.lastMonth, marks.month),
  };
}

// --- Entradas -----------------------------------------------------------------

/** Id do evento no extrato (`like:<postId>`). */
export const EVENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

/** Id do lançamento no extrato: a origem e o evento (`ledgerId`). O cursor do extrato confere. */
export const LEDGER_ID_PATTERN = /^[a-z_]+:[A-Za-z0-9_.:-]{1,200}$/;

const SUBJECT_TYPES = new Set([
  'post',
  'comment',
  'event',
  'artist',
  'mission',
  'reward',
  'invite',
]);

/** Id do lançamento: o evento que ele paga. O mesmo evento nunca paga duas vezes. */
export function ledgerId(entry: Pick<AwardEntry, 'source' | 'eventId'>): string {
  return `${entry.source}:${entry.eventId}`;
}

function invalid(message: string): PointsError {
  return new PointsError('invalid_entry', message);
}

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const isNonZeroInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value !== 0;

function assertArtistId(artistId: unknown): void {
  if (artistId === undefined || artistId === null) return;
  if (typeof artistId !== 'string' || !HANDLE_PATTERN.test(artistId)) {
    throw invalid(`artistId fora do formato: ${String(artistId)}`);
  }
}

/** Confere a entrada. Fora do formato é erro de programação de quem chama (500). */
export function assertValidEntry(entry: AwardEntry): void {
  if (typeof entry.eventId !== 'string' || !EVENT_ID_PATTERN.test(entry.eventId)) {
    throw invalid(`eventId fora do formato: ${String(entry.eventId)}`);
  }
  if (entry.kind === 'earn') {
    if (!(EARN_SOURCES as readonly string[]).includes(entry.source)) {
      throw invalid(`Origem desconhecida: ${entry.source}`);
    }
    if (entry.source === 'mission' ? !isPositiveInt(entry.points) : entry.points !== undefined) {
      throw invalid('Só a missão leva pontos explícitos, inteiros maiores que 0.');
    }
  } else if (entry.kind === 'spend') {
    if (entry.source !== 'redeem' || !isPositiveInt(entry.points)) {
      throw invalid('Resgate precisa de pontos inteiros maiores que 0.');
    }
  } else if (entry.kind === 'adjust') {
    if (entry.source !== 'adjustment' && entry.source !== 'seed') {
      throw invalid(`Origem de ajuste desconhecida: ${String(entry.source)}`);
    }
    const deltas = [entry.balance, entry.xp, entry.season].filter((value) => value !== undefined);
    if (!deltas.every(isNonZeroInt))
      throw invalid('Ajuste com delta que não é inteiro diferente de 0.');
    if (entry.central) {
      assertArtistId(entry.central.artistId);
      if (!entry.central.artistId) throw invalid('Ajuste de central sem artistId.');
      const central = [entry.central.season, entry.central.total].filter((v) => v !== undefined);
      if (central.length === 0 || !central.every(isNonZeroInt)) {
        throw invalid('Ajuste de central pede season, total ou os dois, inteiros diferentes de 0.');
      }
    }
    if (deltas.length === 0 && !entry.central) throw invalid('Ajuste sem nenhum delta.');
  } else {
    throw invalid('Tipo de lançamento desconhecido.');
  }
  if ('artistId' in entry) assertArtistId(entry.artistId);
  if ('subject' in entry && entry.subject) {
    const { type, id } = entry.subject;
    if (!SUBJECT_TYPES.has(type) || typeof id !== 'string' || !EVENT_ID_PATTERN.test(id)) {
      throw invalid('subject fora do formato.');
    }
  }
}

/** artistId da central que a entrada mexe (o ajuste, pela central dele). */
export function entryArtistId(entry: AwardEntry): string | null {
  if (entry.kind === 'adjust') return entry.central?.artistId ?? null;
  return entry.artistId ?? null;
}

// --- Cálculo --------------------------------------------------------------------

/** O lançamento que vai para o extrato (createdAt e o resto das datas em ms). */
export type LedgerData = {
  uid: string;
  kind: AwardEntry['kind'];
  source: PointsSource;
  eventId: string;
  points: number;
  xpDelta: number;
  seasonDelta: number;
  artistId: string | null;
  centralSeasonDelta: number;
  centralTotalDelta: number;
  seasonId: string | null;
  subject: Subject | null;
  balanceAfter: number;
  xpAfter: number;
  seasonPointsAfter: number;
  configVersion: number;
  actor: Actor;
  note: string | null;
  day: string;
  createdAt: number;
};

export type FanInput = {
  uid: string;
  /** false para outro fã sem users/{uid} (conta excluída): os lançamentos dele saem skipped. */
  hasProfile: boolean;
  wallet: WalletState;
  entries: readonly AwardEntry[];
  /** Ids de lançamento que já estão no extrato. */
  existingLedger: ReadonlySet<string>;
  /** Cada central citada nas entradas, lida (ou vazia). */
  centrals: ReadonlyMap<string, CentralState>;
  /** Marcas de atividade de quem chama; null para os outros fãs. */
  activity: ActivityMarks | null;
};

export type ComputeInput = {
  now: number;
  config: PointsConfig;
  /** config/season lido na transação. */
  season: SeasonInfo | null;
  actor: Actor;
  /** Quem chama: o pointsAwarded é a soma dos ganhos aplicados dele. */
  callerUid: string | null;
  fans: readonly FanInput[];
};

export type FanPlan = {
  uid: string;
  /** null quando nada mudou: nem a carteira nem o updatedAt são gravados. */
  wallet: { create: boolean; state: WalletState } | null;
  ledger: { id: string; data: LedgerData }[];
  centrals: { create: boolean; state: CentralState }[];
};

export type ComputeOutput = {
  day: string;
  results: AwardResult[];
  pointsAwarded: number;
  fans: FanPlan[];
  /** O que somar no shard do dia; null quando não há o que somar. */
  shard: ShardDelta | null;
};

/** Cópia da carteira que dá para mudar sem tocar na lida (os dias e a atividade inclusive). */
export function cloneWallet(wallet: WalletState): WalletState {
  const days: Record<string, DayStats> = {};
  for (const [day, stats] of Object.entries(wallet.days)) {
    days[day] = { earned: stats.earned, count: { ...stats.count } };
  }
  return { ...wallet, days, activity: { ...wallet.activity } };
}

/** Tira de `days` só os dias anteriores a `day` menos 6. Um dia depois do "agora" fica. */
export function trimDays(days: Record<string, DayStats>, day: string): Record<string, DayStats> {
  const first = shiftDay(day, -6);
  return Object.fromEntries(Object.entries(days).filter(([key]) => key >= first));
}

function switchSeason<
  T extends { seasonId: string | null; seasonPoints: number; seasonPointsAt: number | null },
>(state: T, seasonId: string): { state: T; hadPoints: boolean } {
  if (state.seasonId === seasonId) return { state, hadPoints: false };
  return {
    state: { ...state, seasonId, seasonPoints: 0, seasonPointsAt: null },
    hadPoints: state.seasonPoints > 0,
  };
}

/**
 * Calcula o efeito dos lançamentos de cada fã, em ordem: cada um parte do
 * resultado do anterior. Não grava nada; o award.ts grava o que voltar.
 * Recusa a transação inteira (PointsError) com resgate maior que o saldo ou
 * ajuste que deixaria um contador negativo.
 */
export function computeAwards(input: ComputeInput): ComputeOutput {
  const { now, config, actor } = input;
  const day = dayKey(now);
  const season = activeSeason(input.season, now);
  const results: AwardResult[] = [];
  const fans: FanPlan[] = [];
  const shard = emptyShardDelta();
  let pointsAwarded = 0;
  const uids = new Set<string>();

  for (const fan of input.fans) {
    // Dois planos do mesmo fã partiriam da mesma carteira, e um apagaria o outro.
    if (uids.has(fan.uid)) throw new Error(`Fã repetido no cálculo: ${fan.uid}`);
    uids.add(fan.uid);
    for (const entry of fan.entries) assertValidEntry(entry);

    if (!fan.hasProfile) {
      for (const entry of fan.entries) {
        results.push({ uid: fan.uid, entryId: ledgerId(entry), status: 'skipped', points: 0 });
      }
      continue;
    }

    let wallet = cloneWallet(fan.wallet);
    wallet.days = trimDays(wallet.days, day);
    if (season) {
      const switched = switchSeason(wallet, season.id);
      wallet = switched.state;
      if (switched.hadPoints) wallet.pastSeasons += 1;
    }

    const centrals = new Map<string, CentralState>();
    const touched = new Set<string>();
    const centralOf = (artistId: string): CentralState => {
      let central = centrals.get(artistId);
      if (!central) {
        central = { ...(fan.centrals.get(artistId) ?? emptyCentral(artistId)) };
        if (season) central = switchSeason(central, season.id).state;
        centrals.set(artistId, central);
      }
      return central;
    };

    const seen = new Set(fan.existingLedger);
    const ledger: FanPlan['ledger'] = [];
    let changed = false;

    for (const entry of fan.entries) {
      const id = ledgerId(entry);
      const result = (status: AwardStatus, points = 0) =>
        results.push({ uid: fan.uid, entryId: id, status, points });
      if (seen.has(id)) {
        result('duplicate');
        continue;
      }

      const artistId = entryArtistId(entry);
      let points = 0;
      let xpDelta = 0;
      let seasonDelta = 0;
      let centralSeasonDelta = 0;
      let centralTotalDelta = 0;

      if (entry.kind === 'earn') {
        const value =
          entry.source === 'mission' ? entry.points : config.values[entry.source as ValueSource];
        const p = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
        if (p <= 0) {
          result('zero');
          continue;
        }
        const limit = config.dailyLimits[entry.source] ?? null;
        const count = wallet.days[day]?.count[entry.source] ?? 0;
        if (limit !== null && count >= limit) {
          result('capped');
          continue;
        }
        points = p;
        xpDelta = p;
        wallet.balance += p;
        wallet.xp += p;
        wallet.earnedTotal += p;
        if (season) {
          seasonDelta = p;
          wallet.seasonPoints += p;
          wallet.seasonPointsAt = now;
        }
        if (artistId) {
          const central = centralOf(artistId);
          central.totalPoints += p;
          centralTotalDelta = p;
          if (season) {
            central.seasonPoints += p;
            central.seasonPointsAt = now;
            centralSeasonDelta = p;
          }
          touched.add(artistId);
        }
        const today = wallet.days[day] ?? { earned: 0, count: {} };
        today.earned += p;
        today.count[entry.source] = (today.count[entry.source] ?? 0) + 1;
        wallet.days[day] = today;
        if (fan.uid === input.callerUid) pointsAwarded += p;
      } else if (entry.kind === 'spend') {
        if (wallet.balance < entry.points) {
          throw new PointsError('insufficient_points', 'Saldo insuficiente.', {
            balance: wallet.balance,
            cost: entry.points,
          });
        }
        points = -entry.points;
        wallet.balance -= entry.points;
        wallet.spentTotal += entry.points;
      } else {
        const needsSeason = entry.season !== undefined || entry.central?.season !== undefined;
        if (needsSeason && !season) {
          throw new PointsError('season_required', 'Ajuste de temporada sem temporada ativa.');
        }
        const next = {
          balance: wallet.balance + (entry.balance ?? 0),
          xp: wallet.xp + (entry.xp ?? 0),
          seasonPoints: wallet.seasonPoints + (entry.season ?? 0),
        };
        let central: CentralState | null = null;
        if (entry.central) {
          central = centralOf(entry.central.artistId);
          const centralSeason = central.seasonPoints + (entry.central.season ?? 0);
          const centralTotal = central.totalPoints + (entry.central.total ?? 0);
          if (centralSeason < 0 || centralTotal < 0) {
            throw new PointsError('negative_counter', 'O ajuste deixaria a central negativa.');
          }
        }
        if (next.balance < 0 || next.xp < 0 || next.seasonPoints < 0) {
          throw new PointsError('negative_counter', 'O ajuste deixaria um contador negativo.');
        }
        points = entry.balance ?? 0;
        xpDelta = entry.xp ?? 0;
        seasonDelta = entry.season ?? 0;
        wallet.balance = next.balance;
        wallet.xp = next.xp;
        wallet.seasonPoints = next.seasonPoints;
        if (seasonDelta > 0) wallet.seasonPointsAt = now;
        if (central && entry.central) {
          centralSeasonDelta = entry.central.season ?? 0;
          centralTotalDelta = entry.central.total ?? 0;
          central.seasonPoints += centralSeasonDelta;
          central.totalPoints += centralTotalDelta;
          if (centralSeasonDelta > 0) central.seasonPointsAt = now;
          touched.add(entry.central.artistId);
        }
      }

      seen.add(id);
      changed = true;
      ledger.push({
        id,
        data: {
          uid: fan.uid,
          kind: entry.kind,
          source: entry.source,
          eventId: entry.eventId,
          points,
          xpDelta,
          seasonDelta,
          artistId,
          centralSeasonDelta,
          centralTotalDelta,
          seasonId: season?.id ?? null,
          subject: entry.kind === 'adjust' ? null : (entry.subject ?? null),
          balanceAfter: wallet.balance,
          xpAfter: wallet.xp,
          seasonPointsAfter: wallet.seasonPoints,
          configVersion: config.version,
          actor: { ...actor },
          note: entry.kind === 'adjust' ? (entry.note ?? null) : null,
          day,
          createdAt: now,
        },
      });
      addEntryToShard(shard, entry, points);
      result('applied', points);
    }

    if (actor.type === 'fan' && fan.activity && hasNewActivity(fan.activity)) {
      wallet.activity = nextActivity(wallet.activity, fan.activity);
      addActivity(shard, fan.activity);
      changed = true;
    }

    fans.push({
      uid: fan.uid,
      wallet: changed ? { create: !fan.wallet.exists, state: { ...wallet, exists: true } } : null,
      ledger,
      centrals: [...touched].map((artistId) => {
        const state = centrals.get(artistId)!;
        return { create: !state.exists, state: { ...state, exists: true } };
      }),
    });
  }

  return {
    day,
    results,
    pointsAwarded,
    fans,
    shard: isEmptyShardDelta(shard) ? null : shard,
  };
}
