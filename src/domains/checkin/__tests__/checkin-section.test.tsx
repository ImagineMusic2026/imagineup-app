import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { missionKeys } from '@/domains/missions/queries';
import { profileKeys } from '@/domains/profile/keys';
import { rankingKeys } from '@/domains/ranking/queries';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet, resetFixtureSession } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { createQueryClient } from '@/services/query/client';
import { shouldPersistQuery } from '@/services/query/persister';
import { resetRefusalAlerts } from '@/services/refusal-alert';
import { useSessionStore } from '@/stores/session';
import { useSuspensionStore } from '@/stores/suspension';

import { CheckinHeaderButton } from '../components/checkin-header-button';
import { CLOSE_AFTER_CHECKIN_MS, CheckinSection } from '../components/checkin-section';
import { CheckinStreakPill } from '../components/checkin-streak-pill';
import { checkinFixture } from '../fixtures';
import { useCheckinPanel } from '../hooks/use-checkin-panel';
import { checkinKeys } from '../keys';
import type { CheckinResult, CheckinState } from '../types';

// O check-in da Início (o ícone do calendário e o card que ele abre) e a
// pílula da 1e, com a consulta de verdade: o silêncio enquanto nada aparece
// (a chave desligada, a `api` de antes, a carga e a falha), o ícone com a
// bolinha, o card que abre e fecha no toque dele, o toque do check-in que
// marca o dia, sobe o "+N" e fecha o card sozinho, o botão sem internet, a
// falha do toque e a virada do dia. O desenho da abertura (a altura medida, o
// pulso, o reduzir movimento) fica no `checkin-faces.test.tsx`, com o
// Reanimated de verdade.

// O api.ts importa o axios do app, que puxa o Firebase (ESM no Jest).
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const hidden = { includeHiddenElements: true } as const;

/** 20 h de São Paulo de 10 de novembro de 2026: faltam 4 horas para a meia-noite. */
const NOW = new Date('2026-11-10T23:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

/** A resposta do servidor: 4 dias seguidos até ontem, o de hoje por fazer (o dia 5 do ciclo). */
const PENDING: CheckinState = {
  enabled: true,
  checkedInToday: false,
  streak: 4,
  best: 4,
  cycle: [3, 3, 4, 4, 5, 6, 15],
  cycleDay: 5,
  todayPoints: 5,
  resetsAt: '2026-11-11T03:00:00.000Z',
};
const DONE: CheckinState = { ...PENDING, checkedInToday: true, streak: 5, best: 5 };
/** A chave desligada: tudo em 0 e o ciclo vazio. */
const OFF: CheckinState = {
  enabled: false,
  checkedInToday: false,
  streak: 0,
  best: 0,
  cycle: [],
  cycleDay: 0,
  todayPoints: 0,
  resetsAt: PENDING.resetsAt,
};

/** A resposta do toque, com os quatro campos das recompensas, como o servidor manda. */
function result(fields: Partial<CheckinResult> = {}): CheckinResult {
  return {
    pointsAwarded: 5,
    completedMissions: [],
    levelUp: null,
    unlockedAchievements: [],
    missionsChanged: false,
    checkin: DONE,
    ...fields,
  };
}

const routeMissing = () => new ApiError('notFound', 'Rota não encontrada.', 404, 'not_found');
const forbidden = () => new ApiError('forbidden', 'App Check', 403, 'app_check_failed');
const network = () => new ApiError('network', 'sem rede');
const timeout = () => new ApiError('timeout', 'prazo');
const server = () => new ApiError('server', 'caiu', 503);

/** O ícone do calendário, com o de hoje por fazer e feito. */
const PENDING_ICON = 'Check-in de hoje por fazer, vale 5 pontos';
const DONE_ICON = 'Check-in de hoje feito. 5 dias seguidos.';
/** O topo do card, por fazer e feito, e o pé do "feito". */
const OPEN = 'Check-in diário. 4 dias seguidos. Termina em 4 horas.';
const DONE_HEADER = 'Check-in diário. 5 dias seguidos.';
const DONE_FOOTER = 'Check-in de hoje feito. Rendeu 5 pontos. Amanhã vale 6 pontos.';
const ACTION = 'Fazer check-in, vale 5 pontos';

/** Promessa que o teste resolve quando quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A Início em miniatura: o ícone do calendário e o card que ele abre, como na `HomeListHeader`. */
function CheckinHome() {
  const panel = useCheckinPanel();
  return (
    <>
      <CheckinHeaderButton panel={panel} />
      <CheckinSection panel={panel} />
    </>
  );
}

/** O toque no ícone do calendário, que abre o card (ou fecha, se estiver aberto). */
async function toggleCard(): Promise<void> {
  fireEvent.press(await screen.findByTestId('checkin-header-button'));
}

/** Abre o card pelo ícone e devolve o botão do check-in de hoje. */
async function openAction() {
  await toggleCard();
  return screen.findByRole('button', { name: ACTION });
}

/**
 * Espera a consulta do check-in terminar e a resposta chegar à tela: com o
 * relógio falso, o aviso do Query aos componentes sai num timer.
 */
async function settled(status: 'success' | 'error'): Promise<void> {
  await waitFor(() => expect(client.getQueryState(checkinKeys.state())?.status).toBe(status));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

const announcements = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls;

/** O puxar para atualizar da Início e o da 1e: a invalidação pela chave. */
async function pull(): Promise<void> {
  await act(async () => {
    await client.invalidateQueries({ queryKey: checkinKeys.state() });
  });
}

/** A volta do app para a frente: as consultas velhas buscam de novo. */
async function refocus(): Promise<void> {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await jest.advanceTimersByTimeAsync(0);
  });
}

/** A volta da rede: as consultas velhas buscam de novo. */
async function reconnect(): Promise<void> {
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await jest.advanceTimersByTimeAsync(0);
  });
}

/** O que o toque mandou: a chave de idempotência de cada POST. */
const sentKeys = () =>
  post.mock.calls.map(
    ([, , config]) => (config?.headers as Record<string, string>)['Idempotency-Key'],
  );

beforeEach(() => {
  jest.clearAllMocks();
  // O relógio do aparelho e o das fixtures andam juntos (o `fixtureNow` lê o `Date`).
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  mockDataSource = 'fixtures';
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  resetRefusalAlerts();
  useSuspensionStore.getState().reset();
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'uid-camila', email: null, displayName: 'Camila Ribeiro', photoURL: null },
    authHolds: 0,
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
  // O mock do RN é um `jest.fn` que o `restoreAllMocks` não volta: cada teste começa sem leitor de tela.
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
});

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
  client.clear();
  resetFixtureSession();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('check-in da Início: o que aparece', () => {
  it('nas fixtures, o check-in de exemplo nasce desligado, como a chave do servidor: nada aparece, nada é anunciado e nada vibra', async () => {
    render(
      <>
        <CheckinHome />
        <CheckinStreakPill />
      </>,
      { wrapper },
    );

    await settled('success');
    expect(client.getQueryData(checkinKeys.state())).toMatchObject({ enabled: false, cycle: [] });
    expect(screen.toJSON()).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('carregando não mostra nada; com a resposta, o ícone entra com a bolinha e o card nasce fechado, sem anúncio e sem toque', async () => {
    // O exemplo nasce desligado: o teste que conta com ele liga, e o `afterEach` volta ao padrão.
    checkinFixture.setEnabled(true);
    render(<CheckinHome />, { wrapper });
    expect(screen.toJSON()).toBeNull();

    const icon = await screen.findByRole('button', { name: PENDING_ICON });
    expect(icon).toHaveProp('accessibilityHint', 'Abre o check-in diário');
    expect(icon).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
    expect(screen.getByTestId('checkin-header-dot')).toBeTruthy();
    // O card fechado já monta, para estar medido no primeiro toque, num bloco de
    // altura 0: fora da tela, do leitor e do toque.
    expect(screen.getByTestId('checkin-card', hidden)).toBeTruthy();
    expect(screen.queryByTestId('checkin-card')).toBeNull();
    expect(screen.queryByRole('header', { name: OPEN })).toBeNull();
    expect(screen.queryByRole('button', { name: ACTION })).toBeNull();
    const panel = screen.getByTestId('checkin-panel', hidden);
    expect(panel).toHaveProp('pointerEvents', 'none');
    expect(panel).toHaveProp('accessibilityElementsHidden', true);
    expect(panel).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(panel).toHaveStyle({ height: 0, opacity: 0 });
    // No Android, o card apaga composto fora da tela (o fundo, a borda e o botão juntos).
    expect(panel).toHaveProp('needsOffscreenAlphaCompositing', true);
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('o toque no ícone abre o card do dia, e o segundo toque fecha', async () => {
    checkinFixture.setEnabled(true);
    render(<CheckinHome />, { wrapper });

    expect(await openAction()).toBeEnabled();
    expect(screen.getByRole('header', { name: OPEN })).toBeTruthy();
    const icon = screen.getByRole('button', { name: PENDING_ICON });
    expect(icon).toHaveProp('accessibilityHint', 'Fecha o check-in diário');
    expect(icon).toHaveProp('accessibilityState', expect.objectContaining({ expanded: true }));
    const panel = screen.getByTestId('checkin-panel');
    expect(panel).toHaveProp('pointerEvents', 'auto');
    expect(panel).toHaveProp('accessibilityElementsHidden', false);
    expect(panel).toHaveStyle({ opacity: 1 });
    // Aberto, a bolinha continua: o de hoje segue por fazer.
    expect(screen.getByTestId('checkin-header-dot')).toBeTruthy();
    expect(jest.mocked(haptics.trigger).mock.calls).toEqual([['selection']]);

    fireEvent.press(icon);
    expect(screen.queryByRole('header', { name: OPEN })).toBeNull();
    expect(screen.queryByRole('button', { name: ACTION })).toBeNull();
    expect(screen.getByTestId('checkin-panel', hidden)).toHaveProp('pointerEvents', 'none');
    expect(screen.getByRole('button', { name: PENDING_ICON })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ expanded: false }),
    );
    // Fechado pelo fã, o card segue montado, só fora do leitor e do toque.
    expect(screen.getByTestId('checkin-card', hidden)).toBeTruthy();
    expect(screen.queryByTestId('checkin-card')).toBeNull();
    expect(announcements()).toEqual([]);
  });

  it('o estado fica fora do disco: o "feito hoje" de uma abertura não aparece na seguinte', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: DONE });
    render(<CheckinHome />, { wrapper });
    expect(await screen.findByRole('button', { name: DONE_ICON })).toBeTruthy();

    const query = client.getQueryCache().find({ queryKey: checkinKeys.state() });
    if (!query) throw new Error('a consulta do check-in não está no cache');
    expect(query.state.status).toBe('success');
    // Dado do servidor (`realData`), mas marcado para não ir ao disco.
    expect(query.meta).toEqual({ realData: true, persist: false });
    expect(shouldPersistQuery(query, false)).toBe(false);
    expect(shouldPersistQuery(query, true)).toBe(false);
  });

  it('com o check-in de hoje já feito, o ícone sem a bolinha, e o card abre com o pé do "feito", sem botão', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: DONE });
    render(<CheckinHome />, { wrapper });

    const icon = await screen.findByRole('button', { name: DONE_ICON });
    expect(screen.queryByTestId('checkin-header-dot')).toBeNull();
    expect(screen.queryByTestId('checkin-card')).toBeNull();

    fireEvent.press(icon);
    expect(screen.getByRole('header', { name: DONE_HEADER })).toBeTruthy();
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Fazer check-in/ })).toBeNull();
    expect(announcements()).toEqual([]);
    expect(jest.mocked(haptics.trigger).mock.calls).toEqual([['selection']]);
    // Aberto sem o toque do check-in, fica: o fechar sozinho é só depois dele.
    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS * 2));
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
  });

  it('com a chave desligada, nada aparece, nada é anunciado e nada vibra', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: OFF });
    render(<CheckinHome />, { wrapper });

    await settled('success');
    expect(screen.toJSON()).toBeNull();
    expect(get).toHaveBeenCalledWith('/me/checkin');
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('com a api de antes do check-in (o 404), nada aparece e a consulta não pergunta de novo', async () => {
    mockDataSource = 'api';
    get.mockRejectedValue(routeMissing());
    const view = render(<CheckinHome />, { wrapper });

    await settled('error');
    expect(screen.toJSON()).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);

    // O puxar para atualizar, a volta do app para a frente, a volta da rede e
    // a tela que monta de novo não perguntam.
    await pull();
    await refocus();
    await reconnect();
    view.unmount();
    render(<CheckinHome />, { wrapper });
    render(<CheckinStreakPill />, { wrapper });
    await pull();
    await refocus();
    await reconnect();
    // Nem o relógio da seção, que anda de minuto em minuto.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.toJSON()).toBeNull();
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('o 404 de uma busca de novo, com o card aberto (a api voltou a ser a de antes), tira o ícone e o card, e nada pergunta de novo', async () => {
    mockDataSource = 'api';
    get.mockResolvedValueOnce({ data: PENDING }).mockRejectedValue(routeMissing());
    render(<CheckinHome />, { wrapper });
    await openAction();

    await pull();
    await waitFor(() =>
      expect(screen.queryByTestId('checkin-section', hidden)).not.toBeOnTheScreen(),
    );
    expect(screen.toJSON()).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);

    await pull();
    await refocus();
    await reconnect();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.toJSON()).toBeNull();
    expect(announcements()).toEqual([]);
  });

  it('só o 404 trava: o 403 de uma busca de novo esconde o ícone e o card, e a busca seguinte pergunta de novo e traz o ícone, com o card fechado', async () => {
    mockDataSource = 'api';
    get
      .mockResolvedValueOnce({ data: PENDING })
      .mockRejectedValueOnce(forbidden())
      .mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });
    await openAction();

    await pull();
    expect(client.getQueryState(checkinKeys.state())?.status).toBe('error');
    await waitFor(() =>
      expect(screen.queryByTestId('checkin-section', hidden)).not.toBeOnTheScreen(),
    );
    expect(screen.toJSON()).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);

    // A recusa esconde enquanto for o erro da consulta: a volta do app pergunta de novo.
    await refocus();
    const icon = await screen.findByRole('button', { name: PENDING_ICON });
    // O card volta fechado: ele fecha quando o estado some.
    expect(icon).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
    expect(screen.queryByRole('header', { name: OPEN })).toBeNull();
    fireEvent.press(icon);
    expect(screen.getByRole('button', { name: ACTION })).toBeEnabled();
    expect(get).toHaveBeenCalledTimes(3);
    expect(announcements()).toEqual([]);
  });

  it('a consulta que falha sem resposta não mostra nada nem anuncia, e a busca seguinte pergunta de novo', async () => {
    mockDataSource = 'api';
    get.mockRejectedValueOnce(network()).mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });

    await settled('error');
    expect(screen.toJSON()).toBeNull();
    expect(announcements()).toEqual([]);

    await act(async () => {
      await client.invalidateQueries({ queryKey: checkinKeys.state() });
    });
    expect(await screen.findByRole('button', { name: PENDING_ICON })).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a busca de novo que falha por rede deixa o card aberto que já estava; a que volta 404 tira', async () => {
    mockDataSource = 'api';
    get
      .mockResolvedValueOnce({ data: PENDING })
      .mockRejectedValueOnce(network())
      .mockRejectedValueOnce(routeMissing());
    render(<CheckinHome />, { wrapper });
    await openAction();

    await act(async () => {
      await client.invalidateQueries({ queryKey: checkinKeys.state() });
    });
    expect(client.getQueryState(checkinKeys.state())?.status).toBe('error');
    expect(screen.getByRole('header', { name: OPEN })).toBeTruthy();
    expect(screen.getByRole('button', { name: PENDING_ICON })).toBeTruthy();

    await act(async () => {
      await client.invalidateQueries({ queryKey: checkinKeys.state() });
    });
    await waitFor(() =>
      expect(screen.queryByTestId('checkin-section', hidden)).not.toBeOnTheScreen(),
    );
    expect(screen.toJSON()).toBeNull();
    expect(announcements()).toEqual([]);
  });

  it('a resposta fora do formato (o corpo de outra rota) não mostra nada', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { season: null, missions: [] } });
    render(<CheckinHome />, { wrapper });

    await settled('success');
    expect(screen.toJSON()).toBeNull();
  });
});

describe('check-in da Início: o toque', () => {
  it('marca o dia, sobe o "+N" com um toque e um anúncio só, e o card fecha sozinho, sem mexer no foco', async () => {
    checkinFixture.setEnabled(true);
    render(<CheckinHome />, { wrapper });
    fireEvent.press(await openAction());

    // O pé do "feito" toma o lugar do botão, e o dia de hoje entra na trilha como feito.
    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.getByRole('header', { name: DONE_HEADER })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ACTION })).toBeNull();
    expect(screen.getByTestId('checkin-points', hidden)).toHaveTextContent('+5');
    // O ícone já diz o feito, sem a bolinha.
    expect(screen.getByRole('button', { name: DONE_ICON })).toBeTruthy();
    expect(screen.queryByTestId('checkin-header-dot')).toBeNull();
    // Os pontos entram na carteira de exemplo; a tela não escreve saldo.
    expect(fixtureWallet.get().balance).toBe(12_480 + 5);

    await waitFor(() =>
      expect(announcements()).toEqual([
        ['Check-in feito. 5 dias seguidos. Mais 5 pontos.', { queue: true }],
      ]),
    );
    // O toque do ícone, o do botão e o do ganho: nada mais vibra.
    expect(jest.mocked(haptics.trigger).mock.calls).toEqual([
      ['selection'],
      ['confirm'],
      ['pointsEarned'],
    ]);

    // Passado o tempo do "+N", o card fecha sozinho. Ninguém leva o foco: com
    // o leitor de tela ligado, o card não fecha (o caso seguinte).
    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS));
    expect(screen.queryByTestId('checkin-points', hidden)).toBeNull();
    expect(screen.queryByLabelText(DONE_FOOTER)).toBeNull();
    expect(screen.getByTestId('checkin-panel', hidden)).toHaveProp('pointerEvents', 'none');
    const icon = screen.getByRole('button', { name: DONE_ICON });
    expect(icon).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
    expect(AccessibilityInfo.sendAccessibilityEvent).not.toHaveBeenCalled();

    // O toque no ícone abre de novo, com a sequência, o que rendeu e o valor de amanhã.
    fireEvent.press(icon);
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.getByRole('header', { name: DONE_HEADER })).toBeTruthy();
  });

  it('com o leitor de tela ligado, o card não fecha sozinho: o anúncio do check-in não é cortado, e o fã fecha pelo ícone', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    checkinFixture.setEnabled(true);
    render(<CheckinHome />, { wrapper });
    fireEvent.press(await openAction());

    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
    await waitFor(() =>
      expect(announcements()).toEqual([
        ['Check-in feito. 5 dias seguidos. Mais 5 pontos.', { queue: true }],
      ]),
    );
    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS * 2));
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.getByTestId('checkin-panel')).toHaveProp('pointerEvents', 'auto');

    fireEvent.press(screen.getByRole('button', { name: DONE_ICON }));
    expect(screen.queryByLabelText(DONE_FOOTER)).toBeNull();
  });

  it('o "feito" que chega por uma busca (o check-in feito noutro aparelho) troca o botão pelo pé do "feito" e deixa o card aberto', async () => {
    mockDataSource = 'api';
    get.mockResolvedValueOnce({ data: PENDING }).mockResolvedValue({ data: DONE });
    render(<CheckinHome />, { wrapper });
    await openAction();

    await pull();
    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.getByRole('button', { name: DONE_ICON })).toBeTruthy();
    // Sem o toque do fã, sem festa e sem fechar sozinho.
    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS * 2));
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.queryByTestId('checkin-points', hidden)).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(announcements()).toEqual([]);
  });

  it('com a API, manda um POST só, põe o estado da resposta no cache e busca de novo o que os pontos mudam', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    client.setQueryData(profileKeys.wallet(), { balance: 12_480 });
    client.setQueryData(profileKeys.achievements(), { unlockedCount: 6 });
    client.setQueryData(missionKeys.list(), { season: null, missions: [] });
    client.setQueryData(rankingKeys.season(), null);
    render(<CheckinHome />, { wrapper });

    const button = await openAction();
    fireEvent.press(button);
    // O segundo toque, antes de a resposta chegar, não manda outro pedido.
    fireEvent.press(button);
    await waitFor(() => expect(screen.getByTestId('checkin-action')).toBeDisabled());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/me/checkin', null, {
      headers: { 'Idempotency-Key': expect.stringMatching(/^checkin-/) },
    });

    await act(async () => {
      answer.resolve({
        data: result({
          pointsAwarded: 15,
          unlockedAchievements: [{ id: 'streak-7', title: '7 dias seguidos' }],
          checkin: { ...DONE, streak: 7, best: 7, cycleDay: 7, todayPoints: 15 },
        }),
      });
    });

    expect(
      await screen.findByLabelText('Check-in de hoje feito. Rendeu 15 pontos. Amanhã vale 3 pontos.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check-in de hoje feito. 7 dias seguidos.' })).toBeTruthy();
    expect(client.getQueryData(checkinKeys.state())).toMatchObject({
      checkedInToday: true,
      streak: 7,
    });
    // O estado veio da resposta: a consulta não buscou de novo.
    expect(get).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(true);
    expect(client.getQueryState(rankingKeys.season())?.isInvalidated).toBe(true);
    expect(client.getQueryState(profileKeys.achievements())?.isInvalidated).toBe(true);
    // O check-in não anda missão (`missionsChanged: false`): elas ficam como estão.
    expect(client.getQueryState(missionKeys.list())?.isInvalidated).toBe(false);
    await waitFor(() =>
      expect(announcements()).toEqual([
        [
          'Check-in feito. 7 dias seguidos. Mais 15 pontos. Conquista nova: 7 dias seguidos.',
          { queue: true },
        ],
      ]),
    );
  });

  it('sem pontos (o segundo toque do dia, feito em outro aparelho), o pé do "feito" entra sem o "+N", o fã ouve o resultado e o card fecha sozinho', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    post.mockResolvedValue({ data: result({ pointsAwarded: 0 }) });
    client.setQueryData(profileKeys.wallet(), { balance: 12_480 });
    render(<CheckinHome />, { wrapper });

    fireEvent.press(await openAction());

    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.queryByTestId('checkin-points', hidden)).toBeNull();
    expect(announcements()).toEqual([['Check-in feito. 5 dias seguidos.', { queue: true }]]);
    expect(jest.mocked(haptics.trigger).mock.calls).toEqual([['selection'], ['confirm']]);
    // Sem pontos, a carteira não busca de novo.
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(false);

    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS));
    expect(screen.queryByLabelText(DONE_FOOTER)).toBeNull();
    expect(screen.getByRole('button', { name: DONE_ICON })).toBeTruthy();
  });

  it('sem internet, o botão fica desligado: o check-in não entra na fila offline', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });
    const button = await openAction();

    act(() => onlineManager.setOnline(false));

    expect(button).toBeDisabled();
    expect(button).toHaveProp(
      'accessibilityHint',
      'Sem internet. Conecte-se para fazer o check-in.',
    );
    fireEvent.press(button);
    expect(post).not.toHaveBeenCalled();
    expect(client.getMutationCache().getAll()).toHaveLength(0);

    act(() => onlineManager.setOnline(true));
    expect(button).toBeEnabled();
  });
});

describe('check-in da Início: a falha do toque', () => {
  const ERROR = 'Não deu para fazer o check-in. Tente de novo.';

  it('a falha incerta mostra a frase embaixo do botão, anuncia na fila e tenta de novo com a mesma chave', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    post.mockRejectedValueOnce(network()).mockResolvedValue({ data: result() });
    render(<CheckinHome />, { wrapper });

    fireEvent.press(await openAction());

    await waitFor(() => expect(screen.getByTestId('checkin-message')).toHaveTextContent(ERROR));
    expect(announcements()).toEqual([[ERROR, { queue: true }]]);
    expect(jest.mocked(haptics.trigger).mock.calls).toEqual([
      ['selection'],
      ['confirm'],
      ['error'],
    ]);
    // O card fica aberto, com o botão ligado: o servidor pode ter gravado, e a chave se repete.
    expect(screen.getByRole('header', { name: OPEN })).toBeTruthy();
    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS * 2));
    expect(screen.getByRole('header', { name: OPEN })).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
    const [first, second] = sentKeys();
    expect(first).toMatch(/^checkin-/);
    expect(second).toBe(first);
    expect(screen.queryByText(ERROR, hidden)).toBeNull();
  });

  it.each<[string, () => ApiError]>([
    ['a rede', network],
    ['o prazo', timeout],
    ['o servidor fora do ar (5xx)', server],
  ])(
    'depois da falha incerta (%s), a carteira busca de novo, porque o servidor pode ter gravado, e o estado do check-in fica como está',
    async (_name, failure) => {
      mockDataSource = 'api';
      get.mockResolvedValue({ data: PENDING });
      post.mockRejectedValueOnce(failure()).mockResolvedValue({ data: result() });
      client.setQueryData(profileKeys.wallet(), { balance: 12_480 });
      client.setQueryData(rankingKeys.season(), null);
      render(<CheckinHome />, { wrapper });

      fireEvent.press(await openAction());
      await waitFor(() => expect(screen.getByTestId('checkin-message')).toHaveTextContent(ERROR));

      expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(true);
      // O ranking fica com o `staleTime` dele, e o estado do check-in não busca de novo.
      expect(client.getQueryState(rankingKeys.season())?.isInvalidated).toBe(false);
      expect(client.getQueryState(checkinKeys.state())?.isInvalidated).toBe(false);
      expect(get).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('header', { name: OPEN })).toBeTruthy();

      // O novo toque repete a chave, recebe a resposta guardada e festeja.
      fireEvent.press(screen.getByRole('button', { name: ACTION }));
      expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
      const [first, second] = sentKeys();
      expect(first).toMatch(/^checkin-/);
      expect(second).toBe(first);
      expect(screen.getByTestId('checkin-points', hidden)).toHaveTextContent('+5');
      await waitFor(() =>
        expect(announcements()).toEqual([
          [ERROR, { queue: true }],
          ['Check-in feito. 5 dias seguidos. Mais 5 pontos.', { queue: true }],
        ]),
      );
    },
  );

  it('depois de uma recusa definitiva, a tentativa seguinte leva chave nova', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    post
      .mockRejectedValueOnce(new ApiError('validation', 'x', 400, 'invalid_request'))
      .mockResolvedValue({ data: result() });
    client.setQueryData(profileKeys.wallet(), { balance: 12_480 });
    render(<CheckinHome />, { wrapper });

    fireEvent.press(await openAction());
    await waitFor(() => expect(screen.getByTestId('checkin-message')).toHaveTextContent(ERROR));
    // A recusa é clara: nada foi gravado, e a carteira não busca de novo.
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();

    const [first, second] = sentKeys();
    expect(second).toMatch(/^checkin-/);
    expect(second).not.toBe(first);
  });

  it.each<[string, () => ApiError]>([
    [
      'a chave desligada (409 checkin_disabled)',
      () => new ApiError('validation', 'fora', 409, 'checkin_disabled'),
    ],
    ['a api de antes (404)', routeMissing],
  ])(
    'com %s, o estado busca de novo e o ícone e o card somem, com o aviso ao leitor',
    async (_name, refusal) => {
      mockDataSource = 'api';
      get.mockResolvedValueOnce({ data: PENDING }).mockResolvedValue({ data: OFF });
      post.mockRejectedValue(refusal());
      render(<CheckinHome />, { wrapper });

      fireEvent.press(await openAction());

      await waitFor(() =>
        expect(screen.queryByTestId('checkin-section', hidden)).not.toBeOnTheScreen(),
      );
      expect(screen.toJSON()).toBeNull();
      expect(get).toHaveBeenCalledTimes(2);
      expect(announcements()).toEqual([
        ['O check-in diário não está disponível agora.', { queue: true }],
      ]);
      expect(haptics.trigger).toHaveBeenCalledWith('error');
    },
  );

  it('a conta suspensa segue o caminho de sempre: a recusa pede o "Conta suspensa" do app', async () => {
    client = createQueryClient({
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    });
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    post.mockRejectedValue(new ApiError('forbidden', 'suspensa', 403, 'account_suspended'));
    render(<CheckinHome />, { wrapper });

    fireEvent.press(await openAction());

    await waitFor(() =>
      expect(screen.getByTestId('checkin-message')).toHaveTextContent(
        'Sua conta está suspensa. Fale com a equipe do ImagineUP.',
      ),
    );
    // A mutação não desliga o `Alert` (`suspendedAlert`): quem abre é o `SuspensionWatcher`.
    expect(useSuspensionStore.getState()).toMatchObject({ refusals: 1, alerts: 1 });
    expect(screen.getByRole('header', { name: OPEN })).toBeTruthy();
  });
});

describe('check-in da Início: a virada do dia', () => {
  it('à meia-noite de São Paulo, o estado de ontem some e o de hoje chega, com o ícone pulsando e o card fechado', async () => {
    checkinFixture.setEnabled(true);
    render(<CheckinHome />, { wrapper });
    fireEvent.press(await openAction());
    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS));

    // Um minuto antes da meia-noite, o ícone de hoje continua feito.
    act(() => jest.advanceTimersByTime(4 * HOUR_MS - 60_000 - CLOSE_AFTER_CHECKIN_MS));
    expect(screen.getByRole('button', { name: DONE_ICON })).toBeTruthy();

    // Passou da meia-noite: o servidor de exemplo já está no dia seguinte, o sexto do ciclo.
    act(() => jest.advanceTimersByTime(2 * 60_000));
    const icon = await screen.findByRole('button', {
      name: 'Check-in de hoje por fazer, vale 6 pontos',
    });
    expect(screen.getByTestId('checkin-header-dot')).toBeTruthy();
    expect(icon).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
    expect(screen.queryByRole('button', { name: DONE_ICON })).toBeNull();

    fireEvent.press(icon);
    expect(
      screen.getByRole('header', { name: 'Check-in diário. 5 dias seguidos. Termina em 23 horas.' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fazer check-in, vale 6 pontos' })).toBeEnabled();
  });

  it('com o dia virado e a busca falhando, nada de ontem fica na tela, e a busca sai de novo a cada minuto', async () => {
    mockDataSource = 'api';
    const tomorrow: CheckinState = {
      ...PENDING,
      streak: 0,
      cycleDay: 1,
      todayPoints: 3,
      resetsAt: '2026-11-12T03:00:00.000Z',
    };
    get
      .mockResolvedValueOnce({ data: DONE })
      .mockRejectedValueOnce(network())
      .mockResolvedValue({ data: tomorrow });
    render(<CheckinHome />, { wrapper });
    expect(await screen.findByRole('button', { name: DONE_ICON })).toBeTruthy();

    act(() => jest.advanceTimersByTime(4 * HOUR_MS + 1000));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await settled('error');
    expect(screen.toJSON()).toBeNull();

    // A volta seguinte do relógio pergunta de novo, e o dia novo chega: a sequência se perdeu.
    act(() => jest.advanceTimersByTime(60_000));
    fireEvent.press(
      await screen.findByRole('button', { name: 'Check-in de hoje por fazer, vale 3 pontos' }),
    );
    expect(
      screen.getByRole('header', {
        name: 'Check-in diário. Comece sua sequência. Termina em 23 horas.',
      }),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(3);
    expect(announcements()).toEqual([]);
  });

  it('com o relógio do aparelho adiantado, o estado que o servidor acabou de mandar fica na tela', async () => {
    mockDataSource = 'api';
    // O aparelho diz 0:05 do dia 11; para o servidor ainda é dia 10, e o prazo é o mesmo.
    jest.setSystemTime(new Date('2026-11-11T03:05:00.000Z'));
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });

    expect(await openAction()).toBeEnabled();
    expect(screen.getByRole('header', { name: 'Check-in diário. 4 dias seguidos.' })).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);

    // De minuto em minuto, pergunta de novo, sem tirar o card.
    act(() => jest.advanceTimersByTime(60_000));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('header', { name: 'Check-in diário. 4 dias seguidos.' })).toBeTruthy();
  });
});

describe('pílula da sequência na 1e', () => {
  it('mostra a sequência que vale agora, com a chama e o rótulo próprio, sem anúncio', async () => {
    checkinFixture.setEnabled(true);
    render(<CheckinStreakPill />, { wrapper });
    expect(screen.toJSON()).toBeNull();

    expect(await screen.findByLabelText('Sequência de check-in: 4 dias seguidos')).toBeTruthy();
    expect(screen.getByText('4 dias seguidos')).toBeTruthy();
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('lê a mesma consulta do card: o check-in feito na Início sobe a sequência na 1e', async () => {
    checkinFixture.setEnabled(true);
    render(
      <>
        <CheckinHome />
        <CheckinStreakPill />
      </>,
      { wrapper },
    );
    expect(await screen.findByLabelText('Sequência de check-in: 4 dias seguidos')).toBeTruthy();

    fireEvent.press(await openAction());

    expect(await screen.findByLabelText('Sequência de check-in: 5 dias seguidos')).toBeTruthy();
  });

  it.each<[string, () => void]>([
    ['a chave desligada', () => get.mockResolvedValue({ data: OFF })],
    [
      'a sequência em 0',
      () => get.mockResolvedValue({ data: { ...PENDING, streak: 0, cycleDay: 1 } }),
    ],
    ['a api de antes (404)', () => get.mockRejectedValue(routeMissing())],
    ['a consulta falhando', () => get.mockRejectedValue(new Error('fora do ar'))],
  ])('com %s, nada aparece e nada é anunciado', async (_name, answer) => {
    mockDataSource = 'api';
    answer();
    render(<CheckinStreakPill />, { wrapper });

    await waitFor(() =>
      expect(client.getQueryState(checkinKeys.state())?.status).not.toBe('pending'),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.toJSON()).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(announcements()).toEqual([]);
  });

  it('com um dia seguido, o texto vai no singular', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { ...PENDING, streak: 1, cycleDay: 2, todayPoints: 3 } });
    render(<CheckinStreakPill />, { wrapper });
    expect(await screen.findByLabelText('Sequência de check-in: 1 dia seguido')).toBeTruthy();
    expect(screen.getByText('1 dia seguido')).toBeTruthy();
  });
});

describe('check-in da Início: a resposta fora de hora', () => {
  it('a falha incerta de ontem não repete a chave hoje: a resposta guardada seria a do outro dia', async () => {
    mockDataSource = 'api';
    // O dia do servidor virou com o card na tela (o relógio do aparelho está
    // atrasado): a busca de novo traz o estado de hoje, com outro prazo.
    const today: CheckinState = { ...PENDING, resetsAt: '2026-11-12T03:00:00.000Z' };
    get.mockResolvedValueOnce({ data: PENDING }).mockResolvedValue({ data: today });
    post.mockRejectedValueOnce(network()).mockResolvedValue({
      data: result({ checkin: { ...today, checkedInToday: true, streak: 5, best: 5 } }),
    });
    render(<CheckinHome />, { wrapper });

    fireEvent.press(await openAction());
    await waitFor(() => expect(screen.getByTestId('checkin-message')).toBeTruthy());

    await act(async () => {
      await client.invalidateQueries({ queryKey: checkinKeys.state() });
    });
    expect(
      await screen.findByRole('header', {
        name: 'Check-in diário. 4 dias seguidos. Termina em 1 dia.',
      }),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();
    const [first, second] = sentKeys();
    expect(second).toMatch(/^checkin-/);
    expect(second).not.toBe(first);
  });

  it('a busca do estado que saiu antes do toque e chega depois da resposta dele não volta o card para o de hoje por fazer', async () => {
    mockDataSource = 'api';
    const late = deferred<{ data: CheckinState }>();
    get.mockResolvedValueOnce({ data: PENDING }).mockReturnValueOnce(late.promise);
    post.mockResolvedValue({ data: result() });
    render(<CheckinHome />, { wrapper });
    const button = await openAction();
    // Uma busca de novo (a volta do app, o puxar para atualizar) sai e fica sem resposta.
    act(() => {
      void client.invalidateQueries({ queryKey: checkinKeys.state() });
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    fireEvent.press(button);
    expect(await screen.findByLabelText(DONE_FOOTER)).toBeTruthy();

    // A resposta dela, lida antes de o check-in gravar, chega por último.
    await act(async () => {
      late.resolve({ data: PENDING });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(client.getQueryState(checkinKeys.state())).toMatchObject({
      status: 'success',
      fetchStatus: 'idle',
      data: { checkedInToday: true, streak: 5 },
    });
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
    expect(screen.getByRole('button', { name: DONE_ICON })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ACTION })).toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a resposta de um toque perto da meia-noite que chega depois da virada busca o estado de hoje na hora, sem ficar no "feito" de ontem, e o card aberto não fecha sozinho', async () => {
    mockDataSource = 'api';
    // 23:59:50 de São Paulo: faltam 10 segundos para o dia do check-in acabar.
    jest.setSystemTime(new Date('2026-11-11T02:59:50.000Z'));
    // O dia seguinte: a sequência de 5 viva e o check-in de hoje por fazer, no dia 6 do ciclo.
    const nextDay: CheckinState = {
      ...PENDING,
      streak: 5,
      best: 5,
      cycleDay: 6,
      todayPoints: 6,
      resetsAt: '2026-11-12T03:00:00.000Z',
    };
    get.mockResolvedValueOnce({ data: PENDING }).mockResolvedValue({ data: nextDay });
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    render(<CheckinHome />, { wrapper });
    fireEvent.press(await openAction());

    // O servidor gravou o de ontem antes da meia-noite; a resposta chega depois dela.
    jest.setSystemTime(new Date('2026-11-11T03:00:05.000Z'));
    await act(async () => {
      answer.resolve({ data: result() });
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(
      await screen.findByRole('button', { name: 'Fazer check-in, vale 6 pontos' }),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(checkinKeys.state())).toMatchObject({
      checkedInToday: false,
      cycleDay: 6,
    });
    // O de hoje voltou a estar por fazer: o fechar sozinho do de ontem não vale.
    act(() => jest.advanceTimersByTime(CLOSE_AFTER_CHECKIN_MS * 2));
    expect(screen.getByRole('button', { name: 'Fazer check-in, vale 6 pontos' })).toBeTruthy();
  });

  it('a resposta que chega com a seção fora da tela só acerta o cache: sem "+N", sem anúncio e sem toque', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    client.setQueryData(profileKeys.wallet(), { balance: 12_480 });
    const view = render(<CheckinHome />, { wrapper });

    fireEvent.press(await openAction());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    view.unmount();
    jest.mocked(haptics.trigger).mockClear();
    await act(async () => {
      answer.resolve({ data: result() });
    });

    await waitFor(() =>
      expect(client.getQueryData(checkinKeys.state())).toMatchObject({ checkedInToday: true }),
    );
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(true);
    expect(announcements()).toEqual([]);
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('a resposta que chega depois de a sessão trocar não vai ao cache do fã seguinte', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: PENDING });
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    client.setQueryData(profileKeys.wallet(), { balance: 12_480 });
    render(<CheckinHome />, { wrapper });

    fireEvent.press(await openAction());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Outro fã entrou no aparelho antes de a resposta chegar.
    act(() => {
      useSessionStore.setState({
        user: { uid: 'uid-outro', email: null, displayName: 'Outro Fã', photoURL: null },
      });
    });
    await act(async () => {
      answer.resolve({ data: result() });
    });

    await waitFor(() => expect(screen.getByRole('button', { name: ACTION })).toBeEnabled());
    expect(client.getQueryData(checkinKeys.state())).toMatchObject({ checkedInToday: false });
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(false);
    expect(screen.queryByTestId('checkin-points', hidden)).toBeNull();
    expect(announcements()).toEqual([]);
  });
});
