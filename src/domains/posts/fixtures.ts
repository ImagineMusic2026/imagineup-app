import { nextSaturday, set } from 'date-fns';

import type { Page, Post, PostArtist } from './types';

/**
 * Posts de exemplo do mural enquanto a API (M2) não existe. Os dois primeiros
 * são os da home do protótipo (1b): o clipe do Netto e, no lugar do post de
 * playlist (fora do contrato), o post de show do Nenho com "Eu vou" (aprovado
 * em 2026-09-29). Os outros são exemplo, para a paginação e a grade da 1d.
 * Sem foto: as miniaturas mostram o placeholder de marca pelo id do post.
 */

export const FEED_PAGE_SIZE = 5;

const HOUR_MS = 60 * 60 * 1000;
// Pontos por pessoa que abre o link compartilhado (exemplo; vem do painel).
const SHARE_POINTS = 2;
const VIDEO_ASPECT = 16 / 9;
const PHOTO_ASPECT = 4 / 5;

const NETTO: PostArtist = {
  id: 'netto-brito',
  name: 'Netto Brito',
  verified: true,
  photoURL: null,
};
const NENHO: PostArtist = { id: 'nenho', name: 'Nenho', verified: true, photoURL: null };
const JUNINHO: PostArtist = {
  id: 'juninho-moraes',
  name: 'Juninho Moraes',
  verified: true,
  photoURL: null,
};

/** "Sábado tem show": o sábado seguinte a `now`, às 22 h. */
function nextSaturdayNight(now: Date): Date {
  return set(nextSaturday(now), { hours: 22, minutes: 0, seconds: 0, milliseconds: 0 });
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
    id: 'p-juninho-2',
    kind: 'text',
    artist: JUNINHO,
    text: 'Valeu por cada mensagem desta semana. Tô lendo tudo.',
    hoursAgo: 13 * 24,
    likeCount: 980,
    commentCount: 75,
  },
];

/** Mural inteiro, do mais novo ao mais antigo, com datas relativas a `now`. Lista nova a cada chamada. */
export function buildPostsFixture(now: Date): Post[] {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  const clip: Post = {
    id: 'p-clipe',
    kind: 'video',
    artist: NETTO,
    text: 'Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.',
    media: { thumbnailUrl: null, aspectRatio: VIDEO_ASPECT },
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
    media:
      kind === 'text'
        ? null
        : { thumbnailUrl: null, aspectRatio: kind === 'video' ? VIDEO_ASPECT : PHOTO_ASPECT },
    event: null,
    createdAt: ago(hoursAgo * HOUR_MS),
    likedByMe: false,
    sharePointsPerVisit: SHARE_POINTS,
  }));

  return [clip, show, ...rest] satisfies Post[];
}

/** Uma página do mural: o cursor é a posição do primeiro post da página. */
export function buildFeedPageFixture(now: Date, cursor: string | null): Page<Post> {
  const posts = buildPostsFixture(now);
  const start = cursor === null ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0);
  const end = start + FEED_PAGE_SIZE;
  return {
    items: posts.slice(start, end),
    nextCursor: end < posts.length ? String(end) : null,
  };
}
