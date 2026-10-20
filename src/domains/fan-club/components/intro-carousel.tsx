import {
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Megaphone,
  Send,
  type LucideIcon,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t, type TranslationKey } from '@/i18n';
import { colors, layout, motion, opacities, radii, shadows, spacing } from '@/theme';

type Step = { key: 'apply' | 'review' | 'posts' | 'share'; icon: LucideIcon };

// Os passos da apresentação, sem dinheiro (34.9, item 2): a página no artista,
// que era o terceiro, foi para as vantagens, e a análise diz o resultado.
const STEPS: readonly Step[] = [
  { key: 'apply', icon: Send },
  { key: 'review', icon: ClipboardCheck },
  { key: 'posts', icon: Camera },
  { key: 'share', icon: Megaphone },
];

const CIRCLE_SIZE = 84;
const CIRCLE_ICON_SIZE = 36;
const ARROW_ICON_SIZE = 22;
const DOT = { size: 6, active: 22 } as const;
// Quanto o passo que sai do centro encolhe e apaga, como no carrossel da referência.
const AWAY = { scale: 0.82, opacity: 0.35 } as const;

const titleKey = (step: Step) => `fanClub.intro.steps.${step.key}.title` as TranslationKey;
const bodyKey = (step: Step) => `fanClub.intro.steps.${step.key}.body` as TranslationKey;

/** O quanto a página `index` está longe do centro: 0 no centro, 1 a uma página dele. */
function distanceOf(offset: number, width: number, index: number): number {
  'worklet';
  return width > 0 ? Math.abs(offset / width - index) : index === 0 ? 0 : 1;
}

interface StepPageProps {
  step: Step;
  index: number;
  current: boolean;
  width: number;
  offset: SharedValue<number>;
  reducedMotion: boolean;
  onAction: (event: AccessibilityActionEvent) => void;
  stepRef: (node: View | null) => void;
}

function StepPage({
  step,
  index,
  current,
  width,
  offset,
  reducedMotion,
  onAction,
  stepRef,
}: StepPageProps) {
  // O passo encolhe e apaga ao sair do centro, seguindo o dedo. Com reduzir
  // movimento, fica parado: só a rolagem anda.
  const away = useAnimatedStyle(() => {
    if (reducedMotion) return { opacity: 1, transform: [{ scale: 1 }] };
    const distance = distanceOf(offset.get(), width, index);
    return {
      opacity: interpolate(distance, [0, 1], [1, AWAY.opacity], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(distance, [0, 1], [1, AWAY.scale], Extrapolation.CLAMP) }],
    };
  });
  const title = t(titleKey(step));
  const body = t(bodyKey(step));

  return (
    <View
      style={[styles.page, { width }]}
      // Só o passo do centro fala: os outros esperam a troca, que leva o foco.
      importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!current}
    >
      <Animated.View style={[styles.pageInner, away]}>
        <View
          ref={stepRef}
          accessible
          accessibilityLabel={t('fanClub.intro.stepLabel', {
            current: index + 1,
            total: STEPS.length,
            title,
            body,
          })}
          accessibilityActions={[
            { name: 'previous', label: t('fanClub.intro.previous') },
            { name: 'next', label: t('fanClub.intro.next') },
          ]}
          onAccessibilityAction={onAction}
          style={styles.step}
          testID={current ? 'fan-club-intro-step' : undefined}
        >
          <View style={styles.circle}>
            <Icon icon={step.icon} size={CIRCLE_ICON_SIZE} color={colors.onAccent} />
          </View>
          <Text variant="titleCard" color={colors.accent} style={styles.centered}>
            {title}
          </Text>
          <Text variant="bodyLead" color={colors.textSecondary} style={styles.centered}>
            {body}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

function Dot({
  index,
  width,
  offset,
}: {
  index: number;
  width: number;
  offset: SharedValue<number>;
}) {
  // O ponto do passo atual fica comprido e rosa; a troca segue a rolagem.
  const shape = useAnimatedStyle(() => {
    const distance = distanceOf(offset.get(), width, index);
    return {
      width: interpolate(distance, [0, 1], [DOT.active, DOT.size], Extrapolation.CLAMP),
      backgroundColor: interpolateColor(
        Math.min(distance, 1),
        [0, 1],
        [colors.accent, colors.trackStrong],
      ),
    };
  });
  return <Animated.View style={[styles.dot, shape]} />;
}

function StepArrow({
  icon,
  label,
  disabled,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic="selection"
      accessibilityLabel={label}
      testID={testID}
      style={[styles.arrow, disabled && styles.inactive]}
    >
      <Icon icon={icon} size={ARROW_ICON_SIZE} color={colors.textSecondary} />
    </PressableScale>
  );
}

/**
 * Os passos da apresentação (34.9, item 2) num carrossel que se arrasta para o
 * lado, uma página por passo: o ícone num círculo rosa, o título em rosa e uma
 * frase. Embaixo, os pontos (o do passo atual mais comprido) entre as setas de
 * voltar e avançar, para quem não arrasta. Cada passo é um foco só ("Passo 2
 * de 4. ..."), e só o do centro fala; as setas e as ações do leitor de tela
 * (anterior e próximo) trocam o passo e levam o foco a ele. Os pontos não
 * falam. Com a fonte grande, as páginas crescem juntas até o texto mais alto.
 */
export function IntroCarousel() {
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // A tela vai de ponta a ponta (o `Screen` sem margem), menos a área segura dos lados.
  const width = windowWidth - insets.left - insets.right;
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const stepRefs = useRef<(View | null)[]>([]);
  // O passo para onde as setas mandaram a rolagem. No Android, a rolagem
  // animada que um toque novo interrompe também avisa o fim, no meio do
  // caminho: sem o destino, o passo voltava para a página de lá.
  const target = useRef<number | null>(null);
  const offset = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      offset.set(event.contentOffset.x);
    },
  });

  const focusStep = (next: number): void => {
    // O foco do leitor vai ao passo novo, que diz "Passo N de 4" com o texto dele.
    setTimeout(
      () => {
        const node = stepRefs.current[next];
        if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
      },
      reducedMotion ? motion.duration.fast : motion.duration.slow,
    );
  };

  const goTo = (next: number): void => {
    if (next < 0 || next >= STEPS.length || next === index) return;
    target.current = next;
    scrollRef.current?.scrollTo({ x: next * width, animated: !reducedMotion });
    setIndex(next);
    focusStep(next);
  };

  // A página em que a rolagem parou. Indo para o passo das setas, só vale a
  // chegada; o arrasto do dedo desfaz o destino.
  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    if (width <= 0) return;
    const page = Math.min(
      STEPS.length - 1,
      Math.max(0, Math.round(event.nativeEvent.contentOffset.x / width)),
    );
    if (target.current !== null) {
      if (page !== target.current) return;
      target.current = null;
    }
    setIndex(page);
  };

  const onAction = (event: AccessibilityActionEvent): void => {
    if (event.nativeEvent.actionName === 'next') goTo(index + 1);
    if (event.nativeEvent.actionName === 'previous') goTo(index - 1);
  };

  return (
    <View testID="fan-club-intro-carousel">
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          target.current = null;
        }}
        onMomentumScrollEnd={settle}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        testID="fan-club-intro-pages"
      >
        {STEPS.map((step, position) => (
          <StepPage
            key={step.key}
            step={step}
            index={position}
            current={position === index}
            width={width}
            offset={offset}
            reducedMotion={reducedMotion}
            onAction={onAction}
            stepRef={(node) => {
              stepRefs.current[position] = node;
            }}
          />
        ))}
      </Animated.ScrollView>
      <View style={styles.controls}>
        <StepArrow
          icon={ChevronLeft}
          label={t('fanClub.intro.previous')}
          disabled={index === 0}
          onPress={() => goTo(index - 1)}
          testID="fan-club-intro-previous"
        />
        {/* Os pontos só desenham: o passo já diz "Passo N de 4" ao leitor. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.dots}
          testID="fan-club-intro-dots"
        >
          {STEPS.map((step, position) => (
            <Dot key={step.key} index={position} width={width} offset={offset} />
          ))}
        </View>
        <StepArrow
          icon={ChevronRight}
          label={t('fanClub.intro.next')}
          disabled={index === STEPS.length - 1}
          onPress={() => goTo(index + 1)}
          testID="fan-club-intro-next"
        />
      </View>
    </View>
  );
}

export const INTRO_STEP_COUNT = STEPS.length;

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: spacing.gutter,
  },
  pageInner: {
    flex: 1,
  },
  step: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentStrong,
    marginBottom: spacing.sm,
    ...shadows.glowAccent,
  },
  centered: {
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  arrow: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: {
    opacity: opacities.disabled,
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    height: DOT.size,
    borderRadius: radii.pill,
  },
});
