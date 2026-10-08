import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/services/api';
import { fixtureWallet } from '@/services/fixtures';

import { profileKeys, useMyProgressQuery, useWalletQuery } from '../queries';

/**
 * Carteira e progresso pelo seletor por domínio: com a carteira na API (o
 * emulador em desenvolvimento), /me/wallet e /me/progress pelo axios, com a
 * consulta esperando a rede e indo para o disco; nas fixtures, como hoje.
 */

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
}));
jest.mock('@/firebase', () => ({ getDb: () => ({}) }));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));

let mockWalletSource: 'api' | 'fixtures' = 'api';
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => (domain === 'wallet' ? mockWalletSource : 'fixtures'),
  usesFixtures: () => true,
}));

const get = jest.mocked(api.get);

// O que a API do emulador responde para a Camila do seed.
const WALLET = { balance: 12_480, xp: 12_480, seasonPoints: 4_120 };
const PROGRESS = {
  xp: 12_480,
  level: { number: 7, name: 'Purainha', minXp: 7_000 },
  nextLevel: { number: 8, name: 'Xodó', minXp: 15_000 },
  weekEarned: 840,
  stats: { linksCreated: 0, peopleBrought: 0, seasons: 3 },
};

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWalletSource = 'api';
  // O padrão de hoje (algum domínio nas fixtures): as consultas da carteira dizem o delas.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always', gcTime: Infinity } },
  });
  get.mockImplementation(async (url: string) => {
    if (url === '/me/wallet') return { data: WALLET };
    if (url === '/me/progress') return { data: PROGRESS };
    throw new Error(`rota inesperada ${url}`);
  });
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  fixtureWallet.reset();
});

describe('carteira na API', () => {
  it('saldo e progresso vêm de /me/wallet e /me/progress', async () => {
    const wallet = renderHook(() => useWalletQuery(), { wrapper });
    const progress = renderHook(() => useMyProgressQuery(), { wrapper });
    await waitFor(() => expect(wallet.result.current.data).toEqual(WALLET));
    await waitFor(() => expect(progress.result.current.data).toEqual(PROGRESS));
    expect(get.mock.calls.map(([url]) => url).sort()).toEqual(['/me/progress', '/me/wallet']);
  });

  it('a consulta espera a rede e vai para o disco (dado de verdade)', async () => {
    const wallet = renderHook(() => useWalletQuery(), { wrapper });
    await waitFor(() => expect(wallet.result.current.isSuccess).toBe(true));
    const query = client.getQueryCache().find({ queryKey: profileKeys.wallet() });
    expect(query?.options.networkMode).toBe('online');
    expect(query?.meta).toEqual({ realData: true });
  });

  it('sem internet, pausa em vez de mostrar o exemplo', () => {
    onlineManager.setOnline(false);
    const wallet = renderHook(() => useWalletQuery(), { wrapper });
    expect(wallet.result.current.fetchStatus).toBe('paused');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('carteira nas fixtures (build sem a API)', () => {
  it('lê a carteira de exemplo, sem rede, e fica fora do disco', async () => {
    mockWalletSource = 'fixtures';
    onlineManager.setOnline(false);
    const wallet = renderHook(() => useWalletQuery(), { wrapper });
    await waitFor(() => expect(wallet.result.current.data).toEqual(fixtureWallet.get()));
    expect(get).not.toHaveBeenCalled();
    const query = client.getQueryCache().find({ queryKey: profileKeys.wallet() });
    expect(query?.options.networkMode).toBe('always');
    expect(query?.meta).toEqual({ realData: false });
  });
});
