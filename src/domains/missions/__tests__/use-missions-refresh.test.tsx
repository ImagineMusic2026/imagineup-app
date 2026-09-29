import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/services/api';
import { haptics } from '@/services/haptics';

import { buildDailyMissionFixture, buildMissionsFixture } from '../fixtures';
import { useMissionsRefresh } from '../hooks/use-missions-refresh';
import { missionKeys, useDailyMissionQuery } from '../queries';

jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));
// Com a API: sem rede, as buscas pausam até ela voltar.
jest.mock('@/config/env', () => ({ dataSource: 'api' }));

const get = jest.mocked(api.get);

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
  get.mockImplementation(async (url: string) => {
    if (url === '/missions') return { data: buildMissionsFixture(now) } as never;
    if (url === '/missions/daily')
      return { data: { mission: buildDailyMissionFixture(now) } } as never;
    throw new Error(`rota sem resposta no teste: ${url}`);
  });
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

/** A 1g e, na aba Início, o card da missão do dia: as duas buscas prontas. */
async function renderLoaded() {
  const view = renderHook(
    () => {
      useDailyMissionQuery();
      return useMissionsRefresh();
    },
    { wrapper },
  );
  await waitFor(() => {
    expect(callsTo('/missions')).toBe(1);
    expect(callsTo('/missions/daily')).toBe(1);
  });
  return view;
}

describe('puxar para atualizar a 1g', () => {
  it('vibra, busca a lista de novo e mostra o indicador até ela chegar', async () => {
    const { result } = await renderLoaded();

    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.refresh();
    });
    expect(haptics.trigger).toHaveBeenCalledWith('refresh');
    expect(result.current.refreshing).toBe(true);

    await act(() => done);
    expect(result.current.refreshing).toBe(false);
    expect(callsTo('/missions')).toBe(2);
  });

  it('a missão do dia da home também busca de novo, para as duas não discordarem', async () => {
    const { result } = await renderLoaded();

    await act(() => result.current.refresh());

    await waitFor(() => expect(callsTo('/missions/daily')).toBe(2));
  });

  it('sem internet, o indicador sai: a busca espera a rede e volta sozinha', async () => {
    const { result } = await renderLoaded();
    act(() => onlineManager.setOnline(false));

    act(() => {
      void result.current.refresh();
    });

    expect(haptics.trigger).toHaveBeenCalledWith('refresh');
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(callsTo('/missions')).toBe(1);
    expect(client.getQueryState(missionKeys.list())?.fetchStatus).toBe('paused');

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(callsTo('/missions')).toBe(2));
    // A volta da rede não acende o indicador de novo.
    expect(result.current.refreshing).toBe(false);
  });

  it('o fim de um puxão antigo não apaga o indicador de um novo', async () => {
    const { result } = await renderLoaded();
    const first = deferred<void>();
    const second = deferred<void>();
    const waits = [first.promise, second.promise];
    const answer = { data: buildMissionsFixture(new Date()) } as never;
    const daily = { data: { mission: buildDailyMissionFixture(new Date()) } } as never;
    // Cada busca da lista espera a sua vez; a da missão do dia responde na hora.
    get.mockImplementation(async (url: string) => {
      if (url === '/missions/daily') return daily;
      await waits.shift();
      return answer;
    });

    act(() => {
      void result.current.refresh();
    });
    // O segundo puxão cancela a busca do primeiro e começa outra.
    act(() => {
      void result.current.refresh();
    });
    await act(async () => first.resolve());
    expect(result.current.refreshing).toBe(true);

    await act(async () => second.resolve());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });
});
