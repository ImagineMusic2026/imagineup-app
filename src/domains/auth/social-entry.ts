import type { User } from 'firebase/auth';

import type { TranslationKey } from '@/i18n';

import type { NewProfile } from './api';

/**
 * A entrada por um provedor, sem React (seção 39 de docs/arquitetura-api.md):
 * o Google no Android e a Apple no iPhone. Cada um abre a folha dele e troca o
 * token pela sessão; o resto da entrada (o convite, o perfil, as centrais, a
 * saída) é do núcleo dividido, o `useSocialEntry`.
 */

/** Como a entrada pelo provedor terminou, quando a folha não foi cancelada. */
export type SocialSignInResult =
  | {
      kind: 'signedIn';
      user: User;
      /** A conta nasceu agora (segue como cadastro); falso, ela já existia. */
      isNewUser: boolean;
      /** O nome que vai ao perfil que nasceu sem nome: o do provedor, ou o guardado da Apple. */
      profileName: string | null;
    }
  /** Só o Google: fora do Gmail, com uma conta de senha no mesmo e-mail (o modo "ligar"). */
  | { kind: 'link'; email: string };

export type SocialSignedIn = Extract<SocialSignInResult, { kind: 'signedIn' }>;

/** O que o núcleo da entrada pede a cada provedor. */
export interface SocialProvider {
  /** Abre a folha e entra. Cancelada, `null`. */
  signIn: () => Promise<SocialSignInResult | null>;
  /** O anúncio do início da entrada, para o leitor de tela. */
  signingInKey: TranslationKey;
  /** A frase do erro da entrada. */
  errorKey: (error: unknown) => TranslationKey;
  /** O nome que vai ao perfil que nasceu sem nome; quem chama não espera. */
  settleNewProfileName: (result: SocialSignedIn, profile: NewProfile | null) => Promise<unknown>;
  /** O nome do provedor nos avisos de desenvolvimento. */
  logName: 'Google' | 'Apple';
}
