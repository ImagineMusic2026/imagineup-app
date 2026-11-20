import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { Polygon } from 'react-native-svg';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Glass } from '@/components/glass';
import { createStackEntrance, type StackEntranceTrigger } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, layout, motion, spacing, typography } from '@/theme';

import { RiseIn } from '../components/rise-in';
import { Tagline } from '../components/tagline';
import { AuthEntranceContext } from '../hooks/use-auth-entrance';
import { WelcomeScreen } from '../views/welcome';

// Reduzir movimento desligado, sem esperar a resposta do sistema: ela chegaria
// depois do teste, num render fora do act.
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

// A 1k só pergunta se o Firebase está configurado.
let mockConfigured = true;
jest.mock('@/firebase', () => ({
  get isFirebaseConfigured() {
    return mockConfigured;
  },
}));

// Só a navegação imperativa e o foco da tela saem do ar; a troca de tela de
// verdade está em `src/navigation/__tests__/auth.test.tsx`.
let mockFocused = true;
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
  useIsFocused: () => mockFocused,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

const TITLE = t('auth.welcome.title');
const CREATE = t('auth.welcome.createAccount');
const SIGN_IN = t('auth.welcome.haveAccount');

type Node = ReturnType<typeof screen.getByText>;
const isHost = (node: Node): boolean => typeof node.type === 'string';

/** Caixa (em host) mais próxima acima do nó. */
function hostParent(node: Node): Node {
  let current = node.parent;
  while (current && !isHost(current)) current = current.parent;
  if (!current) throw new Error('nó sem caixa em volta');
  return current;
}

/** As caixas (em host) logo abaixo do nó, na ordem do desenho. */
function hostChildren(node: Node): Node[] {
  return node.children.flatMap((child) =>
    typeof child === 'string' ? [] : child.findAll(isHost, { deep: false }),
  );
}

const window = Dimensions.get('window');
const setWindowWidth = (width: number) => Dimensions.set({ window: { ...window, width } });

let entrance: StackEntranceTrigger;

beforeEach(() => {
  jest.clearAllMocks();
  entrance = createStackEntrance();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

function welcome() {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <AuthEntranceContext value={entrance}>
        <WelcomeScreen />
      </AuthEntranceContext>
    </SafeAreaProvider>
  );
}

/** Opacidade de cada barra da marca ao lado do título, no primeiro quadro. */
function barsOpacity(): number[] {
  return screen.root
    .findAll((node) => node.type === Polygon)
    .map((node) => {
      const animated = node.props.animatedProps as { fillOpacity: number } | undefined;
      return animated ? animated.fillOpacity : (node.props.fillOpacity as number);
    });
}

afterEach(() => {
  mockConfigured = true;
  mockFocused = true;
  jest.restoreAllMocks();
  act(() => setWindowWidth(window.width));
});

describe('abertura (1k)', () => {
  it('os blocos entram nesta ordem: o nome, a frase, criar conta, já tenho conta e os termos', () => {
    render(welcome());
    const blocks = screen.UNSAFE_getAllByType(RiseIn);
    // O nome, o botão, o link e os termos seguem a cascata de sempre; a frase
    // começa no lugar 2, entre o nome e o botão, e troca de parte sozinha.
    expect(blocks.map((block) => block.props.order)).toEqual([0, 3, 4, 5]);
    expect(screen.UNSAFE_getByType(Tagline).props.firstOrder).toBe(2);

    const [title, create, signIn, terms] = blocks;
    expect(within(title!).getByRole('header', { name: TITLE })).toBeTruthy();
    expect(within(create!).getByRole('button', { name: CREATE })).toBeTruthy();
    expect(within(signIn!).getByRole('button', { name: SIGN_IN })).toBeTruthy();
    expect(within(terms!).getByRole('link', { name: t('auth.terms.termsLink') })).toBeTruthy();
    expect(within(terms!).getByRole('link', { name: t('auth.terms.privacyLink') })).toBeTruthy();
  });

  it('tudo espera o fade da pilha: antes dele, nada começa, e as barras nascem apagadas', () => {
    const delay = jest.spyOn(Reanimated, 'withDelay');
    render(welcome());
    expect(delay).not.toHaveBeenCalled();
    expect(barsOpacity()).toEqual([0, 0, 0]);
  });

  it('no fade da pilha, os blocos sobem em sequência, a frase troca de parte e as barras acendem enquanto o título sobe', () => {
    render(welcome());
    const delay = jest.spyOn(Reanimated, 'withDelay');
    act(() => entrance.enter());

    // 60 ms entre o nome, o botão, o link e os termos (o segundo lugar fica
    // vago); a frase entra em 120 ms (as trocas dela vêm depois, no laço); as
    // barras, 80 ms, a partir de 150.
    const bars = motion.duration.fast;
    const byTime = (a: number, b: number) => a - b;
    expect(delay.mock.calls.map(([wait]) => wait).sort(byTime)).toEqual(
      [0, 180, 240, 300, 120, bars, bars + 80, bars + 160].sort(byTime),
    );
  });

  it('o botão, o link e os termos não esperam a frase: chegam antes da primeira troca dela', () => {
    render(welcome());
    const [, create, signIn, terms] = screen.UNSAFE_getAllByType(RiseIn);
    const firstSwap = 2 * motion.stagger.step + motion.duration.slow + 1200;
    for (const block of [create, signIn, terms]) {
      expect(block!.props.order * motion.stagger.step + motion.duration.slow).toBeLessThan(
        firstSwap,
      );
    }
  });

  it('a frase vem a 20 do nome e começa no lugar 2 da entrada', () => {
    render(welcome());
    const tagline = screen.UNSAFE_getByType(Tagline);
    expect(tagline.props).toEqual({ entrance, firstOrder: 2, active: true });
    // O nome e a frase dividem um bloco, e o vão entre os dois é o dele.
    const brand = hostParent(tagline);
    expect(brand).toHaveStyle({ gap: 20 });
    expect(within(brand).getByRole('header', { name: TITLE })).toBeTruthy();
    // Um foco só para o leitor de tela, com a frase inteira.
    expect(screen.getByLabelText(t('auth.welcome.tagline.label'))).toBeTruthy();
  });

  it('coberta por uma pergunta, a abertura segue montada embaixo, e a frase para', () => {
    mockFocused = false;
    render(welcome());
    expect(screen.UNSAFE_getByType(Tagline).props.active).toBe(false);
  });

  it('tudo no centro: o nome com as barras ao lado, numa fileira no meio da tela', () => {
    render(welcome());
    const [title] = screen.UNSAFE_getAllByType(RiseIn);
    expect(title!.props.style).toMatchObject({
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'center',
      columnGap: spacing.tileGap,
    });
    expect(within(title!).getByRole('header', { name: TITLE })).toHaveStyle(typography.displayXl);
  });

  it('a sobra da tela se divide como no desenho: três partes em cima do nome e uma entre a frase e o botão', () => {
    render(welcome());
    const brand = hostParent(screen.UNSAFE_getByType(Tagline));
    const content = hostParent(brand);
    const [top, second, middle, ...rest] = hostChildren(content);
    expect(second).toBe(brand);
    expect(top).toHaveStyle({ flexGrow: 3 });
    // A frase nunca encosta no botão, nem quando a tela não tem sobra.
    expect(middle).toHaveStyle({ flexGrow: 1, minHeight: spacing.xxl });
    // Depois, o pé: o botão, o link e os termos.
    expect(rest).toHaveLength(3);
  });

  it('o bloco ocupa a tela e rola com o texto grande: livra o logo em cima, a área segura embaixo e fica a 24 das bordas', () => {
    render(welcome());
    const scroll = screen.UNSAFE_getByType(ScrollView);
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
      flexGrow: 1,
      paddingHorizontal: spacing.gutterAuth,
      // 47 da área segura, 39 até o pé do logo do fundo e 24 de folga.
      paddingTop: 47 + 39 + 24,
      paddingBottom: 34 + spacing.md,
    });
  });

  it('"Criar minha conta" é o botão cheio, com o ícone de carta, e leva ao cadastro', () => {
    render(welcome());
    const create = screen.getByRole('button', { name: CREATE });
    expect(within(create).UNSAFE_getByType(Mail)).toBeTruthy();
    expect(create).toBeEnabled();

    fireEvent.press(create);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/cadastro');
  });

  it('"Já tenho conta" é um link rosa, com alvo de 44, e leva a entrar com e-mail', () => {
    render(welcome());
    const signIn = screen.getByRole('button', { name: SIGN_IN });
    expect(screen.getByText(SIGN_IN)).toHaveStyle({
      ...typography.buttonAlt,
      color: colors.accent,
    });
    // O alvo é o texto com a folga dos lados, no meio da linha, e não a largura da tela.
    expect(signIn).toHaveStyle({
      minHeight: layout.minTouchTarget,
      alignSelf: 'center',
      paddingHorizontal: spacing.lg,
    });

    fireEvent.press(signIn);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/entrar-com-email');
  });

  it('o botão de vidro saiu: as duas entradas são o botão rosa e o link, nesta ordem', () => {
    render(welcome());
    expect(screen.UNSAFE_queryAllByType(Glass)).toHaveLength(0);
    // A frase em laço não é tocável: não tem pausa, por decisão do dono.
    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      CREATE,
      SIGN_IN,
    ]);
  });

  it('o pé fica junto: o link a 6 do botão e os termos a 12 do link', () => {
    render(welcome());
    const [, create, signIn, terms] = screen.UNSAFE_getAllByType(RiseIn);
    expect(create!.props.style).toMatchObject({ marginBottom: spacing.metaGap });
    expect(signIn!.props.style).toMatchObject({ marginBottom: spacing.md });
    expect(terms!.props.style).toBeUndefined();
  });

  it('o nome cresce com a fonte só até onde cabe na linha, ao lado das barras', () => {
    // Numa tela de 360, sobram 286 para o nome, que mede 221 na fonte padrão.
    act(() => setWindowWidth(360));
    render(welcome());
    const title = () => screen.getByRole('header', { name: TITLE });
    expect(title().props.maxFontSizeMultiplier).toBeCloseTo((286 * 0.94) / 221, 5);

    // Com largura de sobra, vale o limite do app (200%).
    act(() => setWindowWidth(750));
    expect(title().props.maxFontSizeMultiplier).toBe(2);
  });

  describe('sem o Firebase configurado', () => {
    beforeEach(() => {
      mockConfigured = false;
    });

    it('o aviso aparece em cima do botão, no segundo lugar da entrada', () => {
      render(welcome());
      const blocks = screen.UNSAFE_getAllByType(RiseIn);
      expect(blocks.map((block) => block.props.order)).toEqual([0, 1, 3, 4, 5]);
      const notice = within(blocks[1]!).getByText(t('auth.missingConfig'));
      expect(notice).toHaveStyle({
        ...typography.caption,
        color: colors.danger,
        textAlign: 'center',
      });
    });

    it('as duas entradas ficam desativadas e não saem da tela', () => {
      render(welcome());
      const create = screen.getByRole('button', { name: CREATE });
      const signIn = screen.getByRole('button', { name: SIGN_IN });
      expect(create).toBeDisabled();
      expect(signIn).toBeDisabled();

      fireEvent.press(create);
      fireEvent.press(signIn);
      expect(router.push).not.toHaveBeenCalled();
    });
  });

  it('com o Firebase configurado, o aviso não aparece', () => {
    render(welcome());
    expect(screen.queryByText(t('auth.missingConfig'))).toBeNull();
  });
});
