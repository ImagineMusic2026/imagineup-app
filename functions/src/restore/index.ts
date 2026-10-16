// O roteiro de restauração (docs/arquitetura-api.md, 31.3): os documentos
// voltam de um banco de recuperação (o clone do PITR ou o restore do backup)
// para o (default), sem trazer de volta quem excluiu a conta depois da cópia.
// O script scripts/restore-from-copy.mjs carrega este módulo do build.
export {
  ACCESS_COLLECTIONS,
  accountSources,
  formatRestoreReport,
  isAccountUid,
  isRecoveryDatabase,
  parseRestoreArgs,
  parseRestorePath,
  RECOVERY_DATABASE_PREFIX,
  RESTORE_KINDS,
  RESTORE_USAGE,
  restoreKind,
  sameFirestoreValue,
  TARGET_DATABASE,
  type AccountSource,
  type RestoreArgs,
  type RestoreItem,
  type RestoreKind,
  type RestoreReport,
} from './model';
export {
  applyRestore,
  assertRestoreDatabases,
  copyAccountUids,
  copyDocuments,
  missingAccounts,
  planRestore,
  reexcludeInCopy,
  reexclusionStart,
  RESTORE_MARK,
  RESTORE_PAGE,
  restoreFromCopy,
  type RestoreDeps,
  type RestorePlan,
  type RestoreWrite,
} from './service';
