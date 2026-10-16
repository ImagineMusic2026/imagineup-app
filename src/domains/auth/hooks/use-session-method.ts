import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore, type SignInMethod } from '@/stores/session';

/**
 * Por onde a sessão entrou (seção 33 de docs/arquitetura-api.md, decisões 9,
 * 12 e 14): o `signInProvider` do token, que chega depois da sessão; sem ele
 * (ainda não chegou, ou o token não renovou sem rede), o último jeito de entrar
 * do aparelho. `null`: o token veio de outro jeito (o Admin SDK, o seed), ou o
 * aparelho não tem entrada gravada. A conferência da Apple, a exclusão da conta
 * e a linha "Sair" dos Ajustes decidem por ele.
 */
export function useSessionMethod(): SignInMethod | null {
  const signInProvider = useSessionStore((state) => state.user?.signInProvider);
  const lastSignInMethod = usePreferencesStore((state) => state.lastSignInMethod);
  return signInProvider !== undefined ? signInProvider : lastSignInMethod;
}
