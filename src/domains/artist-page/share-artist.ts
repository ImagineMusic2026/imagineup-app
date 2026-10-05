import { Platform, Share } from 'react-native';

import type { ArtistDetails } from '@/domains/artists';
import { buildInviteUrl } from '@/domains/invites';
import { t } from '@/i18n';

/** Caminho da central no app, o mesmo da rota `artista/[artistaId]`. */
export function artistPath(artistId: string): string {
  return `/artista/${encodeURIComponent(artistId)}`;
}

/**
 * Abre a folha de compartilhar do sistema com o link da central e o código de
 * convite do fã (`?ref=`), que o `+native-intent` lê do outro lado, como o
 * compartilhar do post. Quem credita os pontos é a API, quando alguém abre o
 * link no app ou se cadastra por ele. No iOS o link vai no campo próprio; no
 * Android, na mensagem. Devolve se a folha voltou compartilhada.
 */
export async function shareArtist(
  artist: Pick<ArtistDetails, 'id' | 'name'>,
  inviteCode: string | null,
  linkBase?: string,
): Promise<boolean> {
  const url = buildInviteUrl(inviteCode, artistPath(artist.id), linkBase);
  const message = t('artist.shareMessage', { name: artist.name });
  const result = await Share.share(
    Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` },
  );
  return result.action === Share.sharedAction;
}
