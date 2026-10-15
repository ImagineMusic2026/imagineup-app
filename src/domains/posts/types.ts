import type { ActionRewards } from '@/domains/missions';

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
 * Uma mídia por post (foto ou vídeo, pelo `kind` do post). O vídeo com o mp4
 * toca no detalhe, ao toque (seção 33); o mural e a grade mostram a capa com a
 * marca de vídeo.
 */
export interface PostMedia {
  /** A foto inteira ou o arquivo do vídeo; `null` até existir. */
  url: string | null;
  /** `null` até a foto existir: a miniatura mostra o placeholder de marca pelo id do post. */
  thumbnailUrl: string | null;
  /**
   * Só no vídeo: a capa grande (até 1080 de largura), para o detalhe; `null`
   * sem mídia gravada. Ausente na foto e na `api` de antes do campo (o cache
   * salvo no aparelho inclusive): o detalhe cai na miniatura (seção 33).
   */
  posterUrl?: string | null;
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
 * esperando a rede), não enviado (`failed`, o toque tenta de novo) ou não
 * publicado (`refused`, o texto fora dos Termos de uso, seção 30: o toque
 * nunca manda de novo). Só existe no app, nunca vem da API.
 */
export type CommentStatus = 'pending' | 'failed' | 'refused';

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

/**
 * Toda ação que vale ponto devolve quantos pontos rendeu, para a animação de
 * "+N". Curtir e comentar trazem também as recompensas da ação (bloco 7: as
 * missões concluídas, o nível novo, as conquistas e se alguma missão andou),
 * opcionais aqui.
 */
export interface PointsAward extends ActionRewards {
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

/** Resposta do bloqueio (`blocked: true`) e do desbloqueio (`false`). */
export interface BlockFanResult {
  fanId: string;
  blocked: boolean;
}

/**
 * Resposta da denúncia de perfil (`POST /fans/:fanId/report`, seção 29): a
 * segunda da mesma pessoa na rodada não muda nada, e o app diz a mesma frase
 * para os dois.
 */
export interface ReportFanResult {
  fanId: string;
  status: 'reported' | 'already_reported';
}

/**
 * Um fã da lista de bloqueados (`GET /me/blocks`, seção 29): os campos que o
 * perfil fechado já mostra a qualquer fã. Nunca a bio, as redes nem o resto.
 */
export interface BlockedFan {
  uid: string;
  /** `null` sem nome visível: a linha diz "Fã". */
  displayName: string | null;
  username: string | null;
  photoURL: string | null;
}

/** Uma página da lista, do mais novo ao mais antigo; o cursor é `<índice>:<uid>`. */
export type BlockedFansPage = Page<BlockedFan>;
