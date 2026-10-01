/**
 * A chave inclui tudo que muda o resultado. Toda lista de posts fica debaixo
 * de `postKeys.all` (a curtida e a contagem de comentários chegam a ela).
 *
 * Fica num arquivo sem API: o domínio `artists` invalida o mural depois de
 * entrar numa central e importa daqui direto, porque pelo index seria um
 * ciclo (os posts leem o perfil, que lê as centrais de lá).
 */
export const postKeys = {
  all: ['posts'] as const,
  feed: () => [...postKeys.all, 'feed'] as const,
  /** Posts de uma central, para a grade da 1d. */
  byArtist: (artistId: string) => [...postKeys.all, 'artist', artistId] as const,
  detail: (postId: string) => [...postKeys.all, 'detail', postId] as const,
  comments: (postId: string) => [...postKeys.all, 'comments', postId] as const,
};
