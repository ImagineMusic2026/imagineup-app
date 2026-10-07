import type { AchievementRecord } from '../achievements/model';
import type { RankTarget, Season } from '../api/contract';
import { dayKey, previousWeekKey, weekKey, weekStart } from '../day';
import type { ClosedSeason, SeasonConfig } from '../points/config';
import type { SeasonInfo } from '../points/model';

// Ranking e temporadas (bloco 8), puro: nada aqui lê ou grava o Firestore. A
// temporada mostrada, o cursor das páginas, a seta da semana, a meta do card
// "Você", as conquistas de posição, quando a virada e o retrato vencem e as
// regras das callables do painel. Contrato em docs/arquitetura-api.md, seção 23.

/** Linhas por página do `GET /ranking` (o `limit` do pedido é ignorado). */
export const RANKING_PAGE_SIZE = 20;

/** Fãs por página da virada e do retrato semanal (uma transação por página). */
export const RANKING_JOB_PAGE = 200;

/**
 * Folga depois do `endsAt` antes da virada: o maior `timeoutSeconds` das
 * funções que lançam pontos (a `api`, 30 s) mais uma margem. Função nova que
 * lance pontos cabe nela, ou a folga sobe junto (23.19).
 */
export const CLOSE_GRACE_MS = 60_000;

/** Virada atrasada: a temporada encerrada há mais disso e o trabalho ainda sem `done`. */
export const CLOSE_LATE_MS = 30 * 60_000;

/** O uid de um fã no cursor (o do Auth). */
export const RANK_UID_PATTERN = /^[A-Za-z0-9]{1,128}$/;

/** O maior instante que o Timestamp do Firestore aceita (o `startAfter` lançaria acima dele). */
const MAX_TIMESTAMP_MS = 253_402_300_799_999;

/** Recorte do ranking: o geral da temporada ou o de uma central (só membros). */
export type RankScope = { kind: 'global' } | { kind: 'artist'; artistId: string };

export const GLOBAL_SCOPE: RankScope = { kind: 'global' };

/** A chave de uma linha na ordem do ranking: pontos, chegada (o instante) e o id. */
export type RankKey = { points: number; atMs: number | null; uid: string };

/** O cursor da página seguinte: a chave e a posição da última linha (23.2). */
export type RankCursor = RankKey & { position: number };

/** O recorte em texto, nos `scopes` dos trabalhos: `global` ou `artist:<id>`. */
export function scopeKey(scope: RankScope): string {
  return scope.kind === 'global' ? 'global' : `artist:${scope.artistId}`;
}

export function scopeOf(key: string): RankScope {
  return key.startsWith('artist:')
    ? { kind: 'artist', artistId: key.slice('artist:'.length) }
    : GLOBAL_SCOPE;
}

// --- Temporada mostrada ----------------------------------------------------------

/**
 * A temporada que todas as telas mostram (decisão 4 de 23.1): a de
 * `config/season.season` quando ela já começou (em andamento, ou encerrada e
 * esperando a virada), lida ao vivo; senão a última fechada, encerrada, lida
 * do arquivo; senão nenhuma.
 */
export type ShownSeason = {
  season: SeasonInfo;
  source: 'live' | 'archive';
  status: 'active' | 'ended';
};

export function shownSeason(
  config: Pick<SeasonConfig, 'season' | 'lastClosed'>,
  now: number,
): ShownSeason | null {
  const { season, lastClosed } = config;
  if (season && season.startsAt <= now) {
    return { season, source: 'live', status: now < season.endsAt ? 'active' : 'ended' };
  }
  if (lastClosed) return { season: lastClosed, source: 'archive', status: 'ended' };
  return null;
}

/** A temporada mostrada como o app lê (`Season`), ou null. */
export function seasonView(shown: ShownSeason | null): Season | null {
  if (!shown) return null;
  const { season } = shown;
  return {
    id: season.id,
    name: season.name,
    startsAt: new Date(season.startsAt).toISOString(),
    endsAt: new Date(season.endsAt).toISOString(),
    status: shown.status,
    leaderTitle: season.leaderTitle,
  };
}

/** Os pontos de um documento do ranking na temporada mostrada (de outra temporada, 0). */
export function shownPoints(
  doc: { seasonId: string | null; seasonPoints: number },
  shown: ShownSeason | null,
): number {
  return shown && doc.seasonId === shown.season.id && doc.seasonPoints > 0 ? doc.seasonPoints : 0;
}

// --- Cursor ------------------------------------------------------------------------

/** Texto opaco para o app: o base64url de `[pontos, instanteEmMs, uid, posição]`. */
export function encodeRankCursor(cursor: RankCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.points, cursor.atMs, cursor.uid, cursor.position]),
    'utf8',
  ).toString('base64url');
}

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** null quando o texto não é um cursor nosso (400 na rota). */
export function decodeRankCursor(value: string): RankCursor | null {
  if (!/^[A-Za-z0-9_-]{1,600}$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [points, atMs, uid, position] = parsed as unknown[];
    const validAt =
      atMs === null ||
      (typeof atMs === 'number' && Number.isInteger(atMs) && atMs >= 0 && atMs <= MAX_TIMESTAMP_MS);
    if (
      isPositiveInt(points) &&
      validAt &&
      typeof uid === 'string' &&
      RANK_UID_PATTERN.test(uid) &&
      isPositiveInt(position)
    ) {
      return { points, atMs: atMs as number | null, uid, position };
    }
  } catch {
    return null;
  }
  return null;
}

// --- A seta da semana ----------------------------------------------------------------

/** O retrato semanal gravado no documento do ranking (`rankWeek`, 23.5). */
export type RankWeek = { seasonId: string; week: string; position: number };

export function parseRankWeek(value: unknown): RankWeek | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  return typeof raw.seasonId === 'string' &&
    typeof raw.week === 'string' &&
    isPositiveInt(raw.position)
    ? { seasonId: raw.seasonId, week: raw.week, position: raw.position }
    : null;
}

/**
 * Posições ganhas desde o retrato (23.5): só com a temporada mostrada em
 * andamento e um retrato dela desta semana ou da anterior (a anterior cobre a
 * segunda-feira antes da rodada e um retrato que falhou). Senão, 0.
 */
export function rankChange(
  rankWeek: RankWeek | null,
  position: number,
  shown: ShownSeason | null,
  now: number,
): number {
  if (!rankWeek || !shown || shown.status !== 'active') return 0;
  if (rankWeek.seasonId !== shown.season.id) return 0;
  const week = weekKey(dayKey(now));
  if (rankWeek.week !== week && rankWeek.week !== previousWeekKey(now)) return 0;
  return rankWeek.position - position;
}

// --- A meta do card "Você" ------------------------------------------------------------

/**
 * Que linha a meta precisa ler: a N-ésima (fora do top), a de cima (de 2 a
 * N) ou nenhuma (sem posição, temporada encerrada, 1º lugar).
 */
export function targetRead(
  position: number | null,
  topTarget: number,
  ended: boolean,
): 'top' | 'above' | null {
  if (position === null || ended || position <= 1) return null;
  return position > topTarget ? 'top' : 'above';
}

/**
 * A meta (decisão 11 de 23.1): fora do top N, entrar nele ("840 pts para
 * entrar no top 10"); dentro, o lugar de cima ("312 pts para o 6º lugar"). O
 * que falta é a diferença mais 1 (o empate fica com quem chegou primeiro),
 * nunca abaixo de 1. Sem a linha lida, null.
 */
export function rankTarget(input: {
  position: number | null;
  points: number;
  topTarget: number;
  ended: boolean;
  /** Os pontos da linha lida (a N-ésima ou a de cima), ou null. */
  rowPoints: number | null;
}): RankTarget | null {
  const read = targetRead(input.position, input.topTarget, input.ended);
  if (read === null || input.rowPoints === null || input.position === null) return null;
  const pointsLeft = Math.max(1, input.rowPoints - input.points + 1);
  return read === 'top'
    ? { kind: 'top', position: input.topTarget, pointsLeft }
    : { kind: 'position', position: input.position - 1, pointsLeft };
}

// --- Conquistas de posição ------------------------------------------------------------

/**
 * As conquistas `rank` ativas que a posição no geral alcança e o fã ainda
 * não tem (23.9). Só no retrato semanal e na virada.
 */
export function rankUnlocks(
  catalog: readonly AchievementRecord[],
  position: number,
  owned: Readonly<Record<string, unknown>>,
): AchievementRecord[] {
  return catalog.filter(
    (item) =>
      item.status === 'active' &&
      item.rule.type === 'rank' &&
      position <= item.rule.top &&
      owned[item.id] === undefined,
  );
}

// --- Virada e retrato --------------------------------------------------------------------

/** A virada da temporada vence com o `endsAt` mais a folga (23.6, passo 1). */
export function closeDue(season: SeasonInfo | null, now: number): season is SeasonInfo {
  return season !== null && now >= season.endsAt + CLOSE_GRACE_MS;
}

/**
 * O retrato da semana vence com a temporada ativa, começada antes da
 * segunda-feira desta semana (na primeira não há com o que comparar) e sem o
 * trabalho da semana feito (23.5, passo 2).
 */
export function snapshotDue(season: SeasonInfo | null, now: number, done: boolean): boolean {
  if (!season || done) return false;
  if (!(season.startsAt <= now && now < season.endsAt)) return false;
  return season.startsAt < weekStart(now);
}

export const closeJobId = (seasonId: string) => `close-${seasonId}`;

export const snapshotJobId = (seasonId: string, week: string) => `snapshot-${seasonId}-${week}`;

/**
 * A próxima que o fim da virada promove (23.6, passo 4): uma que venceu
 * enquanto esperava não entra (fecharia vazia na rodada seguinte e tomaria o
 * lugar da última fechada).
 */
export function promoteNext(
  next: SeasonInfo | null,
  now: number,
): { season: SeasonInfo | null; expiredId: string | null } {
  if (next && next.endsAt <= now) return { season: null, expiredId: next.id };
  return { season: next, expiredId: null };
}

// --- Regras das callables do painel (23.10) -------------------------------------------------

/** O `config/season` lido na transação das callables. */
export type SeasonState = {
  current: SeasonInfo | null;
  next: SeasonInfo | null;
  lastClosed: ClosedSeason | null;
};

export type SeasonRefusal =
  | 'season-id-locked'
  | 'season-id-used'
  | 'season-started'
  | 'season-ended'
  | 'season-end-in-past'
  | 'season-overlap'
  | 'has-next'
  | 'no-season'
  | 'season-not-active'
  | 'season-not-due';

/** Começou (`startsAt <= now`): sai só pela virada, no fim ou pelo `endSeason`. */
export const hasStarted = (season: SeasonInfo | null, now: number) =>
  season !== null && season.startsAt <= now;

/**
 * As regras do `updateSeason` que não precisam de leitura, na ordem (23.10),
 * com o `season-id-used` já conferido por quem chama (`idUsed`, só para id
 * novo numa atual livre). O `season-closing` vem antes, com a leitura do
 * trabalho da virada.
 */
export function updateSeasonRefusal(
  state: SeasonState,
  input: SeasonInfo | null,
  now: number,
  idUsed = false,
): SeasonRefusal | null {
  const { current, next, lastClosed } = state;
  if (current && hasStarted(current, now)) {
    if (!input) return 'season-started';
    if (input.id !== current.id) return 'season-id-locked';
    if (input.startsAt !== current.startsAt) return 'season-started';
    if (now >= current.endsAt) return input.endsAt !== current.endsAt ? 'season-ended' : null;
    if (input.endsAt <= now) return 'season-end-in-past';
    if (next && input.endsAt > next.startsAt) return 'season-overlap';
    return null;
  }
  // Sem temporada atual, ou com a atual ainda sem começar: ela é livre.
  if (!input) return next ? 'has-next' : null;
  if (input.id !== current?.id && idUsed) return 'season-id-used';
  if (input.endsAt <= now) return 'season-end-in-past';
  if (lastClosed && input.startsAt < lastClosed.endsAt) return 'season-overlap';
  if (next && input.endsAt > next.startsAt) return 'season-overlap';
  return null;
}

/**
 * As regras do `scheduleNextSeason` (23.10): sem temporada atual não há
 * próxima; o id não pode ter sido usado (o da atual inclusive, conferido aqui;
 * as versões e o arquivo, por quem chama, em `idUsed`); a vencida não entra; e
 * ela começa depois do fim da atual. `next: null` vale sempre.
 */
export function nextSeasonRefusal(
  state: SeasonState,
  input: SeasonInfo | null,
  now: number,
  idUsed = false,
): SeasonRefusal | null {
  if (!input) return null;
  const { current } = state;
  if (!current) return 'no-season';
  if (input.id === current.id || idUsed) return 'season-id-used';
  if (input.endsAt <= now) return 'season-end-in-past';
  if (input.startsAt < current.endsAt) return 'season-overlap';
  return null;
}

/** O `endSeason` só vale para a temporada em andamento, pelo id que a tela mostrou. */
export function endSeasonRefusal(
  state: SeasonState,
  seasonId: string,
  now: number,
): SeasonRefusal | null {
  const { current } = state;
  if (!current || current.id !== seasonId) return 'season-not-active';
  // Começada de fato (o fim novo, o agora, fica depois do início) e ainda aberta.
  if (current.startsAt >= now || now >= current.endsAt) return 'season-not-active';
  return null;
}

/** O `closeSeasonNow` roda só a virada que já venceu (a função agendada faria o mesmo). */
export function closeNowRefusal(
  state: SeasonState,
  seasonId: string,
  now: number,
): SeasonRefusal | null {
  const { current } = state;
  if (!current || current.id !== seasonId) return 'no-season';
  if (!closeDue(current, now)) return 'season-not-due';
  return null;
}

// --- Formatos das consultas (o teste dos índices, 23.12) --------------------------------------

export type IndexField = { fieldPath: string; order: 'ASCENDING' | 'DESCENDING' };

export type QueryShape = {
  name: string;
  collectionGroup: 'wallets' | 'centralPoints';
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP';
  fields: IndexField[];
};

const asc = (fieldPath: string): IndexField => ({ fieldPath, order: 'ASCENDING' });
const desc = (fieldPath: string): IndexField => ({ fieldPath, order: 'DESCENDING' });

const GLOBAL_FILTERS = [asc('seasonId')];
const ARTIST_FILTERS = [asc('artistId'), asc('member'), asc('seasonId')];

/**
 * A lista e as três contagens de 23.4, nos dois recortes: cada formato precisa
 * do índice composto com os mesmos campos e direções no firestore.indexes.json
 * (o id entra sozinho no fim, crescente). A meta do card "Você" lê o começo da
 * lista, no mesmo formato. Mudou uma consulta do queries.ts, muda aqui e no
 * índice; consulta com `limitToLast` inverte as direções e pediria outro.
 */
export const RANKING_QUERY_SHAPES: readonly QueryShape[] = [
  {
    name: 'lista do geral',
    collectionGroup: 'wallets',
    queryScope: 'COLLECTION',
    fields: [...GLOBAL_FILTERS, desc('seasonPoints'), asc('seasonPointsAt')],
  },
  {
    name: 'contagem A do geral',
    collectionGroup: 'wallets',
    queryScope: 'COLLECTION',
    fields: [...GLOBAL_FILTERS, asc('seasonPoints')],
  },
  {
    name: 'contagens B e C do geral',
    collectionGroup: 'wallets',
    queryScope: 'COLLECTION',
    fields: [...GLOBAL_FILTERS, asc('seasonPoints'), asc('seasonPointsAt')],
  },
  {
    name: 'lista da central',
    collectionGroup: 'centralPoints',
    queryScope: 'COLLECTION_GROUP',
    fields: [...ARTIST_FILTERS, desc('seasonPoints'), asc('seasonPointsAt')],
  },
  {
    name: 'contagem A da central',
    collectionGroup: 'centralPoints',
    queryScope: 'COLLECTION_GROUP',
    fields: [...ARTIST_FILTERS, asc('seasonPoints')],
  },
  {
    name: 'contagens B e C da central',
    collectionGroup: 'centralPoints',
    queryScope: 'COLLECTION_GROUP',
    fields: [...ARTIST_FILTERS, asc('seasonPoints'), asc('seasonPointsAt')],
  },
];
