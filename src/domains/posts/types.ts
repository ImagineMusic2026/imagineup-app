/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado.
 * Fã não cria post: só curte e comenta (post de fã está fora do contrato).
 */
export interface Post {
  id: string;
  artistId: string;
  text: string;
  mediaUrl: string | null;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
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
