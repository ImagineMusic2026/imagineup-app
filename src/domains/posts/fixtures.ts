import { nextSaturday, set } from 'date-fns';

import { missionsFixture } from '@/domains/missions';
import { ApiError } from '@/services/api/errors';
import { earnFixturePoints, onFixtureSessionEnd } from '@/services/fixtures';

import { COMMENT_MAX_LENGTH } from './schemas';
import type {
  CommentAuthor,
  Page,
  PointsAward,
  Post,
  PostArtist,
  PostComment,
  PostMedia,
} from './types';

/**
 * Posts de exemplo do mural enquanto a API (M2) não existe. Os dois primeiros
 * são os da home do protótipo (1b): o clipe do Netto e, no lugar do post de
 * playlist (fora do contrato), o post de show do Nenho com "Eu vou" (aprovado
 * em 2026-09-29). Os outros são exemplo, para a paginação e a grade da 1d.
 * Sem foto: as miniaturas mostram o placeholder de marca pelo id do post.
 *
 * Os comentários também são exemplo: no clipe, os três fãs do pódio e a
 * resposta do Netto; o resto sai de uma lista de nomes e frases, até a
 * contagem do post. Curtir e comentar mudam um estado em memória (o
 * "servidor" das fixtures), que volta ao início quando a sessão termina.
 */

export const FEED_PAGE_SIZE = 5;
export const COMMENTS_PAGE_SIZE = 10;

/** Pontos por comentário (exemplo; o valor de verdade vem do painel). */
export const COMMENT_POINTS = 2;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
// Pontos por pessoa que abre o link compartilhado (exemplo; vem do painel).
const SHARE_POINTS = 2;
// Medidas de exemplo: vídeo deitado e foto em pé, como o Instagram corta.
const VIDEO_SIZE = { width: 1920, height: 1080 } as const;
const PHOTO_SIZE = { width: 1080, height: 1350 } as const;

const NETTO: PostArtist = {
  id: 'nettobrito',
  name: 'Netto Brito',
  verified: true,
  photoURL: null,
};
const NENHO: PostArtist = { id: 'nenho', name: 'Nenho', verified: true, photoURL: null };
const JUNINHO: PostArtist = {
  id: 'juninhomoraes',
  name: 'Juninho Moraes',
  verified: true,
  photoURL: null,
};

/** "Sábado tem show": o sábado seguinte a `now`, às 22 h. */
function nextSaturdayNight(now: Date): Date {
  return set(nextSaturday(now), { hours: 22, minutes: 0, seconds: 0, milliseconds: 0 });
}

function mediaOf(kind: Post['kind']): PostMedia | null {
  if (kind !== 'photo' && kind !== 'video') return null;
  const size = kind === 'video' ? VIDEO_SIZE : PHOTO_SIZE;
  return { url: null, thumbnailUrl: null, ...size };
}

interface Sample {
  id: string;
  kind: Post['kind'];
  artist: PostArtist;
  text: string;
  hoursAgo: number;
  likeCount: number;
  commentCount: number;
}

const SAMPLES: readonly Sample[] = [
  {
    id: 'p-g1',
    kind: 'photo',
    artist: NETTO,
    text: 'Ensaio de hoje pro São João. Quem vai estar lá?',
    hoursAgo: 27,
    likeCount: 3_980,
    commentCount: 211,
  },
  {
    id: 'p-g2',
    kind: 'photo',
    artist: NETTO,
    text: 'Bastidores do clipe novo. Foram três dias de gravação em Irará.',
    hoursAgo: 2 * 24,
    likeCount: 3_122,
    commentCount: 164,
  },
  {
    id: 'p-g3',
    kind: 'photo',
    artist: NETTO,
    text: 'Obrigado, Feira de Santana! Que noite.',
    hoursAgo: 3 * 24,
    likeCount: 5_230,
    commentCount: 402,
  },
  {
    id: 'p-texto',
    kind: 'text',
    artist: NETTO,
    text: 'Tem música nova chegando. Chuta o nome aí nos comentários.',
    hoursAgo: 4 * 24,
    likeCount: 2_745,
    commentCount: 618,
  },
  {
    id: 'p-juninho-1',
    kind: 'photo',
    artist: JUNINHO,
    text: 'Primeira semana com a central aberta. Bora fazer barulho!',
    hoursAgo: 6 * 24,
    likeCount: 1_204,
    commentCount: 96,
  },
  {
    id: 'p-nenho-2',
    kind: 'video',
    artist: NENHO,
    text: 'Um pedaço do ensaio de ontem. Qual música vocês querem no show?',
    hoursAgo: 8 * 24,
    likeCount: 2_310,
    commentCount: 187,
  },
  {
    id: 'p-netto-4',
    kind: 'photo',
    artist: NETTO,
    text: 'Chegando em Irará.',
    hoursAgo: 10 * 24,
    likeCount: 4_402,
    commentCount: 233,
  },
  {
    // O terceiro post do Nenho: a missão de exemplo "Curta 5 posts do Nenho"
    // (2 de 5) dá para concluir curtindo os três.
    id: 'p-nenho-3',
    kind: 'text',
    artist: NENHO,
    text: 'Valeu por cada mensagem desta semana. Tô lendo tudo.',
    hoursAgo: 13 * 24,
    likeCount: 980,
    commentCount: 75,
  },
];

/** O mural como o servidor guardou, antes das curtidas e dos comentários do fã. */
function buildBasePosts(now: Date): Post[] {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const clip: Post = {
    id: 'p-clipe',
    kind: 'video',
    artist: NETTO,
    text: 'Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.',
    media: mediaOf('video'),
    event: null,
    createdAt: ago(2 * HOUR_MS),
    likeCount: 4_812,
    commentCount: 327,
    likedByMe: false,
    sharePointsPerVisit: SHARE_POINTS,
  };

  const show: Post = {
    id: 'p-show',
    kind: 'event',
    artist: NENHO,
    text: 'Sábado tem show em Aracaju! Quem vem?',
    media: null,
    event: {
      id: 'arrocha-na-praia',
      title: 'Arrocha na Praia',
      startsAt: nextSaturdayNight(now).toISOString(),
      city: 'Aracaju, SE',
    },
    createdAt: ago(5 * HOUR_MS),
    likeCount: 1_906,
    commentCount: 142,
    likedByMe: false,
    sharePointsPerVisit: SHARE_POINTS,
  };

  const rest = SAMPLES.map(({ hoursAgo, kind, ...sample }): Post => ({
    ...sample,
    kind,
    media: mediaOf(kind),
    event: null,
    createdAt: ago(hoursAgo * HOUR_MS),
    likedByMe: false,
    sharePointsPerVisit: SHARE_POINTS,
  }));

  return [clip, show, ...rest] satisfies Post[];
}

// "Servidor" das fixtures: o que o fã fez nesta abertura do app.
let likes = new Map<string, boolean>();
/** Posts cuja primeira curtida já contou nas missões: descurtir e curtir de novo não conta. */
let likesCounted = new Set<string>();
/** Comentários do fã por post, do mais novo ao mais antigo. */
let fanComments = new Map<string, PostComment[]>();
/** Resposta de cada chave de idempotência: a mesma chave de novo não conta outra vez. */
let answered = new Map<string, PointsAward | (PostComment & PointsAward)>();
let fanCommentSeq = 0;

function withServerState(post: Post): Post {
  const liked = likes.get(post.id);
  const extra = fanComments.get(post.id)?.length ?? 0;
  const likeDelta = liked === undefined || liked === post.likedByMe ? 0 : liked ? 1 : -1;
  return {
    ...post,
    likedByMe: liked ?? post.likedByMe,
    likeCount: Math.max(0, post.likeCount + likeDelta),
    commentCount: post.commentCount + extra,
  };
}

/**
 * Mural inteiro, do mais novo ao mais antigo, com datas relativas a `now` e
 * as curtidas e os comentários que o fã fez. Lista nova a cada chamada.
 */
export function buildPostsFixture(now: Date): Post[] {
  return buildBasePosts(now).map(withServerState);
}

/** Uma página do mural: o cursor é a posição do primeiro post da página. */
export function buildFeedPageFixture(now: Date, cursor: string | null): Page<Post> {
  return pageOf(buildPostsFixture(now), cursor, FEED_PAGE_SIZE);
}

/** Posts por página na grade da central (1d): quatro linhas de três. */
export const ARTIST_POSTS_PAGE_SIZE = 12;

/**
 * Uma página dos posts de uma central (a grade da 1d), do mais novo ao mais
 * antigo: os mesmos posts do mural, com as mesmas curtidas e comentários.
 * Central sem post devolve a página vazia.
 */
export function buildArtistPostsPageFixture(
  now: Date,
  artistId: string,
  cursor: string | null,
): Page<Post> {
  const posts = buildPostsFixture(now).filter((post) => post.artist.id === artistId);
  return pageOf(posts, cursor, ARTIST_POSTS_PAGE_SIZE);
}

/**
 * Quantos posts de exemplo a central tem: o "N posts" da 1d quando as
 * centrais já vêm do servidor e o mural ainda é de exemplo (até o bloco 6).
 */
export function countArtistPostsFixture(now: Date, artistId: string): number {
  return buildBasePosts(now).filter((post) => post.artist.id === artistId).length;
}

function pageOf<T>(items: readonly T[], cursor: string | null, size: number): Page<T> {
  const start = cursor === null ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0);
  const end = start + size;
  return {
    items: items.slice(start, end),
    nextCursor: end < items.length ? String(end) : null,
  };
}

function findBasePost(now: Date, postId: string): Post {
  const post = buildBasePosts(now).find((item) => item.id === postId);
  if (!post) throw new ApiError('notFound', `Post ${postId} não existe nas fixtures.`, 404);
  return post;
}

/** O post como a API devolveria, ou 404 como ela. */
export function findPostFixture(now: Date, postId: string): Post {
  return withServerState(findBasePost(now, postId));
}

interface NamedComment {
  id: string;
  authorId: string;
  authorName: string;
  authorIsArtist?: boolean;
  text: string;
  minutesAgo: number;
}

/** Os comentários do topo do clipe: os três do pódio (1f) e a resposta do Netto. */
const CLIP_COMMENTS: readonly NamedComment[] = [
  {
    id: 'c-clipe-netto',
    authorId: NETTO.id,
    authorName: NETTO.name,
    authorIsArtist: true,
    text: 'Thalita sempre na frente 🔥',
    minutesAgo: 48,
  },
  {
    id: 'c-clipe-thalita',
    authorId: 'fa-thalita',
    authorName: 'Thalita S.',
    text: 'Já mandei pro grupo da família inteira, Irará em peso! 💃',
    minutesAgo: 60,
  },
  {
    id: 'c-clipe-davi',
    authorId: 'fa-davi',
    authorName: 'Davi Lima',
    text: 'Esse clipe ficou lindo demais. Já vi umas dez vezes.',
    minutesAgo: 66,
  },
  {
    id: 'c-clipe-jean',
    authorId: 'fa-jean',
    authorName: 'Jean P.',
    text: 'Irará nunca mais vai ser a mesma depois desse São João.',
    minutesAgo: 73,
  },
];

const FANS: readonly { id: string; name: string }[] = [
  { id: 'fa-maria-clara', name: 'Maria Clara S.' },
  { id: 'fa-alan', name: 'Alan Ferreira' },
  { id: 'fa-bruna', name: 'Bruna Andrade' },
  { id: 'fa-igor', name: 'Igor N.' },
  { id: 'fa-leila', name: 'Leila Matos' },
  { id: 'fa-rafael', name: 'Rafael Costa' },
  { id: 'fa-julia', name: 'Júlia Ramos' },
  { id: 'fa-pedro', name: 'Pedro H.' },
  { id: 'fa-carla', name: 'Carla M.' },
  { id: 'fa-diego', name: 'Diego S.' },
  { id: 'fa-eduarda', name: 'Duda Rocha' },
];

const FAN_TEXTS: readonly string[] = [
  'Que música boa demais!',
  'Tô ouvindo sem parar desde que saiu.',
  'Vem pra Salvador, por favor!',
  'Compartilhei com a galera toda.',
  'Arrepiei aqui.',
  'Quero essa no show!',
  'Orgulho de acompanhar desde o começo.',
  'Já tá no repeat.',
  'Chama que a Bahia vai em peso!',
  'Que voz, meu Deus.',
  'Esse refrão não sai da minha cabeça.',
  'Melhor da semana, sem dúvida.',
  'Tô contando os dias pro próximo show.',
];

// Primeiro comentário genérico: logo depois dos do topo ou, sem eles, 1 min atrás.
const GENERIC_START_GAP_MINUTES = 1;

/**
 * Os comentários do servidor para um post, do mais novo ao mais antigo, até a
 * contagem dele. Os genéricos se espalham entre o último do topo e a hora do
 * post; nome e frase saem da posição, para a lista ser sempre a mesma.
 */
function buildBaseComments(now: Date, post: Post): PostComment[] {
  const minutesAgo = (minutes: number) =>
    new Date(now.getTime() - minutes * MINUTE_MS).toISOString();
  const named = post.id === 'p-clipe' ? CLIP_COMMENTS : [];
  const top = named.map((comment): PostComment => ({
    id: comment.id,
    postId: post.id,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorAvatarUrl: null,
    authorIsArtist: comment.authorIsArtist ?? false,
    text: comment.text,
    createdAt: minutesAgo(comment.minutesAgo),
  }));

  const genericCount = Math.max(0, post.commentCount - top.length);
  const newest = (named.at(-1)?.minutesAgo ?? 0) + GENERIC_START_GAP_MINUTES;
  const postAge = (now.getTime() - new Date(post.createdAt).getTime()) / MINUTE_MS;
  const oldest = Math.max(newest, postAge - GENERIC_START_GAP_MINUTES);
  const step = genericCount > 1 ? (oldest - newest) / (genericCount - 1) : 0;
  // O post muda a ordem dos nomes e das frases, para os posts não repetirem a mesma conversa.
  const seed = post.id.length;

  const generic = Array.from({ length: genericCount }, (_, index): PostComment => {
    const fan = FANS[(index + seed) % FANS.length] as (typeof FANS)[number];
    return {
      id: `${post.id}-c${index + 1}`,
      postId: post.id,
      authorId: fan.id,
      authorName: fan.name,
      authorAvatarUrl: null,
      authorIsArtist: false,
      text: FAN_TEXTS[(index * 5 + seed) % FAN_TEXTS.length] as string,
      createdAt: minutesAgo(newest + index * step),
    };
  });

  return [...top, ...generic];
}

/**
 * Uma página de comentários, do mais novo ao mais antigo: os do fã primeiro
 * (os mais novos), depois os do servidor. O cursor é a posição do primeiro da
 * página, e post que não existe dá 404, como a API.
 */
export function buildCommentsPageFixture(
  now: Date,
  postId: string,
  cursor: string | null,
): Page<PostComment> {
  const post = findBasePost(now, postId);
  const all = [...(fanComments.get(postId) ?? []), ...buildBaseComments(now, post)];
  return pageOf(all, cursor, COMMENTS_PAGE_SIZE);
}

export interface FixtureCommentInput {
  postId: string;
  text: string;
  idempotencyKey: string;
  /** A API tira nome e foto da sessão; as fixtures recebem do app. */
  author: CommentAuthor;
}

/**
 * O servidor dos posts nas fixtures: curtir e comentar, com a chave de
 * idempotência e as recusas que a API faria. Comentar rende pontos (exemplo)
 * e conta nas missões de comentário. A primeira curtida de um post conta nas
 * missões de curtida da central dele ("Curta 5 posts do Nenho"), e só rende
 * pontos quando conclui uma.
 */
export const postsFixture = {
  setLike(postId: string, liked: boolean, idempotencyKey: string, now: Date): PointsAward {
    const previous = answered.get(idempotencyKey);
    if (previous) return { pointsAwarded: previous.pointsAwarded };
    const post = findBasePost(now, postId);
    likes.set(postId, liked);
    let pointsAwarded = 0;
    if (liked && !post.likedByMe && !likesCounted.has(postId)) {
      likesCounted.add(postId);
      pointsAwarded = missionsFixture.record('like', now, { artistId: post.artist.id });
    }
    const result: PointsAward = { pointsAwarded };
    answered.set(idempotencyKey, result);
    return { ...result };
  },

  addComment(input: FixtureCommentInput, now: Date): PostComment & PointsAward {
    const previous = answered.get(input.idempotencyKey);
    if (previous && 'id' in previous) return { ...previous };

    const post = findBasePost(now, input.postId);
    const text = input.text.trim();
    if (text.length === 0 || text.length > COMMENT_MAX_LENGTH) {
      throw new ApiError('validation', 'Comentário vazio ou longo demais.', 422);
    }

    fanCommentSeq += 1;
    const comment: PostComment = {
      id: `c-fa-${fanCommentSeq}`,
      postId: input.postId,
      authorId: input.author.id,
      authorName: input.author.name,
      authorAvatarUrl: input.author.photoURL,
      authorIsArtist: false,
      text,
      createdAt: now.toISOString(),
    };
    fanComments.set(input.postId, [comment, ...(fanComments.get(input.postId) ?? [])]);
    // Com a carteira na API, o comentário de exemplo não rende ponto (earnFixturePoints).
    const pointsAwarded =
      earnFixturePoints(COMMENT_POINTS) +
      missionsFixture.record('comment', now, { artistId: post.artist.id });
    const result = { ...comment, pointsAwarded };
    answered.set(input.idempotencyKey, result);
    return { ...result };
  },

  /** Volta ao início (fim da sessão e testes). As missões voltam com `missionsFixture.reset()`. */
  reset(): void {
    likes = new Map();
    likesCounted = new Set();
    fanComments = new Map();
    answered = new Map();
    fanCommentSeq = 0;
  },
};

onFixtureSessionEnd(() => postsFixture.reset());
