import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { bindPendingInvite, readPendingInvite } from '@/domains/invites';
import { t, type TranslationKey } from '@/i18n';
import { isAppleSignInAvailable } from '@/services/apple-sign-in';
import { isGoogleSignInAvailable } from '@/services/google-sign-in';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { fillMissingProfileName, toSessionUser, waitForProfile, type NewProfile } from '../api';
import { EXISTING_ACCOUNT_CHECK_MS } from '../consts';
import {
  settlePendingAppleName,
  signInWithApple,
  signInWithGoogle,
  socialErrorMessageKey,
  type SocialMethod,
  type SocialSignInResult,
} from '../social';
import { playAuthExit } from './use-auth-exit';
import { settleOnboarding } from './use-sign-in';
import { parkSignUpHold, releaseHeldSignUp } from './use-sign-up';

/**
 * Como a entrada pelo provedor terminou:
 * - `done`: o fã sai das telas de conta (o guard troca a pilha);
 * - `canceled`: a folha do provedor foi fechada, sem erro;
 * - `askInvite`: a conta nova, sem convite de link, segue para o passo "Tem
 *   um código de convite?", com o fã ainda seguro (`parkSignUpHold`);
 * - `link`: o Google esbarrou numa conta de senha com o mesmo e-mail, e a
 *   entrada segue pelo modo "ligar" da tela de entrar com e-mail.
 */
export type SocialSignInOutcome =
  | { status: 'done' }
  | { status: 'canceled' }
  | { status: 'askInvite' }
  | { status: 'link'; email: string };

type SignedIn = Extract<SocialSignInResult, { kind: 'signedIn' }>;

const SIGNING_IN: Record<SocialMethod, TranslationKey> = {
  apple: 'auth.social.signingInApple',
  google: 'auth.social.signingInGoogle',
};

function warnName(error: unknown): void {
  if (__DEV__) console.warn('[auth] O nome não foi para o perfil na entrada social.', error);
}

/**
 * O nome da conta que nasceu agora, no perfil sem nome: o da Apple guardado
 * (que sai do aparelho quando o perfil tem nome) ou o da sessão (o Google
 * chega com nome). Sem esperar a gravação, como no cadastro.
 */
function fillNewProfileName({ user, appleName }: SignedIn, profile: NewProfile | null): void {
  if (appleName !== null) {
    void settlePendingAppleName(user.uid, profile, appleName).catch(warnName);
    return;
  }
  void fillMissingProfileName(user.uid, profile, user.displayName).catch(warnName);
}

/**
 * A conta nova segue o cadastro (seção 33, decisão 7): nunca escolheu
 * artistas; o convite do link guardado fica preso a ela com o código do
 * próprio pendente (o código vazio apagaria o pendente); o perfil é esperado
 * (até 20 s) e recebe o nome que faltar. Sem convite de link, o passo do
 * convite.
 */
async function finishNewAccount(result: SignedIn): Promise<'done' | 'askInvite'> {
  const { user, method } = result;
  usePreferencesStore.getState().resetOnboarding();
  useSessionStore.getState().setSignedIn({ ...toSessionUser(user), signInProvider: method });
  const pending = await readPendingInvite().catch(() => null);
  const bound = pending ? await bindPendingInvite(user.uid, pending.code).catch(() => null) : null;
  const profile = await waitForProfile(user.uid);
  fillNewProfileName(result, profile);
  return bound ? 'done' : 'askInvite';
}

/**
 * A conta que já existe segue o entrar: o nome guardado da Apple vai para o
 * perfil sem nome (o perfil lido em até 3 s), e as centrais decidem a 1l.
 * O nome da sessão do Google não vai para o perfil de uma conta que já existe
 * (33.18, etapa 5): a edição do perfil resolve.
 */
async function finishExistingAccount({ user, method, appleName }: SignedIn): Promise<'done'> {
  useSessionStore.getState().setSignedIn({ ...toSessionUser(user), signInProvider: method });
  const name =
    appleName === null
      ? Promise.resolve()
      : waitForProfile(user.uid, EXISTING_ACCOUNT_CHECK_MS).then((profile) => {
          void settlePendingAppleName(user.uid, profile, appleName).catch(warnName);
        });
  await Promise.all([name, settleOnboarding(user.uid)]);
  return 'done';
}

/**
 * Entrar com a Apple ou com o Google (seção 33 de docs/arquitetura-api.md), no
 * molde do `useSignUp` e do `useSignIn`. O fã fica seguro nas telas de conta
 * desde antes da folha do provedor (a sessão chega pelo listener no meio, e o
 * guard trocaria a pilha antes dos passos); cancelar solta, sem erro nem
 * toque. A conta nova segue o cadastro, e a que já existe segue o entrar. No
 * fim, o último jeito de entrar fica no aparelho, e as telas de conta saem em
 * fade antes de soltar o fã.
 */
export function useSocialSignIn() {
  return useMutation<SocialSignInOutcome, Error, SocialMethod>({
    mutationFn: async (method) => {
      // Uma trava estacionada de outra entrada (o passo do convite) não fica.
      releaseHeldSignUp();
      const release = useSessionStore.getState().holdAuth();
      let parked = false;
      try {
        const result = method === 'apple' ? await signInWithApple() : await signInWithGoogle();
        if (result === null) return { status: 'canceled' };
        if (result.kind === 'link') return { status: 'link', email: result.email };
        const next = result.isNewUser
          ? await finishNewAccount(result)
          : await finishExistingAccount(result);
        usePreferencesStore.getState().setLastSignInMethod(method);
        if (next === 'askInvite') {
          parkSignUpHold(release);
          parked = true;
          return { status: 'askInvite' };
        }
        haptics.trigger('success');
        await playAuthExit();
        return { status: 'done' };
      } finally {
        if (!parked) release();
      }
    },
    onMutate: (method) => {
      AccessibilityInfo.announceForAccessibility(t(SIGNING_IN[method]));
    },
    onError: (error) => {
      haptics.trigger('error');
      // O erro aparece embaixo dos botões; o leitor de tela precisa ouvir também.
      AccessibilityInfo.announceForAccessibility(t(socialErrorMessageKey(error)));
    },
    // Entrar não entra na fila offline: sem rede, o erro aparece na hora.
    networkMode: 'always',
    retry: false,
  });
}

/** Os botões de marca que a 1k mostra neste aparelho. */
export interface SocialProviders {
  apple: boolean;
  google: boolean;
}

/**
 * Quais jeitos de entrar por um provedor este aparelho tem (seção 33, decisões
 * 2, 4 e 16): a Apple só no iOS, com o módulo, e fora do Expo Go (ou com os
 * emuladores), conferida de forma assíncrona; o Google fora do Expo Go, com o
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` e, no iOS, com o ID do cliente iOS. Sem a
 * variável do Google (o provedor ainda não ligado nos consoles), o botão dele
 * não aparece. A Apple começa escondida e aparece quando o sistema responde.
 */
export function useSocialProviders(): SocialProviders {
  const [apple, setApple] = useState(false);
  const [google] = useState(isGoogleSignInAvailable);

  useEffect(() => {
    let active = true;
    void isAppleSignInAvailable().then((available) => {
      if (active) setApple(available);
    });
    return () => {
      active = false;
    };
  }, []);

  return { apple, google };
}
