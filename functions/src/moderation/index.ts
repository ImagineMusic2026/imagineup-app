// Moderação mínima do bloco 6 (provisória, UP-48): denunciar um comentário,
// bloquear um fã, a fila da seção Moderação e a callable moderateComment, e os
// tetos do dia das ações que gravam. docs/arquitetura-api.md, 21.7 e 21.8.
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
export { MODERATION_ACTIONS, moderate, type ModerationAction, type ModerationDeps } from './panel';
export {
  blockFan,
  reportComment,
  runReport,
  unblockFan,
  type BlockOutcome,
  type ReportOutcome,
} from './service';
export { blockListRef, queueItemRef, reportRef } from './store';
