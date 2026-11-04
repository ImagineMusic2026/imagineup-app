export { supportPanelError, type SupportPanelErrorReason } from './errors';
export {
  DEVICE_FIELD_MAX,
  isSupportKind,
  parseSupportMessage,
  statusAfter,
  SUPPORT_ACTIONS,
  SUPPORT_KINDS,
  SUPPORT_MESSAGES_PER_DAY,
  SUPPORT_PLATFORMS,
  SUPPORT_STATUSES,
  SUPPORT_TEXT_MAX,
  type ParsedSupportMessage,
  type SupportAction,
  type SupportDevice,
  type SupportKind,
  type SupportMessageInput,
  type SupportPlatform,
  type SupportStatus,
} from './model';
export {
  applySupportResolution,
  parseSupportResolution,
  resolveSupportMessage,
  runSupportResolution,
  type SupportPanelDeps,
  type SupportResolutionInput,
  type SupportResolutionResult,
} from './panel';
export { SEED_SUPPORT_MESSAGES, seedSupport, type SeedSupportResult } from './seed';
export {
  removeSupportMessagesOf,
  runSendSupportMessage,
  sendSupportMessage,
  type SupportMessageOutcome,
} from './service';
export { supportMessageRef, supportMessagesRef } from './store';
