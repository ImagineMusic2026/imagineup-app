import {
  dehydrate,
  hydrate,
  onlineManager,
  QueryClient,
  type DehydratedState,
  type MutationMeta,
  type Query,
} from '@tanstack/react-query';

import { usesFixtures } from '@/config/data-source';
import { ApiError } from '@/services/api/errors';
import { actionRefusal } from '@/services/api/refusal';

import { queryClient, queryNetworkMode, queryOptionsFor } from '../client';
import { persistOptions, shouldPersistMutation, shouldPersistQuery } from '../persister';

// Sem API e sem emulador, em vez de lidos do ambiente: com EXPO_PUBLIC_API_URL
// preenchida (CI, depois do deploy), estes testes continuam falando do modo
// fixtures, o das builds sem a variável.
jest.mock('@/config/server', () => ({
  ...jest.requireActual('@/config/server'),
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

async function settledQuery(
  client: QueryClient,
  key: string,
  options: { fails?: boolean; persist?: boolean; realData?: boolean } = {},
): Promise<Query> {
  await client
    .fetchQuery({
      queryKey: [key],
      queryFn: async () => {
        if (options.fails) throw new Error('falhou');
        return key;
      },
      retry: false,
      meta: { persist: options.persist, realData: options.realData },
    })
    .catch(() => undefined);
  const query = client.getQueryCache().find({ queryKey: [key] });
  if (!query) throw new Error(`consulta ${key} não ficou no cache`);
  return query;
}

describe('cache salvo no aparelho', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
  });

  afterEach(() => client.clear());

  it('estes testes rodam com todos os domínios nas fixtures', () => {
    expect(usesFixtures()).toBe(true);
  });

  it('com fixtures em uso, não grava consulta de exemplo, nem a que deu certo', async () => {
    const query = await settledQuery(client, 'feed');
    expect(shouldPersistQuery(query, true)).toBe(false);
    expect(persistOptions.dehydrateOptions?.shouldDehydrateQuery?.(query)).toBe(false);
    // A consulta de um domínio que ainda lê das fixtures diz realData: false.
    const wallet = await settledQuery(client, 'carteira', { realData: false });
    expect(shouldPersistQuery(wallet, true)).toBe(false);
  });

  it('com fixtures em uso, grava o dado de verdade (perfil do Firestore, domínio na API) que deu certo', async () => {
    const profile = await settledQuery(client, 'perfil', { realData: true });
    const failed = await settledQuery(client, 'perfil-quebrado', { realData: true, fails: true });
    expect(shouldPersistQuery(profile, true)).toBe(true);
    expect(persistOptions.dehydrateOptions?.shouldDehydrateQuery?.(profile)).toBe(true);
    expect(shouldPersistQuery(failed, true)).toBe(false);
  });

  it('sem domínio nas fixtures, grava a consulta que deu certo', async () => {
    const query = await settledQuery(client, 'feed');
    expect(shouldPersistQuery(query, false)).toBe(true);
  });

  it('sem domínio nas fixtures, deixa de fora o que pediu para não ir ao disco e o que falhou', async () => {
    const sensitive = await settledQuery(client, 'token', { persist: false });
    const failed = await settledQuery(client, 'quebrada', { fails: true });
    expect(shouldPersistQuery(sensitive, false)).toBe(false);
    expect(shouldPersistQuery(failed, false)).toBe(false);
  });
});

// O comentário recusado pelo filtro (seção 30): a mutação vai para o disco com
// o erro, e a linha "Não publicado" volta com o app reaberto. O `services` não
// conhece os posts: a chave e o `meta` aqui são os do comentário, escritos à mão.
describe('mutações salvas no aparelho', () => {
  const COMMENT_KEY = ['posts', 'comment'];
  const META: MutationMeta = { suspendedAlert: false, keepRefused: true };
  const variables = {
    postId: 'p-clipe',
    text: 'Que clipe!',
    idempotencyKey: 'chave-1',
    localId: 'local-1',
  };
  const contentRefused = () =>
    new ApiError('validation', 'Fora dos Termos de uso.', 400, 'comment_invalid', {
      reason: 'not_allowed',
    });

  let client: QueryClient;

  // Sem o tempo de coleta (como o comentário do app, `gcTime: Infinity`): o
  // `clear` não apaga o relógio das mutações, e o Jest esperaria os 5 min.
  const newClient = () => new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });

  beforeEach(() => {
    client = newClient();
  });

  afterEach(() => client.clear());

  /** Uma mutação do comentário que terminou: recusada com o erro dado, ou gravada. */
  async function settledComment(error: unknown, meta: MutationMeta = META): Promise<void> {
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: COMMENT_KEY,
        meta,
        retry: false,
        mutationFn: async () => {
          if (error) throw error;
          return { id: 'c-servidor' };
        },
      })
      .execute(variables)
      .catch(() => undefined);
  }

  /** O que o persister grava, pelo JSON (o `createAsyncStoragePersister` usa o `JSON.stringify`). */
  const savedToDisk = (): DehydratedState =>
    JSON.parse(
      JSON.stringify(dehydrate(client, persistOptions.dehydrateOptions)),
    ) as DehydratedState;

  it('a recusada por conteúdo vai para o disco e volta como recusa de conteúdo', async () => {
    await settledComment(contentRefused());
    const saved = savedToDisk();
    expect(saved.mutations).toHaveLength(1);

    const reopened = newClient();
    hydrate(reopened, saved);
    const [restored, ...others] = reopened.getMutationCache().getAll();
    expect(others).toHaveLength(0);
    expect(restored?.state.status).toBe('error');
    expect(restored?.state.variables).toEqual(variables);
    expect(restored?.meta).toEqual(META);
    // Um objeto do JSON, e não um `ApiError`: a linha sai "Não publicado" pelo
    // `actionRefusal`, que é o que o `useLocalComments` lê.
    expect(restored?.state.error).not.toBeInstanceOf(ApiError);
    expect(actionRefusal(restored?.state.error, 'comment')).toEqual({
      type: 'content',
      key: 'post.composer.contentRefused',
    });
    // O salvamento seguinte, com o app reaberto, continua guardando.
    expect(restored && shouldPersistMutation(restored)).toBe(true);
    reopened.clear();
  });

  it('a recusada por outro motivo, a que deu certo e a sem o meta não vão', async () => {
    await settledComment(
      new ApiError('validation', 'Longo.', 400, 'comment_invalid', { reason: 'too_long' }),
    );
    await settledComment(new ApiError('network', 'sem rede'));
    await settledComment(null);
    await settledComment(contentRefused(), { suspendedAlert: false });
    expect(client.getMutationCache().getAll()).toHaveLength(4);
    expect(savedToDisk().mutations).toEqual([]);
  });

  it('a pausada (a fila offline) continua indo, como no padrão do TanStack', () => {
    const paused = client.getMutationCache().build<unknown, ApiError, unknown, unknown>(
      client,
      { mutationKey: COMMENT_KEY, meta: META },
      {
        context: undefined,
        data: undefined,
        error: null,
        failureCount: 0,
        failureReason: null,
        isPaused: true,
        status: 'pending',
        variables,
        submittedAt: Date.now(),
      },
    );
    expect(shouldPersistMutation(paused)).toBe(true);
    expect(savedToDisk().mutations).toHaveLength(1);
  });

  it('a que pediu para ficar de fora (a fila só na memória, como a reação do fã-clube) não vai, nem pausada na fila', async () => {
    const scope = { id: 'fan-club-react-p1' };
    const meta: MutationMeta = { persist: false };
    let release = (): void => undefined;
    const first = client.getMutationCache().build<unknown, ApiError, unknown, unknown>(client, {
      mutationKey: ['fan-club', 'react'],
      scope,
      meta,
      networkMode: 'always',
      retry: false,
      mutationFn: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    });
    const second = client.getMutationCache().build<unknown, ApiError, unknown, unknown>(client, {
      mutationKey: ['fan-club', 'react'],
      scope,
      meta,
      networkMode: 'always',
      retry: false,
      mutationFn: async () => undefined,
    });
    const running = first.execute('heart');
    const waiting = second.execute('fire');
    // A segunda espera a primeira na fila do `scope`: fica pausada.
    await Promise.resolve();
    expect(second.state.isPaused).toBe(true);
    expect(shouldPersistMutation(second)).toBe(false);
    expect(shouldPersistMutation(first)).toBe(false);
    expect(savedToDisk().mutations).toEqual([]);

    release();
    await Promise.all([running, waiting]);
  });
});

describe('consultas no modo fixtures', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
    queryClient.clear();
  });

  it('rodam sem internet em vez de pausar', async () => {
    onlineManager.setOnline(false);
    await expect(
      queryClient.fetchQuery({ queryKey: ['offline'], queryFn: async () => 'fixture' }),
    ).resolves.toBe('fixture');
  });

  it('mutações continuam esperando a rede, para a fila offline valer', () => {
    expect(queryClient.getDefaultOptions().queries?.networkMode).toBe('always');
    expect(queryClient.getDefaultOptions().mutations?.networkMode).not.toBe('always');
  });
});

describe('modo de rede das consultas', () => {
  it('sem API, a carteira roda como fixture e fica fora do disco', () => {
    expect(queryOptionsFor('wallet')).toEqual({ networkMode: 'always', meta: { realData: false } });
  });

  it.each([
    ['fixtures', 'always'],
    ['api', 'online'],
  ] as const)('com a fonte %s, as consultas usam o modo %s', (source, mode) => {
    expect(queryNetworkMode(source)).toBe(mode);
  });
});
