// Ranking e temporadas (bloco 8): a temporada mostrada, o ranking geral e de
// cada central por consulta com índice e posição por contagem, o retrato
// semanal e a virada pela função agendada `rankingTick`, as callables do
// painel e o seed. A API (src/api/routes/ranking.ts) usa daqui; o seed dos
// emuladores carrega o build (functions/lib/ranking). docs/arquitetura-api.md,
// seção 23.
export {
  rankingJobRef,
  runRankingTick,
  runRankSnapshot,
  runSeasonClose,
  type CloseResult,
  type JobOptions,
  type RankingJob,
  type SnapshotResult,
} from './jobs';
export {
  CLOSE_GRACE_MS,
  CLOSE_LATE_MS,
  closeDue,
  closeJobId,
  decodeRankCursor,
  encodeRankCursor,
  GLOBAL_SCOPE,
  RANKING_JOB_PAGE,
  RANKING_PAGE_SIZE,
  RANKING_QUERY_SHAPES,
  rankChange,
  rankTarget,
  rankUnlocks,
  seasonView,
  shownSeason,
  snapshotDue,
  snapshotJobId,
  type RankCursor,
  type RankKey,
  type RankScope,
  type ShownSeason,
} from './model';
export {
  CLOSE_NOW_BUDGET_MS,
  closeNow,
  endCurrent,
  scheduleNext,
  type SeasonPanelDeps,
} from './panel';
export { countAheadQueries, rankDocRef, rankingQuery } from './queries';
export {
  GENERIC_COUNT,
  RANKING_SEED,
  rankingAccountKey,
  SEED_PAST_SEASONS,
  seedPastSeasons,
  seedRankingBase,
  seedRankingSnapshot,
  seedRankingWeek,
  type RankingSeedAccount,
} from './seed';
export {
  archivedCentralRanks,
  liveCentralRank,
  readLeaderboard,
  readMyRank,
  readSeason,
  seasonArchiveRef,
  standingsRef,
} from './service';
