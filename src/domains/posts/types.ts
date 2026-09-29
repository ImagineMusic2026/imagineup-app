/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado.
 * Fã não cria post: só curte e comenta (post de fã está fora do contrato).
 */

/**
 * Decide a miniatura do feed: foto e vídeo mostram a mídia, texto não tem
 * miniatura e show (aprovado em 2026-09-29 no lugar do post de playlist) mostra
 * o bloco ciano da agenda e o "Eu vou".
 */
export type PostKind = 'photo' | 'video' | 'text' | 'event';

export interface PostArtist {
  id: string;
  name: string;
  /** Selo de verificado ao lado do nome. */
  verified: boolean;
  photoURL: string | null;
}

export interface PostMedia {
  /** `null` até a foto existir: a miniatura mostra o placeholder de marca pelo id do post. */
  thumbnailUrl: string | null;
  /** Largura sobre altura, para o detalhe do post. */
  aspectRatio: number;
}

/** O show do post de show, resumido. A presença ("Eu vou") é a da agenda. */
export interface PostEvent {
  id: string;
  title: string;
  /** ISO. */
  startsAt: string;
  city: string;
}

export interface Post {
  id: string;
  kind: PostKind;
  artist: PostArtist;
  text: string;
  media: PostMedia | null;
  /** Só nos posts de show. */
  event: PostEvent | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  /**
   * Pontos por pessoa que abre o link compartilhado ("Compartilhar +2"). Vêm
   * das regras do painel; `null` esconde o "+N".
   */
  sharePointsPerVisit: number | null;
}

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Toda ação que vale ponto devolve quantos pontos rendeu, para a animação de "+N". */
export interface PointsAward {
  pointsAwarded: number;
}
