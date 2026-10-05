import { Platform, Share } from 'react-native';

import { buildInviteUrl } from '@/domains/invites';
import { t } from '@/i18n';

import type { Post } from './types';

/** Caminho do post no app, o mesmo da rota `post/[postId]`. */
export function postPath(postId: string): string {
  return `/post/${encodeURIComponent(postId)}`;
}

/**
 * Abre a folha de compartilhar do sistema com o link do post e o código de
 * convite do fã (`?ref=`), que o `+native-intent` lê do outro lado. Quem
 * credita os pontos é a API, quando alguém abre o link no app ou se cadastra
 * por ele: nada de "+N" na hora. No iOS o link vai no campo próprio (com ele
 * também na mensagem, sairia duas vezes); no Android, na mensagem. Devolve se
 * a folha voltou compartilhada (no Android, o sistema sempre diz que sim; no
 * iOS, cancelar volta `dismissedAction`).
 */
export async function sharePost(
  post: Pick<Post, 'id' | 'artist'>,
  inviteCode: string | null,
  linkBase?: string,
): Promise<boolean> {
  const url = buildInviteUrl(inviteCode, postPath(post.id), linkBase);
  const message = t('post.shareMessage', { artist: post.artist.name });
  const result = await Share.share(
    Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` },
  );
  return result.action === Share.sharedAction;
}
