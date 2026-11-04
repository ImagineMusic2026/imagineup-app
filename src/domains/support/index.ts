export { sendSupportMessage } from './api';
export { SUPPORT_KINDS, SUPPORT_SLUGS, SUPPORT_TEXT_MAX, supportKindOf } from './consts';
export { supportMutationKeys, useSendSupportMessageMutation } from './queries';
export type {
  SendSupportMessageVariables,
  SupportDevice,
  SupportKind,
  SupportMessageBody,
  SupportMessageResult,
} from './types';
