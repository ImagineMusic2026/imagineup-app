import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { buildFanCentralsFixture } from '@/domains/artists/fixtures';
import { checkinKeys, useCheckinQuery } from '@/domains/checkin';
import { fanClubKeys } from '@/domains/fan-club';
import { buildDailyMissionFixture } from '@/domains/missions/fixtures';
import { buildFeedPageFixture } from '@/domains/posts/fixtures';
import { GLOBAL_SCOPE, rankingKeys } from '@/domains/ranking';
import { api } from '@/services/api';
import { haptics } from '@/services/haptics';

import { useHomeRefresh } from '../hooks/use-home-refresh';

// O build do Firebase que o Jest resolve é ESM; a home não fala com ele aqui.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));
// Com a API: sem rede, as buscas pausam até ela voltar.
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'api',
  usesFixtures: () => false,
}));

const get = jest.mocked(api.get);
const ROUTES = ['/missions/daily', '/me/centrals', '/feed', '/me/rsvps'];

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function callsTo(url: string): number {
  return get.mock.calls.filter(([called]) => called === url).length;
}

/** Promessa que o teste resolve quando quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  const now = new Date();
  const answers: Record<string, unknown> = {
    '/missions/daily': { mission: buildDailyMissionFixture(now) },
    '/me/centrals': buildFanCentralsFixture(),
    '/feed': buildFeedPageFixture(now, null),
    '/me/rsvps': { eventIds: [] },
  };
  get.mockImplementation(async (url: string) => ({ data: answers[url] }) as never);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, networkMode: 'online' } },
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  jest.restoreAllMocks();
});

async function renderLoaded() {
  const view = renderHook(() => useHomeRefresh(), { wrapper });
  await waitFor(() => ROUTES.forEach((url) => expect(callsTo(url)).toBe(1)));
  return view;
}

describe('puxar para atualizar a home', () => {
  it('busca de novo missão, centrais, mural e presenças, com o indicador até acabar', async () => {
    const { result } = await renderLoaded();

    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.refresh();
    });
    expect(result.current.refreshing).toBe(true);
    expect(haptics.trigger).toHaveBeenCalledWith('refresh');

    await act(() => done);
    expect(result.current.refreshing).toBe(false);
    ROUTES.forEach((url) => expect(callsTo(url)).toBe(2));
  });

  it('o ranking (1f e 1d, nas outras abas) busca de novo junto, só a primeira página: o "você é #12" e o card não discordam', async () => {
    const { result } = await renderLoaded();
    const page = { items: [], nextCursor: 'c20' };
    client.setQueryData(rankingKeys.leaderboard(GLOBAL_SCOPE), {
      pages: [page, { items: [], nextCursor: null }],
      pageParams: [null, 'c20'],
    });
    client.setQueryData(rankingKeys.myRank(GLOBAL_SCOPE), {
      position: 12,
      points: 4_120,
      target: null,
    });

    await act(() => result.current.refresh());

    expect(client.getQueryState(rankingKeys.myRank(GLOBAL_SCOPE))?.isInvalidated).toBe(true);
    expect(client.getQueryState(rankingKeys.leaderboard(GLOBAL_SCOPE))?.isInvalidated).toBe(true);
    expect(client.getQueryData(rankingKeys.leaderboard(GLOBAL_SCOPE))).toEqual({
      pages: [page],
      pageParams: [null],
    });
  });

  it('"Dos seus fã-clubes" (seção 34) busca de novo junto, só quando já veio: antes da abertura, nada é pedido', async () => {
    const { result } = await renderLoaded();
    await act(() => result.current.refresh());
    expect(client.getQueryState(fanClubKeys.feed())).toBeUndefined();

    client.setQueryData(fanClubKeys.feed(), { pages: [], pageParams: [null] });
    await act(() => result.current.refresh());
    expect(client.getQueryState(fanClubKeys.feed())?.isInvalidated).toBe(true);
    expect(get.mock.calls.some(([url]) => String(url).includes('fan-club'))).toBe(false);
  });

  it('o check-in diário (seção 39) busca de novo junto, pela chave, só quando já veio: sem a seção na tela, nada é pedido', async () => {
    const { result } = await renderLoaded();
    await act(() => result.current.refresh());
    // O puxar não cria a consulta: quem pergunta é a seção, e só ela.
    expect(client.getQueryState(checkinKeys.state())).toBeUndefined();

    client.setQueryData(checkinKeys.state(), { enabled: false });
    await act(() => result.current.refresh());
    expect(client.getQueryState(checkinKeys.state())?.isInvalidated).toBe(true);
    expect(get.mock.calls.some(([url]) => String(url).includes('checkin'))).toBe(false);
  });

  it('o indicador não espera o check-in diário (seção 39): sai com as quatro buscas da home, e a do check-in segue por fora', async () => {
    // A resposta da chave desligada: mesmo sem card, a seção da Início deixa a consulta ativa.
    const off = { enabled: false, cycle: [], resetsAt: '2026-11-11T03:00:00.000Z' };
    const late = deferred<{ data: unknown }>();
    const others = get.getMockImplementation();
    let asked = 0;
    get.mockImplementation(((url: string) => {
      if (url !== '/me/checkin') return others?.(url);
      asked += 1;
      return asked === 1 ? Promise.resolve({ data: off }) : late.promise;
    }) as never);
    const { result } = renderHook(() => ({ checkin: useCheckinQuery(), home: useHomeRefresh() }), {
      wrapper,
    });
    await waitFor(() => ROUTES.forEach((url) => expect(callsTo(url)).toBe(1)));
    await waitFor(() => expect(result.current.checkin.isSuccess).toBe(true));

    act(() => {
      void result.current.home.refresh();
    });
    expect(result.current.home.refreshing).toBe(true);

    // As quatro buscas da home acabaram e o indicador saiu, com a do check-in ainda sem resposta.
    await waitFor(() => expect(result.current.home.refreshing).toBe(false));
    ROUTES.forEach((url) => expect(callsTo(url)).toBe(2));
    expect(callsTo('/me/checkin')).toBe(2);
    expect(result.current.checkin.fetchStatus).toBe('fetching');

    // A resposta atrasada chega por fora, sem acender o indicador de novo.
    late.resolve({ data: off });
    await waitFor(() => expect(result.current.checkin.fetchStatus).toBe('idle'));
    expect(result.current.home.refreshing).toBe(false);
    expect(callsTo('/me/checkin')).toBe(2);
  });

  it('sem internet, o indicador não fica girando: as buscas esperam a rede e voltam sozinhas', async () => {
    const { result } = await renderLoaded();
    act(() => onlineManager.setOnline(false));

    act(() => {
      void result.current.refresh();
    });

    expect(haptics.trigger).toHaveBeenCalledWith('refresh');
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    ROUTES.forEach((url) => expect(callsTo(url)).toBe(1));

    act(() => onlineManager.setOnline(true));
    await waitFor(() => ROUTES.forEach((url) => expect(callsTo(url)).toBe(2)));
    // A volta da rede não acende o indicador de novo.
    expect(result.current.refreshing).toBe(false);
  });
});
