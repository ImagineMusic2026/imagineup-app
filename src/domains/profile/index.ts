export { SuspendedNotice, SuspensionContact } from './components/suspended-notice';
export { SuspensionWatcher } from './components/suspension-watcher';
// As redes como o perfil e o servidor guardam, para a candidatura do fã-clube (seção 34).
export { normalizeSocialHandle, type SocialHandleResult } from './details';
export { fanProfileHref } from './fan-profile-href';
export { useFanIdentity, type FanIdentity } from './hooks/use-fan-identity';
export { useSuspension, type Suspension } from './hooks/use-suspension';
// A foto da publicação do fã-clube (seção 34, decisão 15): a galeria sem o
// recorte do sistema e o preparo em 4:5, com a foto e a miniatura.
export {
  CLUB_PHOTO_SIZE,
  CLUB_THUMB_SIZE,
  PhotoPickError,
  pickPhoto,
  prepareFanClubPhoto,
  type PickedPhoto,
  type PreparedFanClubPhoto,
  type PreparedImage,
} from './photo';
export {
  fanKeys,
  profileKeys,
  profileMutationKeys,
  registerProfileQueryDefaults,
  useCachedFanProfile,
  useChangePhotoMutation,
  useFanProfileQuery,
  useLedgerInfiniteQuery,
  useMyAchievementsQuery,
  useMyContactQuery,
  useMyInviteQuery,
  useMyProfileQuery,
  useMyProgressQuery,
  useRegisterInviteLinkMutation,
  useRemovePhotoMutation,
  useUpdateContactMutation,
  useUpdateProfileMutation,
  useUsernameAvailabilityQuery,
  useWalletQuery,
  useWatchMyProfile,
  type RegisterInviteLinkVariables,
} from './queries';
export type {
  Achievement,
  EditableProfile,
  FanContact,
  FanProfile,
  FanPublicProfile,
  FanSocials,
  FanStats,
  Gender,
  LedgerEntry,
  LedgerPage,
  Level,
  MyAchievements,
  MyInvite,
  MyProgress,
  PhotoChange,
  ProfileChanges,
  SocialNetwork,
  SuspensionReason,
  UsernameAvailability,
  UsernameLockReason,
  UsernameStatus,
  Wallet,
} from './types';
export {
  isAutomaticUsername,
  normalizeUsername,
  usernameLock,
  type UsernameLock,
} from './username';
export { EditProfileScreen } from './views/edit-profile';
export { FanProfileScreen, type FanProfileScreenProps } from './views/fan-profile';
export { LedgerScreen } from './views/ledger';
export { ProfileScreen } from './views/profile';
