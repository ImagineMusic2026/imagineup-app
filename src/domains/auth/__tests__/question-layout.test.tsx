import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Logo } from '@/components/logo';
import { Scrim } from '@/components/scrim';
import { Screen } from '@/components/screen';
import { StepProgress } from '@/components/step-progress';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, motion, spacing, typography } from '@/theme';

import { AuthLogo } from '../components/auth-backdrop';
import { QuestionLayout, type QuestionLayoutProps } from '../components/question-layout';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

let mockKeyboardVisible = false;
jest.mock('@/hooks/use-keyboard-visible', () => ({
  useKeyboardVisible: () => mockKeyboardVisible,
}));

const insets = { top: 47, bottom: 34, left: 0, right: 0 };
const metrics = { frame: { x: 0, y: 0, width: 402, height: 874 }, insets };

const EMAIL_TITLE = t('auth.signUp.emailTitle');
const NAME_TITLE = t('auth.signUp.nameTitle');

function question(props: Partial<QuestionLayoutProps> = {}, field: ReactNode = <Text>campo</Text>) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <QuestionLayout stepKey="email" title={EMAIL_TITLE} footer={<Text>pé</Text>} {...props}>
        {field}
      </QuestionLayout>
    </SafeAreaProvider>
  );
}

/** Caixa (em host) mais próxima acima do nó. */
function hostParent(node: ReturnType<typeof screen.getByText>) {
  let current = node.parent;
  while (current && typeof current.type !== 'string') current = current.parent;
  if (!current) throw new Error('nó sem caixa em volta');
  return current;
}

let timing: jest.SpyInstance;
let focus: jest.SpyInstance;

/** As entradas pedidas (o conteúdo subindo com fade), fora o enchimento da barra de etapas. */
const entrances = () =>
  timing.mock.calls.filter(
    ([, config]) => (config as { duration?: number }).duration === motion.duration.base,
  );

/** Os textos que receberam o foco do leitor de tela. */
const focused = () =>
  focus.mock.calls.map(
    ([node, event]) => [(node as { props: { children: unknown } }).props.children, event] as const,
  );

// O mock do ScrollView do React Native põe os métodos no protótipo.
const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;

/** As rolagens pedidas, na ordem. */
const scrolls = () => scrollTo.mock.calls.map(([target]) => target as object);

// As medidas do desenho (frame de 390 x 844). A pergunta começa a 77 do miolo
// (os 74 de cima e a barra de etapas, de 3), e o bloco do campo, 157 abaixo
// dela (y 234 do miolo), com os 58 do campo: o alvo de 44, a folga de 12 e a
// linha de 2.
const QUESTION_TOP = 77;
const FIELD = { top: 157, height: 58 };
const FIELD_TOP = QUESTION_TOP + FIELD.top;
const FIELD_END = FIELD_TOP + FIELD.height;
// A rolagem à vista: sem o teclado, a pergunta cabe com sobra; com ele, num
// aparelho de 360 x 640, sobram uns 262 entre a barra de status e o pé.
const TALL = 542;
const SHORT = 262;
// A linha do erro embaixo do campo, com a folga até ele.
const ERROR_LINE = 21;

const box = (y: number, height: number) => ({
  nativeEvent: { layout: { x: 0, y, width: 346, height } },
});

/** A rolagem mudou de altura: o teclado abriu ou fechou, a mensagem do envio apareceu no pé. */
const resizeScroll = (height: number) =>
  fireEvent(screen.UNSAFE_getByType(ScrollView), 'layout', box(0, height));

/** A pergunta dentro do miolo, embaixo da barra de etapas. */
const placeQuestion = () =>
  fireEvent(screen.getByTestId('question-content'), 'layout', box(QUESTION_TOP, 400));

/** O bloco do campo dentro da pergunta: muda quando o erro aparece e quando a pergunta troca. */
const resizeField = (field = FIELD) =>
  fireEvent(screen.getByTestId('question-field'), 'layout', box(field.top, field.height));

/** Mede a pergunta como o nativo faria ao montar: a rolagem, a pergunta e o bloco do campo. */
function measure(viewport: number, field = FIELD) {
  resizeScroll(viewport);
  placeQuestion();
  resizeField(field);
}

/** O quadro seguinte, em que a rolagem pedida sai (no Jest, o quadro é um timer de zero). */
const nextFrame = () => jest.advanceTimersByTime(0);

beforeEach(() => {
  // O `AccessibilityInfo` do Jest já é um mock, e o `restoreAllMocks` não zera as chamadas dele.
  jest.clearAllMocks();
  mockReducedMotion = false;
  mockKeyboardVisible = false;
  timing = jest.spyOn(Reanimated, 'withTiming');
  focus = jest
    .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('casca das perguntas da entrada', () => {
  describe('a pergunta', () => {
    it('o título é o cabeçalho, grande e no centro, com o texto de apoio embaixo', () => {
      const lead = t('auth.signIn.emailQuestion');
      render(question({ lead }));
      expect(screen.getByRole('header', { name: EMAIL_TITLE })).toHaveStyle({
        ...typography.titleOnboarding,
        textAlign: 'center',
      });
      expect(screen.getByText(lead)).toHaveStyle({
        ...typography.body,
        color: colors.textSecondary,
        textAlign: 'center',
      });
    });

    it('o título de duas linhas quebra em linhas parecidas, sem palavra sozinha na última', () => {
      render(question({ stepKey: 'invite', title: t('auth.signUp.inviteStepTitle') }));
      expect(screen.getByRole('header').props).toMatchObject({
        // Android e iOS, cada um com a sua opção.
        textBreakStrategy: 'balanced',
        lineBreakStrategyIOS: 'push-out',
      });
    });

    it('a barra de etapas do cadastro enche até onde a pergunta manda', () => {
      render(question({ progress: { current: 1, total: 2, fill: 2 / 3 } }));
      expect(
        screen.getByRole('progressbar', {
          name: t('components.stepProgress.label', { current: 1, total: 2 }),
        }),
      ).toBeOnTheScreen();
      expect(screen.UNSAFE_getByType(StepProgress).props).toMatchObject({
        current: 1,
        total: 2,
        currentFill: 2 / 3,
      });
    });

    it('sem etapas (o entrar) e sem pílula, os dois lugares ficam reservados: o título não pula', () => {
      render(question());
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.getByTestId('question-progress')).toHaveStyle({ height: layout.stepBar });
      expect(screen.getByTestId('question-above')).toHaveStyle({
        minHeight: layout.minTouchTarget,
      });
    });

    it('a pílula do e-mail vai no lugar dela, acima do título, no centro', () => {
      render(question({ above: <Text>pílula</Text> }));
      const slot = screen.getByTestId('question-above');
      expect(within(slot).getByText('pílula')).toBeOnTheScreen();
      expect(slot).toHaveStyle({ alignItems: 'center' });
    });

    it('o lugar da pílula cresce com ela: com a fonte grande, o e-mail quebra a linha e não é cortado', () => {
      render(question({ above: <Text>pílula</Text> }));
      const slot = StyleSheet.flatten(screen.getByTestId('question-above').props.style);
      // Altura mínima, e não fixa, e sem esconder o que passar dela.
      expect(slot.minHeight).toBe(layout.minTouchTarget);
      expect(slot.height).toBeUndefined();
      expect(slot.maxHeight).toBeUndefined();
      expect(slot.overflow).toBeUndefined();
    });

    it('o campo fica a 44 do título e mais 22 para dentro de cada lado', () => {
      render(question());
      expect(hostParent(screen.getByText('campo'))).toHaveStyle({
        marginTop: 44,
        paddingHorizontal: spacing.gutterOnboarding,
      });
    });

    it('com texto de apoio, o campo fica a 32 dele', () => {
      render(question({ lead: t('auth.signUp.inviteCodeHint') }));
      expect(hostParent(screen.getByText('campo'))).toHaveStyle({ marginTop: 32 });
    });
  });

  describe('a rolagem e o pé', () => {
    it('o miolo rola sem fechar o teclado no toque, e o pé fica fora da rolagem', () => {
      render(question({ secondary: <Text>link</Text> }));
      const scroll = screen.UNSAFE_getByType(ScrollView);
      expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
      expect(within(scroll).getByText(EMAIL_TITLE)).toBeOnTheScreen();
      expect(within(scroll).getByText('campo')).toBeOnTheScreen();
      expect(within(scroll).queryByText('pé')).toBeNull();
      expect(screen.getByText('pé')).toBeOnTheScreen();
    });

    it('o link de baixo fica dentro da rolagem, depois do campo: preso no pé, cobria o campo com o teclado aberto', () => {
      render(question({ secondary: <Text>link</Text> }));
      const scroll = screen.UNSAFE_getByType(ScrollView);
      expect(
        within(scroll)
          .getAllByText(/./)
          .map((node) => node.props.children),
      ).toEqual([EMAIL_TITLE, 'campo', 'link']);
      expect(within(hostParent(screen.getByText('pé'))).queryByText('link')).toBeNull();
    });

    it('com altura sobrando, o link desce até o fim do miolo, a 12 do pé; sem ela, fica a 24 do campo', () => {
      render(question({ secondary: <Text>link</Text> }));
      // A pergunta ocupa o resto do miolo, e a caixa do link cresce com o link embaixo.
      expect(screen.getByTestId('question-content')).toHaveStyle({ flexGrow: 1 });
      expect(screen.getByTestId('question-secondary')).toHaveStyle({
        flexGrow: 1,
        justifyContent: 'flex-end',
        paddingTop: spacing.xl,
      });
      // Os 4 do fim do miolo e os 8 de cima do pé.
      const content = StyleSheet.flatten(
        screen.UNSAFE_getByType(ScrollView).props.contentContainerStyle,
      );
      expect(content).toMatchObject({ flexGrow: 1, paddingBottom: spacing.xs });
      expect(hostParent(screen.getByText('pé'))).toHaveStyle({ paddingTop: spacing.sm });
    });

    it('sem link de baixo, o lugar dele não existe', () => {
      render(question());
      expect(screen.queryByTestId('question-secondary')).toBeNull();
    });

    it('presos embaixo, fora da rolagem, ficam só a mensagem do envio e o pé, nessa ordem', () => {
      const text = t('auth.errors.network');
      render(question({ notice: { text, tone: 'danger' }, secondary: <Text>link</Text> }));
      const footer = hostParent(screen.getByText('pé'));
      expect(
        within(footer)
          .getAllByText(/./)
          .map((node) => node.props.children),
      ).toEqual([text, 'pé']);
      expect(within(screen.UNSAFE_getByType(ScrollView)).queryByText(text)).toBeNull();
      expect(screen.getByText(text)).toHaveStyle({
        ...typography.caption,
        color: colors.danger,
        textAlign: 'center',
      });
    });

    it('a mensagem neutra não usa a cor de erro', () => {
      const text = t('auth.signIn.resetSentShort');
      render(question({ notice: { text, tone: 'neutral' } }));
      expect(screen.getByText(text)).toHaveStyle({ color: colors.textSecondary });
    });

    it('sem teclado, o pé respeita a área segura de baixo', () => {
      render(question());
      expect(hostParent(hostParent(screen.getByText('pé')))).toHaveStyle({
        paddingBottom: insets.bottom,
      });
    });

    it('sem área segura de baixo, o pé fica a 16 do fim da tela', () => {
      render(
        <SafeAreaProvider initialMetrics={{ ...metrics, insets: { ...insets, bottom: 0 } }}>
          <QuestionLayout stepKey="email" title={EMAIL_TITLE} footer={<Text>pé</Text>}>
            <Text>campo</Text>
          </QuestionLayout>
        </SafeAreaProvider>,
      );
      expect(hostParent(hostParent(screen.getByText('pé')))).toHaveStyle({
        paddingBottom: spacing.lg,
      });
    });

    it('com o teclado aberto, a área segura de baixo sai do pé: o teclado a cobre', () => {
      mockKeyboardVisible = true;
      render(question());
      expect(hostParent(hostParent(screen.getByText('pé')))).toHaveStyle({
        paddingBottom: spacing.lg,
      });
    });
  });

  describe('o teclado', () => {
    const avoiding = () => screen.UNSAFE_getByType(KeyboardAvoidingView).props;

    it('fica em volta da tela inteira, colado ao topo: dentro dela, mediria a sobra errada', () => {
      render(question());
      const around = screen.UNSAFE_getByType(KeyboardAvoidingView);
      expect(around.findByType(Screen)).toBeTruthy();
      expect(around.props.style).toMatchObject({ flex: 1 });
    });

    it('no iOS, a tela sobe com o teclado desde o aviso dele: sempre ligado', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      render(question());
      expect(avoiding()).toMatchObject({ behavior: 'padding', enabled: true });
    });

    it('no Android, só com o teclado cobrindo o pé: o flutuante não sobe a tela', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      const { rerender } = render(question());
      expect(avoiding()).toMatchObject({ behavior: 'padding', enabled: false });

      mockKeyboardVisible = true;
      rerender(question());
      expect(avoiding().enabled).toBe(true);
    });

    it('o logo do fundo vem de novo por cima do véu das perguntas, no mesmo lugar e a .75', () => {
      render(question());
      const scrim = screen.UNSAFE_getByType(Scrim);
      const logo = screen.UNSAFE_getByType(AuthLogo);
      expect(logo.parent).toBe(scrim.parent);
      const layers = scrim.parent!.children;
      expect(layers.indexOf(logo)).toBeGreaterThan(layers.indexOf(scrim));
      expect(screen.UNSAFE_getByType(Logo).props).toMatchObject({ height: 17, opacity: 0.75 });
      expect(isHiddenFromAccessibility(screen.UNSAFE_getByType(Logo))).toBe(true);
    });

    it('o véu das perguntas tem a altura da tela, e não a da tela encolhida pelo teclado', () => {
      render(question());
      expect(screen.UNSAFE_getByType(Scrim).props).toMatchObject({
        preset: 'authQuestion',
        style: { height: metrics.frame.height },
      });
    });
  });

  describe('a troca de pergunta', () => {
    it('na primeira, nada entra e o foco do leitor de tela não é mexido', () => {
      jest.useFakeTimers();
      render(question());
      jest.runOnlyPendingTimers();

      expect(entrances()).toHaveLength(0);
      expect(focus).not.toHaveBeenCalled();
      expect(hostParent(screen.getByText(EMAIL_TITLE))).toHaveStyle({
        opacity: 1,
        transform: [{ translateY: 0 }],
      });
    });

    it('a pergunta nova entra subindo com fade, e o foco do leitor vai ao título dela', () => {
      jest.useFakeTimers();
      const { rerender } = render(question());

      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      expect(entrances()).toEqual([[1, expect.objectContaining({ easing: motion.easing.out })]]);
      // O foco espera o conteúdo aparecer.
      expect(focus).not.toHaveBeenCalled();
      jest.advanceTimersByTime(motion.duration.fast);
      expect(focused()).toEqual([[NAME_TITLE, 'focus']]);
    });

    it('a mesma pergunta renderizada de novo (o fã digitando) não entra de novo nem mexe no foco', () => {
      jest.useFakeTimers();
      const { rerender } = render(question());
      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      jest.runOnlyPendingTimers();
      timing.mockClear();
      focus.mockClear();

      rerender(question({ stepKey: 'name', title: NAME_TITLE }, <Text>campo com texto</Text>));
      jest.runOnlyPendingTimers();
      expect(entrances()).toHaveLength(0);
      expect(focus).not.toHaveBeenCalled();
    });

    it('com a chave do foco, a pergunta que volta por um erro entra subindo, mas o foco do leitor fica com o anúncio', () => {
      jest.useFakeTimers();
      const { rerender } = render(question({ stepKey: 'password:0', focusKey: '2' }));

      // O envio falhou: a mesma pergunta volta no lugar do momento, como uma nova.
      rerender(question({ stepKey: 'password:1', focusKey: '2' }));
      expect(entrances()).toHaveLength(1);
      jest.runOnlyPendingTimers();
      expect(focus).not.toHaveBeenCalled();

      // O fã troca de pergunta: aí sim o foco vai ao título.
      rerender(question({ stepKey: 'name:1', focusKey: '3', title: NAME_TITLE }));
      jest.advanceTimersByTime(motion.duration.fast);
      expect(focused()).toEqual([[NAME_TITLE, 'focus']]);
    });

    it('voltar à pergunta anterior também é uma troca', () => {
      jest.useFakeTimers();
      const { rerender } = render(question({ stepKey: 'name', title: NAME_TITLE }));
      rerender(question());
      jest.advanceTimersByTime(motion.duration.fast);

      expect(entrances()).toHaveLength(1);
      expect(focused()).toEqual([[EMAIL_TITLE, 'focus']]);
    });

    it('a barra de etapas e o pé não entram junto: só o conteúdo da pergunta', () => {
      render(question({ progress: { current: 1, total: 2, fill: 1 / 3 } }));
      const content = hostParent(screen.getByText(EMAIL_TITLE));
      expect(within(content).getByTestId('question-above')).toBeOnTheScreen();
      expect(within(content).getByText('campo')).toBeOnTheScreen();
      expect(within(content).queryByRole('progressbar')).toBeNull();
      expect(within(content).queryByText('pé')).toBeNull();
    });

    it('o link de baixo é da pergunta: entra junto com ela, e não troca seco', () => {
      render(question({ secondary: <Text>link</Text> }));
      const content = hostParent(screen.getByText(EMAIL_TITLE));
      expect(content).toBe(screen.getByTestId('question-content'));
      expect(within(content).getByText('link')).toBeOnTheScreen();
    });

    it('com reduzir movimento, a troca é seca, e o foco do leitor vai do mesmo jeito', () => {
      mockReducedMotion = true;
      jest.useFakeTimers();
      const { rerender } = render(question());

      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      expect(entrances()).toHaveLength(0);
      expect(hostParent(screen.getByText(NAME_TITLE))).toHaveStyle({
        opacity: 1,
        transform: [{ translateY: 0 }],
      });
      jest.advanceTimersByTime(motion.duration.fast);
      expect(focused()).toEqual([[NAME_TITLE, 'focus']]);
    });
  });

  describe('o campo à vista: ele, o erro dele e o que vem logo abaixo nunca ficam atrás do pé', () => {
    // Onde a rolagem para com o teclado aberto: o fim do bloco do campo, com a folga do fim do miolo.
    const REVEALED = FIELD_END + spacing.xs - SHORT;

    /** A pergunta aberta e medida, com o teclado aberto e a rolagem já no lugar. */
    function openWithKeyboard(props: Partial<QuestionLayoutProps> = {}) {
      const view = render(question(props));
      measure(TALL);
      nextFrame();
      resizeScroll(SHORT);
      nextFrame();
      scrollTo.mockClear();
      return view;
    }

    beforeEach(() => jest.useFakeTimers());

    it('abrindo com tudo cabendo, a rolagem fica no começo, posta no lugar sem animar', () => {
      render(question());
      measure(TALL);
      // O pedido só sai no quadro seguinte, e os três avisos de medida viram uma rolagem só.
      expect(scrollTo).not.toHaveBeenCalled();
      nextFrame();
      expect(scrolls()).toEqual([{ y: 0, animated: false }]);
    });

    it('o teclado abre (a rolagem encolhe): rola até o fim do bloco do campo, com a folga do fim do miolo', () => {
      render(question());
      measure(TALL);
      nextFrame();
      scrollTo.mockClear();

      resizeScroll(SHORT);
      expect(scrollTo).not.toHaveBeenCalled();
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED, animated: true }]);
      // O campo inteiro acima do pé, com os 4 de folga embaixo dele.
      expect(REVEALED + SHORT).toBe(FIELD_END + spacing.xs);
    });

    it('a tela que abre com o teclado já aberto nasce com o campo à vista, sem animar', () => {
      render(question());
      measure(SHORT);
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED, animated: false }]);
    });

    it('o erro aparece embaixo do campo (o bloco cresce): a rolagem vai até o fim dele', () => {
      openWithKeyboard();
      resizeField({ ...FIELD, height: FIELD.height + ERROR_LINE });
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED + ERROR_LINE, animated: true }]);
    });

    it('o erro some (o bloco encolhe): a rolagem volta a terminar no fim do campo', () => {
      openWithKeyboard();
      resizeField({ ...FIELD, height: FIELD.height + ERROR_LINE });
      nextFrame();
      resizeField();
      nextFrame();
      expect(scrolls()).toEqual([
        { y: REVEALED + ERROR_LINE, animated: true },
        { y: REVEALED, animated: true },
      ]);
    });

    it('a mensagem do envio aparece no pé (a rolagem encolhe mais): o bloco do campo sobe junto', () => {
      const notice = 27;
      openWithKeyboard();
      resizeScroll(SHORT - notice);
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED + notice, animated: true }]);
    });

    it('pergunta nova com o bloco do mesmo tamanho: a rolagem volta ao lugar dela', () => {
      const { rerender } = openWithKeyboard();
      // O `onLayout` não avisa quando nada muda de tamanho: quem pede é a troca.
      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      expect(scrollTo).not.toHaveBeenCalled();
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED, animated: true }]);
    });

    it('pergunta nova com o bloco mais alto (a senha, com o medidor e os termos): uma rolagem só, já com a medida nova', () => {
      const password = { ...FIELD, height: 168 };
      const { rerender } = openWithKeyboard();

      rerender(question({ stepKey: 'password', title: t('auth.signUp.passwordTitle') }));
      resizeField(password);
      nextFrame();
      expect(scrolls()).toEqual([
        { y: FIELD_TOP + password.height + spacing.xs - SHORT, animated: true },
      ]);
    });

    it('voltar à pergunta de bloco mais baixo traz a rolagem de volta', () => {
      const password = { ...FIELD, height: 168 };
      const { rerender } = openWithKeyboard({ stepKey: 'password' });
      resizeField(password);
      nextFrame();
      scrollTo.mockClear();

      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      resizeField();
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED, animated: true }]);
    });

    it('a mesma pergunta renderizada de novo (o fã digitando) não pede rolagem', () => {
      const { rerender } = openWithKeyboard();
      rerender(question({}, <Text>campo com texto</Text>));
      nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('o aviso de medida que repete a mesma medida não pede rolagem: não desfaz a do dedo', () => {
      openWithKeyboard();
      resizeScroll(SHORT);
      placeQuestion();
      resizeField();
      nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('o bloco mais alto que a rolagem (a fonte a 200%): o campo fica no topo, e o resto rola por baixo do pé', () => {
      openWithKeyboard();
      resizeField({ ...FIELD, height: SHORT + 80 });
      nextFrame();
      expect(scrolls()).toEqual([{ y: FIELD_TOP, animated: true }]);
    });

    it('no Android, a rolagem que cresce (o teclado fechou) não pede nada: o sistema já a traz de volta', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      openWithKeyboard();
      resizeScroll(TALL);
      nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('no iOS, a rolagem que cresce volta ao começo: sozinha, a pergunta ficaria deslocada', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      openWithKeyboard();
      resizeScroll(TALL);
      nextFrame();
      expect(scrolls()).toEqual([{ y: 0, animated: true }]);
    });

    it('a rolagem aceita o destino pedido enquanto ainda encolhe com o teclado (iOS)', () => {
      render(question());
      expect(screen.UNSAFE_getByType(ScrollView).props.scrollToOverflowEnabled).toBe(true);
    });

    it('com reduzir movimento, a rolagem vai até o campo sem animar', () => {
      mockReducedMotion = true;
      const { rerender } = openWithKeyboard();

      resizeField({ ...FIELD, height: FIELD.height + ERROR_LINE });
      nextFrame();
      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      nextFrame();
      expect(scrolls()).toEqual([
        { y: REVEALED + ERROR_LINE, animated: false },
        { y: REVEALED + ERROR_LINE, animated: false },
      ]);
    });

    it('sem as medidas, o pedido não vira rolagem, nem marca o quadro', () => {
      const { rerender } = render(question());
      const idle = jest.getTimerCount();
      // Só a altura da rolagem, sem a pergunta nem o campo.
      resizeScroll(SHORT);
      expect(jest.getTimerCount()).toBe(idle);
      nextFrame();
      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();

      // As que faltavam chegam: aí sim, e é a primeira vez (sem animar).
      placeQuestion();
      resizeField();
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED, animated: false }]);
    });

    it('a rolagem sem altura ainda não foi medida: a medida de verdade que vem depois vale como a primeira', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      render(question());
      measure(0);
      nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();

      resizeScroll(SHORT);
      nextFrame();
      expect(scrolls()).toEqual([{ y: REVEALED, animated: false }]);
    });

    it('sem medida nenhuma (o Jest das telas não mede), a troca de pergunta não marca quadro', () => {
      const frame = jest.spyOn(globalThis, 'requestAnimationFrame');
      const { rerender } = render(question());
      rerender(question({ stepKey: 'name', title: NAME_TITLE }));
      rerender(question({ stepKey: 'password', title: t('auth.signUp.passwordTitle') }));
      expect(frame).not.toHaveBeenCalled();
    });

    it('a tela que sai com a rolagem pedida desfaz o pedido: nada rola depois', () => {
      const { unmount } = openWithKeyboard();
      const idle = jest.getTimerCount();
      resizeField({ ...FIELD, height: FIELD.height + ERROR_LINE });
      // O quadro pedido está marcado.
      expect(jest.getTimerCount()).toBe(idle + 1);

      unmount();
      expect(jest.getTimerCount()).toBe(idle);
      nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });
});
