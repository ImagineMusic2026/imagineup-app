import {
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import {
  applyMissionTicks,
  candidateMissions,
  emptyMissionsState,
  MISSION_PERIODS,
  missionArtistId,
  missionEventId,
  rollMissions,
  type MissionItem,
  type MissionPeriodState,
  type MissionRecord,
  type MissionsState,
  type MissionTick,
} from '../missions/model';
import { parseSeasonConfig, seasonConfigRef } from './config';
import {
  activityMarks,
  cloneWallet,
  computeAwards,
  emptyCentral,
  emptyWallet,
  entryArtistId,
  ledgerId,
  NO_GAME,
  PointsError,
  trimDays,
  type ActionRewards,
  type ActivityMarks,
  type Actor,
  type AwardEntry,
  type CentralState,
  type ComputeOutput,
  type DailyActionKey,
  type DayStats,
  type FanInput,
  type GameConfig,
  type PointsConfig,
  type WalletState,
} from './model';
import {
  addEngagementToShard,
  addInviteToShard,
  addMembershipToShard,
  emptyShardDelta,
  pickShard,
  shardRef,
  shardWrite,
  type EngagementKind,
  type InviteShardEvent,
} from './stats';

// Lançamento de pontos no Firestore, em duas fases, porque a transação exige
// todas as leituras antes de qualquer gravação: planAwards só lê e calcula,
// applyAwards só grava. Ordem de uma rota que grava: chave e fã
// (runIdempotent), leituras do domínio, planAwards, gravações do domínio, e o
// runIdempotent grava o plano e a chave. docs/arquitetura-api.md, seção 5.

/** O retrato do fã que chama, montado pelo requireFan: o handler e o planAwards não leem de novo. */
export type FanContext = {
  uid: string;
  /** createdAt de users/{uid}, em ms (a coorte do painel). */
  profileCreatedAt: number | null;
  /**
   * Nome e foto do perfil lido na transação, ou null: o comentário (bloco 6)
   * copia os dois sem ler o perfil de novo.
   */
  displayName: string | null;
  photoURL: string | null;
  wallet: WalletState;
  /** Marcas de atividade do pedido; null no ajuste e no seed, que não marcam. */
  activity: ActivityMarks | null;
};

export type FanAwards = {
  uid: string;
  entries: AwardEntry[];
  /** O retrato de quem chama. Sem ele, o planAwards lê o perfil e a carteira do fã. */
  fan?: FanContext;
  /**
   * As unidades das missões deste fã (bloco 7, 22.4), sempre no planAwards que
   * vem antes das gravações do domínio. Fã sem perfil: ignoradas.
   */
  ticks?: MissionTick[];
};

export type AwardContext = {
  /** O mesmo "agora" do pedido inteiro, também nas novas tentativas. */
  now: number;
  config: PointsConfig;
  /** De 0 até SHARD_COUNT menos 1, sorteado de novo a cada tentativa. */
  shard: number;
  actor: Actor;
  /**
   * Missões, conquistas e meta da temporada (bloco 7), da mesma carga do cache
   * dos valores. Os caminhos fora da API que não passam nada usam o `NO_GAME`:
   * sem andar missão, sem desbloquear conquista e sem marcar a meta.
   */
  game: GameConfig;
};

export type AwardPlan = ComputeOutput & {
  now: number;
  shardIndex: number;
  /**
   * As centrais que o plano leu, por fã (lidas ou vazias): o `setCentralMember`
   * (bloco 8) grava o `member` a partir delas quando nenhum lançamento mexeu
   * na central.
   */
  centralsRead: Map<string, Map<string, CentralState>>;
  /** As recompensas de quem chama (22.2): vão na resposta da ação (`rewardsOf`). */
  rewards: ActionRewards;
  /**
   * O retrato que o plano usou (o `fan` de uma das entradas), ou null. O
   * runIdempotent exige que seja o do pedido: sem ele, a atividade de quem
   * chama sumiria sem aviso.
   */
  caller: FanContext | null;
};

export function walletRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('wallets').doc(uid);
}

export function ledgerRef(db: Firestore, uid: string, entryId: string): DocumentReference {
  return walletRef(db, uid).collection('ledger').doc(entryId);
}

export function centralPointsRef(db: Firestore, uid: string, artistId: string): DocumentReference {
  return walletRef(db, uid).collection('centralPoints').doc(artistId);
}

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function millis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function parseMissionItem(value: unknown): MissionItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  return {
    current: num(raw.current),
    keys: Array.isArray(raw.keys)
      ? raw.keys.filter((key): key is string => typeof key === 'string')
      : [],
    completedAt: millis(raw.completedAt),
    rewardPaid: num(raw.rewardPaid),
  };
}

function parsePeriod(value: unknown): MissionPeriodState | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { key?: unknown; items?: unknown };
  if (typeof raw.key !== 'string') return null;
  const items: Record<string, MissionItem> = {};
  if (typeof raw.items === 'object' && raw.items !== null) {
    for (const [id, item] of Object.entries(raw.items as Record<string, unknown>)) {
      const parsed = parseMissionItem(item);
      if (parsed) items[id] = parsed;
    }
  }
  return { key: raw.key, items };
}

/** `wallets/{uid}.missions` lido; campo estranho vale vazio (22.3). */
function parseMissions(value: unknown): MissionsState {
  const state = emptyMissionsState();
  if (typeof value !== 'object' || value === null) return state;
  for (const period of MISSION_PERIODS) {
    state[period] = parsePeriod((value as Record<string, unknown>)[period]);
  }
  return state;
}

function parseAchievements(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    const ms = millis(at);
    if (ms !== null) out[id] = ms;
  }
  return out;
}

function parseGoalReached(value: unknown): WalletState['goalReached'] {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { seasonId?: unknown; at?: unknown };
  const at = millis(raw.at);
  return typeof raw.seasonId === 'string' && at !== null ? { seasonId: raw.seasonId, at } : null;
}

function parseDays(value: unknown): Record<string, DayStats> {
  if (typeof value !== 'object' || value === null) return {};
  const days: Record<string, DayStats> = {};
  for (const [day, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof raw !== 'object' || raw === null) continue;
    const stats = raw as { earned?: unknown; count?: unknown };
    const count: DayStats['count'] = {};
    if (typeof stats.count === 'object' && stats.count !== null) {
      for (const [source, n] of Object.entries(stats.count as Record<string, unknown>)) {
        (count as Record<string, number>)[source] = num(n);
      }
    }
    days[day] = { earned: num(stats.earned), count };
  }
  return days;
}

/** wallets/{uid} como o núcleo usa; sem documento, tudo zerado. */
export function walletFromDoc(data: DocumentData | undefined): WalletState {
  if (!data) return emptyWallet();
  const activity = (data.activity ?? {}) as Record<string, unknown>;
  return {
    exists: true,
    balance: num(data.balance),
    xp: num(data.xp),
    seasonId: text(data.seasonId),
    seasonPoints: num(data.seasonPoints),
    seasonPointsAt: millis(data.seasonPointsAt),
    earnedTotal: num(data.earnedTotal),
    spentTotal: num(data.spentTotal),
    days: parseDays(data.days),
    pastSeasons: num((data.stats as Record<string, unknown> | undefined)?.pastSeasons),
    closedSeasonId: text((data.stats as Record<string, unknown> | undefined)?.closedSeasonId),
    activity: {
      lastDay: text(activity.lastDay),
      lastWeek: text(activity.lastWeek),
      lastMonth: text(activity.lastMonth),
    },
    seasonMissions: num(data.seasonMissions),
    goalReached: parseGoalReached(data.goalReached),
    missions: parseMissions(data.missions),
    achievements: parseAchievements(data.achievements),
    updatedAt: millis(data.updatedAt),
  };
}

export function centralFromDoc(artistId: string, data: DocumentData | undefined): CentralState {
  if (!data) return emptyCentral(artistId);
  return {
    exists: true,
    artistId,
    seasonId: text(data.seasonId),
    seasonPoints: num(data.seasonPoints),
    seasonPointsAt: millis(data.seasonPointsAt),
    totalPoints: num(data.totalPoints),
    member: data.member === true,
  };
}

/** Conta só da equipe: staff/{uid} sem a marca de fã ligada (accountCreatedByInvite: false). */
function isStaffOnly(staff: DocumentSnapshot): boolean {
  return staff.exists && staff.get('accountCreatedByInvite') !== false;
}

/**
 * O perfil lido na transação existe? Sem users/{uid}: not_fan para conta só
 * da equipe, profile_not_ready no resto (perfil que ainda nasce no cadastro ou
 * conta que acabou de ser excluída). O requireFan e a criação do código de
 * convite (bloco 5) usam.
 */
export async function requireProfile(
  tx: Transaction,
  db: Firestore,
  uid: string,
  profile: DocumentSnapshot,
): Promise<void> {
  if (profile.exists) return;
  const staff = await tx.get(db.collection('staff').doc(uid));
  if (isStaffOnly(staff)) throw new PointsError('not_fan', 'Esta conta não é de fã.');
  throw new PointsError('profile_not_ready', 'O perfil do fã ainda não existe.');
}

/**
 * Toda gravação exige o perfil do fã, lido na transação (requireProfile), e
 * monta o retrato dele: a carteira e as marcas de atividade do pedido.
 */
export async function requireFan(
  tx: Transaction,
  db: Firestore,
  uid: string,
  profile: DocumentSnapshot,
  wallet: DocumentSnapshot,
  now: number,
  options: { markActivity: boolean },
): Promise<FanContext> {
  await requireProfile(tx, db, uid, profile);
  const state = walletFromDoc(wallet.data());
  const profileCreatedAt = millis(profile.get('createdAt'));
  return {
    uid,
    profileCreatedAt,
    displayName: text(profile.get('displayName')),
    photoURL: text(profile.get('photoURL')),
    wallet: state,
    activity: options.markActivity ? activityMarks(state.activity, now, profileCreatedAt) : null,
  };
}

/**
 * Junta as entradas do mesmo fã numa só, na ordem, com o retrato dele. Duas
 * entradas do mesmo uid virariam dois planos a partir da mesma carteira lida, e
 * a segunda gravação apagaria a primeira (ou o commit falharia com dois
 * `create`): o claim do próprio convite (bloco 5), por exemplo, traz quem chama
 * duas vezes. Retrato de outro uid, ou dois retratos, é erro de programação.
 */
export function mergeFanAwards(fans: readonly FanAwards[]): {
  fans: FanAwards[];
  caller: FanContext | null;
} {
  const byUid = new Map<string, FanAwards>();
  let caller: FanContext | null = null;
  for (const fan of fans) {
    if (fan.fan) {
      if (fan.fan.uid !== fan.uid) {
        throw new Error('O retrato (fan) de uma entrada é de outro fã.');
      }
      if (caller && caller !== fan.fan) {
        throw new Error('Só quem chama entra no plano com o retrato (fan), e uma vez.');
      }
      caller = fan.fan;
    }
    const merged = byUid.get(fan.uid);
    if (!merged) {
      byUid.set(fan.uid, {
        uid: fan.uid,
        entries: [...fan.entries],
        fan: fan.fan,
        ticks: [...(fan.ticks ?? [])],
      });
      continue;
    }
    merged.entries.push(...fan.entries);
    merged.ticks!.push(...(fan.ticks ?? []));
    merged.fan ??= fan.fan;
  }
  return { fans: [...byUid.values()], caller };
}

/**
 * As missões que a gravação pode concluir para o fã (22.4, leitura 2): para
 * quem chama, cujo progresso já está no retrato, só as que vão concluir;
 * para outro fã (quem convidou), cuja carteira só chega no getAll, todas as
 * candidatas (em geral uma ou duas). O planAwards lê o extrato e a central só
 * delas.
 */
export function missionsToRead(
  fan: FanAwards,
  game: GameConfig,
  now: number,
): { mission: MissionRecord; periodKey: string }[] {
  const ticks = fan.ticks ?? [];
  if (ticks.length === 0) return [];
  const candidates = candidateMissions(game.missions, ticks, now);
  if (candidates.length === 0) return [];
  const rolled = rollMissions(fan.fan ? fan.fan.wallet.missions : emptyMissionsState(), now);
  if (fan.fan) return applyMissionTicks(rolled, candidates, ticks, now).completions;
  return candidates.map((mission) => ({ mission, periodKey: rolled.state[mission.period]!.key }));
}

/**
 * Fase 1: lê o que falta (a temporada na transação, o extrato de cada
 * lançamento e das missões que podem concluir, as centrais citadas e o perfil
 * e a carteira dos outros fãs) e calcula. Sem lançamentos e sem unidades de
 * missão, não lê nada: dá para chamar depois das gravações do domínio (só a
 * atividade de quem chama). O mesmo uid repetido vira uma entrada só
 * (mergeFanAwards).
 */
export async function planAwards(
  tx: Transaction,
  db: Firestore,
  input: FanAwards[],
  ctx: AwardContext,
): Promise<AwardPlan> {
  const { fans, caller } = mergeFanAwards(input);
  const game = ctx.game ?? NO_GAME;
  const hasEntries = fans.some((fan) => fan.entries.length > 0 || (fan.ticks?.length ?? 0) > 0);
  const refs: DocumentReference[] = [];
  const at = (ref: DocumentReference) => refs.push(ref) - 1;

  const seasonAt = hasEntries ? at(seasonConfigRef(db)) : -1;
  const layout = fans.map((fan) => {
    const missions = missionsToRead(fan, game, ctx.now);
    const ledgerIds = [
      ...new Set([
        ...fan.entries.map(ledgerId),
        ...missions.map(({ mission, periodKey }) =>
          ledgerId({ source: 'mission', eventId: missionEventId(mission.id, periodKey) }),
        ),
      ]),
    ];
    const artistIds = [
      ...new Set(
        [
          ...fan.entries.map(entryArtistId),
          ...missions.map(({ mission }) => missionArtistId(mission)),
        ].filter((id): id is string => id !== null),
      ),
    ];
    return {
      fan,
      profileAt: fan.fan ? -1 : at(db.collection('users').doc(fan.uid)),
      walletAt: fan.fan ? -1 : at(walletRef(db, fan.uid)),
      ledger: ledgerIds.map((id) => ({ id, index: at(ledgerRef(db, fan.uid, id)) })),
      centrals: artistIds.map((id) => ({ id, index: at(centralPointsRef(db, fan.uid, id)) })),
    };
  });

  const snaps = refs.length > 0 ? await tx.getAll(...refs) : [];
  const season = seasonAt >= 0 ? parseSeasonConfig(snaps[seasonAt]!.data()).season : null;

  const inputs: FanInput[] = layout.map(({ fan, profileAt, walletAt, ledger, centrals }) => ({
    uid: fan.uid,
    hasProfile: fan.fan ? true : snaps[profileAt]!.exists,
    wallet: fan.fan ? fan.fan.wallet : walletFromDoc(snaps[walletAt]!.data()),
    entries: fan.entries,
    ticks: fan.ticks ?? [],
    existingLedger: new Set(ledger.filter(({ index }) => snaps[index]!.exists).map(({ id }) => id)),
    centrals: new Map(
      centrals.map(({ id, index }) => [id, centralFromDoc(id, snaps[index]!.data())]),
    ),
    activity: fan.fan?.activity ?? null,
  }));

  const callerUid = caller?.uid ?? fans[0]?.uid ?? null;
  const result = computeAwards({
    now: ctx.now,
    config: ctx.config,
    season,
    actor: ctx.actor,
    callerUid,
    fans: inputs,
    game,
  });
  const centralsRead = new Map(inputs.map((input) => [input.uid, new Map(input.centrals)]));
  return { ...result, now: ctx.now, shardIndex: ctx.shard, caller, centralsRead };
}

/**
 * Grava o `member` de uma central do fã no plano (bloco 8, 23.7), no molde do
 * `addDailyCount`: a central que um lançamento já mexe recebe o campo e sai
 * numa gravação só; a que o plano só leu (`centralsRead`) ou a lida pela rota
 * (`read`, na saída) é gravada como estava, com o `member`; sem o documento,
 * ele nasce zerado, com a temporada ativa do plano. Mesmo valor que o lido:
 * nada a gravar. Chame depois do planAwards e antes de o plano ser gravado.
 */
export function setCentralMember(
  plan: AwardPlan,
  uid: string,
  artistId: string,
  member: boolean,
  read?: CentralState,
): void {
  const fan = plan.fans.find((item) => item.uid === uid);
  if (!fan) throw new Error('O fã não está no plano.');
  const touched = fan.centrals.find((item) => item.state.artistId === artistId);
  if (touched) {
    touched.state.member = member;
    return;
  }
  const base = read ?? plan.centralsRead.get(uid)?.get(artistId) ?? emptyCentral(artistId);
  if (base.exists && base.member === member) return;
  const state: CentralState = base.exists
    ? { ...base, member }
    : { ...emptyCentral(artistId), seasonId: plan.activeSeasonId, member };
  fan.centrals.push({ create: !base.exists, state: { ...state, exists: true } });
}

/**
 * As recompensas do plano para a resposta da ação (22.2): os quatro campos,
 * sempre (listas vazias, null e false quando nada aconteceu). Valem para
 * curtir, comentar, "Eu vou", entrar e seguir; desfazer, sair, denunciar,
 * bloquear e o convite não mandam.
 */
export function rewardsOf(plan: Pick<AwardPlan, 'rewards'>): ActionRewards {
  return {
    completedMissions: plan.rewards.completedMissions.map((item) => ({ ...item })),
    levelUp: plan.rewards.levelUp ? { ...plan.rewards.levelUp } : null,
    unlockedAchievements: plan.rewards.unlockedAchievements.map((item) => ({ ...item })),
    missionsChanged: plan.rewards.missionsChanged,
  };
}

const tsOrNull = (ms: number | null) => (ms === null ? null : Timestamp.fromMillis(ms));

function periodFields(state: MissionPeriodState | null): DocumentData | null {
  if (!state) return null;
  const items: DocumentData = {};
  for (const [id, item] of Object.entries(state.items)) {
    items[id] = {
      current: item.current,
      keys: item.keys,
      completedAt: tsOrNull(item.completedAt),
      rewardPaid: item.rewardPaid,
    };
  }
  return { key: state.key, items };
}

/**
 * Os campos da carteira, inteiros a cada gravação: o `missions`, o
 * `achievements` e o `goalReached` vão sempre juntos com o resto (22.17), e
 * um `update` que esquecesse um deles apagaria o progresso.
 */
function walletFields(state: WalletState, now: Timestamp): DocumentData {
  const achievements: DocumentData = {};
  for (const [id, at] of Object.entries(state.achievements)) {
    achievements[id] = Timestamp.fromMillis(at);
  }
  return {
    balance: state.balance,
    xp: state.xp,
    seasonId: state.seasonId,
    seasonPoints: state.seasonPoints,
    seasonPointsAt: tsOrNull(state.seasonPointsAt),
    earnedTotal: state.earnedTotal,
    spentTotal: state.spentTotal,
    days: state.days,
    activity: state.activity,
    seasonMissions: state.seasonMissions,
    goalReached: state.goalReached
      ? { seasonId: state.goalReached.seasonId, at: Timestamp.fromMillis(state.goalReached.at) }
      : null,
    missions: {
      daily: periodFields(state.missions.daily),
      weekly: periodFields(state.missions.weekly),
    },
    achievements,
    updatedAt: now,
  };
}

/**
 * Fase 2: grava o que mudou, e só o que mudou. Carteira com `create` na
 * primeira vez e `update` depois (o `days` vai inteiro, e é assim que os dias
 * velhos saem; nunca `set` com merge nele). Um shard dos agregados por
 * transação, somando todos os fãs dela.
 */
export function applyAwards(tx: Transaction, db: Firestore, plan: AwardPlan): void {
  const now = Timestamp.fromMillis(plan.now);
  for (const fan of plan.fans) {
    if (fan.wallet) {
      const ref = walletRef(db, fan.uid);
      const fields = walletFields(fan.wallet.state, now);
      if (fan.wallet.create) {
        // As temporadas do fã só a virada soma (bloco 8, 23.3): o núcleo cria
        // o campo zerado e nunca mais o grava.
        tx.create(ref, {
          uid: fan.uid,
          ...fields,
          stats: { pastSeasons: 0, closedSeasonId: null },
          schemaVersion: 1,
          createdAt: now,
        });
      } else {
        tx.update(ref, fields);
      }
    }
    for (const { id, data } of fan.ledger) {
      tx.create(ledgerRef(db, fan.uid, id), {
        ...data,
        createdAt: Timestamp.fromMillis(data.createdAt),
      });
    }
    for (const { create, state } of fan.centrals) {
      const fields = {
        uid: fan.uid,
        artistId: state.artistId,
        seasonId: state.seasonId,
        seasonPoints: state.seasonPoints,
        seasonPointsAt: tsOrNull(state.seasonPointsAt),
        totalPoints: state.totalPoints,
        member: state.member,
        updatedAt: now,
      };
      const ref = centralPointsRef(db, fan.uid, state.artistId);
      if (create) tx.create(ref, fields);
      else tx.update(ref, fields);
    }
  }
  if (plan.shard) {
    tx.set(shardRef(db, plan.day, plan.shardIndex), shardWrite(plan.shard, plan.day, plan.now), {
      merge: true,
    });
  }
}

/** Uma entrada ou saída de central, para os agregados do painel (bloco 4). */
export type MembershipChange = { artistId: string; kind: 'joined' | 'left' };

/**
 * Soma entradas e saídas de centrais no shard do dia do plano, que o
 * applyAwards grava (continua uma gravação de shard por transação). Cria o
 * shard quando o plano não tinha o que somar. Chame antes de o runIdempotent
 * gravar o plano.
 */
export function addMembershipCounts(plan: AwardPlan, changes: readonly MembershipChange[]): void {
  if (changes.length === 0) return;
  plan.shard ??= emptyShardDelta();
  for (const change of changes) addMembershipToShard(plan.shard, change.artistId, change.kind);
}

/**
 * Soma um evento do convite (cadastro convidado, visita contada ou link novo)
 * no shard do dia do plano, como o addMembershipCounts: continua uma gravação
 * de shard por transação, e o shard nasce quando o plano não tinha o que
 * somar (bloco 5, docs/arquitetura-api.md, 20.7). Chame antes de o
 * runIdempotent gravar o plano.
 */
export function addInviteCounts(plan: AwardPlan, change: InviteShardEvent): void {
  plan.shard ??= emptyShardDelta();
  addInviteToShard(plan.shard, change);
}

/** Um fluxo de engajamento do bloco 6 e as centrais no ar da ação (nenhuma no bloqueio). */
export type EngagementChange = { kind: EngagementKind; artistIds: readonly string[] };

/**
 * Soma curtidas, descurtidas, comentários, presenças, denúncias e bloqueios no
 * shard do dia do plano (bloco 6, 21.10), como o addMembershipCounts: continua
 * uma gravação de shard por transação, e o shard nasce quando o plano não
 * tinha o que somar. Chame antes de o runIdempotent gravar o plano.
 */
export function addEngagementCounts(plan: AwardPlan, changes: readonly EngagementChange[]): void {
  if (changes.length === 0) return;
  plan.shard ??= emptyShardDelta();
  for (const change of changes) addEngagementToShard(plan.shard, change.kind, change.artistIds);
}

/**
 * Soma 1 a um contador do dia que não rende ponto (`days[dia].count[key]`) na
 * carteira de quem chama, no dia do plano. Sem lançamento nem marca de
 * atividade, o plano não gravaria a carteira: ela passa a ser gravada, a
 * partir da lida no pedido (com os dias velhos cortados, como o cálculo faria).
 * Chame depois do planAwards e antes de o runIdempotent gravar o plano.
 */
export function addDailyCount(plan: AwardPlan, fan: FanContext, key: DailyActionKey): void {
  const caller = plan.fans.find((item) => item.uid === fan.uid);
  if (!caller) throw new Error('O fã que chama não está no plano.');
  if (!caller.wallet) {
    const state = cloneWallet(fan.wallet);
    state.days = trimDays(state.days, plan.day);
    caller.wallet = { create: !fan.wallet.exists, state: { ...state, exists: true } };
  }
  const { days } = caller.wallet.state;
  const today = days[plan.day] ?? { earned: 0, count: {} };
  today.count[key] = (today.count[key] ?? 0) + 1;
  days[plan.day] = today;
}

/** gRPC ALREADY_EXISTS: o runTransaction do Admin SDK não repete esse código sozinho. */
export const ALREADY_EXISTS = 6;

/**
 * Roda de novo uma vez quando a transação falha com ALREADY_EXISTS (o
 * `create` da chave ou de um lançamento que outro pedido gravou no meio). A
 * segunda rodada acha a chave ou o lançamento já gravados.
 */
export async function retryOnAlreadyExists<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: unknown }).code !== ALREADY_EXISTS) throw error;
    return run();
  }
}

/**
 * Uma ação de fã fora da API (o seed dos emuladores do bloco 6: curtir,
 * comentar, "Eu vou" e denunciar), como o runJoinCentrals: abre a transação,
 * exige o perfil (sem marcar atividade), roda o núcleo da ação com o ator e a
 * configuração dados e grava o plano que ele devolve.
 */
/** Opções dos caminhos fora da API (seed e ajuste): sem `game`, o `NO_GAME`. */
export type RunOptions = {
  now: number;
  config: PointsConfig;
  actor: Actor;
  random?: () => number;
  game?: GameConfig;
};

/** O contexto do lançamento de um caminho fora da API. */
export function runContext(options: RunOptions): AwardContext {
  return {
    now: options.now,
    config: options.config,
    shard: pickShard(options.random ?? Math.random),
    actor: options.actor,
    game: options.game ?? NO_GAME,
  };
}

export function runAsFan<T extends { plan: AwardPlan }>(
  db: Firestore,
  uid: string,
  options: RunOptions,
  work: (tx: Transaction, fan: FanContext, award: AwardContext) => Promise<T>,
): Promise<T> {
  const random = options.random ?? Math.random;
  return retryOnAlreadyExists(() =>
    db.runTransaction(async (tx) => {
      const [profile, wallet] = await tx.getAll(
        db.collection('users').doc(uid),
        walletRef(db, uid),
      );
      const fan = await requireFan(tx, db, uid, profile!, wallet!, options.now, {
        markActivity: false,
      });
      const outcome = await work(tx, fan, runContext({ ...options, random }));
      applyAwards(tx, db, outcome.plan);
      return outcome;
    }),
  );
}

/**
 * Lançamento fora da API: o seed dos emuladores e, depois, o ajuste da equipe
 * (callable adjustFanPoints). Abre a transação, exige o perfil (sem marcar
 * atividade), planeja e grava.
 */
export async function runAward(
  db: Firestore,
  uid: string,
  entries: AwardEntry[],
  options: RunOptions,
): Promise<AwardPlan> {
  const random = options.random ?? Math.random;
  return retryOnAlreadyExists(() =>
    db.runTransaction(async (tx) => {
      const [profile, wallet] = await tx.getAll(
        db.collection('users').doc(uid),
        walletRef(db, uid),
      );
      const fan = await requireFan(tx, db, uid, profile!, wallet!, options.now, {
        markActivity: false,
      });
      const plan = await planAwards(
        tx,
        db,
        [{ uid, entries, fan }],
        runContext({ ...options, random }),
      );
      applyAwards(tx, db, plan);
      return plan;
    }),
  );
}
