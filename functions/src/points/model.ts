import {
  unlockAchievements,
  type AchievementRecord,
  type FirstAction,
} from '../achievements/model';
import { HANDLE_PATTERN } from '../artists/model';
import { dayKey, monthKey, shiftDay, weekKey } from '../day';
import {
  applyMissionTicks,
  candidateMissions,
  cloneMissionsState,
  emptyMissionsState,
  EMPTY_MISSION_INDEX,
  MISSION_TITLE_MAX,
  missionArtistId,
  missionEventId,
  rollMissions,
  type MissionIndex,
  type MissionRecord,
  type MissionsState,
  type MissionTick,
  type SeasonGoalConfig,
} from '../missions/model';
import { isVisibleLine } from '../visible-line';
import {
  addAchievementToShard,
  addActivity,
  addEntryToShard,
  addMissionToShard,
  emptyShardDelta,
  isEmptyShardDelta,
  type ShardDelta,
} from './stats';

// Núcleo de pontos, puro: nada aqui lê ou grava o Firestore. O award.ts lê,
// chama computeAwards e grava o resultado. Contrato em docs/arquitetura-api.md
// (seções 4, 5 e 7; missões, conquistas e nível do bloco 7 na seção 22).

// Os dias de São Paulo moram em day.ts desde o bloco 7; daqui saem como antes.
export { dayKey, monthKey, nextDayStart, shiftDay, TIME_ZONE, weekKey } from '../day';

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

/**
 * Todas as origens do extrato. `redeem` é o débito do resgate e
 * `redeem_refund`, a devolução do resgate recusado pela equipe (bloco 10,
 * docs/arquitetura-api.md, 25.1, decisão 7).
 */
export type PointsSource = EarnSource | 'redeem' | 'redeem_refund' | 'adjustment' | 'seed';

/** Um degrau da régua de níveis (o `Level` do app). */
export type Level = { number: number; name: string; minXp: number };

/** Valores, limites e régua (config/points), já completos e validados. */
export type PointsConfig = {
  /** 0 é o padrão do código; o painel grava 1, 2, 3... */
  version: number;
  values: Record<ValueSource, number>;
  /** Eventos pagos por dia de São Paulo; null é sem limite. A missão é sempre null (22.1, decisão 7). */
  dailyLimits: Record<EarnSource, number | null>;
  levels: Level[];
  /**
   * Tetos do dia das ações, por fã (os dos blocos 4, 5 e 6), editáveis pelo
   * painel desde o bloco 7 (22.1, decisão 13). Contam ações, pagas ou não.
   */
  actionCaps: Record<DailyActionKey, number>;
};

/**
 * O jogo da configuração (bloco 7): o índice das missões no ar por tipo de
 * ação, o catálogo de conquistas e a meta da temporada. Vem da mesma carga do
 * cache que dá os valores; os caminhos fora da API que não passam nada usam o
 * `NO_GAME` (catálogos vazios e sem meta): sem missão, sem conquista, sem meta.
 */
export type GameConfig = {
  missions: MissionIndex;
  achievements: readonly AchievementRecord[];
  seasonGoal: SeasonGoalConfig | null;
};

export const NO_GAME: GameConfig = {
  missions: EMPTY_MISSION_INDEX,
  achievements: [],
  seasonGoal: null,
};

/** O encerramento antes da hora (`endSeason`, bloco 8): o fim combinado, quando e quem. */
export type EndedEarly = {
  plannedEndsAt: number;
  at: number;
  by: { uid: string; name: string };
};

/** A temporada de config/season, com as datas em ms. */
export type SeasonInfo = {
  id: string;
  name: string;
  startsAt: number;
  endsAt: number;
  leaderTitle: string | null;
  /** O N do "top N" do card "Você" (bloco 8, 23.3), de 1 a 50; 10 sem o campo. */
  topTarget: number;
  /** Gravado pelo `endSeason`: o `endsAt` passou a ser o `at` (bloco 8). */
  endedEarly: EndedEarly | null;
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
      /** Só na missão, obrigatório: o título dela agora (o `subjectTitle` do extrato). */
      title?: string;
    }
  | {
      kind: 'spend';
      source: 'redeem';
      eventId: string;
      points: number;
      artistId?: string | null;
      subject?: Subject | null;
      /** O título da recompensa na hora (o `subjectTitle` do extrato, bloco 10). */
      title?: string;
    }
  | {
      /**
       * A devolução do resgate recusado (bloco 10, 25.1, decisão 7): o saldo
       * sobe o que o pedido gastou e o `spentTotal` desce o mesmo tanto (nunca
       * abaixo de 0). XP, temporada, centrais e os dias não mexem.
       */
      kind: 'refund';
      source: 'redeem_refund';
      eventId: string;
      points: number;
      subject?: Subject | null;
      /** O título da recompensa (o `subjectTitle` do extrato). */
      title?: string;
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

/**
 * `points` é quanto o saldo mexeu: positivo no ganho e na devolução, negativo
 * no resgate, o delta no ajuste.
 */
export type AwardResult = { uid: string; entryId: string; status: AwardStatus; points: number };

/**
 * Contadores do dia que não rendem ponto, ao lado das origens em
 * `days[dia].count`: `central_entry` são os pedidos que criaram vínculo com
 * alguma central (o teto diário do bloco 4, docs/arquitetura-api.md, 19.5);
 * `invite_visit_sent` são as visitas a links de convite que a conta mandou, e
 * `invite_link` os links novos que ela registrou (os tetos do bloco 5, 20.4);
 * `like_set`, `comment_sent`, `rsvp_set`, `comment_report` e `fan_block` são
 * as trocas para curtido, os comentários, as trocas para "Eu vou", as
 * denúncias e os bloqueios (os tetos do bloco 6, 21.7); `photo_set`, as trocas
 * de foto do perfil (o teto do bloco 9, 24.1, decisão 11); `reward_redeem`,
 * os resgates da loja (o teto do bloco 10, 25.1, decisão 15); `photo_upload`,
 * as vagas de envio da foto (a proteção contra abuso, 27.4); `profile_save` e
 * `name_change`, os salvamentos do perfil e as trocas de nome (o perfil novo,
 * seção 28, decisão 9).
 */
export type DailyActionKey =
  | 'central_entry'
  | 'invite_visit_sent'
  | 'invite_link'
  | 'like_set'
  | 'comment_sent'
  | 'rsvp_set'
  | 'comment_report'
  | 'fan_block'
  | 'photo_set'
  | 'reward_redeem'
  | 'photo_upload'
  | 'profile_save'
  | 'name_change';

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
  /** Temporadas fechadas em que o fã pontuou no geral; só a virada soma (bloco 8, 23.3). */
  pastSeasons: number;
  /** A última temporada que a virada contou para o fã (`stats.closedSeasonId`, bloco 8). */
  closedSeasonId: string | null;
  activity: ActivityState;
  /** Missões concluídas na temporada `seasonId`; zera na troca de temporada (bloco 7). */
  seasonMissions: number;
  /** Quem bateu a meta da temporada; nunca sai (bloco 7). */
  goalReached: { seasonId: string; at: number } | null;
  /** O progresso do período atual de cada tipo (bloco 7). */
  missions: MissionsState;
  /** Conquistas desbloqueadas, com a data em ms; nunca saem (bloco 7). */
  achievements: Record<string, number>;
  /** O `updatedAt` da carteira lida, em ms: a data da conquista de nível que já valia (22.6). */
  updatedAt: number | null;
};

/** wallets/{uid}/centralPoints/{artistId} lido. */
export type CentralState = {
  exists: boolean;
  artistId: string;
  seasonId: string | null;
  seasonPoints: number;
  seasonPointsAt: number | null;
  totalPoints: number;
  /**
   * O fã é membro da central (bloco 8, decisão 3 de 23.1): entrar grava true e
   * sair, false, na transação do vínculo. O ranking da central filtra por ele.
   */
  member: boolean;
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
    closedSeasonId: null,
    activity: { lastDay: null, lastWeek: null, lastMonth: null },
    seasonMissions: 0,
    goalReached: null,
    missions: emptyMissionsState(),
    achievements: {},
    updatedAt: null,
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
    member: false,
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
 * programação (500) ou do ajuste da equipe (`adjustFanPoints`, bloco 11, que
 * lê o `details.counter` do `negative_counter`).
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

/**
 * Temporadas em que o fã pontuou: as que a virada já contou (`pastSeasons`) e
 * a dos pontos guardados, se tem ponto e a virada ainda não a contou
 * (`closedSeasonId`). Conta certo antes da virada, entre a virada e a primeira
 * ação na temporada nova e depois dela (bloco 8, decisão 8 de 23.1).
 */
export function seasonsPlayed(
  wallet: Pick<WalletState, 'pastSeasons' | 'seasonPoints' | 'seasonId' | 'closedSeasonId'>,
): number {
  const current = wallet.seasonPoints > 0 && wallet.seasonId !== wallet.closedSeasonId ? 1 : 0;
  return wallet.pastSeasons + current;
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

/** O título guardado no extrato: de 1 a 80, numa linha visível (missão e, no bloco 10, a loja). */
function isEntryTitle(title: unknown): title is string {
  return (
    typeof title === 'string' &&
    title.length >= 1 &&
    title.length <= MISSION_TITLE_MAX &&
    isVisibleLine(title)
  );
}

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
    if (entry.source === 'mission') {
      if (!isEntryTitle(entry.title)) {
        throw invalid('A missão leva o título dela, de 1 a 80, numa linha visível.');
      }
    } else if (entry.title !== undefined) {
      throw invalid('Só a missão leva título.');
    }
  } else if (entry.kind === 'spend') {
    if (entry.source !== 'redeem' || !isPositiveInt(entry.points)) {
      throw invalid('Resgate precisa de pontos inteiros maiores que 0.');
    }
    if (entry.title !== undefined && !isEntryTitle(entry.title)) {
      throw invalid('O título do resgate vai de 1 a 80, numa linha visível.');
    }
  } else if (entry.kind === 'refund') {
    if (entry.source !== 'redeem_refund' || !isPositiveInt(entry.points)) {
      throw invalid(
        'Devolução precisa da origem redeem_refund e de pontos inteiros maiores que 0.',
      );
    }
    if (entry.title !== undefined && !isEntryTitle(entry.title)) {
      throw invalid('O título da devolução vai de 1 a 80, numa linha visível.');
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
  // A devolução do resgate nunca é de uma central (bloco 10).
  if (entry.kind === 'refund') return null;
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
  /**
   * O título da missão quando concluiu (bloco 7) ou da recompensa no resgate e
   * na devolução (bloco 10); null no resto.
   */
  subjectTitle: string | null;
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
  /**
   * true para outro fã (não quem chama) com a conta suspensa (`suspendedAt`
   * no perfil, bloco 11, 26.6): os ganhos (`earn`) dele saem skipped e as
   * unidades de missão são ignoradas, como o fã sem perfil; a devolução do
   * resgate entra. Quem chama nunca vem marcado (a trava dele é a da API).
   */
  suspended?: boolean;
  wallet: WalletState;
  entries: readonly AwardEntry[];
  /** As unidades das missões (bloco 7), na ordem; sem perfil, ignoradas. */
  ticks?: readonly MissionTick[];
  /** Ids de lançamento que já estão no extrato (os das missões que podem concluir inclusive). */
  existingLedger: ReadonlySet<string>;
  /** Cada central citada nas entradas (e nas missões que podem concluir), lida (ou vazia). */
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
  /** Missões, conquistas e meta da temporada; sem ele, o `NO_GAME`. */
  game?: GameConfig;
};

export type FanPlan = {
  uid: string;
  /** null quando nada mudou: nem a carteira nem o updatedAt são gravados. */
  wallet: { create: boolean; state: WalletState } | null;
  ledger: { id: string; data: LedgerData }[];
  centrals: { create: boolean; state: CentralState }[];
};

/** Uma missão concluída e paga agora, para a resposta de quem chama. */
export type CompletedMissionResult = {
  id: string;
  title: string;
  rewardPoints: number;
  /** ISO. */
  completedAt: string;
};

/**
 * As recompensas da ação para quem chama (22.2): as missões concluídas e
 * pagas agora, a subida de nível, as conquistas desbloqueadas agora e se as
 * missões mudaram para ele (alguma unidade contou, a meta da temporada foi
 * cumprida agora ou, na meta por pontos, os pontos da temporada mudaram). Vão
 * na resposta das rotas das ações.
 */
export type ActionRewards = {
  completedMissions: CompletedMissionResult[];
  levelUp: Level | null;
  unlockedAchievements: { id: string; title: string }[];
  missionsChanged: boolean;
};

export function emptyRewards(): ActionRewards {
  return { completedMissions: [], levelUp: null, unlockedAchievements: [], missionsChanged: false };
}

export type ComputeOutput = {
  day: string;
  results: AwardResult[];
  pointsAwarded: number;
  fans: FanPlan[];
  /** O que somar no shard do dia; null quando não há o que somar. */
  shard: ShardDelta | null;
  /** As recompensas de quem chama. */
  rewards: ActionRewards;
  /** A temporada ativa no "agora" do cálculo, ou null (a central nova do `member`, bloco 8). */
  activeSeasonId: string | null;
};

/** Cópia da carteira que dá para mudar sem tocar na lida (os dias, a atividade e as missões inclusive). */
export function cloneWallet(wallet: WalletState): WalletState {
  const days: Record<string, DayStats> = {};
  for (const [day, stats] of Object.entries(wallet.days)) {
    days[day] = { earned: stats.earned, count: { ...stats.count } };
  }
  return {
    ...wallet,
    days,
    activity: { ...wallet.activity },
    goalReached: wallet.goalReached ? { ...wallet.goalReached } : null,
    missions: cloneMissionsState(wallet.missions),
    achievements: { ...wallet.achievements },
  };
}

/** Tira de `days` só os dias anteriores a `day` menos 6. Um dia depois do "agora" fica. */
export function trimDays(days: Record<string, DayStats>, day: string): Record<string, DayStats> {
  const first = shiftDay(day, -6);
  return Object.fromEntries(Object.entries(days).filter(([key]) => key >= first));
}

function switchSeason<
  T extends { seasonId: string | null; seasonPoints: number; seasonPointsAt: number | null },
>(state: T, seasonId: string): { state: T } {
  if (state.seasonId === seasonId) return { state };
  return { state: { ...state, seasonId, seasonPoints: 0, seasonPointsAt: null } };
}

/**
 * O lançamento da conclusão de uma missão (22.1, decisão 7): os pontos dela,
 * o título do catálogo e o evento `mission:<id>:<período>`, que nunca paga
 * duas vezes.
 */
export function missionEntry(mission: MissionRecord, periodKey: string): AwardEntry {
  return {
    kind: 'earn',
    source: 'mission',
    eventId: missionEventId(mission.id, periodKey),
    points: mission.rewardPoints,
    artistId: missionArtistId(mission),
    subject: { type: 'mission', id: mission.id },
    title: mission.title,
  };
}

/**
 * Calcula o efeito dos lançamentos de cada fã, em ordem: cada um parte do
 * resultado do anterior. Não grava nada; o award.ts grava o que voltar.
 * Recusa a transação inteira (PointsError) com resgate maior que o saldo ou
 * ajuste que deixaria um contador negativo.
 *
 * Bloco 7 (22.4): depois dos lançamentos da rota, as unidades das missões
 * andam o progresso (a troca preguiçosa de período, os alvos em `keys`), e
 * cada conclusão vira um lançamento `mission` no fim da lista do fã, pelo
 * mesmo caminho (o que já está no extrato sai `duplicate`). Depois, a meta da
 * temporada e as conquistas. A carteira é gravada também quando só o
 * progresso mudou, só uma conquista nasceu ou só a meta foi marcada.
 */
export function computeAwards(input: ComputeInput): ComputeOutput {
  const { now, config, actor } = input;
  const game = input.game ?? NO_GAME;
  const day = dayKey(now);
  const season = activeSeason(input.season, now);
  const results: AwardResult[] = [];
  const fans: FanPlan[] = [];
  const shard = emptyShardDelta();
  let pointsAwarded = 0;
  const rewards = emptyRewards();
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

    const isCaller = fan.uid === input.callerUid;
    let wallet = cloneWallet(fan.wallet);
    wallet.days = trimDays(wallet.days, day);
    if (season) {
      const switched = switchSeason(wallet, season.id);
      // A troca de temporada zera também as missões concluídas nela (22.7). As
      // temporadas do fã não somam aqui: quem conta é a virada (bloco 8, 23.7).
      if (switched.state !== wallet) switched.state.seasonMissions = 0;
      wallet = switched.state;
    }
    const seasonPointsBefore = wallet.seasonPoints;

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
    let missionApplied = false;

    /** Aplica uma entrada e devolve o status e os pontos dela. */
    const apply = (entry: AwardEntry): { status: AwardStatus; points: number } => {
      const id = ledgerId(entry);
      const result = (status: AwardStatus, points = 0) => {
        results.push({ uid: fan.uid, entryId: id, status, points });
        return { status, points };
      };
      // O suspenso que não chama não ganha nada (o convite e as missões dele, 26.6).
      if (fan.suspended && entry.kind === 'earn') return result('skipped');
      if (seen.has(id)) return result('duplicate');

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
        if (p <= 0) return result('zero');
        const limit = config.dailyLimits[entry.source] ?? null;
        const count = wallet.days[day]?.count[entry.source] ?? 0;
        if (limit !== null && count >= limit) return result('capped');
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
        if (isCaller) pointsAwarded += p;
        if (entry.source === 'mission') {
          missionApplied = true;
          if (season) wallet.seasonMissions += 1;
        }
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
      } else if (entry.kind === 'refund') {
        // A devolução do resgate recusado (bloco 10, 25.1, decisão 7): só o
        // saldo sobe; o gasto desce o mesmo tanto, nunca abaixo de 0.
        points = entry.points;
        wallet.balance += entry.points;
        wallet.spentTotal = Math.max(0, wallet.spentTotal - entry.points);
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
        let centralNext: { season: number; total: number } | null = null;
        if (entry.central) {
          central = centralOf(entry.central.artistId);
          centralNext = {
            season: central.seasonPoints + (entry.central.season ?? 0),
            total: central.totalPoints + (entry.central.total ?? 0),
          };
        }
        // O primeiro contador que ficaria negativo, na ordem do painel (26.4).
        const negative = (
          [
            ['balance', next.balance],
            ['xp', next.xp],
            ['season', next.seasonPoints],
            ['centralSeason', centralNext?.season ?? 0],
            ['centralTotal', centralNext?.total ?? 0],
          ] as const
        ).find(([, value]) => value < 0);
        if (negative) {
          throw new PointsError('negative_counter', 'O ajuste deixaria um contador negativo.', {
            counter: negative[0],
          });
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
          subjectTitle: entry.kind === 'adjust' ? null : (entry.title ?? null),
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
      return result('applied', points);
    };

    for (const entry of fan.entries) apply(entry);

    // Missões (22.4, passos 3 a 5): a troca de período, as unidades e as conclusões.
    // As do suspenso que não chama não andam (26.6).
    const ticks = fan.suspended ? [] : (fan.ticks ?? []);
    if (ticks.length > 0) {
      const candidates = candidateMissions(game.missions, ticks, now);
      const applied = applyMissionTicks(rollMissions(wallet.missions, now), candidates, ticks, now);
      if (applied.counted) {
        wallet.missions = applied.state;
        changed = true;
        if (isCaller) rewards.missionsChanged = true;
      }
      for (const { mission, periodKey } of applied.completions) {
        const outcome = apply(missionEntry(mission, periodKey));
        const item = wallet.missions[mission.period]!.items[mission.id]!;
        item.rewardPaid = outcome.status === 'applied' ? outcome.points : 0;
        if (outcome.status !== 'applied') continue;
        addMissionToShard(shard, mission.id);
        if (isCaller) {
          rewards.completedMissions.push({
            id: mission.id,
            title: mission.title,
            rewardPoints: outcome.points,
            completedAt: new Date(now).toISOString(),
          });
        }
      }
    }

    // Meta da temporada (passo 6): marcada uma vez, na gravação em que a conta chega ao alvo.
    const goal = game.seasonGoal;
    const goalLive = season !== null && goal !== null && goal.seasonId === season.id;
    if (goalLive && wallet.goalReached?.seasonId !== season.id) {
      const count = goal.metric === 'missions' ? wallet.seasonMissions : wallet.seasonPoints;
      if (count >= goal.target) {
        wallet.goalReached = { seasonId: season.id, at: now };
        changed = true;
        if (isCaller) rewards.missionsChanged = true;
      }
    }
    // Com a meta por pontos, o anel da 1g é o `seasonPoints`: o app busca as
    // missões de novo também quando ele mudou, sem unidade contada (22.2).
    if (goalLive && goal.metric === 'points' && wallet.seasonPoints !== seasonPointsBefore) {
      if (isCaller) rewards.missionsChanged = true;
    }

    // Nível e conquistas (passo 7), pela régua do pedido.
    const levelBefore = levelForXp(fan.wallet.xp, config.levels).level;
    const levelAfter = levelForXp(wallet.xp, config.levels).level;
    if (game.achievements.length > 0) {
      const firsts = new Set<FirstAction>(ticks.map((tick) => tick.action));
      if (missionApplied) firsts.add('mission');
      const unlocked = unlockAchievements({
        catalog: game.achievements,
        owned: wallet.achievements,
        levelBefore: levelBefore.number,
        levelAfter: levelAfter.number,
        firsts,
        now,
        readAt: fan.wallet.updatedAt,
      });
      if (unlocked.added.length > 0) {
        wallet.achievements = unlocked.owned;
        changed = true;
        for (const item of unlocked.added) addAchievementToShard(shard, item.id);
        if (isCaller) rewards.unlockedAchievements.push(...unlocked.announced);
      }
    }
    if (isCaller && levelAfter.number > levelBefore.number) rewards.levelUp = { ...levelAfter };

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
    rewards,
    activeSeasonId: season?.id ?? null,
  };
}
