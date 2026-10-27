import { Platform, Share } from 'react-native';

import { buildInviteUrl } from '@/domains/invites';
import { t } from '@/i18n';

/** O caminho da página pública do fã-clube, o da rota `fa-clube/[clubeId]` (34.9). */
export function fanClubPath(clubId: string): string {
  return `/fa-clube/${encodeURIComponent(clubId)}`;
}

/** A página pública do fã-clube, na pilha raiz, para o `router` (34.9, item 7). */
export function fanClubHref(clubId: string) {
  return { pathname: '/fa-clube/[clubeId]', params: { clubeId: clubId } } as const;
}

/**
 * A tela da publicação (seção 37, 37.9, item 3), na pilha raiz, por cima das
 * abas, no molde do `post/[postId]`: aberta pelo botão dos comentários do
 * card e pelo "Ver comentários" do gestor.
 */
export function fanClubPostHref(postId: string) {
  return {
    pathname: '/fa-clube/publicacao/[publicacaoId]',
    params: { publicacaoId: postId },
  } as const;
}

/**
 * O fã-clube que vai na folha: o id (o link), o nome e o artista da mensagem.
 * Sem o artista (a publicação da Início de um artista que não está nas
 * centrais em cache), a mensagem sai sem ele.
 */
export interface ShareableFanClub {
  id: string;
  name: string;
  artistName: string | null;
}

/**
 * Abre a folha de compartilhar do sistema com o link do fã-clube e o código de
 * convite de quem compartilha (`?ref=`), como o compartilhar da central. O
 * código vai também escrito na mensagem: até os links abrirem o app (34.17),
 * quem não tem o app cai na página Baixar e só fica atribuído se digitar o
 * código. No iOS o link vai no campo próprio; no Android, na mensagem.
 * Devolve se a folha voltou compartilhada.
 */
export async function shareFanClub(
  club: ShareableFanClub,
  inviteCode: string | null,
  linkBase?: string,
): Promise<boolean> {
  const url = buildInviteUrl(inviteCode, fanClubPath(club.id), linkBase);
  let message: string;
  if (club.artistName) {
    const params = { name: club.name, artist: club.artistName };
    message = inviteCode
      ? t('fanClub.mine.shareMessageCode', { ...params, code: inviteCode })
      : t('fanClub.mine.shareMessage', params);
  } else {
    message = inviteCode
      ? t('fanClub.mine.shareMessageCodeNoArtist', { name: club.name, code: inviteCode })
      : t('fanClub.mine.shareMessageNoArtist', { name: club.name });
  }
  const result = await Share.share(
    Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` },
  );
  return result.action === Share.sharedAction;
}
