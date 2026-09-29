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
 * Central que o fã segue, como a home (1b) mostra no carrossel. A posição é a
 * do fã na central, na temporada; quem calcula é o servidor.
 */
export interface FanCentral {
  artistId: string;
  name: string;
  /** Nome curto que cabe no card ("Juninho M."); sem ele, o nome inteiro com reticências. */
  shortName: string | null;
  photoURL: string | null;
  /** Posição do fã na central; `null` quando ele ainda não tem posição ("novo"). */
  fanRank: number | null;
}
