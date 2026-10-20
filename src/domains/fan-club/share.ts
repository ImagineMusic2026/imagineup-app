import { Platform, Share } from 'react-native';

import { buildInviteUrl } from '@/domains/invites';
import { t } from '@/i18n';

import type { MyFanClubClub } from './types';

/** O caminho da página pública do fã-clube, o da rota `fa-clube/[clubeId]` (34.9). */
export function fanClubPath(clubId: string): string {
  return `/fa-clube/${encodeURIComponent(clubId)}`;
}

/**
 * Abre a folha de compartilhar do sistema com o link do fã-clube e o código de
 * convite do gestor (`?ref=`), como o compartilhar da central. O código vai
 * também escrito na mensagem: até os links abrirem o app (34.17), quem não
 * tem o app cai na página Baixar e só fica atribuído se digitar o código. No
 * iOS o link vai no campo próprio; no Android, na mensagem. Devolve se a folha
 * voltou compartilhada.
 */
export async function shareFanClub(
  club: Pick<MyFanClubClub, 'id' | 'name' | 'artistName'>,
  inviteCode: string | null,
  linkBase?: string,
): Promise<boolean> {
  const url = buildInviteUrl(inviteCode, fanClubPath(club.id), linkBase);
  const params = { name: club.name, artist: club.artistName };
  const message = inviteCode
    ? t('fanClub.mine.shareMessageCode', { ...params, code: inviteCode })
    : t('fanClub.mine.shareMessage', params);
  const result = await Share.share(
    Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` },
  );
  return result.action === Share.sharedAction;
}
