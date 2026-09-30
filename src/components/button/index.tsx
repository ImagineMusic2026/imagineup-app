import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import type { HapticEvent } from '@/services/haptics';
import {
  borderWidths,
  colors,
  layout,
  motion,
  opacities,
  radii,
  shadows,
  spacing,
  tints,
  type TypographyVariant,
} from '@/theme';
import { withAlpha } from '@/utils/color';

/**
 * - `primary`: rosa fechado, o CTA de toda tela.
 * - `points`: lima cheio, quando o assunto é ponto (resgate).
 * - `secondary`, `ghost`: escuros, para ação de apoio.
 * - `inverse`: branco com texto tinta, o "Criar minha conta" da 1k.
 * - `glass`: vidro claro com rótulo em Manrope, o "Já tenho conta" da 1k.
 * - `outline`: contornado, o "Eu vou" das linhas da 1m.
 * - `pointsTinted`: lima tingido, o "Chamar amigos +10" da 1m.
 * - `onPoints`, `onPointsSoft`: sobre o card lima da missão do dia (1b).
 * - `eventsTinted`: ciano tingido, o "Confirmado" proposto para a 1m.
 */
export type ButtonVariant =
  | 'primary'
  | 'points'
  | 'secondary'
  | 'ghost'
  | 'inverse'
  | 'glass'
  | 'outline'
  | 'pointsTinted'
  | 'onPoints'
  | 'onPointsSoft'
  | 'eventsTinted';

/**
 * `lg` e `md` são desenhados com o alvo inteiro; `mdCompact` (os do card da
 * missão do dia, 1b), `sm` e `xs` desenham menos que o alvo de 44.
 */
export type ButtonSize = 'lg' | 'md' | 'mdCompact' | 'sm' | 'xs';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  /** Estado de escolha para o leitor de tela, como o "Confirmado" da 1m. */
  selected?: boolean;
  /**
   * Estado, não ação (o "Na central" da 1d): o mesmo desenho, sem toque e lido
   * como texto. Fica no mesmo pressável, para a troca de uma ação para ele
   * seguir animada e o foco do leitor de tela não pular.
   */
  readOnly?: boolean;
  /** Brilho colorido embaixo. Padrão: só o `primary` em `lg` e `md`. Vale para `primary` e `points`. */
  glow?: boolean;
  haptic?: HapticEvent | null;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Vai no alvo de toque (margem, `flex`, `alignSelf`), não no desenho. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface Surface {
  background: string;
  border: string;
  foreground: string;
}

// Sobre o lima da missão do dia: tinta a .1 no fundo e .2 na borda (1b).
const ON_POINTS_SOFT = { fill: 0.1, border: 0.2 } as const;

// Toda variante tem borda (da cor do fundo nas cheias), para botões lado a lado
// terem a mesma altura, como na 1m.
const SURFACES: Record<ButtonVariant, Surface> = {
  primary: {
    // O CTA do protótipo usa #FF2D6F com texto branco (3,59:1, reprova AA).
    // accentStrong mantém o tom e passa em contraste.
    background: colors.accentStrong,
    border: colors.accentStrong,
    foreground: colors.onAccent,
  },
  points: { background: colors.points, border: colors.points, foreground: colors.onPoints },
  secondary: {
    background: colors.surfaceRaised,
    border: colors.borderStrong,
    foreground: colors.text,
  },
  ghost: { background: colors.transparent, border: colors.borderGlass, foreground: colors.text },
  inverse: { background: colors.inverse, border: colors.inverse, foreground: colors.onInverse },
  // Quem desenha o vidro é o `Glass`; estas são as cores que ele usa.
  glass: { background: colors.glass, border: colors.borderGlassStrong, foreground: colors.text },
  outline: {
    background: colors.transparent,
    border: colors.borderOutline,
    foreground: colors.text,
  },
  pointsTinted: {
    background: withAlpha(colors.points, tints.strong.fill),
    border: withAlpha(colors.points, tints.strong.border),
    foreground: colors.points,
  },
  onPoints: { background: colors.onPoints, border: colors.onPoints, foreground: colors.points },
  onPointsSoft: {
    background: withAlpha(colors.onPoints, ON_POINTS_SOFT.fill),
    border: withAlpha(colors.onPoints, ON_POINTS_SOFT.border),
    foreground: colors.onPoints,
  },
  eventsTinted: {
    background: withAlpha(colors.events, tints.soft.fill),
    border: withAlpha(colors.events, tints.soft.border),
    foreground: colors.events,
  },
};

const GLOW: Partial<Record<ButtonVariant, ViewStyle>> = {
  primary: shadows.glowAccent,
  points: shadows.glowPoints,
};

// Sora nos botões de marca; Manrope no vidro da 1k e no secundário sobre o
// lima (1b), como no protótipo. No `xs` o protótipo só usa Manrope.
const PLAIN_LABEL: ReadonlySet<ButtonVariant> = new Set(['glass', 'onPointsSoft']);
const LABEL_VARIANT: Record<ButtonSize, { brand: TypographyVariant; plain: TypographyVariant }> = {
  lg: { brand: 'button', plain: 'buttonAlt' },
  md: { brand: 'buttonSmall', plain: 'labelCompact' },
  mdCompact: { brand: 'buttonSmall', plain: 'labelCompact' },
  sm: { brand: 'chip', plain: 'labelCompact' },
  xs: { brand: 'buttonXs', plain: 'buttonXs' },
};

// Os tamanhos compactos (`layout.buttonHeight`) ficam abaixo do alvo: o
// pressável cresce até 44 por fora e o desenho fica centralizado dentro dele,
// porque no Fabric do iOS o hitSlop fora do pai não recebe toque.
const COMPACT: ReadonlySet<ButtonSize> = new Set(['mdCompact', 'sm', 'xs']);

const RADIUS: Record<ButtonSize, number> = {
  lg: radii.cta,
  md: radii.sm,
  mdCompact: radii.sm,
  sm: radii.xs,
  xs: radii.xxs,
};

const ICON_SIZE: Record<ButtonSize, number> = { lg: 18, md: 18, mdCompact: 16, sm: 14, xs: 14 };

/**
 * Botão de ação: rosa para ação, lima só quando o assunto é ponto. Trocar de
 * variante (entrar na central, confirmar presença) leva o fundo à cor nova em
 * HSV e o rótulo entra em fade, sem troca seca; com reduzir movimento, troca na hora.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  icon,
  loading = false,
  disabled = false,
  selected,
  readOnly = false,
  glow,
  haptic = 'tap',
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const surface = SURFACES[variant];
  const inactive = disabled || loading;
  const compact = COMPACT.has(size);
  const glowing = glow ?? (variant === 'primary' && !compact);
  const labelVariant = LABEL_VARIANT[size][PLAIN_LABEL.has(variant) ? 'plain' : 'brand'];
  const colorStyle = useSurfaceColors(surface.background, surface.border);
  const contentStyle = useContentFade(`${variant}|${label}|${loading}`);
  const { inactiveStyle, glowStyle } = useInactiveFade(inactive);
  const glowShadow = glowing ? GLOW[variant] : undefined;

  const surfaceStyle = [styles.surface, styles[size], compact ? null : styles.fill];

  const content = (
    <Animated.View style={[styles.content, compact && styles.contentCompact, contentStyle]}>
      {loading ? (
        <ActivityIndicator color={surface.foreground} />
      ) : (
        <>
          {icon ? (
            <Icon icon={icon} size={ICON_SIZE[size]} color={surface.foreground} strokeWidth={2.2} />
          ) : null}
          {/* Em todo tamanho o rótulo cresce até 200%, e o botão cresce com ele. */}
          <Text
            variant={labelVariant}
            color={surface.foreground}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={styles.label}
          >
            {label}
          </Text>
        </>
      )}
    </Animated.View>
  );

  return (
    <PressableScale
      onPress={readOnly ? undefined : onPress}
      disabled={inactive}
      // Sem `focusable`, o Android não marca o elemento como tocável ("toque
      // duas vezes para ativar"); o leitor de tela continua chegando nele.
      focusable={!readOnly}
      haptic={readOnly ? null : haptic}
      scaleTo={readOnly ? 1 : undefined}
      accessibilityRole={readOnly ? 'text' : 'button'}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={readOnly ? undefined : { busy: loading, disabled: inactive, selected }}
      testID={testID}
      style={[compact && styles.target, style]}
    >
      <View style={compact ? null : styles.fill}>
        {glowShadow ? (
          // O brilho fica fora do grupo que apaga: no Android, a camada fora da
          // tela corta o que passa da borda do botão, e ele sumiria no fade.
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { borderRadius: RADIUS[size] }, glowShadow, glowStyle]}
          />
        ) : null}
        {/* Um grupo só: no Android, sem a composição fora da tela, fundo, borda
            e rótulo apagariam cada um sozinho (aro claro e rótulo rosado). */}
        <Animated.View
          needsOffscreenAlphaCompositing
          style={[compact ? null : styles.fill, inactiveStyle]}
        >
          {variant === 'glass' ? (
            <Glass tone="light" strength="glass" radius={RADIUS[size]} style={surfaceStyle}>
              {content}
            </Glass>
          ) : (
            <Animated.View style={[surfaceStyle, colorStyle]}>{content}</Animated.View>
          )}
        </Animated.View>
      </View>
    </PressableScale>
  );
}

/**
 * Desativado ou carregando, o botão apaga até `opacities.disabled` e o brilho
 * some (o botão travado da 1l é chapado); ao liberar (o terceiro artista
 * escolhido), os dois voltam juntos em 250 ms, sem troca seca. Com reduzir
 * movimento, troca na hora. Nasce no estado atual, sem animar.
 */
function useInactiveFade(inactive: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const opacity = useSharedValue(inactive ? opacities.disabled : 1);

  useEffect(() => {
    const target = inactive ? opacities.disabled : 1;
    opacity.set(
      reducedMotion
        ? target
        : withTiming(target, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  }, [inactive, reducedMotion, opacity]);

  const inactiveStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  // O brilho vai de 0 (travado) a 1 (ativo) no mesmo passo do botão.
  const glowStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, (opacity.get() - opacities.disabled) / (1 - opacities.disabled)),
  }));

  return { inactiveStyle, glowStyle };
}

/** A mesma cor com alfa 0 ("transparent" continua como está). */
function clearOf(color: string): string {
  if (color.startsWith('#')) return withAlpha(color, 0);
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, 0)` : color;
}

function isClear(color: string): boolean {
  return color === colors.transparent || /,\s*0\)$/.test(color);
}

/**
 * Fundo e borda que andam até as cores novas quando a variante muda. A ponta
 * transparente vira a cor da outra ponta com alfa 0: em HSV, o preto do
 * "transparent" faria o matiz passar pelo arco-íris no caminho.
 */
function useSurfaceColors(background: string, border: string) {
  const reducedMotion = usePrefersReducedMotion();
  const target = useRef({ background, border });
  const from = useSharedValue({ background, border });
  const to = useSharedValue({ background, border });
  const progress = useSharedValue(1);

  useEffect(() => {
    const previous = target.current;
    if (previous.background === background && previous.border === border) return;
    target.current = { background, border };
    const shown = to.get();
    from.set({
      background: isClear(shown.background) ? clearOf(background) : shown.background,
      border: isClear(shown.border) ? clearOf(border) : shown.border,
    });
    to.set({
      background: isClear(background) ? clearOf(shown.background) : background,
      border: isClear(border) ? clearOf(shown.border) : border,
    });
    progress.set(0);
    progress.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  }, [background, border, reducedMotion, from, to, progress]);

  return useAnimatedStyle(() => {
    const p = progress.get();
    const start = from.get();
    const end = to.get();
    if (p >= 1) return { backgroundColor: end.background, borderColor: end.border };
    return {
      backgroundColor: interpolateColor(p, [0, 1], [start.background, end.background], 'HSV'),
      borderColor: interpolateColor(p, [0, 1], [start.border, end.border], 'HSV'),
    };
  });
}

/**
 * Rótulo novo entra em fade. No render em que a chave muda, o conteúdo novo
 * já nasce invisível (a chave antiga ainda está no thread de UI), então nada
 * pisca antes de o fade começar.
 */
function useContentFade(key: string) {
  const reducedMotion = usePrefersReducedMotion();
  const shown = useSharedValue(key);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (shown.get() === key) return;
    shown.set(key);
    opacity.set(0);
    opacity.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.fast, easing: motion.easing.out }),
    );
  }, [key, reducedMotion, shown, opacity]);

  return useAnimatedStyle(() => ({ opacity: shown.get() === key ? opacity.get() : 0 }));
}

const styles = StyleSheet.create({
  target: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    justifyContent: 'center',
  },
  surface: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidths.default,
  },
  // Altura que quem chama der ao alvo (lg e md) vai para o desenho.
  fill: {
    flexGrow: 1,
  },
  lg: {
    minHeight: layout.buttonHeight.lg,
    paddingHorizontal: spacing.xl,
    borderRadius: RADIUS.lg,
  },
  md: {
    minHeight: layout.buttonHeight.md,
    paddingHorizontal: spacing.lg,
    borderRadius: RADIUS.md,
  },
  // Os dois botões do card da 1b (34,5 e 36 no protótipo) ficam iguais, com 36.
  mdCompact: {
    minHeight: layout.buttonHeight.mdCompact,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.cardPadding,
    borderRadius: RADIUS.mdCompact,
  },
  // 12 dos lados, o "Chamar amigos" da 1m (o "Eu vou" rosa ao lado tem 14, e
  // quem o desenha é o `RsvpButton`).
  sm: {
    minHeight: layout.buttonHeight.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: RADIUS.sm,
  },
  xs: {
    minHeight: layout.buttonHeight.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: RADIUS.xs,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  contentCompact: {
    gap: spacing.iconLabelGap,
  },
  // Com a fonte a 200%, o rótulo quebra em linhas centralizadas em vez de vazar.
  label: {
    flexShrink: 1,
    textAlign: 'center',
  },
});
