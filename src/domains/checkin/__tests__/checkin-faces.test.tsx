import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { getAnimatedStyle, setUpTests } from 'react-native-reanimated';

import { api } from '@/services/api';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';
import { motion } from '@/theme';

import { CheckinHeaderButton } from '../components/checkin-header-button';
import { CLOSE_AFTER_CHECKIN_MS, CheckinSection } from '../components/checkin-section';
import { useCheckinPanel } from '../hooks/use-checkin-panel';
import { checkinKeys } from '../keys';
import type { CheckinResult, CheckinState } from '../types';

// O card do check-in abrindo e fechando pelo ícone do calendário, e o pulso
// do ícone, como o fã vê: a altura e a opacidade do card, o halo e o fade de
// entrada, com a animação e com reduzir movimento. O que o toque busca,
// anuncia e vibra fica no `checkin-section.test.tsx`.

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

const ACTION = 'Fazer check-in, vale 5 pontos';
const DONE_FOOTER = 'Check-in de hoje feito. Rendeu 5 pontos. Amanhã vale 6 pontos.';

// No aparelho, quem dá a altura do card é o `onLayout` do conteúdo dele; o
// Jest não tem layout. São alturas de exemplo: com o botão e com o pé do "feito".
const CARD_HEIGHT = 213;
const DONE_HEIGHT = 196;
/** Um quadro: o tempo de o Reanimated aplicar um valor que mudou. */
const FRAME_MS = 17;
/** A troca inteira, com folga. */
const SWAP_MS = motion.duration.base + 2 * FRAME_MS;
/** O teto do halo, o do `checkin-header-button.tsx`. */
const HALO_OPACITY = 0.35;

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

/** O conteúdo do card medido, como o `onLayout` do aparelho faria. */
function measure(height: number): void {
  fireEvent(measuredContent(), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
  });
}

/**
 * O conteúdo medido do card: quem tem o `onLayout` da `Expandable`. Fora do
 * fluxo do recorte, ele é medido também com o card fechado; no fluxo, num
 * recorte de altura 0, o bloco fechado nunca abria no aparelho (seção 40, 40.8).
 */
function measuredContent() {
  let node = screen.getByTestId('checkin-card', hidden).parent;
  while (node && typeof node.props.onLayout !== 'function') node = node.parent;
  if (!node) throw new Error('Sem o conteúdo medido do card.');
  return node;
}

/** O relógio anda, e as animações com ele. */
function pass(ms: number): void {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

const panel = () => screen.getByTestId('checkin-panel', hidden);
const halo = () => screen.getByTestId('checkin-header-halo', hidden);
const icon = () => screen.getByTestId('checkin-header-button');

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

/** O ícone na tela, com o card aberto pelo toque e medido. */
async function renderOpen(state: CheckinState = PENDING): Promise<void> {
  get.mockResolvedValue({ data: state });
  render(<CheckinHome />, { wrapper });
  fireEvent.press(await screen.findByTestId('checkin-header-button'));
  measure(state.checkedInToday ? DONE_HEIGHT : CARD_HEIGHT);
  pass(SWAP_MS);
}

describe('o card do check-in: abrir e fechar pelo ícone', () => {
  it('nasce fechado, com altura 0 e apagado, e abre no toque do ícone até a medida dele, sem troca seca', async () => {
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });
    await screen.findByTestId('checkin-header-button');
    pass(SWAP_MS);
    // Fechado, o card nem monta: a Início não pula quando o estado chega.
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(screen.queryByTestId('checkin-card', hidden)).toBeNull();

    fireEvent.press(icon());
    measure(CARD_HEIGHT);
    // No começo do caminho, o card já aparece e ainda não chegou.
    pass(2 * FRAME_MS);
    const opening = getAnimatedStyle(panel());
    expect(opening.opacity).toBeGreaterThan(0);
    expect(opening.opacity).toBeLessThan(1);
    expect(opening.height).toBeGreaterThan(0);
    expect(opening.height).toBeLessThan(CARD_HEIGHT);
    // Um valor só anda as duas coisas: a altura acompanha a opacidade.
    expect(opening.height).toBeCloseTo(Number(opening.opacity) * CARD_HEIGHT);

    pass(SWAP_MS);
    expect(panel()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
    expect(panel()).toHaveProp('pointerEvents', 'auto');
    expect(panel()).toHaveProp('accessibilityElementsHidden', false);
    expect(screen.getByRole('button', { name: ACTION })).toBeEnabled();
  });

  it('o segundo toque no ícone fecha o card, animado, e ele sai do toque e do leitor', async () => {
    await renderOpen();
    fireEvent.press(icon());
    pass(2 * FRAME_MS);
    const closing = getAnimatedStyle(panel());
    expect(closing.height).toBeGreaterThan(0);
    expect(closing.height).toBeLessThan(CARD_HEIGHT);

    pass(SWAP_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(panel()).toHaveProp('pointerEvents', 'none');
    expect(panel()).toHaveProp('accessibilityElementsHidden', true);
    expect(panel()).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    // O card fica montado, para abrir de novo animado.
    expect(screen.getByTestId('checkin-card', hidden)).toBeTruthy();
  });

  it('o conteúdo do card fica fora do fluxo do recorte, e por isso o card fechado também é medido', async () => {
    await renderOpen();
    expect(StyleSheet.flatten(measuredContent().props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    });
  });
});

describe('o card do check-in: depois do toque', () => {
  it('fica aberto com o pé do "feito" o tempo do "+N" e fecha sozinho, animado', async () => {
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    await renderOpen();
    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    await settle(() => answer.resolve({ data: RESULT }));
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
    measure(DONE_HEIGHT);

    // Quase no fim do tempo, o card segue aberto, na medida nova.
    pass(CLOSE_AFTER_CHECKIN_MS - FRAME_MS);
    expect(panel()).toHaveAnimatedStyle({ height: DONE_HEIGHT, opacity: 1 });

    // O tempo acabou: o card fecha a partir do quadro seguinte.
    pass(2 * FRAME_MS);
    pass(2 * FRAME_MS);
    const closing = getAnimatedStyle(panel());
    expect(closing.height).toBeLessThan(DONE_HEIGHT);
    expect(closing.height).toBeGreaterThan(0);

    pass(SWAP_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(icon()).toHaveProp('accessibilityState', expect.objectContaining({ expanded: false }));
  });

  it('se o fã fecha o card antes do tempo, ele não abre nem fecha de novo sozinho', async () => {
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    await renderOpen();
    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    await settle(() => answer.resolve({ data: RESULT }));

    fireEvent.press(icon());
    pass(CLOSE_AFTER_CHECKIN_MS + SWAP_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });

    // Aberto de novo, fica: o fechar sozinho é só depois do toque do check-in.
    fireEvent.press(icon());
    pass(CLOSE_AFTER_CHECKIN_MS + SWAP_MS);
    expect(panel()).toHaveProp('pointerEvents', 'auto');
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
  });

  it('do feito ao por fazer com o card aberto (o dia do servidor virou), o botão volta, ligado, e o card não fecha sozinho', async () => {
    await renderOpen(DONE);
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();

    // O estado de hoje chega com o card na tela: outro prazo, o check-in por fazer.
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
    expect(screen.getByRole('button', { name: 'Fazer check-in, vale 6 pontos' })).toBeEnabled();
    expect(
      screen.getByRole('header', { name: 'Check-in diário. 5 dias seguidos. Termina em 1 dia.' }),
    ).toBeTruthy();
    pass(CLOSE_AFTER_CHECKIN_MS + SWAP_MS);
    expect(panel()).toHaveProp('pointerEvents', 'auto');
    expect(panel()).toHaveAnimatedStyle({ opacity: 1 });
  });
});

describe('o ícone do check-in: o fade e o pulso', () => {
  it('sem reduzir movimento, o ícone entra em fade por valor animado, do 0 ao 1', async () => {
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });
    await settle();
    pass(FRAME_MS);
    expect(getAnimatedStyle(screen.getByTestId('checkin-header', hidden)).opacity).toBeLessThan(1);

    pass(SWAP_MS);
    expect(screen.getByTestId('checkin-header')).toHaveAnimatedStyle({ opacity: 1 });
  });

  it('com o de hoje por fazer e o card fechado, o halo cresce e apaga em laço; aberto, para', async () => {
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });
    await screen.findByTestId('checkin-header-button');
    pass(400);
    const pulse = getAnimatedStyle(halo());
    expect(pulse.opacity).toBeGreaterThan(0);
    expect(pulse.opacity).toBeLessThan(HALO_OPACITY);
    // E de novo, no ciclo seguinte: é um laço, e não um pulso só.
    pass(1600);
    const again = getAnimatedStyle(halo());
    expect(again.opacity).toBeGreaterThan(0);
    expect(again.opacity).toBeLessThan(HALO_OPACITY);

    fireEvent.press(icon());
    pass(FRAME_MS);
    expect(halo()).toHaveAnimatedStyle({ opacity: 0 });
  });

  it('com a Início fora de vista (outra aba, uma tela por cima), o halo não pulsa, e a bolinha fica', async () => {
    get.mockResolvedValue({ data: PENDING });
    function AwayHome() {
      const away = useCheckinPanel();
      return <CheckinHeaderButton panel={away} active={false} />;
    }
    render(<AwayHome />, { wrapper });
    await screen.findByTestId('checkin-header-button');
    pass(400);
    expect(halo()).toHaveAnimatedStyle({ opacity: 0 });
    expect(screen.getByTestId('checkin-header-dot')).toBeTruthy();
  });

  it('com o de hoje feito, nem halo nem bolinha', async () => {
    get.mockResolvedValue({ data: DONE });
    render(<CheckinHome />, { wrapper });
    await screen.findByTestId('checkin-header-button');
    pass(400);
    expect(halo()).toHaveAnimatedStyle({ opacity: 0 });
    expect(screen.queryByTestId('checkin-header-dot')).toBeNull();
  });

  it('com reduzir movimento, o ícone nasce inteiro, sem o fade, o halo não pulsa, a bolinha fica e o card abre e fecha na hora', async () => {
    mockReducedMotion = true;
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });
    await screen.findByTestId('checkin-header-button');
    expect(screen.getByTestId('checkin-header')).toHaveAnimatedStyle({ opacity: 1 });
    pass(400);
    expect(halo()).toHaveAnimatedStyle({ opacity: 0 });
    expect(screen.getByTestId('checkin-header-dot')).toBeTruthy();

    fireEvent.press(icon());
    measure(CARD_HEIGHT);
    pass(FRAME_MS);
    expect(panel()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
    fireEvent.press(icon());
    pass(FRAME_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
  });
});
