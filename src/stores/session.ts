import { create } from 'zustand';

/**
 * Os jeitos de entrar no app (seção 33 de docs/arquitetura-api.md): e-mail e
 * senha, o Google e a Apple.
 */
export type SignInMethod = 'password' | 'google' | 'apple';

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  /**
   * A conta entra com e-mail e senha (`password` no `providerData`): só ela
   * troca a senha e o e-mail nos Ajustes (seção 29, frente D). Opcional para a
   * sessão montada à mão; sem o campo, as duas linhas não aparecem.
   */
  hasPassword?: boolean;
  /**
   * Os jeitos de entrar que a conta tem (o `providerData`). A mesma conta pode
   * ter a Apple e o Google (seção 33, decisão 8). Opcional, como o
   * `hasPassword`.
   */
  providers?: SignInMethod[];
  /**
   * Por onde a sessão entrou: o `signInProvider` do token, e não a lista de
   * provedores. A conferência da Apple, a exclusão e a linha "Sair" decidem
   * por ele (seção 33, decisões 9, 12 e 14). Chega depois da sessão (o token
   * é lido sem segurar a abertura); sem ele, vale o `lastSignInMethod` das
   * preferências. `null`: o token veio de outro jeito (o Admin SDK, o seed).
   */
  signInProvider?: SignInMethod | null;
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
  /**
   * A exclusão da conta está andando (seção 33, decisão 12). A revogação da
   * Apple vem antes do `deleteUser`, e o aviso de revogação que ela dispara
   * não pode tirar a sessão no meio: a conferência da Apple
   * (`useAppleCredentialCheck`) ignora o `REVOKED` enquanto isto vale. Volta
   * a falso quando a sessão termina.
   */
  deletingAccount: boolean;
  /**
   * A sessão da conta. Sem o `signInProvider`, fica o que a mesma conta já
   * tinha: o listener do Auth avisa sem ele, e o provedor chega depois.
   */
  setSignedIn: (user: SessionUser) => void;
  /** O provedor da sessão, lido do token depois de ela abrir. Só vale para a conta de agora. */
  setSignInProvider: (uid: string, signInProvider: SignInMethod | null) => void;
  setSignedOut: () => void;
  /** Liga e desliga a marca da exclusão em andamento. */
  setDeletingAccount: (deleting: boolean) => void;
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
  deletingAccount: false,
  setSignedIn: (user) =>
    set((state) => {
      const known = state.user?.uid === user.uid ? state.user.signInProvider : undefined;
      const keep = user.signInProvider === undefined && known !== undefined;
      return { status: 'signedIn', user: keep ? { ...user, signInProvider: known } : user };
    }),
  setSignInProvider: (uid, signInProvider) =>
    set((state) => (state.user?.uid === uid ? { user: { ...state.user, signInProvider } } : {})),
  setSignedOut: () => set({ status: 'signedOut', user: null, deletingAccount: false }),
  setDeletingAccount: (deleting) => set({ deletingAccount: deleting }),
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
