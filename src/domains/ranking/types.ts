/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado.
 *
 * O ranking conta os pontos da temporada, o terceiro contador aprovado em
 * 2026-09-28 (o saldo e o nível ficam de fora). Posição, pontos e metas são
 * calculados no servidor; o app só lê.
 */

/** Recorte do ranking: o geral da temporada ou o da central de um artista. */
export type RankingScope = { kind: 'global' } | { kind: 'artist'; artistId: string };

/** A temporada em andamento, ou a última, com o resultado congelado (`ended`). */
export interface Season {
  id: string;
  /** "São João", lido como "Temporada de São João". */
  name: string;
  /** ISO. */
  startsAt: string;
  /** ISO. A linha da temporada conta os dias até aqui. */
  endsAt: string;
  status: 'active' | 'ended';
  /**
   * Título do 1º lugar, configurado no painel ("Rainha do São João"). `null`
   * usa o neutro do app, "Líder da temporada".
   */
  leaderTitle: string | null;
}

/** Uma posição do ranking, no recorte pedido. */
export interface LeaderboardEntry {
  position: number;
  userId: string;
  /**
   * O nome do perfil, inteiro: a lista mostra assim (com reticências) e o
   * pódio encurta para o primeiro nome e a inicial do último. `null` quando o
   * fã ainda não tem nome visível.
   */
  displayName: string | null;
  photoURL: string | null;
  /** Opcional no perfil: sem ela, a linha mostra só o nome. */
  city: string | null;
  /** Pontos da temporada no recorte. */
  points: number;
  /**
   * Posições ganhas (positivo) ou perdidas (negativo) desde a semana
   * anterior; 0 quando não mudou.
   */
  change: number;
  /** A linha do fã que pede, marcada pelo servidor. */
  isMe: boolean;
}

/** Uma página do ranking, em ordem de posição. */
export interface LeaderboardPage {
  items: LeaderboardEntry[];
  nextCursor: string | null;
  /**
   * Ranking de exemplo ao lado de dado de verdade (as centrais ou a carteira
   * já vêm do servidor, o ranking ainda não): a tela mostra o aviso. O
   * servidor nunca manda; o bloco 8 apaga o campo e o aviso.
   */
  example?: boolean;
}

/**
 * A próxima meta do fã:
 * - `top`: entrar no top N ("840 pts para entrar no top 10");
 * - `position`: alcançar a posição de cima, já dentro do top.
 */
export interface RankTarget {
  kind: 'top' | 'position';
  position: number;
  pointsLeft: number;
}

/** O fã no recorte pedido (card "Você"). */
export interface MyRank {
  /** `null` sem pontos no recorte: ele ainda não entrou no ranking. */
  position: number | null;
  points: number;
  /** `null` no 1º lugar, sem pontos e com a temporada encerrada. */
  target: RankTarget | null;
  /**
   * O recorte é de exemplo ao lado de dado de verdade (`LeaderboardPage.example`).
   * Numa central, o fã fica fora do ranking de exemplo e o card "Você" diz
   * "Sem posição ainda", como a 1e. O servidor nunca manda.
   */
  example?: boolean;
}
