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
   * As contas que já resolveram o convite neste aparelho, por uid: o código foi
   * aceito ou a conta já tinha um (20.18). Some com a linha "Tenho um código
   * de convite" dos Ajustes.
   */
  InviteSettled = '@imagineup/invite-settled/v1',
  /** O último prêmio do fã-clube que o gestor viu, por uid (seção 34, decisão 51). */
  FanClubPrizeSeen = '@imagineup/fan-club-prize-seen/v1',
  /**
   * O nome que a Apple manda uma vez, com o `user` da Apple, até o perfil ter
   * nome (seção 39.5).
   */
  ApplePendingName = '@imagineup/apple-pending-name/v1',
}
