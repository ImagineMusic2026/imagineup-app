import { Platform, Share } from 'react-native';

/**
 * Abre a folha de compartilhar do sistema com o link do convite, como o
 * compartilhar do post e o da central. Quem credita os pontos é a API, quando
 * alguém abre o link no app ou se cadastra por ele: nada de "+N" na hora. No
 * iOS o link vai no campo próprio (com ele também na mensagem, sairia duas
 * vezes); no Android, na mensagem. Devolve se a folha voltou compartilhada.
 */
export async function shareInvite(url: string, message: string): Promise<boolean> {
  const result = await Share.share(
    Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}` },
  );
  return result.action === Share.sharedAction;
}
