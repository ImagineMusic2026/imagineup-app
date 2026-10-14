// Moderação mínima do bloco 6 (provisória, UP-48): denunciar um comentário,
// bloquear um fã, a fila da seção Moderação e a callable moderateComment, e os
// tetos do dia das ações que gravam. docs/arquitetura-api.md, 21.7 e 21.8. No
// bloco 11 (26.4 e 26.6), a suspensão do fã e o ocultar em lote, e o seed da
// Moderação (26.13). Desde as exigências das lojas (seção 29): a denúncia de
// perfil na fila separada `profileReportQueue`, a lista de bloqueados, a
// callable resolveProfileReport e o bloqueio e a denúncia do seed.
export { countDailyAction, enforceDailyCap } from './caps';
export { moderationPanelError, type ModerationPanelErrorReason } from './errors';
export {
  BLOCK_LIST_MAX,
  BLOCKED_PAGE_MAX,
  blockedPage,
  BLOCKS_PER_DAY,
  COMMENTS_PER_DAY,
  DAILY_CAPS,
  DailyCapError,
  formatBlockCursor,
  isFanId,
  LIKES_PER_DAY,
  ModerationError,
  parseBlockCursor,
  parseReportReason,
  profileReportId,
  REPORT_REASONS,
  REPORTS_PER_DAY,
  RSVPS_PER_DAY,
  type BlockCursor,
  type CapAction,
  type ModerationErrorReason,
  type ReportReason,
} from './model';
export {
  applyFanSuspension,
  HIDE_FAN_COMMENTS_PAGE,
  hideFanComments,
  parseSuspensionInput,
  runFanSuspension,
  setFanSuspended,
  SUSPENSION_NOTE_MAX,
  SUSPENSION_REASONS,
  type ModerationFansDeps,
  type SuspensionInput,
  type SuspensionReason,
} from './fans';
export {
  applyModeration,
  bumpCommentCount,
  MODERATION_ACTIONS,
  moderate,
  readModerationTargets,
  runModeration,
  writeModeration,
  type ModerationAction,
  type ModerationDeps,
  type ModerationOutcome,
  type ModerationTarget,
  type ModerationWrite,
} from './panel';
export {
  applyProfileResolution,
  parseProfileResolution,
  PROFILE_RESOLUTIONS,
  resolveProfileReport,
  runResolveProfileReport,
  type ProfilePanelDeps,
  type ProfileResolution,
  type ProfileResolutionInput,
} from './profile-panel';
export {
  blockFan,
  readBlockedFans,
  reportComment,
  reportFan,
  runBlockFan,
  runReport,
  runReportFan,
  unblockFan,
  type BlockOutcome,
  type ReportFanOutcome,
  type ReportOutcome,
} from './service';
export {
  SEED_BLOCKS,
  SEED_HIDDEN_SPAM_COMMENT,
  SEED_PROFILE_REPORTS,
  SEED_SPAM_COMMENTS,
  SEED_SPAM_FAN,
  SEED_SPAM_POST,
  SEED_SUSPENDED_EMAIL,
  SEED_SUSPENSION_NOTE,
  seedModeration,
  seedProfileModeration,
  seedSuspension,
  type SeedModerationResult,
  type SeedProfileModerationResult,
  type SeedStaffActor,
} from './seed';
export {
  blockListRef,
  profileQueueItemRef,
  profileReportRef,
  queueItemRef,
  reportRef,
} from './store';
