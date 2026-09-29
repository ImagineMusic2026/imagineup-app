import { useMyInviteQuery } from '@/domains/profile';

import { sharePost } from '../share-post';
import type { Post } from '../types';

/**
 * Compartilhar um post com o código de convite do fã. Se o código ainda não
 * chegou (offline na primeira abertura), sai o link puro: compartilhar
 * funciona, só não rende pontos.
 */
export function useSharePost(): (post: Pick<Post, 'id' | 'artist'>) => void {
  const invite = useMyInviteQuery();
  const code = invite.data?.code ?? null;
  return (post) => {
    // Fechar a folha sem escolher ninguém também resolve; erro do sistema não tem o que mostrar.
    sharePost(post, code).catch(() => undefined);
  };
}
