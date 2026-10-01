import { Platform, Share } from 'react-native';

/**
 * Abre a folha de compartilhar do sistema com o link do convite, como o
 * compartilhar do post e o da central. Quem credita os pontos é a API, quando
 * alguém abre o link ou se cadastra por ele: nada de "+N" na hora. No iOS o
 * link vai no campo próprio (com ele também na mensagem, sairia duas vezes);
 * no Android, na mensagem.
 */
export async function shareInvite(url: string, message: string): Promise<void> {
  await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` });
}
