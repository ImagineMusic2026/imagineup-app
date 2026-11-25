import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { sourceOf } from '@/config/data-source';
import { bindPendingInvite, readPendingInvite } from '@/domains/invites';
import { getFirebaseAuth } from '@/firebase';
import { t, type TranslationKey } from '@/i18n';
import { api } from '@/services/api';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { SessionEndedError, toSessionUser, waitForProfile } from '../api';
import { EXISTING_ACCOUNT_CHECK_MS } from '../consts';
import type { SocialProvider } from '../social-entry';
import { playAuthExit } from './use-auth-exit';
import { holdSocialInvite, releaseHeldSignUp } from './use-sign-up';

/** Como a entrada pelo provedor terminou, para a tela decidir o passo seguinte. */
export type SocialEntryOutcome =
  { status: 'done' | 'canceled' | 'askInvite' } | { status: 'link'; email: string };

/** A entrada por um provedor, como as telas de conta a usam. */
export interface SocialEntry {
  /** O botão do provedor aparece. */
  available: boolean;
  isPending: boolean;
  /** Entra pelo provedor. Indisponível, ou já em curso, `undefined` sem fazer nada. */
  signIn: () => Promise<SocialEntryOutcome | undefined>;
  /** A frase do último erro, ou `null`. */
  error: TranslationKey | null;
  reset: () => void;
}

/** Consulta as centrais da conta que acabou de entrar, sem segurar a navegação sem rede. */
async function restoreOnboarding(uid: string): Promise<void> {
  if (sourceOf('artists') !== 'api') return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, EXISTING_ACCOUNT_CHECK_MS);
  });
  try {
    const request = api
      .get<unknown>('/me/centrals', { sessionUid: uid, signal: controller.signal })
      .then(({ data }) => (Array.isArray(data) ? data : null))
      .catch(() => null);
    const centrals = await Promise.race([request, deadline]);
    if (centrals === null || getFirebaseAuth().currentUser?.uid !== uid) return;
    const preferences = usePreferencesStore.getState();
    if (centrals.length > 0) preferences.completeOnboarding();
    else preferences.resetOnboarding();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * O núcleo da entrada pelo Google (Android) e pela Apple (iPhone), seção 39 de
 * docs/arquitetura-api.md. O `holdAuth` segura o fã nas telas de conta antes
 * da folha; a sessão é conferida antes e depois dela (o `signIn` do provedor)
 * e depois de cada espera. A conta nova amarra o convite do link, espera o
 * perfil e, sem convite, para na pergunta do código (`/codigo-de-convite`),
 * com a trava guardada pelo `holdSocialInvite`; a que já existe confere as
 * centrais para pular a escolha de artistas. A trava sai no fim, menos a que
 * ficou guardada para a pergunta do código. Um toque por vez.
 */
export function useSocialEntry(provider: SocialProvider, available: boolean): SocialEntry {
  const active = useRef(false);
  const mutation = useMutation<SocialEntryOutcome, Error, void>({
    mutationFn: async () => {
      releaseHeldSignUp();
      const release = useSessionStore.getState().holdAuth();
      let inviteHeld = false;
      try {
        const result = await provider.signIn();
        if (result === null) return { status: 'canceled' };
        if (result.kind === 'link') return { status: 'link', email: result.email };

        const { user, isNewUser } = result;
        if (getFirebaseAuth().currentUser?.uid !== user.uid) throw new SessionEndedError();
        if (isNewUser) usePreferencesStore.getState().resetOnboarding();
        useSessionStore.getState().setSignedIn(toSessionUser(user));

        if (isNewUser) {
          const pending = await readPendingInvite().catch(() => null);
          const bound = pending
            ? await bindPendingInvite(user.uid, pending.code).catch(() => null)
            : null;
          const profile = await waitForProfile(user.uid).catch(() => null);
          if (getFirebaseAuth().currentUser?.uid !== user.uid) throw new SessionEndedError();
          void provider.settleNewProfileName(result, profile).catch((error: unknown) => {
            if (__DEV__) {
              console.warn(
                `[auth] O nome não foi para o perfil na entrada com ${provider.logName}.`,
                error,
              );
            }
          });
          if (bound === null) {
            holdSocialInvite(user.uid, release);
            inviteHeld = true;
            return { status: 'askInvite' };
          }
        } else {
          await restoreOnboarding(user.uid);
        }

        haptics.trigger('success');
        await playAuthExit();
        return { status: 'done' };
      } finally {
        if (!inviteHeld) release();
      }
    },
    onMutate: () => AccessibilityInfo.announceForAccessibility(t(provider.signingInKey)),
    onError: (error) => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(provider.errorKey(error)));
    },
    networkMode: 'always',
    retry: false,
  });

  async function signIn(): Promise<SocialEntryOutcome | undefined> {
    if (!available || active.current) return undefined;
    active.current = true;
    try {
      return await mutation.mutateAsync();
    } catch {
      return undefined;
    } finally {
      active.current = false;
    }
  }

  return {
    available,
    isPending: mutation.isPending,
    signIn,
    error: mutation.error ? provider.errorKey(mutation.error) : null,
    reset: mutation.reset,
  };
}
