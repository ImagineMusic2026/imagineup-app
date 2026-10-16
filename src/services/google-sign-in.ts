import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { googleWebClientId } from '@/config/env';
import { isExpoGo } from '@/config/runtime';

/**
 * Entrar com o Google (seção 33 de docs/arquitetura-api.md, decisões 3, 10 e
 * 16), pelo `@react-native-google-signin/google-signin` original. Este é o
 * único arquivo do app que carrega o pacote: o módulo nativo dele não existe no
 * Expo Go, e o import derruba o app. Por isso ele vem por `require`, só fora do
 * Expo Go e só com o Google ligado; os tipos vêm por `typeof import`, que não
 * carrega nada.
 */
type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

/** Por que o Google não entregou o token. */
export type GoogleSignInFailure =
  /** O Google está desligado neste app (sem a variável, no Expo Go, no iOS sem o ID do cliente). */
  | 'unavailable'
  /** O Android sem o Google Play Services em dia. */
  | 'playServices'
  /** O pacote respondeu sem o `idToken` (o `webClientId` errado). */
  | 'noIdToken';

export class GoogleSignInError extends Error {
  constructor(readonly reason: GoogleSignInFailure) {
    super(`Entrar com o Google: ${reason}`);
    this.name = 'GoogleSignInError';
  }
}

/** O que a folha do Google devolve para o Firebase e para o modo "ligar". */
export interface GoogleIdToken {
  idToken: string;
  /** O e-mail da conta Google escolhida (o modo "ligar" usa este, e não o do erro do Firebase). */
  email: string;
}

/**
 * O ID do cliente iOS do Google, que o `app.config.ts` põe no
 * `extra.googleIosClientId` quando a constante está preenchida. Sem ele, o
 * `configure` e o `signIn` do pacote recusam no iOS (33.18, etapa 3b).
 */
function googleIosClientId(): string | undefined {
  const value: unknown = Constants.expoConfig?.extra?.googleIosClientId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * O botão do Google aparece: fora do Expo Go, com o `webClientId` (o
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`) e, no iOS, com o ID do cliente iOS. Sem
 * a variável (o Google ainda não ligado nos consoles), nunca.
 */
export function isGoogleSignInAvailable(): boolean {
  if (isExpoGo() || !googleWebClientId) return false;
  return Platform.OS !== 'ios' || googleIosClientId() !== undefined;
}

let loaded: GoogleSignInModule | null = null;

/** O pacote, carregado e configurado uma vez. Com o Google desligado, `null`, sem carregar nada. */
function loadGoogle(): GoogleSignInModule | null {
  if (!isGoogleSignInAvailable()) return null;
  if (loaded) return loaded;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- só aqui e só fora do Expo Go: o import estático derruba o Expo Go (seção 33, decisão 16).
  const google = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  google.GoogleSignin.configure({
    webClientId: googleWebClientId,
    iosClientId: googleIosClientId(),
  });
  loaded = google;
  return google;
}

/**
 * Abre a folha do Google e devolve o `idToken` e o e-mail da conta escolhida.
 * Cancelada (ou com outra entrada do Google já aberta), `null`, sem erro. No
 * Android, confere antes o Google Play Services, com o aviso do sistema para
 * atualizar; sem ele, `GoogleSignInError('playServices')`.
 */
export async function googleIdToken(): Promise<GoogleIdToken | null> {
  const google = loadGoogle();
  if (!google) throw new GoogleSignInError('unavailable');
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = google;
  try {
    if (Platform.OS === 'android') {
      const ready = await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      if (!ready) throw new GoogleSignInError('playServices');
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null;
    const { idToken, user } = response.data;
    if (!idToken) throw new GoogleSignInError('noIdToken');
    return { idToken, email: user.email };
  } catch (error) {
    if (!isErrorWithCode(error)) throw error;
    switch (error.code) {
      case statusCodes.SIGN_IN_CANCELLED:
      case statusCodes.IN_PROGRESS:
        return null;
      case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
        throw new GoogleSignInError('playServices');
      default:
        throw error;
    }
  }
}

/**
 * Sai do Google no aparelho, para o seletor de contas aparecer na próxima vez
 * (seção 33, decisão 10). Nunca lança: sair do app não espera o Google.
 */
export async function signOutGoogle(): Promise<void> {
  const google = loadGoogle();
  if (!google) return;
  try {
    await google.GoogleSignin.signOut();
  } catch {
    // O Firebase já saiu; o Google fica para a próxima entrada.
  }
}

/**
 * Tira do ImagineUP o acesso à conta Google e sai dela no aparelho, depois de a
 * conta ser excluída (seção 33, decisão 12). Nunca lança: a exclusão já passou.
 */
export async function revokeGoogleAccess(): Promise<void> {
  const google = loadGoogle();
  if (!google) return;
  try {
    await google.GoogleSignin.revokeAccess();
  } catch {
    // A conta já foi excluída; a revogação que falha não volta atrás.
  }
  await signOutGoogle();
}
