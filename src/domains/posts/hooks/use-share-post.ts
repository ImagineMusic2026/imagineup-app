import { inviteLinkId } from '@/domains/invites';
import { useMyInviteQuery, useRegisterInviteLinkMutation } from '@/domains/profile';
import { createIdempotencyKey } from '@/utils/id';

import { sharePost } from '../share-post';
import type { Post } from '../types';

/**
 * O "+N" do compartilhar de um post: os pontos por visita da configuração
 * (`pointsPerVisit` do convite, o mesmo da sheet "Gerar meu link"). O
 * `sharePointsPerVisit` do post (de exemplo até o bloco 6) só diz se o
 * compartilhar rende (`null` ou 0 não rende) e vale enquanto o convite não
 * chegou.
 */
export function useSharePoints(post: Pick<Post, 'sharePointsPerVisit'>): number {
  const invite = useMyInviteQuery();
  if (!post.sharePointsPerVisit || post.sharePointsPerVisit <= 0) return 0;
  return invite.data?.pointsPerVisit ?? post.sharePointsPerVisit;
}

/**
 * Compartilhar um post com o código de convite do fã. Se o código ainda não
 * chegou (offline na primeira abertura), sai o link puro: compartilhar
 * funciona, só não rende pontos. Com o código e a folha voltando
 * compartilhada, o link conta nos "links criados" do Perfil (`post:<id>`).
 */
export function useSharePost(): (post: Pick<Post, 'id' | 'artist'>) => void {
  const invite = useMyInviteQuery();
  const register = useRegisterInviteLinkMutation();
  const code = invite.data?.code ?? null;
  const linkBase = invite.data?.linkBase;
  return (post) => {
    // Fechar a folha sem escolher ninguém também resolve; erro do sistema não tem o que mostrar.
    sharePost(post, code, linkBase)
      .then((shared) => {
        if (!shared || !code) return;
        register.mutate({
          linkId: inviteLinkId({ kind: 'post', postId: post.id }),
          idempotencyKey: createIdempotencyKey(),
        });
      })
      .catch(() => undefined);
  };
}
