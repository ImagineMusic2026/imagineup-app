/**
 * Chaves do armazenamento local, sempre com namespace e versão. Mudou o formato
 * do que é salvo? Suba a versão em vez de migrar no lugar.
 */
export enum StorageKeys {
  QueryCache = '@imagineup/query-cache/v1',
  Preferences = '@imagineup/preferences/v1',
  /** O convite do link que abriu o app, com a origem (bloco 5). A v1 só tinha o código. */
  PendingInvite = '@imagineup/pending-invite/v2',
  /** A v1 do convite pendente: apagada na primeira leitura, sem migração. */
  LegacyPendingInvite = '@imagineup/pending-invite/v1',
  /** Os convites amarrados às contas criadas no aparelho, por uid. */
  InviteClaims = '@imagineup/invite-claims/v1',
  /**
   * O nome que a Apple mandou na primeira entrada, com o `user` da Apple,
   * guardado antes de a conta existir: a Apple não manda de novo (seção 33,
   * decisão 6).
   */
  ApplePendingName = '@imagineup/apple-pending-name/v1',
}
