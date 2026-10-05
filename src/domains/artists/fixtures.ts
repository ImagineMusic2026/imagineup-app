// Posição e pontos do fã em cada central saem do ranking de exemplo, a fonte
// única desses números: a home, o perfil e o ranking mostram sempre os mesmos.
// Import direto do arquivo, fora do index: pelo index do ranking seria um
// ciclo (o ranking lê as centrais daqui). Some junto com as fixtures quando a
// API entrar.
import { buildMyRankFixture } from '@/domains/ranking/fixtures';
import { ApiError } from '@/services/api/errors';
import { earnFixturePoints, onFixtureSessionEnd } from '@/services/fixtures';

import type {
  Artist,
  ArtistDetails,
  FanCentral,
  FollowArtistsResult,
  JoinCentralResult,
} from './types';

/**
 * Dados de exemplo enquanto a API (M2) não existe. Os quatro primeiros são os
 * do protótipo (1l, 1b, 1d); os outros 18 são genéricos, só para o "+18
 * artistas" e a busca, até a cliente mandar a lista real. Sem foto: as telas
 * mostram o placeholder de marca pelo id.
 */
const FEATURED: readonly Omit<Artist, 'order' | 'photoURL'>[] = [
  { id: 'netto-brito', name: 'Netto Brito', fanCount: 412_000 },
  { id: 'nenho', name: 'Nenho', fanCount: 298_000 },
  { id: 'juninho-moraes', name: 'Juninho Moraes', fanCount: 141_000 },
  { id: 'rock-salles', name: 'Rock Salles', fanCount: 96_000 },
];

const FIRST_GENERIC = FEATURED.length + 1;
const LAST_GENERIC = 22;
const GENERIC_TOP_FANS = 90_000;
const GENERIC_FANS_STEP = 4_000;

/** Lista nova a cada chamada, na ordem de destaque. */
export function buildArtistsFixture(): Artist[] {
  const featured = FEATURED.map((artist, index) => ({ ...artist, photoURL: null, order: index }));
  const generic = Array.from({ length: LAST_GENERIC - FIRST_GENERIC + 1 }, (_, index) => {
    const number = FIRST_GENERIC + index;
    return {
      id: `artista-${number}`,
      name: `Artista ${number}`,
      photoURL: null,
      fanCount: GENERIC_TOP_FANS - index * GENERIC_FANS_STEP,
      order: featured.length + index,
    };
  });
  return [...featured, ...generic] satisfies Artist[];
}

/**
 * Centrais que o fã de exemplo (a Camila do protótipo) já segue: as três que a
 * home (1b) e o perfil (1e) mostram. Seguir soma a elas.
 */
const INITIAL_FOLLOWED: readonly string[] = ['netto-brito', 'nenho', 'juninho-moraes'];

/** Pontos por entrar numa central pela página do artista (exemplo; o valor vem do painel). */
export const JOIN_CENTRAL_POINTS = 10;

let followed = new Set<string>(INITIAL_FOLLOWED);
// Chave de idempotência já vista e o que ela devolveu, como o servidor faria.
let answered = new Map<string, FollowArtistsResult>();
let joinAnswers = new Map<string, JoinCentralResult>();

function snapshot(): FollowArtistsResult {
  return { followedArtistIds: [...followed] };
}

function assertKnown(artistIds: readonly string[]): void {
  const known = new Set(buildArtistsFixture().map((artist) => artist.id));
  const unknown = artistIds.find((id) => !known.has(id));
  if (unknown !== undefined) {
    throw new ApiError('notFound', `Artista ${unknown} não existe nas fixtures.`, 404);
  }
}

/**
 * Estado de "servidor" de quem o fã segue. Fica em memória e volta ao início
 * quando o app reabre ou a sessão termina.
 */
export const followFixture = {
  /** Segue os artistas; a mesma chave de novo devolve a resposta da primeira vez. */
  follow(artistIds: readonly string[], idempotencyKey: string): FollowArtistsResult {
    const previous = answered.get(idempotencyKey);
    if (previous) return { followedArtistIds: [...previous.followedArtistIds] };

    assertKnown(artistIds);
    for (const id of artistIds) followed.add(id);
    const result = snapshot();
    answered.set(idempotencyKey, result);
    return snapshot();
  },

  /**
   * Entrar numa central pela página do artista (1d). Rende os pontos de
   * exemplo na carteira só na primeira vez: quem já está nela recebe zero,
   * como a API idempotente faria. A mesma chave de novo devolve a resposta da
   * primeira vez.
   */
  join(artistId: string, idempotencyKey: string): JoinCentralResult {
    const previous = joinAnswers.get(idempotencyKey);
    if (previous) return { ...previous };

    assertKnown([artistId]);
    // Com a carteira na API, entrar na central de exemplo não rende ponto (earnFixturePoints).
    const pointsAwarded = followed.has(artistId) ? 0 : earnFixturePoints(JOIN_CENTRAL_POINTS);
    followed.add(artistId);
    const result: JoinCentralResult = { artistId, pointsAwarded };
    joinAnswers.set(idempotencyKey, result);
    return { ...result };
  },

  followedIds(): string[] {
    return snapshot().followedArtistIds;
  },

  /** Volta ao início (fim da sessão e testes). */
  reset(): void {
    followed = new Set(INITIAL_FOLLOWED);
    answered = new Map();
    joinAnswers = new Map();
  },
};

onFixtureSessionEnd(() => followFixture.reset());

/** O nome curto que o card da home (1b) usa no protótipo. */
const SHORT_NAMES: Readonly<Record<string, string>> = { 'juninho-moraes': 'Juninho M.' };

/**
 * Centrais que o fã segue, na ordem em que ele entrou nelas: as três do
 * protótipo e as que a escolha de artistas (1l) somou, que ainda não têm
 * posição. A posição e os pontos da temporada são os do ranking de exemplo
 * da central (#12 e 4.120 no Netto, #41 e 2.980 no Nenho, sem posição no
 * Juninho). Lista nova a cada chamada.
 */
export function buildFanCentralsFixture(): FanCentral[] {
  const artists = new Map(buildArtistsFixture().map((artist) => [artist.id, artist]));
  return followFixture.followedIds().flatMap((id) => {
    const artist = artists.get(id);
    if (!artist) return [];
    const standing = buildMyRankFixture({ kind: 'artist', artistId: id });
    return [
      {
        artistId: artist.id,
        name: artist.name,
        shortName: SHORT_NAMES[id] ?? null,
        photoURL: artist.photoURL,
        fanCount: artist.fanCount,
        fanRank: standing.position,
        seasonPoints: standing.points,
      } satisfies FanCentral,
    ];
  });
}

/** Números de exemplo das centrais do protótipo (1d): o Netto é o do desenho. */
const FEATURED_NUMBERS: Readonly<Record<string, { postCount: number; centralPoints: number }>> = {
  'netto-brito': { postCount: 1_284, centralPoints: 8_400_000 },
  nenho: { postCount: 936, centralPoints: 5_900_000 },
  'juninho-moraes': { postCount: 412, centralPoints: 2_300_000 },
  'rock-salles': { postCount: 268, centralPoints: 1_100_000 },
};

// Centrais genéricas: posts e pontos proporcionais aos fãs, sem gestão da
// Imagine (a pílula "gestão oficial" some), até a lista real chegar.
const GENERIC_POSTS_PER_THOUSAND_FANS = 1;
const GENERIC_POINTS_PER_FAN = 12;

/**
 * A central de um artista para a página dele (1d), com o fã dentro ou fora
 * dela conforme o que ele seguiu nesta abertura do app. Artista que não existe
 * dá 404, como a API. Objeto novo a cada chamada; sem capa nem foto (as telas
 * mostram o placeholder de marca pelo id).
 */
export function buildArtistDetailsFixture(artistId: string): ArtistDetails {
  const artist = buildArtistsFixture().find((item) => item.id === artistId);
  if (!artist) throw new ApiError('notFound', `Artista ${artistId} não existe nas fixtures.`, 404);
  const featured = FEATURED_NUMBERS[artistId];
  return {
    id: artist.id,
    name: artist.name,
    coverUrl: null,
    photoURL: artist.photoURL,
    verified: true,
    managedByImagine: featured !== undefined,
    fanCount: artist.fanCount,
    postCount:
      featured?.postCount ??
      Math.round((artist.fanCount / 1_000) * GENERIC_POSTS_PER_THOUSAND_FANS),
    centralPoints: featured?.centralPoints ?? artist.fanCount * GENERIC_POINTS_PER_FAN,
    isMember: followFixture.followedIds().includes(artistId),
  } satisfies ArtistDetails;
}
