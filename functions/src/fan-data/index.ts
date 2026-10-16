// Os pedidos de dados de um fã pela LGPD (seção 32 de docs/arquitetura-api.md,
// frente A6): a lista das fontes (`FAN_DATA_SOURCES`, com o que vai ao
// arquivo, o que sai de cada fonte e o que a exclusão faz com ela), o
// arquivo, puro (os valores em JSON, o filtro de campos, a conta do Auth, as
// entradas das páginas e o login recente), e os núcleos das callables só de
// admin: `exportFanData` (export.ts) e `deleteFanAccount` (delete.ts). O
// `deleteUserData` (store.ts) aponta para a lista.
export { deleteFanAccount, type FanDeletionResult } from './delete';
export { exportFanData, type ExportPage, type FanDataDeps } from './export';
export {
  AFTER_MAX_LENGTH,
  EXPORT_FORMAT,
  EXPORT_NOTICES,
  EXPORT_PAGE_SIZE,
  EXPORT_VERSION,
  exportAccount,
  exportFields,
  exportHeader,
  exportItem,
  exportList,
  isRecentLogin,
  parseAfter,
  parsePart,
  RECENT_LOGIN_MAX_SECONDS,
  sameEmail,
  toExportValue,
  type ExportAccount,
  type ExportAuthUser,
  type ExportDoc,
  type ExportRecord,
  type ExportValue,
} from './model';
export {
  FAN_DATA_FIRST_KEYS,
  FAN_DATA_PARENTS,
  FAN_DATA_PARTS,
  FAN_DATA_SOURCES,
  fanDataSource,
  firstKeySource,
  knownSubcollections,
  partSource,
  PROFILE_TECHNICAL_FIELDS,
  type FanDataDeletionEffect,
  type FanDataFirstKey,
  type FanDataParent,
  type FanDataPart,
  type FanDataPlace,
  type FanDataRead,
  type FanDataSource,
} from './sources';
