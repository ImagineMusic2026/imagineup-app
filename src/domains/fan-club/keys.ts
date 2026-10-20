/**
 * As chaves das consultas do fã-clube (seção 34). A chave inclui tudo que
 * muda o resultado, e tudo fica debaixo de `fanClubKeys.all`.
 *
 * Fica num arquivo sem dependências, no molde do `posts/keys.ts`: o domínio
 * `artists` (sair da central) e o `posts` (bloquear) vão importar daqui
 * direto, na etapa 8 de 34.14, para zerar "Fã-clubes que sigo" e "Dos seus
 * fã-clubes" (34.9 e 34.22); pelo index, seria um ciclo (o fã-clube importa
 * as centrais e os posts pelo index deles).
 */
export const fanClubKeys = {
  all: ['fanClub'] as const,
  /** O estado do fã nos Ajustes e no "Meu fã-clube" (`GET /me/fan-club`). */
  mine: () => [...fanClubKeys.all, 'mine'] as const,
  /** Os números do "Meu fã-clube" (`GET /me/fan-club/numbers`). */
  numbers: () => [...fanClubKeys.all, 'numbers'] as const,
  /** As centrais que aceitam fã-clubes, só na candidatura (`GET /me/fan-club/artists`). */
  artists: () => [...fanClubKeys.all, 'artists'] as const,
  /** "Minhas publicações" (`GET /me/fan-club/posts`). */
  myPosts: () => [...fanClubKeys.all, 'myPosts'] as const,
  /** A página pública (`GET /fan-clubs/:clubId`). */
  club: (clubId: string) => [...fanClubKeys.all, 'club', clubId] as const,
  /** As publicações no ar da página (`GET /fan-clubs/:clubId/posts`). */
  clubPosts: (clubId: string) => [...fanClubKeys.all, 'clubPosts', clubId] as const,
  /** O card da 1d e o "Ver todos" (`GET /artists/:artistId/fan-clubs`). */
  byArtist: (artistId: string) => [...fanClubKeys.all, 'artist', artistId] as const,
  /** "Fã-clubes que sigo" (`GET /me/fan-club-follows`). */
  follows: () => [...fanClubKeys.all, 'follows'] as const,
  /** "Dos seus fã-clubes" da Início (`GET /me/fan-club-feed`). */
  feed: () => [...fanClubKeys.all, 'feed'] as const,
};
