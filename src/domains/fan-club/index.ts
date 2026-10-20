// O fã-clube gerido pelo fã (docs/arquitetura-api.md, seção 34): a base da
// etapa 6 de 34.14. As telas (os Ajustes, a candidatura e o "Meu fã-clube"; a
// página, o seguir, a Início e os seguidos) chegam nas etapas 7 e 8, com o
// queries.ts e as views. Os domínios de composição importam daqui, e o
// `artists` e os `posts` leem as chaves pelo arquivo (`fan-club/keys.ts`).
export {
  FAN_CLUB_ERROR_CODES,
  FAN_CLUB_FOLLOWS_MAX,
  FAN_CLUB_INVALID_FIELDS,
  FAN_CLUB_NAME_MAX,
  FAN_CLUB_NAME_MIN,
  FAN_CLUB_PENDING_MAX,
  FAN_CLUB_PITCH_MAX,
  FAN_CLUB_PITCH_MIN,
  FAN_CLUB_POST_TEXT_MAX,
  FAN_CLUB_REFUSALS,
  FAN_CLUB_ROUNDS_MAX,
  type FanClubInvalidField,
  type FanClubInvalidReason,
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
export { fanClubKeys } from './keys';
export type {
  FanClubApplication,
  FanClubApplicationBody,
  FanClubApplicationStatus,
  FanClubArtist,
  FanClubCard,
  FanClubListPage,
  FanClubNumbers,
  FanClubPage,
  FanClubPerson,
  FanClubPost,
  FanClubPostRejectReason,
  FanClubPostStatus,
  FanClubRejectReason,
  FanClubReportReason,
  FanClubStatus,
  FanClubUnavailableReason,
  FanClubUploadSlot,
  FollowedFanClub,
  FollowFanClubResult,
  MyFanClub,
  MyFanClubClub,
  OwnFanClubPost,
} from './types';
