import { LinearGradient, vec } from '@shopify/react-native-skia';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { STRIPE_ANGLE, stripes, type StripePreset, type StripeToken } from '@/theme';
import { withAlpha } from '@/utils/color';

interface StripesLayerProps {
  /** A camada ocupa o pai inteiro; o estilo só entra para ajustes. */
  style?: StyleProp<ViewStyle>;
}

/** Um preset de `stripes`, com ajuste fino por prop (a 1g usa o `onPoints` a .08). */
type StripesFromPreset = { preset: StripePreset } & Partial<StripeToken>;

/** Listra avulsa, fora dos presets. A cor é hex, como as do tema. */
interface StripesFromValues extends Omit<StripeToken, 'angle'> {
  preset?: undefined;
  /** Sem valor, a inclinação da marca (`STRIPE_ANGLE`). */
  angle?: number;
}

export type StripesProps = StripesLayerProps & (StripesFromPreset | StripesFromValues);

export interface StripeGradient {
  start: { x: number; y: number };
  end: { x: number; y: number };
  colors: string[];
  positions: number[];
}

/**
 * O `repeating-linear-gradient` do protótipo em números do Skia: um período
 * inteiro ao longo do eixo do ângulo (0° é para cima, sentido horário, como no
 * CSS), a listra na cor e o resto na mesma cor a 0. Paradas iguais fazem a
 * borda seca, e o `mode="repeat"` repete o período pela área toda.
 */
export function stripeGradient({
  color,
  alpha,
  width,
  period,
  angle,
}: StripeToken): StripeGradient {
  const radians = (angle * Math.PI) / 180;
  const solid = withAlpha(color, alpha);
  // Nunca a string 'transparent': a borda da listra puxaria para o preto.
  const clear = withAlpha(color, 0);
  const edge = width / period;
  return {
    start: { x: 0, y: 0 },
    end: { x: period * Math.sin(radians), y: -period * Math.cos(radians) },
    colors: [solid, solid, clear, clear],
    positions: [0, edge, edge, 1],
  };
}

/**
 * As listras como shader, para quem já desenha num Canvas próprio (o
 * placeholder de foto das listas e dos cards): vai dentro de um `Fill` ou de
 * uma forma do Skia.
 */
export function StripesShader({ stripe }: { stripe: StripeToken }) {
  const { start, end, colors, positions } = stripeGradient(stripe);
  return (
    <LinearGradient
      start={vec(start.x, start.y)}
      end={vec(end.x, end.y)}
      colors={colors}
      positions={positions}
      mode="repeat"
    />
  );
}

/**
 * As listras como `<Pattern>` do react-native-svg, para quem desenha em SVG (o
 * brilho da 1e, o placeholder da capa e dos destaques): vai dentro de um
 * `<Defs>` e pinta uma forma com `fill="url(#id)"`. É o mesmo desenho do
 * shader: a listra em `[0, width]` de cada período, medido ao longo do eixo do
 * ângulo a partir do canto de cima. O eixo x do padrão gira até o eixo do
 * gradiente do CSS (`angle - 90` no sentido horário).
 */
export function StripesPattern({ id, stripe }: { id: string; stripe: StripeToken }) {
  const { color, alpha, width, period, angle } = stripe;
  return (
    <Pattern
      id={id}
      patternUnits="userSpaceOnUse"
      x={0}
      y={0}
      width={period}
      height={period}
      patternTransform={`rotate(${angle - 90})`}
    >
      <Rect x={0} y={0} width={width} height={period} fill={color} fillOpacity={alpha} />
    </Pattern>
  );
}

function resolveStripe(props: StripesFromPreset | StripesFromValues): StripeToken {
  if (props.preset === undefined) {
    const { color, alpha, width, period, angle = STRIPE_ANGLE } = props;
    return { color, alpha, width, period, angle };
  }
  const base = stripes[props.preset];
  return {
    color: props.color ?? base.color,
    alpha: props.alpha ?? base.alpha,
    width: props.width ?? base.width,
    period: props.period ?? base.period,
    angle: props.angle ?? base.angle,
  };
}

/**
 * Listras diagonais da marca (1k, 1b, 1g, 1d), inclinadas como as barras do
 * logo. Textura por cima do fundo do pai: não recebe toque e não existe para o
 * leitor de tela. O pai com `overflow: hidden` recorta os cantos.
 *
 * Em SVG, e não no Skia: no Android, o `Canvas` do Skia desenha numa
 * superfície que só fica pronta alguns quadros depois de a tela aparecer, e as
 * listras da capa da 1d e do fundo da 1k surgiam secas depois da transição. O
 * SVG entra no primeiro quadro, junto com o resto.
 */
export function Stripes(props: StripesProps) {
  const token = resolveStripe(props);
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, props.style]}
    >
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <StripesPattern id="stripes" stripe={token} />
        </Defs>
        <Rect width="100%" height="100%" fill="url(#stripes)" />
      </Svg>
    </View>
  );
}
