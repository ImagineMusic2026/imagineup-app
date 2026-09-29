/**
 * Perfil básico do fã, lido de `users/{uid}` no Firestore. Nasce no servidor
 * (função `createUserProfile`) alguns segundos depois do cadastro; o celular só
 * lê o próprio e, quando a edição entrar, muda `displayName` e `city`.
 */
export interface FanProfile {
  uid: string;
  /** `null` quando o nome do cadastro não passou em `visibleLine()`: o fã preenche depois. */
  displayName: string | null;
  /** O @ sem a arroba ("camilarib"). */
  username: string | null;
  city: string | null;
  /** Gravada pelo servidor depois de validar o upload; a do provedor não é copiada. */
  photoURL: string | null;
  /** ISO. O `Timestamp` do Firestore vira texto antes do cache, que vai para o disco em JSON. */
  createdAt: string | null;
}

/**
 * Os três contadores do fã (aprovados em 2026-09-28), todos decididos no
 * servidor: o app só lê.
 */
export interface Wallet {
  /** Saldo para trocar por recompensas; cai no resgate. */
  balance: number;
  /** Pontos de nível, que nunca caem. */
  xp: number;
  /** Pontos da temporada, que contam no ranking. */
  seasonPoints: number;
}

/**
 * Convite do fã: o código que vai no `?ref=` dos links que ele compartilha e o
 * que cada pessoa trazida rende. Os valores vêm do painel admin pela API.
 */
export interface MyInvite {
  code: string;
  /** Por pessoa que abre o link ("+2 por pessoa que abre seu link"). */
  pointsPerVisit: number;
  /** Por pessoa que se cadastra pelo link. */
  pointsPerSignup: number;
}
