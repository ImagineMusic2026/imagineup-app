import { useEffect, useState } from 'react';

import { isFirebaseConfigured } from '@/firebase';
import { appleSignInAvailability, knownAppleSignInAvailability } from '@/services/apple-sign-in';

import { fillMissingProfileName } from '../api';
import { appleSignInErrorKey, settlePendingAppleName, signInWithApple } from '../apple-entry';
import type { SocialProvider } from '../social-entry';
import { useSocialEntry, type SocialEntry } from './use-social-entry';

/**
 * A Apple no núcleo da entrada social: só no iPhone, fora do Expo Go (seção
 * 39). O nome que a Apple mandou vai ao perfil sem nome e, com ele, a chave
 * guardada sai; sem ele, vale o nome da conta, como no Google.
 */
const APPLE: SocialProvider = {
  signIn: signInWithApple,
  signingInKey: 'auth.apple.signingIn',
  errorKey: appleSignInErrorKey,
  settleNewProfileName: (result, profile) =>
    result.profileName !== null
      ? settlePendingAppleName(result.user.uid, profile, result.profileName)
      : fillMissingProfileName(result.user.uid, profile, result.user.displayName),
  logName: 'Apple',
};

/**
 * A entrada com a Apple. A disponibilidade é perguntada uma vez por abertura
 * (o `_layout.tsx` já a pede na abertura): com a resposta conhecida, o botão
 * nasce no primeiro quadro, sem aparecer depois embaixo do teclado.
 */
export function useAppleEntry(): SocialEntry {
  const [available, setAvailable] = useState(
    () => isFirebaseConfigured && knownAppleSignInAvailability() === true,
  );

  useEffect(() => {
    if (!isFirebaseConfigured || available) return undefined;
    let mounted = true;
    void appleSignInAvailability().then((yes) => {
      // Só o sim muda o estado: o não (o Android, o Expo Go) não desenha nada.
      if (mounted && yes) setAvailable(true);
    });
    return () => {
      mounted = false;
    };
  }, [available]);

  return useSocialEntry(APPLE, available);
}
