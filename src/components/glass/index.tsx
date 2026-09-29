import { BlurView, type BlurTint } from 'expo-blur';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';

import { blur, blurFallback, borderWidths, colors, radii, type BlurStrength } from '@/theme';
import { withAlpha } from '@/utils/color';

export type GlassTone = 'dark' | 'darkStrong' | 'light';
export type GlassStrength = Exclude<BlurStrength, 'tabBar'>;

export interface GlassProps extends ViewProps {
  /** `dark` nos botões da capa (1d), `darkStrong` nos selos sobre foto (1m, 1d), `light` no botão de vidro (1k). */
  tone?: GlassTone;
  /** Quanto desfoca no iOS: `glass` (blur 10 do protótipo) ou `badge` (blur 8). */
  strength?: GlassStrength;
  radius?: number;
  /** Sem ela, a borda segue o papel: .22 no vidro claro, .16 nos selos, .14 nos botões. */
  borderColor?: string;
}

// O Android não desfoca: o vidro escuro fica mais opaco para o texto por cima
// continuar legível sobre foto clara. O vidro claro fica igual, porque sempre
// está sobre o véu escuro da 1k.
const ANDROID_LAYER = {
  dark: 'darkOpaque',
  darkStrong: 'darkStrongOpaque',
  light: 'light',
} as const satisfies Record<GlassTone, keyof typeof styles>;

const TINT: Record<GlassTone, BlurTint> = {
  dark: 'dark',
  darkStrong: 'dark',
  // No app só escuro, o material padrão do iOS já sai escuro e neutro.
  light: 'default',
};

function defaultBorder(tone: GlassTone, strength: GlassStrength): string {
  if (tone === 'light') return colors.borderGlassStrong;
  return strength === 'badge' ? colors.borderOutline : colors.borderGlass;
}

/**
 * Superfície de vidro sobre foto: desfoque no iOS e a cor por cima, na ordem do
 * `backdrop-filter` do protótipo (primeiro desfoca, depois tinge). Só desenha;
 * quem toca é o pressável em volta (`GlassIconButton`, botão de vidro), e as
 * camadas de desfoque e de cor não recebem toque nem foco.
 */
export function Glass({
  tone = 'dark',
  strength = 'glass',
  radius = radii.pill,
  borderColor,
  style,
  children,
  ...props
}: GlassProps) {
  const blurred = Platform.OS === 'ios';

  return (
    <View
      {...props}
      style={[
        styles.container,
        { borderRadius: radius, borderColor: borderColor ?? defaultBorder(tone, strength) },
        style,
      ]}
    >
      {blurred ? (
        <BlurView
          intensity={blur[strength]}
          tint={TINT[tone]}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles[blurred ? tone : ANDROID_LAYER[tone]]]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderWidth: borderWidths.default,
  },
  dark: {
    backgroundColor: colors.glassDark,
  },
  darkStrong: {
    backgroundColor: colors.glassDarkStrong,
  },
  light: {
    backgroundColor: colors.glass,
  },
  darkOpaque: {
    backgroundColor: withAlpha(colors.background, blurFallback.glassDark),
  },
  darkStrongOpaque: {
    backgroundColor: withAlpha(colors.background, blurFallback.glassDarkStrong),
  },
});
