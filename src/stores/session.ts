import { create } from 'zustand';

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /**
   * Quantos fluxos seguram o fã nas telas de conta (grupo `(auth)`) com a
   * conta já logada; acima de zero, os guards o tratam como fora. O cadastro
   * segura do primeiro passo até o perfil (`users/{uid}`) nascer, porque a
   * conta nasce logada antes de o nome ir para ela; entrar e cadastrar seguram
   * até o fim da saída em fade das telas de conta. É um contador, e não um
   * liga e desliga, para um fluxo nunca soltar o que outro segurou.
   */
  authHolds: number;
  setSignedIn: (user: SessionUser) => void;
  setSignedOut: () => void;
  /** Segura o fã nas telas de conta. Devolve a função que solta (vale uma vez só). */
  holdAuth: () => () => void;
}

/**
 * Espelho do usuário do Firebase Auth para as telas. Não é persistido: quem
 * guarda a sessão no aparelho é o próprio Firebase. Perfil, pontos e nível
 * vêm da API pelo React Query, não daqui.
 */
export const useSessionStore = create<SessionState>()((set) => ({
  status: 'loading',
  user: null,
  authHolds: 0,
  setSignedIn: (user) => set({ status: 'signedIn', user }),
  setSignedOut: () => set({ status: 'signedOut', user: null }),
  holdAuth: () => {
    set((state) => ({ authHolds: state.authHolds + 1 }));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((state) => ({ authHolds: Math.max(0, state.authHolds - 1) }));
    };
  },
}));
