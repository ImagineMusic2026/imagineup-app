import type { Href } from 'expo-router';

import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

export interface SessionGate {
  /** Dá para mostrar a navegação (preferências lidas e sessão conhecida ou presumida). */
  ready: boolean;
  signedIn: boolean;
  onboarded: boolean;
}

/**
 * Quem pode ir para onde. Enquanto o Firebase confirma a sessão, um aparelho
 * que já tinha sessão (`lastSessionUid`) entra como logado, com o cache salvo;
 * se a sessão tiver caído, o listener derruba e os guards corrigem.
 *
 * Enquanto um fluxo das telas de conta segura o fã (`authHolds`), a conta já
 * existe e está logada, mas ele ainda conta como fora: sem isso, o guard
 * tiraria a tela de cadastro no primeiro passo, antes de o nome ir para a
 * conta e de o perfil nascer, e trocaria a pilha antes da saída em fade.
 */
export function useSessionGate(): SessionGate {
  const status = useSessionStore((state) => state.status);
  const held = useSessionStore((state) => state.authHolds > 0);
  const hydrated = usePreferencesStore((state) => state.hydrated);
  const lastSessionUid = usePreferencesStore((state) => state.lastSessionUid);
  const onboarded = usePreferencesStore((state) => state.hasCompletedOnboarding);
  const presumed = status === 'loading' && !!lastSessionUid;

  return {
    ready: hydrated && (status !== 'loading' || presumed),
    signedIn: (status === 'signedIn' || presumed) && !held,
    onboarded,
  };
}

/**
 * A primeira tela que os guards deixam abrir. Navegar para uma rota barrada por
 * `Stack.Protected` não dá erro nem faz nada, então quem sai de uma tela fora
 * dos guards (convite, não encontrado) precisa mirar numa rota permitida.
 */
export function entryRoute({ signedIn, onboarded }: SessionGate, destination: Href = '/'): Href {
  if (!signedIn) return '/entrar';
  if (!onboarded) return '/artistas';
  return destination;
}
