import type { ArtistDetails } from '@/domains/artists';
import { inviteLinkId } from '@/domains/invites';
import { useMyInviteQuery, useRegisterInviteLinkMutation } from '@/domains/profile';
import { createIdempotencyKey } from '@/utils/id';

import { shareArtist } from '../share-artist';

/**
 * Compartilhar a central com o código de convite do fã. Se o código ainda não
 * chegou (offline na primeira abertura), sai o link puro: compartilhar
 * funciona, só não rende pontos. Com o código e a folha voltando
 * compartilhada, o link conta nos "links criados" do Perfil (`artist:<id>`).
 */
export function useShareArtist(): (artist: Pick<ArtistDetails, 'id' | 'name'>) => void {
  const invite = useMyInviteQuery();
  const register = useRegisterInviteLinkMutation();
  const code = invite.data?.code ?? null;
  const linkBase = invite.data?.linkBase;
  return (artist) => {
    // Fechar a folha sem escolher ninguém também resolve; erro do sistema não tem o que mostrar.
    shareArtist(artist, code, linkBase)
      .then((shared) => {
        if (!shared || !code) return;
        register.mutate({
          linkId: inviteLinkId({ kind: 'artist', artistId: artist.id }),
          idempotencyKey: createIdempotencyKey(),
        });
      })
      .catch(() => undefined);
  };
}
