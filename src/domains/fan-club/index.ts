// O fã-clube gerido pelo fã (docs/arquitetura-api.md, seção 34): a base da
// etapa 6 de 34.14, as telas da etapa 7 (os Ajustes, a candidatura e o "Meu
// fã-clube") e as da etapa 8 (a página, o seguir, a denúncia, o card da 1d, a
// Início e os seguidos). Os domínios de composição importam daqui, e o
// `artists` e os `posts`, as chaves pelo arquivo (`fan-club/keys.ts`). Da
// Fase 2 (seção 37, etapa 5 de 37.13): os tipos, a api, as chaves, as
// fixtures e a reação no card; da etapa 6, a tela da publicação, com os
// comentários, as respostas e as menções.
export { ArtistFanClubsCard } from './components/artist-fan-clubs-card';
export { FanClubFeedSection } from './components/fan-club-feed-section';
export {
  FAN_CLUB_COMMENT_MAX,
  FAN_CLUB_ERROR_CODES,
  FAN_CLUB_FOLLOWS_MAX,
  FAN_CLUB_INVALID_FIELDS,
  FAN_CLUB_MEMBER_NOTICE_VERSION,
  FAN_CLUB_NAME_MAX,
  FAN_CLUB_NAME_MIN,
  FAN_CLUB_PENDING_MAX,
  FAN_CLUB_PITCH_MAX,
  FAN_CLUB_PITCH_MIN,
  FAN_CLUB_POST_TEXT_MAX,
  FAN_CLUB_REACTION_EMOJI,
  FAN_CLUB_REACTIONS,
  FAN_CLUB_REFUSALS,
  FAN_CLUB_ROUNDS_MAX,
  type FanClubInvalidField,
  type FanClubInvalidReason,
  type FanClubReaction,
  type FanClubRefusal,
} from './consts';
export {
  fanClubErrorText,
  POST_REJECT_REASON_TEXTS,
  POST_STATUS_TEXTS,
  REJECT_REASON_TEXTS,
  UNAVAILABLE_TEXTS,
  type FanClubErrorText,
} from './describe';
export {
  canApplyNow,
  fanClubStageOf,
  hasNewPrize,
  leaveCentralNotes,
  liveFanClub,
  settingsRowOf,
  shownFanClub,
  type FanClubSettingsRow,
  type FanClubStage,
  type NextRound,
} from './entry';
export { fanClubKeys } from './keys';
export {
  useCachedFanClubOwner,
  useFanClubGate,
  useLeaveCentralNotes,
  useMyFanClubQuery,
  useReactToFanClubPostMutation,
  useShownFanClub,
  type FanClubPostStep,
  type NewFanClubPost,
} from './queries';
export { fanClubHref, fanClubPostHref } from './share';
export type {
  AddFanClubCommentResult,
  FanClubApplication,
  FanClubApplicationBody,
  FanClubApplicationStatus,
  FanClubArtist,
  FanClubCard,
  FanClubComment,
  FanClubCommentLine,
  FanClubCommentPage,
  FanClubEngagement,
  FanClubListPage,
  FanClubMention,
  FanClubNumbers,
  FanClubPage,
  FanClubPerson,
  FanClubPost,
  FanClubPostDetails,
  FanClubPostRejectReason,
  FanClubReactionCounts,
  FanClubReactionResult,
  FanClubPostStatus,
  FanClubRejectReason,
  FanClubReportReason,
  FanClubStatus,
  FanClubUnavailableReason,
  FanClubUploadSlot,
  FollowedFanClub,
  FollowFanClubResult,
  MyFanClub,
  MentionSuggestion,
  MyFanClubClub,
  OwnFanClubPost,
} from './types';
export { ArtistFanClubsScreen } from './views/artist-fan-clubs';
export { FanClubApplyScreen } from './views/fan-club-apply';
export { FanClubPageScreen } from './views/fan-club-page';
export { FanClubPostScreen } from './views/fan-club-post';
export { FollowedFanClubsScreen } from './views/followed-fan-clubs';
export { MyFanClubScreen } from './views/my-fan-club';
export { NewFanClubPostScreen } from './views/new-fan-club-post';
export { ReportFanClubPostSheetScreen } from './views/report-post-sheet';
export { FanClubRulesSheetScreen } from './views/rules-sheet';
export { UnfollowFanClubSheetScreen } from './views/unfollow-sheet';
