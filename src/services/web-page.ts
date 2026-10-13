import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { SUPPORT_EMAIL } from '@/config/links';
import { colors } from '@/theme';

/**
 * Abre uma página no navegador dentro do app (termos, privacidade, o
 * regulamento das recompensas). No Android, na mesma tarefa do app: fechar a
 * aba volta para a tela de onde o fã veio, e não para outra tarefa (no Expo
 * Go, a tela inicial dele). A falha não tem o que mostrar.
 */
export function openWebPage(url: string): void {
  WebBrowser.openBrowserAsync(url, {
    toolbarColor: colors.background,
    controlsColor: colors.accent,
    createTask: false,
  }).catch(() => undefined);
}

/** O endereço `mailto:` do contato, com o assunto codificado e nenhum dado do fã. */
export function supportEmailUrl(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/**
 * Abre o app de e-mail com o contato da equipe. Devolve se abriu: sem app de
 * e-mail, a tela mostra o endereço (selecionável). Sem `canOpenURL`, que no
 * Android 11 ou mais pede `<queries>` no manifesto (nativo, fora do EAS
 * Update): o `openURL` com `catch` diz o mesmo.
 */
export async function openSupportEmail(subject: string): Promise<boolean> {
  try {
    await Linking.openURL(supportEmailUrl(subject));
    return true;
  } catch {
    return false;
  }
}
