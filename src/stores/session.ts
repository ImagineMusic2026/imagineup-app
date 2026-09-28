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
  setSignedIn: (user: SessionUser) => void;
  setSignedOut: () => void;
}

/**
 * Espelho do usuário do Firebase Auth para as telas. Não é persistido: quem
 * guarda a sessão no aparelho é o próprio Firebase. Perfil, pontos e nível
 * vêm da API pelo React Query, não daqui.
 */
export const useSessionStore = create<SessionState>()((set) => ({
  status: 'loading',
  user: null,
  setSignedIn: (user) => set({ status: 'signedIn', user }),
  setSignedOut: () => set({ status: 'signedOut', user: null }),
}));
