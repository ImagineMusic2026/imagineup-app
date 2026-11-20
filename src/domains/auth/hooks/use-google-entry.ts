import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { sourceOf } from '@/config/data-source';
import { bindPendingInvite, readPendingInvite } from '@/domains/invites';
import { getFirebaseAuth, isFirebaseConfigured } from '@/firebase';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { isGoogleSignInAvailable } from '@/services/google-sign-in';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { fillMissingProfileName, SessionEndedError, toSessionUser, waitForProfile } from '../api';
import { googleSignInErrorKey, signInWithGoogle } from '../google-entry';
import { playAuthExit } from './use-auth-exit';
import { holdGoogleInvite, releaseHeldSignUp } from './use-sign-up';

export type GoogleEntryOutcome =
  | { status: 'done' | 'canceled' | 'askInvite' }
  | { status: 'link'; email: string };

const EXISTING_ONBOARDING_WAIT_MS = 3_000;

/** Consulta as centrais da conta que acabou de entrar, sem segurar a navegação sem rede. */
async function restoreOnboarding(uid: string): Promise<void> {
  if (sourceOf('artists') !== 'api') return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, EXISTING_ONBOARDING_WAIT_MS);
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

export function useGoogleEntry() {
  const active = useRef(false);
  const available = isFirebaseConfigured && isGoogleSignInAvailable();
  const mutation = useMutation<GoogleEntryOutcome, Error, void>({
    mutationFn: async () => {
      releaseHeldSignUp();
      const release = useSessionStore.getState().holdAuth();
      let inviteHeld = false;
      try {
        const result = await signInWithGoogle();
        if (result === null) return { status: 'canceled' };
        if (result.kind === 'link') return { status: 'link', email: result.email };

        const { user, isNewUser } = result;
        if (getFirebaseAuth().currentUser?.uid !== user.uid) throw new SessionEndedError();
        if (isNewUser) usePreferencesStore.getState().resetOnboarding();
        useSessionStore.getState().setSignedIn(toSessionUser(user));

        if (isNewUser) {
          const pending = await readPendingInvite().catch(() => null);
          const bound = pending ? await bindPendingInvite(user.uid, pending.code).catch(() => null) : null;
          const profile = await waitForProfile(user.uid).catch(() => null);
          if (getFirebaseAuth().currentUser?.uid !== user.uid) throw new SessionEndedError();
          void fillMissingProfileName(user.uid, profile, user.displayName).catch((error: unknown) => {
            if (__DEV__) console.warn('[auth] O nome não foi para o perfil na entrada com Google.', error);
          });
          if (bound === null) {
            holdGoogleInvite(user.uid, release);
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
    onMutate: () => AccessibilityInfo.announceForAccessibility(t('auth.google.signingIn')),
    onError: (error) => {
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(googleSignInErrorKey(error)));
    },
    networkMode: 'always',
    retry: false,
  });

  async function signIn(): Promise<GoogleEntryOutcome | undefined> {
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
    error: mutation.error ? googleSignInErrorKey(mutation.error) : null,
    reset: mutation.reset,
  };
}
