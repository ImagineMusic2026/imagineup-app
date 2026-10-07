// Conquistas do bloco 7: o catálogo versionado (config/achievements, com a
// lista provisória como padrão do código), as regras de desbloqueio, a leitura
// da 1e e as callables do painel. docs/arquitetura-api.md, 22.6 e 22.8.
export { achievementPanelError, type AchievementPanelErrorReason } from './errors';
export {
  ACHIEVEMENT_HIGHLIGHTS,
  achievementsView,
  DEFAULT_ACHIEVEMENTS_CONFIG,
  defaultAchievements,
  parseAchievementsConfig,
  unlockAchievements,
  type AchievementRecord,
  type AchievementRule,
  type AchievementsConfig,
} from './model';
export {
  addAchievement,
  changeAchievementStatus,
  editAchievement,
  reorderAchievementList,
} from './panel';
export { myAchievements } from './service';
