// Moderação mínima do bloco 6 (provisória, UP-48): denunciar um comentário,
// bloquear um fã, a fila da seção Moderação e a callable moderateComment, e os
// tetos do dia das ações que gravam. docs/arquitetura-api.md, 21.7 e 21.8. No
// bloco 11 (26.4 e 26.6), a suspensão do fã e o ocultar em lote, e o seed da
// Moderação (26.13).
export { countDailyAction, enforceDailyCap } from './caps';
export { moderationPanelError, type ModerationPanelErrorReason } from './errors';
export {
  BLOCK_LIST_MAX,
  BLOCKS_PER_DAY,
  COMMENTS_PER_DAY,
  DAILY_CAPS,
  DailyCapError,
  isFanId,
  LIKES_PER_DAY,
  ModerationError,
  parseReportReason,
  REPORT_REASONS,
  REPORTS_PER_DAY,
  RSVPS_PER_DAY,
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
  blockFan,
  reportComment,
  runReport,
  unblockFan,
  type BlockOutcome,
  type ReportOutcome,
} from './service';
export {
  SEED_HIDDEN_SPAM_COMMENT,
  SEED_SPAM_COMMENTS,
  SEED_SPAM_FAN,
  SEED_SPAM_POST,
  SEED_SUSPENDED_EMAIL,
  SEED_SUSPENSION_NOTE,
  seedModeration,
  seedSuspension,
  type SeedModerationResult,
  type SeedStaffActor,
} from './seed';
export { blockListRef, queueItemRef, reportRef } from './store';
