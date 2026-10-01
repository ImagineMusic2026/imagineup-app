/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado: a
 * lista real de artistas e o que "fãs" conta (membros da central no app ou
 * seguidores nas redes) ainda são perguntas para a cliente.
 */
export interface Artist {
  id: string;
  name: string;
  /** Miniatura da foto; `null` até a foto existir (o card mostra o placeholder de marca). */
  photoURL: string | null;
  /** Quantos fãs a central tem ("412 mil fãs"). */
  fanCount: number;
  /** Ordem de destaque: os primeiros aparecem na grade da escolha de artistas (1l). */
  order: number;
}

export interface FollowArtistsVariables {
  artistIds: readonly string[];
  /** A mesma chave numa repetição (rede que caiu no meio) não segue duas vezes. */
  idempotencyKey: string;
}

/** Centrais que o fã segue depois da ação. */
export interface FollowArtistsResult {
  followedArtistIds: string[];
}

/**
 * Central que o fã segue, como a home (1b) mostra no carrossel e o perfil (1e)
 * lista em "Suas centrais". Posição e pontos são os do fã no ranking da
 * central, na temporada (os mesmos do ranking da 1f); quem calcula é o
 * servidor.
 */
export interface FanCentral {
  artistId: string;
  name: string;
  /** Nome curto que cabe no card ("Juninho M."); sem ele, o nome inteiro com reticências. */
  shortName: string | null;
  photoURL: string | null;
  /** Quantos fãs a central tem ("#12 entre 412 mil fãs"). */
  fanCount: number;
  /** Posição do fã na central; `null` quando ele ainda não tem posição ("novo"). */
  fanRank: number | null;
  /** Pontos da temporada do fã nesta central; 0 enquanto ele não pontuou nela. */
  seasonPoints: number;
}

/**
 * A central de um artista, como a página dele (1d) mostra: capa, selo, os
 * três números e se o fã já está nela. Os números são do servidor; "fãs" é a
 * mesma contagem de `Artist.fanCount`.
 */
export interface ArtistDetails {
  id: string;
  name: string;
  /** Capa em paisagem; `null` mostra o placeholder de marca pelo id do artista. */
  coverUrl: string | null;
  /** Foto do rosto (header compacto, posts); `null` mostra as iniciais. */
  photoURL: string | null;
  /** Selo de verificado ao lado do nome. */
  verified: boolean;
  /** A carreira é gerida pela Imagine: a capa mostra a pílula "gestão oficial". */
  managedByImagine: boolean;
  fanCount: number;
  postCount: number;
  /** Pontos que os fãs somaram na central (em lima, "PTS DA CENTRAL"). */
  centralPoints: number;
  /** O fã está na central (a segue). */
  isMember: boolean;
}

export interface JoinCentralVariables {
  artistId: string;
  /** A mesma chave numa repetição (fila offline, rede que caiu) não conta duas vezes. */
  idempotencyKey: string;
}

/**
 * Resposta de entrar numa central. Os pontos vêm das regras do painel: zero
 * quando o fã já estava nela (a API é idempotente) ou quando a regra não dá
 * ponto por entrar.
 */
export interface JoinCentralResult {
  artistId: string;
  pointsAwarded: number;
}
