// Perfil editável do fã (bloco 9): a troca do @ e a foto pela API, a fila que
// acerta as cópias do nome e da foto nos comentários, a pasta da foto na
// exclusão de conta e o seed da foto de teste. A API (src/api/routes/
// profile.ts) e o gatilho usam daqui; o seed dos emuladores e o
// scripts/release-fan-username.mjs carregam o build (functions/lib/fan-profile).
// docs/arquitetura-api.md, seção 24.
export { fanPhotoFiles, MISSING_FAN_PHOTO_FILES, type FanPhotoFiles } from './files';
export {
  ABANDONED_UPLOAD_MS,
  AUTOMATIC_USERNAME,
  FAN_PHOTO_PATH,
  FAN_PHOTO_PURGE_DELAY_MS,
  FAN_PROFILE_SLOW_WINDOW_MS,
  FAN_PROFILE_SYNC_DAILY_WINDOWS,
  FAN_PROFILE_SYNC_WINDOW_MS,
  normalizeUsername,
  parseFanPhotoPath,
  PHOTO_CHANGES_PER_DAY,
  PHOTO_HEAD_BYTES,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  PHOTO_UPLOAD_MAX_AGE_MS,
  PROFILE_SYNC_PAGE,
  ProfileEditError,
  USERNAME_CHANGE_INTERVAL_MS,
  USERNAME_INPUT_MAX,
  USERNAME_PATTERN,
  UsernameReleaseError,
  usernameRefusal,
  type ProfileEditErrorReason,
  type UsernameReleaseReason,
} from './model';
export { SEED_PHOTO_FILE, seedFanPhoto, type UploadPhoto } from './seed';
export {
  changeUsername,
  purgeFanPhotos,
  readUsernameAvailability,
  releaseUsername,
  removeFanPhoto,
  removeReplacedPhoto,
  setFanPhoto,
  syncFanProfile,
  type FanProfileSyncResult,
  type PhotoChange,
  type UsernameAvailability,
  type UsernameChange,
  type UsernameStatus,
} from './service';
export {
  FAN_PROFILE_MAX_ATTEMPTS,
  FAN_PROFILE_QUEUE,
  profileSyncBudgetRef,
  queueFanPhotoPurge,
  queueFanProfileSync,
  runFanProfileSync,
  type FanProfileQueue,
  type QueueFanProfileSyncResult,
} from './sync';
