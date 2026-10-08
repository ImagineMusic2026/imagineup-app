import { onlineManager, QueryClient, type Query } from '@tanstack/react-query';

import { usesFixtures } from '@/config/data-source';

import { queryClient, queryNetworkMode, queryOptionsFor } from '../client';
import { persistOptions, shouldPersistQuery } from '../persister';

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
