/**
 * Chaves do armazenamento local, sempre com namespace e versão. Mudou o formato
 * do que é salvo? Suba a versão em vez de migrar no lugar.
 */
export enum StorageKeys {
  QueryCache = '@imagineup/query-cache/v1',
  Preferences = '@imagineup/preferences/v1',
  PendingInvite = '@imagineup/pending-invite/v1',
}
