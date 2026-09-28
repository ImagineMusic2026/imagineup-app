import '@tanstack/react-query';

import type { ApiError } from '@/services/api/errors';

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError;
    queryMeta: {
      /** `false` deixa a consulta fora do cache salvo no aparelho. */
      persist?: boolean;
    };
  }
}
