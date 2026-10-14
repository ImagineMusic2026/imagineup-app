import '@tanstack/react-query';

import type { ApiError } from '@/services/api/errors';

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError;
    queryMeta: {
      /** `false` deixa a consulta fora do cache salvo no aparelho. */
      persist?: boolean;
      /**
       * Dado de verdade (o perfil do Firestore) numa tela que ainda lê
       * fixtures: vai para o disco também no modo fixtures.
       */
      realData?: boolean;
    };
    mutationMeta: {
      /**
       * `false` na mutação cuja tela mostra a frase da conta suspensa (o
       * comentário, as denúncias, o resgate, o perfil, a foto, o link do
       * convite): o 403 `account_suspended` não abre o `Alert` "Conta
       * suspensa", um canal só por recusa (29.1, decisão 19).
       */
      suspendedAlert?: boolean;
      /**
       * `true` no comentário: recusado pelo filtro do que o fã publica, ele
       * vai para o disco com o erro (o persister), e a linha "Não publicado"
       * sobrevive ao app fechado (seção 30).
       */
      keepRefused?: boolean;
    };
  }
}
