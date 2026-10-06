// Missões do bloco 7: o catálogo versionado (config/missions) e o arquivo
// (missionArchive), o índice por tipo de ação, os períodos do dia e da semana
// de São Paulo, o progresso do fã (na carteira), as leituras da 1g e da 1b,
// as callables do painel e o seed. A API (src/api/routes/missions.ts) e o
// núcleo de pontos usam daqui; o seed dos emuladores carrega o build
// (functions/lib/missions). docs/arquitetura-api.md, seção 22.
export { gamePanelError, type GamePanelErrorReason } from './errors';
export {
  ACTIVE_MISSIONS_MAX,
  candidateMissions,
  EMPTY_MISSION_INDEX,
  EMPTY_MISSIONS_CONFIG,
  keyDigest,
  MISSION_ACTIONS,
  MISSION_GOAL_MAX,
  MISSION_ID_PATTERN,
  missionEnd,
  missionEventId,
  missionIndex,
  MISSIONS_MAX,
  parseMissionsConfig,
  periodKeyOf,
  validateMissionInput,
  type MissionAction,
  type MissionIndex,
  type MissionRecord,
  type MissionsConfig,
  type MissionsState,
  type MissionTick,
  type SeasonGoalConfig,
} from './model';
export {
  addMission,
  catalogDoc,
  changeMissionStatus,
  changeSeasonGoal,
  editMission,
  missionArchiveRef,
  reorderMissionList,
} from './panel';
export { SEED_MISSIONS, SEED_SEASON_GOAL, seedCatalog, seedMissionsCatalog } from './seed';
export { readDailyMission, readMissions } from './service';
