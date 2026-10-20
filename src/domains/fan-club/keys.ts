/**
 * As chaves das consultas do fã-clube (seção 34). A chave inclui tudo que
 * muda o resultado, e tudo fica debaixo de `fanClubKeys.all`.
 *
 * Fica num arquivo sem dependências, no molde do `posts/keys.ts`: o domínio
 * `artists` (sair da central) e o `posts` (bloquear e desbloquear) importam
 * daqui direto, para zerar o que os fãs veem dos fã-clubes (34.9 e 34.22);
 * pelo index, seria um ciclo (o fã-clube importa as centrais e os posts pelo
 * index deles).
 */
export const fanClubKeys = {
  all: ['fanClub'] as const,
  /** O estado do fã nos Ajustes e no "Meu fã-clube" (`GET /me/fan-club`), também a trava. */
  mine: () => [...fanClubKeys.all, 'mine'] as const,
  /** Os números do "Meu fã-clube" (`GET /me/fan-club/numbers`). */
  numbers: () => [...fanClubKeys.all, 'numbers'] as const,
  /** As centrais que aceitam fã-clubes, só na candidatura (`GET /me/fan-club/artists`). */
  artists: () => [...fanClubKeys.all, 'artists'] as const,
  /** "Minhas publicações" (`GET /me/fan-club/posts`). */
  myPosts: () => [...fanClubKeys.all, 'myPosts'] as const,
  /**
   * Tudo o que os fãs veem dos fã-clubes: a página, as publicações dela, a
   * lista do artista, "Fã-clubes que sigo" e "Dos seus fã-clubes". Sair da
   * central, bloquear e desbloquear zeram tudo daqui de uma vez.
   */
  public: () => [...fanClubKeys.all, 'public'] as const,
  /** Todas as páginas públicas: a entrada na central muda o `isMember` delas. */
  pages: () => [...fanClubKeys.public(), 'club'] as const,
  /** A página pública (`GET /fan-clubs/:clubId`). */
  club: (clubId: string) => [...fanClubKeys.pages(), clubId] as const,
  /** As publicações no ar da página (`GET /fan-clubs/:clubId/posts`). */
  clubPosts: (clubId: string) => [...fanClubKeys.public(), 'clubPosts', clubId] as const,
  /** Todas as listas de artista: o seguir muda o "Seguindo" delas. */
  artistLists: () => [...fanClubKeys.public(), 'artist'] as const,
  /** O card da 1d e o "Ver todos" (`GET /artists/:artistId/fan-clubs`). */
  byArtist: (artistId: string) => [...fanClubKeys.artistLists(), artistId] as const,
  /** "Fã-clubes que sigo" (`GET /me/fan-club-follows`). */
  follows: () => [...fanClubKeys.public(), 'follows'] as const,
  /** "Dos seus fã-clubes" da Início (`GET /me/fan-club-feed`). */
  feed: () => [...fanClubKeys.public(), 'feed'] as const,
};
