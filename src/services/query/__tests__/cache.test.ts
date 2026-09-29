import { onlineManager, QueryClient, type Query } from '@tanstack/react-query';

import { dataSource } from '@/config/env';

import { queryClient, queryNetworkMode } from '../client';
import { persistOptions, shouldPersistQuery } from '../persister';

// O env real, sem o aviso de Firebase sem .env, com a fonte fixada em vez de
// lida do .env: com EXPO_PUBLIC_API_URL preenchida (CI, depois do M2), estes
// testes continuam falando do modo fixtures.
jest.mock('@/config/env', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const env = jest.requireActual('@/config/env');
  warn.mockRestore();
  return { ...env, dataSource: 'fixtures' };
});

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

  it('estes testes rodam no modo fixtures', () => {
    expect(dataSource).toBe('fixtures');
  });

  it('no modo fixtures não grava consulta nenhuma, nem a que deu certo', async () => {
    const query = await settledQuery(client, 'feed');
    expect(shouldPersistQuery(query, 'fixtures')).toBe(false);
    expect(persistOptions.dehydrateOptions?.shouldDehydrateQuery?.(query)).toBe(false);
  });

  it('no modo fixtures, grava o dado de verdade (o perfil do Firestore) que deu certo', async () => {
    const profile = await settledQuery(client, 'perfil', { realData: true });
    const failed = await settledQuery(client, 'perfil-quebrado', { realData: true, fails: true });
    expect(shouldPersistQuery(profile, 'fixtures')).toBe(true);
    expect(persistOptions.dehydrateOptions?.shouldDehydrateQuery?.(profile)).toBe(true);
    expect(shouldPersistQuery(failed, 'fixtures')).toBe(false);
  });

  it('com a API, grava a consulta que deu certo', async () => {
    const query = await settledQuery(client, 'feed');
    expect(shouldPersistQuery(query, 'api')).toBe(true);
  });

  it('com a API, deixa de fora o que pediu para não ir ao disco e o que falhou', async () => {
    const sensitive = await settledQuery(client, 'token', { persist: false });
    const failed = await settledQuery(client, 'quebrada', { fails: true });
    expect(shouldPersistQuery(sensitive, 'api')).toBe(false);
    expect(shouldPersistQuery(failed, 'api')).toBe(false);
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
  it.each([
    ['fixtures', 'always'],
    ['api', 'online'],
  ] as const)('com a fonte %s, as consultas usam o modo %s', (source, mode) => {
    expect(queryNetworkMode(source)).toBe(mode);
  });
});
