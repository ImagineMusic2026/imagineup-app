/**
 * Contrato com a API do mural (bloco 6, docs/arquitetura-api.md, seção 21),
 * espelho de `functions/src/api/contract.ts`: mudou um, mude o outro. Campo
 * novo na resposta é sempre opcional aqui. Fã não cria post: só curte, comenta,
 * denuncia um comentário e bloqueia um fã (post de fã está fora do contrato).
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

/**
 * Uma mídia por post (foto ou vídeo, pelo `kind` do post). O app não toca
 * vídeo: o detalhe mostra a miniatura com um selo de play.
 */
export interface PostMedia {
  /** A foto inteira ou o arquivo do vídeo; `null` até existir. */
  url: string | null;
  /** `null` até a foto existir: a miniatura mostra o placeholder de marca pelo id do post. */
  thumbnailUrl: string | null;
  /** Medidas da mídia em px, para a proporção do detalhe; `null` quando a API não mandar. */
  width: number | null;
  height: number | null;
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

/**
 * Comentário do próprio fã que ainda não chegou ao servidor: indo (ou
 * esperando a rede) ou recusado. Só existe no app, nunca vem da API.
 */
export type CommentStatus = 'pending' | 'failed';

export interface PostComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  /** Foto do fã ou do artista; `null` mostra as iniciais. */
  authorAvatarUrl: string | null;
  /** Resposta do próprio artista: leva o selo de verificado. */
  authorIsArtist: boolean;
  text: string;
  createdAt: string;
  /** Só no app: o comentário do fã enquanto vai ou depois de falhar. */
  status?: CommentStatus;
  /**
   * Só no app: o comentário que o fã acabou de mandar, já com o id do
   * servidor, guarda o id local de quando ia, para a linha continuar a mesma.
   */
  localId?: string;
}

/** Quem comenta: o fã logado, com o nome e a foto do perfil. */
export interface CommentAuthor {
  id: string;
  name: string;
  photoURL: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Toda ação que vale ponto devolve quantos pontos rendeu, para a animação de "+N". */
export interface PointsAward {
  pointsAwarded: number;
}

/**
 * Motivo da denúncia de um comentário (lista fechada, provisória até a
 * UP-48). Sem motivo vai `null`.
 */
export type CommentReportReason = 'spam' | 'offensive' | 'harassment' | 'other';

/** Resposta da denúncia: a segunda do mesmo fã ao mesmo comentário não muda nada. */
export interface ReportCommentResult {
  commentId: string;
  status: 'reported' | 'already_reported';
}

/** Resposta do bloqueio (e do desbloqueio, ainda sem tela). */
export interface BlockFanResult {
  fanId: string;
  blocked: boolean;
}
