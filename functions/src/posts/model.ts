import { Timestamp } from 'firebase-admin/firestore';

import type { Post, PostComment, PostEvent, PostMedia } from '../api/contract';
import { isPublished, safeCount, exactMillis, type ArtistRecord } from '../centrals/model';
import { isContentId } from '../page-cursor';
import { cleanMultiline, isVisibleMultiline } from '../visible-line';
import { postPanelError } from './errors';

// Mural do bloco 6, puro: nada aqui lê ou grava o Firestore. O service.ts lê,
// chama daqui e grava. Contrato em docs/arquitetura-api.md, seção 21.

export const POST_KINDS = ['photo', 'video', 'text', 'event'] as const;
export type PostKind = (typeof POST_KINDS)[number];

export type ContentStatus = 'draft' | 'published' | 'unpublished';

/**
 * Shards das contagens de cada post (`postStats/{postId}/countShards/{n}`).
 * Quem soma lista a subcoleção e nunca supõe este número. Teto perto de 16
 * curtidas ou comentários por segundo no mesmo post, sustentados.
 */
export const POST_SHARD_COUNT = 16;

/** Páginas: sem `limit`, o padrão de cada lista; com ele, de 1 a 50. */
export const FEED_LIMIT_DEFAULT = 10;
/** Quatro linhas da grade da 1d. */
export const ARTIST_POSTS_LIMIT_DEFAULT = 12;
export const COMMENTS_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 50;

/** O `in` do Firestore aceita até 30 valores: o mural junta blocos de 30 centrais. */
export const FEED_IN_BLOCK = 30;

/** Rodadas de busca dos comentários quando os bloqueados esvaziam a página. */
export const COMMENT_PAGE_ROUNDS = 5;

/** Comentários do próprio fã lidos no detalhe, para a correção do `commentCount`. */
export const OWN_COMMENTS_READ = 5;

/** Comentário: de 1 a 500 unidades de UTF-16, como o `maxLength` do campo do app. */
export const COMMENT_MAX = 500;

/** Legenda do post: até 2.000; texto e show exigem pelo menos 1. */
export const POST_TEXT_MAX = 2_000;

/** Nome do autor quando o perfil não tem nome: o `post.comments.fallbackName` do app. */
export const COMMENT_FALLBACK_NAME = 'Fã';

/** Medidas padrão quando o upload não mandou largura e altura (21.9). */
export const POST_MEDIA_SIZES = {
  photo: { photo: { width: 1080, height: 1350 }, thumb: { width: 480, height: 600 } },
  video: { photo: { width: 1920, height: 1080 }, thumb: { width: 480, height: 270 } },
} as const;

/** Arquivo de imagem gravado: a URL de download, o caminho e as medidas. */
export type ImageFile = { url: string; path: string; width: number; height: number };

/** O mp4 do vídeo: a URL, o caminho e o tamanho. */
export type VideoFile = { url: string; path: string; size: number };

/** posts/{postId} como o servidor usa, com as datas em ms. */
export type PostRecord = {
  id: string;
  artistId: string;
  kind: PostKind;
  text: string;
  /** A foto (no vídeo, a capa) e a miniatura; null sem mídia gravada. */
  photo: ImageFile | null;
  thumb: ImageFile | null;
  video: VideoFile | null;
  eventId: string | null;
  status: ContentStatus | null;
  /** A primeira publicação, em ms; null quando nunca foi ao ar. */
  publishedAt: number | null;
  likeCount: number;
  commentCount: number;
  /** O instante da leitura dos shards copiada, em ms com fração (microssegundos). */
  countsAt: number | null;
};

export type PostErrorReason = 'post_not_found' | 'comment_not_found' | 'comment_invalid';

const POST_ERROR_MESSAGES: Record<PostErrorReason, string> = {
  post_not_found: 'Post não encontrado.',
  comment_not_found: 'Comentário não encontrado.',
  comment_invalid: 'Comentário vazio, longo demais ou com caracteres invisíveis.',
};

/**
 * Recusa do núcleo do mural. A API traduz para o código de mesmo nome
 * (`toApiHttpError`); o seed usa o mesmo núcleo fora da API.
 */
export class PostError extends Error {
  readonly reason: PostErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: PostErrorReason, details?: Record<string, unknown>) {
    super(POST_ERROR_MESSAGES[reason]);
    this.name = 'PostError';
    this.reason = reason;
    this.details = details;
  }
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

function millis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function imageOf(value: unknown): ImageFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const { url, path, width, height } = value as Record<string, unknown>;
  if (typeof url !== 'string' || typeof path !== 'string') return null;
  return {
    url,
    path,
    width: typeof width === 'number' ? width : 0,
    height: typeof height === 'number' ? height : 0,
  };
}

function videoOf(value: unknown): VideoFile | null {
  if (typeof value !== 'object' || value === null) return null;
  const { url, path, size } = value as Record<string, unknown>;
  if (typeof url !== 'string' || typeof path !== 'string') return null;
  return { url, path, size: typeof size === 'number' ? size : 0 };
}

function statusOf(value: unknown): ContentStatus | null {
  return value === 'draft' || value === 'published' || value === 'unpublished' ? value : null;
}

export function isPostKind(value: unknown): value is PostKind {
  return (POST_KINDS as readonly unknown[]).includes(value);
}

/** O documento de posts/{id} como o servidor usa. */
export function postRecord(id: string, data: Record<string, unknown>): PostRecord {
  const media = (typeof data.media === 'object' && data.media !== null ? data.media : {}) as Record<
    string,
    unknown
  >;
  return {
    id,
    artistId: typeof data.artistId === 'string' ? data.artistId : '',
    kind: isPostKind(data.kind) ? data.kind : 'text',
    text: typeof data.text === 'string' ? data.text : '',
    photo: imageOf(media.photo),
    thumb: imageOf(media.thumb),
    video: videoOf(media.video),
    eventId: text(data.eventId),
    status: statusOf(data.status),
    publishedAt: millis(data.publishedAt),
    likeCount: safeCount(data.likeCount),
    commentCount: safeCount(data.commentCount),
    countsAt: exactMillis(data.countsAt),
  };
}

/**
 * Post visível: no ar, de central no ar (21.18). A central fora do ar esconde
 * os posts dela no mural, na grade e no detalhe, mesmo publicados.
 */
export function isPostVisible(
  post: PostRecord | null | undefined,
  artist: ArtistRecord | null | undefined,
): post is PostRecord {
  return (
    !!post &&
    post.status === 'published' &&
    post.publishedAt !== null &&
    isPublished(artist) &&
    artist.id === post.artistId
  );
}

/**
 * A mídia como o app lê. Foto e vídeo sempre trazem a mídia, mesmo sem
 * arquivo gravado (só o seed publica assim): as URLs nulas e as medidas
 * padrão, como as fixtures (o app decide a miniatura pela presença dela).
 * Texto e show: null.
 */
export function mediaView(post: PostRecord): PostMedia | null {
  if (post.kind !== 'photo' && post.kind !== 'video') return null;
  const size = POST_MEDIA_SIZES[post.kind].photo;
  if (!post.photo) return { url: null, thumbnailUrl: null, ...size };
  return {
    url: post.kind === 'video' ? (post.video?.url ?? null) : post.photo.url,
    thumbnailUrl: post.thumb?.url ?? post.photo.url,
    width: post.photo.width || size.width,
    height: post.photo.height || size.height,
  };
}

/**
 * A curtida do fã lida: o estado e o `countedAt` da última troca (o instante
 * do commit, do mesmo relógio do `countsAt`), em ms.
 */
export type LikeState = { liked: boolean; countedAt: number | null };

/**
 * As contagens que quem chama vê (21.6). `likeCount`: a cópia, mais 1 quando
 * a curtida dele está ativa e entrou no shard depois da leitura da cópia (ou
 * não há cópia). `commentCount`: a cópia, mais os comentários visíveis dele
 * que entraram no shard depois da leitura (só o detalhe lê esses; as listas
 * passam null). Os instantes são os do commit (`countedAt`), e não o "agora"
 * do pedido: a cópia que lê os shards entre o começo do pedido e o commit
 * não tem a ação, e o "agora" ficaria antes dela.
 */
export function viewCounts(
  post: PostRecord,
  like: LikeState | null,
  ownCommentTimes: readonly number[] | null,
): { likeCount: number; commentCount: number } {
  const after = (at: number | null) =>
    post.countsAt === null || (at !== null && at > post.countsAt);
  const likeCount = post.likeCount + (like?.liked && after(like.countedAt) ? 1 : 0);
  const fresh = ownCommentTimes?.filter((at) => after(at)).length ?? 0;
  return { likeCount, commentCount: post.commentCount + fresh };
}

/** O show do post de show, já conferido (no ar e não encerrado); senão null. */
export type PostEventView = PostEvent | null;

/** O `Post` do app: igual no mural, na grade e no detalhe. */
export function postView(
  post: PostRecord,
  artist: ArtistRecord,
  options: {
    like: LikeState | null;
    event: PostEventView;
    sharePointsPerVisit: number;
    ownCommentTimes?: readonly number[] | null;
  },
): Post {
  const counts = viewCounts(post, options.like, options.ownCommentTimes ?? null);
  return {
    id: post.id,
    kind: post.kind,
    artist: {
      id: artist.id,
      name: artist.name,
      verified: artist.verified,
      photoURL: artist.thumbUrl,
    },
    text: post.text,
    media: mediaView(post),
    event: post.kind === 'event' ? options.event : null,
    createdAt: new Date(post.publishedAt ?? 0).toISOString(),
    likeCount: counts.likeCount,
    commentCount: counts.commentCount,
    likedByMe: options.like?.liked === true,
    sharePointsPerVisit: options.sharePointsPerVisit > 0 ? options.sharePointsPerVisit : null,
  };
}

/** A ordem do mural e da grade: a primeira publicação mais nova antes, depois o id decrescente. */
export function comparePosts(a: PostRecord, b: PostRecord): number {
  return (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

/**
 * Junta os blocos do mural (um por grupo de até 30 centrais, cada um com os
 * `limit + 1` primeiros dele) na mesma ordem e fica com os `limit` primeiros.
 * Como cada bloco traz os primeiros dele, a junção dá os primeiros do todo.
 * `hasMore` diz se sobrou algum.
 */
export function mergePostBlocks(
  blocks: readonly (readonly PostRecord[])[],
  limit: number,
): { items: PostRecord[]; hasMore: boolean } {
  const seen = new Set<string>();
  const all = blocks
    .flat()
    .filter((post) => (seen.has(post.id) ? false : (seen.add(post.id), true)))
    .sort(comparePosts);
  return { items: all.slice(0, limit), hasMore: all.length > limit };
}

/** Os blocos de até `size` centrais do `in` do mural. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

// --- Comentários ---------------------------------------------------------------

export type CommentStatus = 'visible' | 'hidden';

/** posts/{postId}/postComments/{commentId} como o servidor usa. */
export type CommentRecord = {
  id: string;
  postId: string;
  artistId: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL: string | null;
  text: string;
  status: CommentStatus;
  /** Em ms. */
  createdAt: number;
};

export function commentRecord(id: string, data: Record<string, unknown>): CommentRecord {
  return {
    id,
    postId: typeof data.postId === 'string' ? data.postId : '',
    artistId: typeof data.artistId === 'string' ? data.artistId : '',
    authorUid: typeof data.authorUid === 'string' ? data.authorUid : '',
    authorName:
      typeof data.authorName === 'string' && data.authorName !== ''
        ? data.authorName
        : COMMENT_FALLBACK_NAME,
    authorPhotoURL: text(data.authorPhotoURL),
    text: typeof data.text === 'string' ? data.text : '',
    status: data.status === 'hidden' ? 'hidden' : 'visible',
    createdAt: millis(data.createdAt) ?? 0,
  };
}

/** O `PostComment` do app. A resposta do artista é pergunta (21.16): sempre false. */
export function commentView(comment: CommentRecord): PostComment {
  return {
    id: comment.id,
    postId: comment.postId,
    authorId: comment.authorUid,
    authorName: comment.authorName,
    authorAvatarUrl: comment.authorPhotoURL,
    authorIsArtist: false,
    text: comment.text,
    createdAt: new Date(comment.createdAt).toISOString(),
  };
}

export type CommentTextProblem = 'empty' | 'too_long' | 'invisible';

/**
 * O texto do comentário limpo (`cleanMultiline`) e conferido, igual ao app
 * (21.1, decisão 20): vazio depois da limpeza, acima de 500 unidades de
 * UTF-16 ou com uma linha que não é visível.
 */
export function commentTextProblem(cleaned: string): CommentTextProblem | null {
  if (cleaned.length === 0) return 'empty';
  if (cleaned.length > COMMENT_MAX) return 'too_long';
  if (!isVisibleMultiline(cleaned)) return 'invisible';
  return null;
}

/**
 * Corpo do `POST /posts/:postId/comments`: `{ text }`. Devolve o texto limpo;
 * texto que não é texto é `undefined` (400 `invalid_request` na rota), e o
 * que não passa recusa com `comment_invalid` e o motivo.
 */
export function parseCommentText(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const raw = (body as { text?: unknown }).text;
  if (typeof raw !== 'string') return undefined;
  const cleaned = cleanMultiline(raw);
  const problem = commentTextProblem(cleaned);
  if (problem) throw new PostError('comment_invalid', { reason: problem });
  return cleaned;
}

// --- Contagens em shards -------------------------------------------------------

/** O shard das contagens de uma transação: o sorteio do shard do painel, reduzido aos 16 do post. */
export function postShardOf(shard: number): number {
  return ((Math.trunc(shard) % POST_SHARD_COUNT) + POST_SHARD_COUNT) % POST_SHARD_COUNT;
}

/** Soma de um campo dos shards; o que não é número conta 0. Pode dar negativo (erro, vale 0). */
export function sumShards(values: readonly unknown[]): number {
  return values.reduce<number>(
    (sum, value) =>
      typeof value === 'number' && Number.isFinite(value) ? sum + Math.trunc(value) : sum,
    0,
  );
}

/**
 * A tarefa copia quando a leitura dos shards é mais nova que a última cópia.
 * Copia mesmo com os números iguais: o `countsAt` precisa passar o
 * `updatedAt` da curtida de quem curtiu, senão a correção somaria 1 para
 * sempre (21.18).
 */
export function shouldCopyCounts(countsAt: number | null, readTime: number): boolean {
  return countsAt === null || countsAt < readTime;
}

// --- Callables do painel (21.9) ------------------------------------------------

/** Id de post, de comentário ou de show vindo do painel. */
export function parseContentId(value: unknown): string {
  if (!isContentId(value)) throw postPanelError('post-not-found');
  return value;
}

export function parsePostKind(value: unknown): PostKind {
  if (!isPostKind(value)) throw postPanelError('invalid-kind');
  return value;
}

/**
 * Legenda do post, limpa como o comentário (`cleanMultiline`): de 1 a 2.000
 * no texto e no show; de 0 a 2.000 na foto e no vídeo, que podem sair sem
 * legenda. Ausente ou null vale texto vazio.
 */
export function parsePostText(kind: PostKind, value: unknown): string {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    throw postPanelError('invalid-text');
  }
  const cleaned = cleanMultiline(typeof value === 'string' ? value : '');
  const needsText = kind === 'text' || kind === 'event';
  if (
    (needsText && cleaned.length === 0) ||
    cleaned.length > POST_TEXT_MAX ||
    !isVisibleMultiline(cleaned)
  ) {
    throw postPanelError('invalid-text');
  }
  return cleaned;
}

/** Pasta da mídia de um post no bucket. */
export function postPrefix(postId: string): string {
  return `posts/${postId}/`;
}

const sameValue = (stored: unknown, asked: unknown): boolean =>
  Array.isArray(stored) && Array.isArray(asked)
    ? stored.length === asked.length && stored.every((item, index) => item === asked[index])
    : stored === asked;

/**
 * O documento que já existe com o id que o painel mandou no `createPost`, no
 * `createEvent` ou no `createReward` é a nova tentativa do mesmo rascunho
 * (puro, bloco 11, 26.5): ainda rascunho, criado por quem chama, com os
 * campos que travam depois de criado iguais aos do pedido (`fields`). Fora
 * disso, o id é de outro documento, e a criação recusa em vez de responder
 * que criou.
 */
export function isRetriedDraft(
  stored: Record<string, unknown> | undefined,
  actorUid: string,
  fields: Record<string, unknown> = {},
): boolean {
  if (!stored || stored.status !== 'draft' || stored.createdBy !== actorUid) return false;
  return Object.entries(fields).every(([key, value]) => sameValue(stored[key], value));
}

const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

/** true se o caminho é um arquivo direto em `<prefixo>` (sem subpasta). */
export function isFileIn(path: unknown, prefix: string): path is string {
  if (typeof path !== 'string' || !path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return FILE_NAME_PATTERN.test(name) && name !== '.' && name !== '..';
}

/** Caminhos da mídia que o painel subiu para posts/{postId}/. */
/**
 * Os caminhos da mídia do `updatePost`. No vídeo, `videoPath` ausente mantém o
 * vídeo de agora (o painel trocou só a capa, bloco 11, 26.5), e null tira; na
 * foto, sempre null.
 */
export type PostMediaPaths = { photoPath: string; thumbPath: string; videoPath?: string | null };

/**
 * `media` do updatePost: null tira; senão `{ photoPath, thumbPath }` na foto
 * e `{ photoPath, thumbPath, videoPath? }` no vídeo, arquivos diretos da pasta
 * do post, diferentes entre si. No vídeo, `videoPath` ausente volta ausente (o
 * vídeo de agora fica) e null tira o vídeo (bloco 11, 26.5). Texto e show não
 * levam mídia.
 */
export function parsePostMediaPaths(
  kind: PostKind,
  value: unknown,
  postId: string,
): PostMediaPaths | null {
  if (kind !== 'photo' && kind !== 'video') throw postPanelError('media-not-allowed');
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw postPanelError('invalid-media');
  const { photoPath, thumbPath, videoPath } = value as Record<string, unknown>;
  const prefix = postPrefix(postId);
  if (!isFileIn(photoPath, prefix) || !isFileIn(thumbPath, prefix) || photoPath === thumbPath) {
    throw postPanelError('invalid-media');
  }
  if (kind === 'photo' && videoPath !== undefined && videoPath !== null) {
    throw postPanelError('invalid-media');
  }
  if (videoPath !== undefined && videoPath !== null) {
    if (!isFileIn(videoPath, prefix) || videoPath === photoPath || videoPath === thumbPath) {
      throw postPanelError('invalid-media');
    }
    return { photoPath, thumbPath, videoPath };
  }
  if (kind === 'video' && videoPath === undefined) return { photoPath, thumbPath };
  return { photoPath, thumbPath, videoPath: null };
}

/** O status pedido no setPostStatus e no setEventStatus. */
export function parseContentStatus(value: unknown): 'published' | 'unpublished' {
  if (value !== 'published' && value !== 'unpublished') throw postPanelError('invalid-status');
  return value;
}

/**
 * Arquivos da pasta que saem depois de trocar ou tirar a mídia: tudo na pasta
 * que não está em `keep`. Caminho de outra pasta nunca entra.
 */
export function staleFiles(
  paths: readonly string[],
  prefix: string,
  keep: readonly (string | null | undefined)[],
): string[] {
  const kept = new Set(keep.filter((path): path is string => typeof path === 'string'));
  return [...new Set(paths)].filter((path) => path.startsWith(prefix) && !kept.has(path));
}
