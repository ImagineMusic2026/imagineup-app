import type { ArtistDetails } from '@/domains/artists';
import { useMyInviteQuery } from '@/domains/profile';

import { shareArtist } from '../share-artist';

/**
 * Compartilhar a central com o código de convite do fã. Se o código ainda não
 * chegou (offline na primeira abertura), sai o link puro: compartilhar
 * funciona, só não rende pontos.
 */
export function useShareArtist(): (artist: Pick<ArtistDetails, 'id' | 'name'>) => void {
  const invite = useMyInviteQuery();
  const code = invite.data?.code ?? null;
  return (artist) => {
    // Fechar a folha sem escolher ninguém também resolve; erro do sistema não tem o que mostrar.
    shareArtist(artist, code).catch(() => undefined);
  };
}
