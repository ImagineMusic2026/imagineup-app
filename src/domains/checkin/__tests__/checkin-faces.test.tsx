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
// do ícone, como o fã vê: a altura do recorte, o fade e a descida do conteúdo
// (o `RevealExpandable`), o halo e o fade de entrada, com a animação e com
// reduzir movimento. O que o toque busca, anuncia e vibra fica no
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

const ACTION = 'Fazer check-in, vale 5 pontos';
const DONE_FOOTER = 'Check-in de hoje feito. Rendeu 5 pontos. Amanhã vale 6 pontos.';

// No aparelho, quem dá a altura do card é o `onLayout` do conteúdo dele; o
// Jest não tem layout. São alturas de exemplo: com o botão e com o pé do "feito".
const CARD_HEIGHT = 213;
const DONE_HEIGHT = 196;
/** Um quadro: o tempo de o Reanimated aplicar um valor que mudou. */
const FRAME_MS = 17;
/** O fade de entrada do ícone inteiro, com folga. */
const SWAP_MS = motion.duration.base + 2 * FRAME_MS;
/** A abertura inteira do card, com folga: a altura e o conteúdo, que entra depois. */
const OPEN_MS =
  Math.max(motion.reveal.open, motion.reveal.contentDelay + motion.reveal.contentIn) + 2 * FRAME_MS;
/** O fechar inteiro do card, com folga. */
const CLOSE_MS = Math.max(motion.reveal.close, motion.reveal.contentOut) + 2 * FRAME_MS;
/** Quanto o conteúdo desce ao entrar (e sobe ao sair). */
const RISE = motion.reveal.rise;
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

/**
 * O conteúdo do card: quem tem o `onLayout` do `RevealExpandable`. Fora do
 * fluxo do recorte, ele é medido também com o card fechado; no fluxo, num
 * recorte de altura 0, o bloco fechado nunca abria no aparelho (seção 40, 40.8).
 */
const content = () => screen.getByTestId('checkin-panel-content', hidden);

/** O conteúdo do card medido, como o `onLayout` do aparelho faria. */
function measure(height: number): void {
  fireEvent(content(), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
  });
}

/**
 * A descida do conteúdo: 0 no lugar, negativa acima dele. Lida direto do
 * estilo animado que o Reanimated guarda no Jest (o `jestAnimatedStyle`): o
 * `getAnimatedStyle` quebra com o `undefined` do estilo aninhado que a seção
 * passa (`[styles.content, style]`), e o `style` da view guarda o do primeiro
 * render.
 */
function rise(): number {
  const animated = content().props.jestAnimatedStyle as
    { value?: { transform?: { translateY?: number }[] } } | undefined;
  return animated?.value?.transform?.[0]?.translateY ?? 0;
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

/** O ícone na tela, com o card medido ainda fechado, como no aparelho, e aberto pelo toque. */
async function renderOpen(state: CheckinState = PENDING): Promise<void> {
  get.mockResolvedValue({ data: state });
  render(<CheckinHome />, { wrapper });
  await screen.findByTestId('checkin-header-button');
  measure(state.checkedInToday ? DONE_HEIGHT : CARD_HEIGHT);
  fireEvent.press(icon());
  pass(OPEN_MS);
}

describe('o card do check-in: abrir e fechar pelo ícone', () => {
  it('nasce fechado, com altura 0 e apagado, já montado e medido, e abre no toque do ícone como gaveta, sem troca seca', async () => {
    get.mockResolvedValue({ data: PENDING });
    render(<CheckinHome />, { wrapper });
    await screen.findByTestId('checkin-header-button');
    // Fechado, o card já monta, fora do toque e do leitor: a medida chega antes do primeiro toque.
    measure(CARD_HEIGHT);
    pass(SWAP_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(screen.queryByTestId('checkin-card')).toBeNull();

    fireEvent.press(icon());
    // No começo, a gaveta desce devagar, e o conteúdo ainda espera: nada de abrir na hora.
    pass(2 * FRAME_MS);
    const start = getAnimatedStyle(panel());
    expect(start.height).toBeGreaterThan(0);
    expect(start.height).toBeLessThan(CARD_HEIGHT / 2);
    expect(start.opacity).toBe(0);
    expect(rise()).toBe(-RISE);

    // Passado o atraso, o conteúdo entra em fade, descendo, com a gaveta ainda abrindo.
    pass(motion.reveal.contentDelay + 2 * FRAME_MS);
    const middle = getAnimatedStyle(panel());
    expect(middle.height).toBeGreaterThan(Number(start.height));
    expect(middle.height).toBeLessThan(CARD_HEIGHT);
    expect(middle.opacity).toBeGreaterThan(0);
    expect(middle.opacity).toBeLessThan(1);
    expect(rise()).toBeGreaterThan(-RISE);
    expect(rise()).toBeLessThan(0);

    pass(OPEN_MS);
    expect(panel()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
    expect(rise()).toBe(0);
    expect(panel()).toHaveProp('pointerEvents', 'auto');
    expect(panel()).toHaveProp('accessibilityElementsHidden', false);
    expect(screen.getByRole('button', { name: ACTION })).toBeEnabled();
  });

  it('o segundo toque no ícone fecha o card: o conteúdo apaga e sobe antes de a gaveta fechar, e ele sai do toque e do leitor', async () => {
    await renderOpen();
    fireEvent.press(icon());
    pass(2 * FRAME_MS);
    const start = getAnimatedStyle(panel());
    expect(start.height).toBeGreaterThan(CARD_HEIGHT / 2);
    expect(start.height).toBeLessThan(CARD_HEIGHT);
    expect(start.opacity).toBeLessThan(1);

    // O conteúdo já apagou, e a gaveta ainda está fechando.
    pass(motion.reveal.contentOut);
    const middle = getAnimatedStyle(panel());
    expect(middle.opacity).toBe(0);
    expect(middle.height).toBeGreaterThan(0);
    expect(rise()).toBe(-RISE);

    pass(CLOSE_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
    expect(panel()).toHaveProp('pointerEvents', 'none');
    expect(panel()).toHaveProp('accessibilityElementsHidden', true);
    expect(panel()).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    // O card fica montado, para abrir de novo pelo mesmo caminho.
    expect(screen.getByTestId('checkin-card', hidden)).toBeTruthy();
  });

  it('abrir de novo no meio do fechar segue de onde a gaveta está, sem voltar ao 0', async () => {
    await renderOpen();
    fireEvent.press(icon());
    pass(motion.reveal.close / 2);
    const closing = Number(getAnimatedStyle(panel()).height);
    expect(closing).toBeGreaterThan(0);
    expect(closing).toBeLessThan(CARD_HEIGHT);

    fireEvent.press(icon());
    pass(2 * FRAME_MS);
    expect(getAnimatedStyle(panel()).height).toBeGreaterThan(closing / 2);
    pass(OPEN_MS);
    expect(panel()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
  });

  it('o conteúdo do card fica fora do fluxo do recorte, e por isso o card fechado também é medido', async () => {
    await renderOpen();
    expect(StyleSheet.flatten(content().props.style)).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    });
  });
});

describe('o card do check-in: depois do toque', () => {
  it('fica aberto com o pé do "feito" o tempo do "+N", com a troca de altura andando, e fecha sozinho, animado', async () => {
    const answer = deferred<{ data: CheckinResult }>();
    post.mockReturnValue(answer.promise);
    await renderOpen();
    fireEvent.press(screen.getByRole('button', { name: ACTION }));
    await settle(() => answer.resolve({ data: RESULT }));
    expect(screen.getByLabelText(DONE_FOOTER)).toBeTruthy();
    measure(DONE_HEIGHT);

    // O pé do "feito" é mais baixo que o botão: a gaveta encolhe andando, e não pula.
    pass(2 * FRAME_MS);
    const resizing = getAnimatedStyle(panel());
    expect(resizing.height).toBeLessThan(CARD_HEIGHT);
    expect(resizing.height).toBeGreaterThan(DONE_HEIGHT);

    // Quase no fim do tempo, o card segue aberto, na medida nova.
    pass(CLOSE_AFTER_CHECKIN_MS - 3 * FRAME_MS);
    expect(panel()).toHaveAnimatedStyle({ height: DONE_HEIGHT, opacity: 1 });

    // O tempo acabou: o card fecha a partir do quadro seguinte.
    pass(2 * FRAME_MS);
    pass(2 * FRAME_MS);
    const closing = getAnimatedStyle(panel());
    expect(closing.height).toBeLessThan(DONE_HEIGHT);
    expect(closing.height).toBeGreaterThan(0);

    pass(CLOSE_MS);
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
    pass(CLOSE_AFTER_CHECKIN_MS + CLOSE_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });

    // Aberto de novo, fica: o fechar sozinho é só depois do toque do check-in.
    fireEvent.press(icon());
    pass(CLOSE_AFTER_CHECKIN_MS + OPEN_MS);
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
    pass(CLOSE_AFTER_CHECKIN_MS + CLOSE_MS);
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

    measure(CARD_HEIGHT);
    fireEvent.press(icon());
    pass(FRAME_MS);
    expect(panel()).toHaveAnimatedStyle({ height: CARD_HEIGHT, opacity: 1 });
    expect(rise()).toBe(0);
    // A troca de altura com o card aberto também vale na hora.
    measure(DONE_HEIGHT);
    pass(FRAME_MS);
    expect(panel()).toHaveAnimatedStyle({ height: DONE_HEIGHT, opacity: 1 });
    fireEvent.press(icon());
    pass(FRAME_MS);
    expect(panel()).toHaveAnimatedStyle({ height: 0, opacity: 0 });
  });
});
