import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';

import { buildAgendaPageFixture } from '../fixtures';
import { useAgendaRefresh } from '../hooks/use-agenda-refresh';
import { agendaKeys } from '../queries';

// O build do Firebase que o Jest resolve é ESM; a presença invalida a carteira
// do domínio de perfil, que lê o Firestore.
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
jest.mock('@/config/env', () => ({ dataSource: 'api' }));

const get = jest.mocked(api.get);
const NOW = new Date(2026, 8, 29, 20, 0);
const PAGE = { data: buildAgendaPageFixture(NOW, null) } as never;
const RSVPS = { data: { eventIds: ['sao-joao-irara'] } } as never;

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
  get.mockImplementation(async (url: string) => {
    if (url === '/agenda') return PAGE;
    if (url === '/me/rsvps') return RSVPS;
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

/** A 1m com os shows e as presenças prontos. */
async function renderLoaded() {
  const view = renderHook(() => useAgendaRefresh(), { wrapper });
  await waitFor(() => {
    expect(callsTo('/agenda')).toBe(1);
    expect(callsTo('/me/rsvps')).toBe(1);
  });
  return view;
}

describe('puxar para atualizar a 1m', () => {
  it('vibra, busca os shows e as presenças juntos e mostra o indicador até os dois chegarem', async () => {
    const { result } = await renderLoaded();
    const rsvps = deferred<void>();
    get.mockImplementation(async (url: string) => {
      if (url === '/agenda') return PAGE;
      await rsvps.promise;
      return RSVPS;
    });

    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.refresh();
    });
    expect(haptics.trigger).toHaveBeenCalledWith('refresh');
    expect(result.current.refreshing).toBe(true);
    await waitFor(() => expect(callsTo('/agenda')).toBe(2));
    expect(callsTo('/me/rsvps')).toBe(2);

    // Os shows chegaram, as presenças ainda não: o indicador fica.
    await act(async () => undefined);
    expect(result.current.refreshing).toBe(true);

    await act(async () => rsvps.resolve());
    await act(() => done);
    expect(result.current.refreshing).toBe(false);
  });

  it('sem internet, o indicador sai: as buscas esperam a rede e voltam sozinhas', async () => {
    const { result } = await renderLoaded();
    act(() => onlineManager.setOnline(false));

    act(() => {
      void result.current.refresh();
    });

    expect(haptics.trigger).toHaveBeenCalledWith('refresh');
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(callsTo('/agenda')).toBe(1);
    expect(client.getQueryState(agendaKeys.events())?.fetchStatus).toBe('paused');

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(callsTo('/agenda')).toBe(2));
    // A volta da rede não acende o indicador de novo.
    expect(result.current.refreshing).toBe(false);
  });

  it('o fim de um puxão antigo não apaga o indicador de um novo', async () => {
    const { result } = await renderLoaded();
    const first = deferred<void>();
    const second = deferred<void>();
    const waits = [first.promise, second.promise];
    // Cada busca dos shows espera a sua vez; a das presenças responde na hora.
    get.mockImplementation(async (url: string) => {
      if (url === '/me/rsvps') return RSVPS;
      await waits.shift();
      return PAGE;
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

  it('se uma das buscas falha, o indicador sai do mesmo jeito', async () => {
    const { result } = await renderLoaded();
    get.mockImplementation(async (url: string) => {
      if (url === '/agenda') throw new ApiError('server', 'fora do ar', 500);
      return RSVPS;
    });

    await act(() => result.current.refresh());

    expect(result.current.refreshing).toBe(false);
    expect(callsTo('/agenda')).toBe(2);
    // A agenda que já estava na tela fica, com o erro para a tela avisar.
    expect(client.getQueryState(agendaKeys.events())?.error).toBeInstanceOf(ApiError);
    expect(client.getQueryData(agendaKeys.events())).toBeDefined();
  });
});
