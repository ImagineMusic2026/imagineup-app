import { create } from 'zustand';

interface SuspensionState {
  /** Recusas 403 `account_suspended` das mutações desde o começo da sessão. */
  refusals: number;
  /** Quantas delas pediram o `Alert` "Conta suspensa" (a ação sem texto na tela). */
  alerts: number;
  /**
   * Uma recusa de conta suspensa. `alert` falso na mutação com
   * `meta: { suspendedAlert: false }`: a tela dela mostra a frase.
   */
  noteRefusal: (alert: boolean) => void;
  /** O fim da sessão (`use-auth-listener.ts`). */
  reset: () => void;
}

/**
 * As recusas de conta suspensa, anotadas pelo `MutationCache` do Query
 * (`services/query/client.ts`), fora do disco. O `SuspensionWatcher` do
 * `profile` escuta: busca o perfil de novo (o aviso fixo da 1b, da 1e e dos
 * Ajustes aparece) e, quando a recusa pede, abre o `Alert` (29.11, frente E).
 */
export const useSuspensionStore = create<SuspensionState>()((set) => ({
  refusals: 0,
  alerts: 0,
  noteRefusal: (alert) =>
    set((state) => ({
      refusals: state.refusals + 1,
      alerts: alert ? state.alerts + 1 : state.alerts,
    })),
  reset: () => set({ refusals: 0, alerts: 0 }),
}));
