import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';

import { api } from '@/services/api';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';
import { motion } from '@/theme';

import { CheckinSection } from '../components/checkin-section';
import { checkinKeys } from '../keys';
import type { CheckinResult, CheckinState } from '../types';

// A troca das duas faces do check-in (o card aberto e a linha do "Check-in
// feito") como o fã a vê: a altura e a opacidade de cada face, com a animação
// e com reduzir movimento. O que o toque busca, anuncia e vibra fica no
// `checkin-section.test.tsx`.

// Esta suíte roda com o Reanimated de verdade, e não com o mock do
// `jest.setup.js`: o mock refaz cada valor animado a cada render e calcula o
// estilo na hora do render, então não leva a medida do `onLayout` ao estilo
// nem distingue a troca animada da troca na hora.
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated'));

// O api.ts importa o axios do app, que puxa o Firebase (ESM no Jest).
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'api',
  usesFixtures: () => false,
}));

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

// O `toHaveAnimatedStyle`: o estilo que o Reanimated aplicou, e não o do primeiro render.
setUpTests();

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const hidden = { includeHiddenElements: true } as const;

/** 20 h de São Paulo de 10 de novembro de 2026: faltam 4 horas para a meia-noite. */
const NOW = new Date('2026-11-10T23:00:00.000Z');

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

const RESULT: CheckinResult = {
  pointsAwarded: 5,
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
  checkin: DONE,
};

const CLOSED = 'Check-in feito. 5 dias seguidos. Amanhã vale 6 pontos.';
const ACTION = 'Fazer check-in, vale 5 pontos';

// No aparelho, quem dá a altura de cada face é o `onLayout` do conteúdo dela;
// o Jest não tem layout. São alturas de exemplo, diferentes uma da outra.
const CARD_HEIGHT = 203;
const ROW_HEIGHT = 68;
/** Um quadro: o tempo de o Reanimated aplicar um valor que mudou. */
const FRAME_MS = 17;
/** A troca inteira, com folga. */
const SWAP_MS = motion.duration.base + 2 * FRAME_MS;

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

/** O conteúdo de uma face medido, como o `onLayout` do aparelho faria. */
function measure(content: 'checkin-card' | 'checkin-done', height: number): void {
  fireEvent(screen.getByTestId(content, hidden), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
  });
}

/**
 * O conteúdo medido de uma face: quem tem o `onLayout` da `Expandable`. Fora do
 * fluxo do recorte, ele é medido também com a face fechada; no fluxo, num
 * recorte de altura 0, a face fechada nunca abria no aparelho (seção 39, 39.8).
 */
function measuredContent(content: 'checkin-card' | 'checkin-done') {
  let node = screen.getByTestId(content, hidden).parent;
  while (node && typeof node.props.onLayout !== 'function') node = node.parent;
  if (!node) throw new Error(`Sem o conteúdo medido de ${content}.`);
  return node;
}

/** O relógio anda, e as animações com ele. */
function pass(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** A face do card (o de hoje por fazer) e a da linha do "Check-in feito". */
const cardFace = () => screen.getByTestId('checkin-open', hidden);
const rowFace = () => screen.getByTestId('checkin-closed', hidden);

/** A resposta chega e a tela troca de estado, sem o tempo da animação passar. */
async function settle(answer: () => void = () => undefined): Promise<void> {
  await act(async () => {
    answer();
    await jest.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  mockReducedMotion = false;
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'uid-camila', email: null, displayName: 'Camila Ribeiro', photoURL: null },
    authHolds: 0,
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** O card na tela, com as duas faces medidas, e o toque sem resposta ainda. */
async function renderAndTap(): Promise<() => void> {
  get.mockResolvedValue({ data: PENDING });
  const answer = deferred<{ data: CheckinResult }>();
  post.mockReturnValue(answer.promise);
  render(<CheckinSection />, { wrapper });
  const button = await screen.findByRole('button', { name: ACTION });
  measure('checkin-card', CARD_HEIGHT);
  measure('checkin-done', ROW_HEIGHT);
  pass(SWAP_MS);
  // Antes do toque: o card aberto na medida dele, e a linha fechada.
  expect(cardFace()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
  expect(rowFace()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
  fireEvent.press(button);
  return () => answer.resolve({ data: RESULT });
}

describe('as faces do check-in: a troca depois do toque', () => {
  it('o card fecha até a altura 0, apagado, e a linha do "Check-in feito" abre até a medida dela, as duas juntas e sem troca seca', async () => {
    const answer = await renderAndTap();
    await settle(answer);
    expect(screen.getByRole('header', { name: CLOSED })).toBeTruthy();

    // No começo do caminho, nenhuma das duas chegou: o card ainda aparece, e a linha já aparece.
    pass(2 * FRAME_MS);
    const card = getAnimatedStyle(cardFace());
    const row = getAnimatedStyle(rowFace());
    expect(card.opacity).toBeGreaterThan(0);
    expect(card.opacity).toBeLessThan(1);
    expect(card.height).toBeGreaterThan(0);
    expect(card.height).toBeLessThan(CARD_HEIGHT);
    expect(row.opacity).toBeGreaterThan(0);
    expect(row.opacity).toBeLessThan(1);
    expect(row.height).toBeGreaterThan(0);
    expect(row.height).toBeLessThan(ROW_HEIGHT);
    // Um valor só anda as duas coisas: a altura acompanha a opacidade.
    expect(card.height).toBeCloseTo(Number(card.opacity) * CARD_HEIGHT);
    expect(row.height).toBeCloseTo(Number(row.opacity) * ROW_HEIGHT);

    pass(SWAP_MS);
    expect(cardFace()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(rowFace()).toHaveAnimatedStyle({ height: ROW_HEIGHT, opacity: 1 });
    // O card fechado sai do toque e do leitor; a linha entra.
    expect(cardFace()).toHaveProp('pointerEvents', 'none');
    expect(cardFace()).toHaveProp('accessibilityElementsHidden', true);
    expect(rowFace()).toHaveProp('pointerEvents', 'auto');
    expect(rowFace()).toHaveProp('accessibilityElementsHidden', false);
  });

  it('com reduzir movimento, a troca é na hora, e a seção nasce inteira, sem o fade', async () => {
    mockReducedMotion = true;
    get.mockResolvedValue({ data: PENDING });
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    render(<CheckinSection />, { wrapper });
    const button = await screen.findByRole('button', { name: ACTION });
    // Sem fade de entrada: a seção já nasce com a opacidade inteira.
    expect(screen.getByTestId('checkin-section')).toHaveAnimatedStyle({ opacity: 1 });
    measure('checkin-card', CARD_HEIGHT);
    measure('checkin-done', ROW_HEIGHT);
    pass(FRAME_MS);
    expect(cardFace()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
    expect(rowFace()).toHaveAnimatedStyle({ height: 0, opacity: 0 });

    fireEvent.press(button);
    await settle(() => answer.resolve({ data: RESULT }));
    expect(screen.getByRole('header', { name: CLOSED })).toBeTruthy();

    // Um quadro depois, as duas faces já estão no fim: nada andou no caminho.
    pass(FRAME_MS);
    expect(cardFace()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(rowFace()).toHaveAnimatedStyle({ height: ROW_HEIGHT, opacity: 1 });
  });

  it('sem reduzir movimento, a seção entra em fade por valor animado, do 0 ao 1', async () => {
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinSection />, { wrapper });
    await settle();
    // Um quadro depois de a resposta chegar, a seção ainda está no caminho.
    pass(FRAME_MS);
    const entering = getAnimatedStyle(screen.getByTestId('checkin-section', hidden));
    expect(entering.opacity).toBeLessThan(1);

    pass(SWAP_MS);
    expect(screen.getByTestId('checkin-section')).toHaveAnimatedStyle({ opacity: 1 });
  });
});

describe('as faces do check-in: sem o toque', () => {
  it('o conteúdo das duas faces fica fora do fluxo do recorte, e por isso a face fechada também é medida', async () => {
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinSection />, { wrapper });
    await screen.findByRole('button', { name: ACTION });
    for (const content of ['checkin-card', 'checkin-done'] as const) {
      expect(StyleSheet.flatten(measuredContent(content).props.style)).toMatchObject({
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
      });
    }
  });

  it('com o check-in de hoje já feito, só a linha aparece, na medida dela, e o card nem monta', async () => {
    get.mockResolvedValue({ data: DONE });
    render(<CheckinSection />, { wrapper });
    expect(await screen.findByRole('header', { name: CLOSED })).toBeTruthy();
    // Antes da medida, a face aberta ainda não tem altura; com ela, abre de uma vez.
    expect(rowFace()).toHaveAnimatedStyle({ height: 0, opacity: 1 });
    measure('checkin-done', ROW_HEIGHT);
    pass(FRAME_MS);
    expect(rowFace()).toHaveAnimatedStyle({ height: ROW_HEIGHT, opacity: 1 });
    expect(cardFace()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(screen.queryByTestId('checkin-card', hidden)).toBeNull();
  });

  it('do feito ao por fazer com a seção montada (o dia do servidor virou), o card abre na medida dele, com o botão de volta e ligado, e a linha fecha', async () => {
    get.mockResolvedValue({ data: DONE });
    render(<CheckinSection />, { wrapper });
    expect(await screen.findByRole('header', { name: CLOSED })).toBeTruthy();
    measure('checkin-done', ROW_HEIGHT);
    pass(SWAP_MS);

    // O estado de hoje chega com a seção na tela: outro prazo, o check-in por fazer.
    await settle(() => {
      client.setQueryData<CheckinState>(checkinKeys.state(), {
        ...PENDING,
        streak: 5,
        best: 5,
        cycleDay: 6,
        todayPoints: 6,
        resetsAt: '2026-11-12T03:00:00.000Z',
      });
    });
    const button = screen.getByRole('button', { name: 'Fazer check-in, vale 6 pontos' });
    expect(button).toBeEnabled();
    // O card montou agora, dentro da face fechada: a medida chega, e ele abre.
    measure('checkin-card', CARD_HEIGHT);
    pass(SWAP_MS);
    expect(cardFace()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
    expect(cardFace()).toHaveProp('pointerEvents', 'auto');
    expect(cardFace()).toHaveProp('accessibilityElementsHidden', false);
    expect(rowFace()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(rowFace()).toHaveProp('pointerEvents', 'none');
    expect(screen.queryByRole('header', { name: CLOSED })).toBeNull();
    expect(
      screen.getByRole('header', { name: 'Check-in diário. 5 dias seguidos. Termina em 1 dia.' }),
    ).toBeTruthy();
  });
});
