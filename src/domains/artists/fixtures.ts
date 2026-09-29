import { ApiError } from '@/services/api/errors';

import type { Artist, FanCentral, FollowArtistsResult } from './types';

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

let followed = new Set<string>(INITIAL_FOLLOWED);
// Chave de idempotência já vista e o que ela devolveu, como o servidor faria.
let answered = new Map<string, FollowArtistsResult>();

function snapshot(): FollowArtistsResult {
  return { followedArtistIds: [...followed] };
}

/**
 * Estado de "servidor" de quem o fã segue. Fica em memória e volta ao início
 * quando o app reabre.
 */
export const followFixture = {
  /** Segue os artistas; a mesma chave de novo devolve a resposta da primeira vez. */
  follow(artistIds: readonly string[], idempotencyKey: string): FollowArtistsResult {
    const previous = answered.get(idempotencyKey);
    if (previous) return { followedArtistIds: [...previous.followedArtistIds] };

    const known = new Set(buildArtistsFixture().map((artist) => artist.id));
    const unknown = artistIds.find((id) => !known.has(id));
    if (unknown !== undefined) {
      throw new ApiError('notFound', `Artista ${unknown} não existe nas fixtures.`, 404);
    }

    for (const id of artistIds) followed.add(id);
    const result = snapshot();
    answered.set(idempotencyKey, result);
    return snapshot();
  },

  followedIds(): string[] {
    return snapshot().followedArtistIds;
  },

  /** Volta ao início (testes). */
  reset(): void {
    followed = new Set(INITIAL_FOLLOWED);
    answered = new Map();
  },
};

/**
 * Posição do fã de exemplo nas centrais do protótipo (1b, 1e): #12 no Netto e
 * #41 no Nenho; no Juninho ele ainda não tem posição ("novo"). E o nome curto
 * que o card do protótipo usa.
 */
const FAN_RANKS: Readonly<Record<string, number>> = { 'netto-brito': 12, nenho: 41 };
const SHORT_NAMES: Readonly<Record<string, string>> = { 'juninho-moraes': 'Juninho M.' };

/**
 * Centrais que o fã segue, na ordem em que ele entrou nelas: as três do
 * protótipo e as que a escolha de artistas (1l) somou, que ainda não têm
 * posição. Lista nova a cada chamada.
 */
export function buildFanCentralsFixture(): FanCentral[] {
  const artists = new Map(buildArtistsFixture().map((artist) => [artist.id, artist]));
  return followFixture.followedIds().flatMap((id) => {
    const artist = artists.get(id);
    if (!artist) return [];
    return [
      {
        artistId: artist.id,
        name: artist.name,
        shortName: SHORT_NAMES[id] ?? null,
        photoURL: artist.photoURL,
        fanRank: FAN_RANKS[id] ?? null,
      } satisfies FanCentral,
    ];
  });
}
