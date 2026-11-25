import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Scrim } from '@/components/scrim';
import { Screen } from '@/components/screen';
import { StepProgress } from '@/components/step-progress';
import { Text, type TextInstance } from '@/components/text';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { colors, layout, motion, spacing } from '@/theme';

import { AuthLogo } from './auth-backdrop';

export interface QuestionLayoutProps {
  /** Barra de etapas do cadastro; sem ela, o lugar fica reservado e o título não pula. */
  progress?: { current: number; total: number; fill: number };
  /**
   * Muda a cada pergunta: dispara a entrada do conteúdo e, sem `focusKey`,
   * leva o foco do leitor ao título.
   */
  stepKey: string;
  /**
   * Quando muda, o foco do leitor de tela vai ao título. A tela passa uma chave
   * que só muda quando o próprio fã troca de pergunta: a pergunta que volta
   * por causa de um erro (o envio que falhou, o e-mail recusado, o código
   * recusado) entra subindo, mas o leitor fica com o anúncio do erro, que o
   * foco no título cortaria no meio.
   */
  focusKey?: string;
  /** Acima do título (a pílula do e-mail); sem ela, o lugar fica reservado. */
  above?: ReactNode;
  title: string;
  lead?: string;
  /**
   * O campo e o que vai junto dele (medidor, aviso dos termos, link da senha).
   * É o bloco que a rolagem mantém à vista, acima do pé e do teclado.
   */
  children: ReactNode;
  /** Mensagem de envio que não é de um campo (rede, tentativas), acima do pé. */
  notice?: { text: string; tone: 'danger' | 'neutral' };
  /**
   * Link de baixo (trocar entre entrar e criar conta, convite). Fica no fim do
   * miolo, dentro da rolagem: encostado no pé quando sobra altura e, quando
   * não sobra, depois do campo, sem cobri-lo.
   */
  secondary?: ReactNode;
  footer: ReactNode;
}

// Medidas do desenho das perguntas (frame de 390 x 844, com a área segura de
// cima em 44), contadas a partir da área segura.
// A barra de etapas fica a 74 (y 118), 35 abaixo do logo do fundo.
const PROGRESS_TOP = 74;
// O lugar da pílula começa a 28 do topo da barra (y 146).
const ABOVE_TOP = 28 - layout.stepBar;
// Do título ao campo, quando não há texto de apoio entre os dois.
const CONTENT_TOP = 44;
// O texto de apoio tem 290 de largura no frame: 28 para dentro da margem.
const LEAD_INSET = 28;
// A folga do fim do miolo até a borda do pé: a do link de baixo e a que o fim
// do bloco do campo ganha quando a rolagem vai até ele. Com os 8 de cima do
// pé, são os 12 que separam o link da fileira do voltar.
const CONTENT_END = spacing.xs;

/**
 * O conteúdo que troca dentro de uma tela (a pergunta seguinte) entra subindo
 * `motion.stagger.rise` com fade, quando `key` muda. Por valor animado, e não
 * pelo `entering` do Reanimated, que já apagou uma tela inteira no Android, nem
 * por uma `key` na caixa, que remontaria os filhos: o campo que a tela mantém
 * montado segue com o foco, e o teclado não fecha entre uma pergunta e a outra.
 *
 * Na montagem o conteúdo nasce no lugar (quem o traz é o fade da pilha); com
 * `onMount`, entra também na primeira vez (o momento "Conta criada", que
 * aparece no lugar da pergunta). Com reduzir movimento, a troca é seca.
 */
export function useContentEntrance(key: string, { onMount = false }: { onMount?: boolean } = {}) {
  const reducedMotion = usePrefersReducedMotion();
  // O conteúdo que já entrou, visto do efeito e, em `shown`, do thread de UI.
  const entered = useRef(onMount ? null : key);
  const shown = useSharedValue(onMount ? null : key);
  const progress = useSharedValue(1);

  useEffect(() => {
    if (entered.current === key) return;
    entered.current = key;
    if (reducedMotion) {
      shown.set(key);
      return;
    }
    progress.set(0);
    shown.set(key);
    progress.set(withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }));
  }, [key, reducedMotion, shown, progress]);

  return useAnimatedStyle(() => {
    // No render em que o conteúdo muda, `shown` ainda tem a chave antiga: o
    // novo já nasce apagado, e nada pisca antes de a entrada começar.
    const visible = reducedMotion || shown.get() === key ? progress.get() : 0;
    return {
      opacity: visible,
      transform: [{ translateY: (1 - visible) * motion.stagger.rise }],
    };
  });
}

/**
 * Pergunta nova: o foco do leitor de tela vai ao título dela, logo depois de
 * ela aparecer (o botão que o fã tocou continua na tela, mas a pergunta em
 * volta mudou). Na primeira não: o leitor começa pela tela sozinho.
 */
function useTitleFocus(focusKey: string) {
  const title = useRef<TextInstance>(null);
  const focused = useRef(focusKey);

  useEffect(() => {
    if (focused.current === focusKey) return undefined;
    focused.current = focusKey;
    const timer = setTimeout(() => {
      if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
    }, motion.duration.fast);
    return () => clearTimeout(timer);
  }, [focusKey]);

  return title;
}

/** O que a rolagem da pergunta já mediu (pelo `onLayout`) e a rolagem que ela tem pedida. */
interface RevealState {
  /** A altura da rolagem à vista, entre a área segura de cima e o pé. */
  viewport: number | null;
  /** Onde a pergunta começa dentro do miolo, embaixo da barra de etapas. */
  questionTop: number | null;
  /** O bloco do campo dentro da pergunta: onde começa e a altura. */
  field: { top: number; height: number } | null;
  /** O quadro em que a rolagem pedida sai, quando há uma pedida. */
  frame: number | null;
  /** A rolagem já foi posta no lugar uma vez (a tela abrindo). */
  placed: boolean;
}

/**
 * Até onde a rolagem vai para o bloco do campo terminar à vista, com a folga
 * do fim do miolo. Com tudo cabendo, o começo. Com o bloco mais alto que a
 * rolagem (a fonte a 200% num aparelho baixo), o campo fica no topo e o resto
 * do bloco rola por baixo do pé. `null` enquanto falta alguma medida.
 */
function fieldRevealOffset({ viewport, questionTop, field }: RevealState): number | null {
  if (viewport === null || questionTop === null || field === null) return null;
  const top = questionTop + field.top;
  const end = top + field.height + CONTENT_END;
  return Math.max(0, Math.min(top, end - viewport));
}

/**
 * Pede a rolagem até o bloco do campo para o quadro seguinte; os pedidos do
 * mesmo quadro viram um só (a pergunta nova e as medidas dela chegam em avisos
 * separados). No quadro seguinte, e não na hora: no Android, o comando de
 * rolar é executado antes da montagem do mesmo lote, ainda com a altura de
 * antes de o teclado abrir, e a rolagem não chegaria ao campo. Sem as medidas,
 * não há o que pedir: a que faltar pede de novo quando chegar.
 */
function requestReveal(
  scroll: RefObject<ScrollView | null>,
  state: RevealState,
  animated: boolean,
): void {
  if (state.frame !== null || fieldRevealOffset(state) === null) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = null;
    const y = fieldRevealOffset(state);
    if (y === null || !scroll.current) return;
    // A primeira vez é a tela abrindo: o campo nasce no lugar, sem rolar à vista.
    scroll.current.scrollTo({ y, animated: animated && state.placed });
    state.placed = true;
  });
}

/**
 * O campo da pergunta, o erro dele e o que vem logo abaixo (a regra da senha)
 * nunca ficam atrás do pé: a rolagem vai até o fim do bloco do campo quando
 * ela encolhe (o teclado abriu, a mensagem do envio apareceu no pé), quando o
 * bloco muda de tamanho (o erro apareceu embaixo do campo) e a cada pergunta
 * nova. No Android, o encolhimento já traz o campo em foco, mas não o que vem
 * embaixo dele; no iOS, nada rola sozinho. Com reduzir movimento, sem animar.
 *
 * As medidas vêm do `onLayout` da rolagem, da pergunta e do bloco do campo.
 */
function useFieldReveal(stepKey: string) {
  const reducedMotion = usePrefersReducedMotion();
  const scroll = useRef<ScrollView>(null);
  const state = useRef<RevealState>({
    viewport: null,
    questionTop: null,
    field: null,
    frame: null,
    placed: false,
  });
  const revealed = useRef(stepKey);

  // Pergunta nova, mesmo com o bloco do mesmo tamanho da anterior (o `onLayout`
  // não avisa): a rolagem volta ao lugar dela, onde quer que o fã a tenha deixado.
  useEffect(() => {
    if (revealed.current === stepKey) return;
    revealed.current = stepKey;
    requestReveal(scroll, state.current, !reducedMotion);
  }, [stepKey, reducedMotion]);

  // A tela saiu com uma rolagem pedida: o pedido não chega a sair.
  useEffect(() => {
    const current = state.current;
    return () => {
      if (current.frame === null) return;
      cancelAnimationFrame(current.frame);
      current.frame = null;
    };
  }, []);

  const reveal = (): void => requestReveal(scroll, state.current, !reducedMotion);

  return {
    scroll,
    onViewportLayout: (event: LayoutChangeEvent): void => {
      const { height } = event.nativeEvent.layout;
      const previous = state.current.viewport;
      // Sem altura, a rolagem ainda não foi medida de verdade.
      if (height <= 0 || previous === height) return;
      state.current.viewport = height;
      // Crescendo (o teclado fechou), o Android traz sozinho a rolagem de volta
      // para dentro do conteúdo, e o pedido brigaria com o dedo de quem arrastou
      // para fechar o teclado. O iOS não traz: a pergunta ficaria deslocada até
      // o próximo toque.
      if (previous === null || height < previous || Platform.OS === 'ios') reveal();
    },
    onQuestionLayout: (event: LayoutChangeEvent): void => {
      const { y } = event.nativeEvent.layout;
      if (state.current.questionTop === y) return;
      state.current.questionTop = y;
      reveal();
    },
    onFieldLayout: (event: LayoutChangeEvent): void => {
      const { y, height } = event.nativeEvent.layout;
      const previous = state.current.field;
      if (previous && previous.top === y && previous.height === height) return;
      state.current.field = { top: y, height };
      reveal();
    },
  };
}

/**
 * Casca de uma pergunta da entrada (cadastro e entrar com e-mail): uma
 * pergunta por tela, com o título grande no centro, o campo embaixo dele e o
 * pé (voltar e botão) preso acima do teclado. As perguntas de um fluxo são
 * passos da mesma tela: o que muda é o `stepKey`, e a barra de etapas, o véu
 * e o pé ficam no lugar enquanto o conteúdo troca.
 *
 * O título fica na mesma altura em toda pergunta: a barra de etapas e a pílula
 * do e-mail têm o lugar reservado mesmo quando não aparecem. O miolo rola (o
 * texto a 200%, o aparelho pequeno com o teclado aberto), e fora da rolagem,
 * presos embaixo, ficam só a mensagem do envio e o pé. O link de baixo é o fim
 * do miolo: preso junto do pé, num aparelho baixo (360 x 640) com o teclado
 * aberto ele cobria o campo. A rolagem mantém à vista o bloco do campo
 * (`useFieldReveal`).
 *
 * O teclado é o do post (`post-details`): o `KeyboardAvoidingView` em volta da
 * `Screen`, colado ao topo da tela, sempre ligado no iOS e, no Android, só com
 * o teclado cobrindo o pé (o flutuante avisa altura zero, e ligado ele subia o
 * pé a altura da barra de navegação). Com o teclado aberto, a área segura de
 * baixo sai do pé, porque o teclado a cobre.
 *
 * O aviso de offline fica no fluxo, embaixo da barra de status, e empurra a
 * pergunta, como nos formulários de conta de antes: flutuando, com o texto
 * grande ele cobriria as etapas e o título justo quando o envio falha por
 * falta de rede.
 */
export function QuestionLayout({
  progress,
  stepKey,
  focusKey,
  above,
  title,
  lead,
  children,
  notice,
  secondary,
  footer,
}: QuestionLayoutProps) {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const keyboardVisible = useKeyboardVisible();
  const entranceStyle = useContentEntrance(stepKey);
  const titleRef = useTitleFocus(focusKey ?? stepKey);
  const { scroll, onViewportLayout, onQuestionLayout, onFieldLayout } = useFieldReveal(stepKey);
  const isIOS = Platform.OS === 'ios';
  const footerBottom = keyboardVisible ? spacing.lg : Math.max(insets.bottom, spacing.lg);

  return (
    <KeyboardAvoidingView behavior="padding" enabled={isIOS || keyboardVisible} style={styles.fill}>
      <Screen
        transparent
        padded={false}
        // O véu tem a altura da tela, e não a da `Screen`, que encolhe com o
        // teclado: as paradas do degradê são frações da altura, e presas a
        // ela a parede do fundo escureceria a cada vez que o teclado sobe.
        backdrop={
          <>
            <Scrim preset="authQuestion" style={{ height: frame.height }} />
            {/* O véu cobriria o logo do fundo: ele vem de novo, por cima. */}
            <AuthLogo />
          </>
        }
        contentStyle={{ paddingBottom: footerBottom }}
      >
        <ScrollView
          ref={scroll}
          style={styles.fill}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={isIOS ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          // No iOS, o `KeyboardAvoidingView` encolhe a rolagem aos poucos, junto
          // com o teclado, e o comando de rolar é limitado pela altura que ela
          // tem na hora: pedida no começo da subida, a rolagem até o campo
          // pararia antes dele. O destino pedido nunca passa do fim do miolo.
          scrollToOverflowEnabled
          onLayout={onViewportLayout}
        >
          <View testID="question-progress" style={styles.progress}>
            {progress ? (
              <StepProgress
                current={progress.current}
                total={progress.total}
                currentFill={progress.fill}
              />
            ) : null}
          </View>
          <Animated.View
            testID="question-content"
            onLayout={onQuestionLayout}
            style={[styles.question, entranceStyle]}
          >
            <View testID="question-above" style={styles.above}>
              {above}
            </View>
            <Text
              ref={titleRef}
              variant="titleOnboarding"
              accessibilityRole="header"
              // O título que não cabe numa linha ("Qual é o código do
              // convite?") quebra em linhas parecidas, como no desenho, sem
              // deixar uma palavra sozinha na última.
              textBreakStrategy="balanced"
              lineBreakStrategyIOS="push-out"
              style={styles.title}
            >
              {title}
            </Text>
            {lead ? (
              <Text variant="body" color={colors.textSecondary} style={styles.lead}>
                {lead}
              </Text>
            ) : null}
            <View
              testID="question-field"
              onLayout={onFieldLayout}
              style={[styles.body, !!lead && styles.bodyAfterLead]}
            >
              {children}
            </View>
            {secondary ? (
              <View testID="question-secondary" style={styles.secondary}>
                {secondary}
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>
        <View style={styles.footer}>
          {notice ? (
            <Text
              variant="caption"
              color={notice.tone === 'danger' ? colors.danger : colors.textSecondary}
              style={styles.notice}
            >
              {notice.text}
            </Text>
          ) : null}
          {footer}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  // Cresce até a altura da tela; com o conteúdo maior que ela, rola.
  content: {
    flexGrow: 1,
    paddingTop: PROGRESS_TOP,
    paddingHorizontal: spacing.gutterOnboarding,
    paddingBottom: CONTENT_END,
  },
  // Reservado também no entrar, que não tem etapas.
  progress: {
    height: layout.stepBar,
  },
  // A pergunta ocupa o resto do miolo, para o link de baixo descer até o fim dele.
  question: {
    flexGrow: 1,
  },
  // O alvo de 44 da pílula. Altura mínima: com a fonte grande, ela cresce.
  above: {
    minHeight: layout.minTouchTarget,
    marginTop: ABOVE_TOP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: spacing.cardPadding,
    textAlign: 'center',
  },
  lead: {
    marginTop: spacing.md,
    paddingHorizontal: LEAD_INSET,
    textAlign: 'center',
  },
  // O campo fica mais 22 para dentro de cada lado (302 no frame de 390).
  body: {
    marginTop: CONTENT_TOP,
    paddingHorizontal: spacing.gutterOnboarding,
  },
  bodyAfterLead: {
    marginTop: spacing.xxl,
  },
  // O link de baixo, no fim do miolo: com altura sobrando, a caixa cresce e
  // ele desce até o pé, como no desenho; sem ela (o aparelho baixo com o
  // teclado aberto, a fonte grande), vem a 24 do bloco do campo, e a pergunta
  // rola até ele.
  secondary: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: spacing.xl,
  },
  // Fora da rolagem: a mensagem do envio e a fileira do voltar com o botão.
  footer: {
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.gutterOnboarding,
  },
  notice: {
    textAlign: 'center',
  },
});
