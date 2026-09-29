import type { ImageContentPosition } from 'expo-image';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage, type RemoteImageFallback } from '@/components/remote-image';
import { Scrim } from '@/components/scrim';
import type { HapticEvent } from '@/services/haptics';
import { radii, spacing, type ScrimPreset } from '@/theme';

interface PhotoCardBaseProps {
  uri: string | null | undefined;
  fallback: RemoteImageFallback;
  scrim: ScrimPreset;
  /** Altura mínima, não fixa: com a fonte a 200% o card cresce. */
  minHeight?: number;
  radius?: number;
  /** Selo no canto de cima (data da 1m). O conteúdo nunca sobe por cima dele. */
  topLeft?: ReactNode;
  /** Conteúdo preso embaixo, sobre a parte escura do véu. */
  children?: ReactNode;
  contentPosition?: ImageContentPosition;
  /** Margens e ajuste de padding da tela (a 1h pede 16 dos lados). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface StaticPhotoCardProps extends PhotoCardBaseProps {
  onPress?: undefined;
  accessibilityLabel?: undefined;
  accessibilityHint?: undefined;
  accessibilityRole?: undefined;
  haptic?: undefined;
}

/**
 * Card pressável: o rótulo descreve o card todo, e nada dentro dele é botão com
 * a mesma ação (regra de pressáveis aninhados). Filhos sem role; o papel é de
 * quem chama (sem ele, botão).
 */
interface PressablePhotoCardProps extends PhotoCardBaseProps {
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  haptic?: HapticEvent | null;
}

export type PhotoCardProps = StaticPhotoCardProps | PressablePhotoCardProps;

/**
 * Foto de ponta a ponta com véu e o conteúdo embaixo: destaque da loja (1h,
 * pressável, sem botão dentro) e do show (1m, não pressável, com botões dentro).
 */
export function PhotoCard(props: PhotoCardProps) {
  const {
    uri,
    fallback,
    scrim,
    minHeight,
    radius = radii.xl,
    topLeft,
    children,
    contentPosition,
    style,
    testID,
  } = props;

  const frame = [
    styles.card,
    { minHeight, borderRadius: radius },
    topLeft ? styles.withTopLeft : null,
    style,
  ];

  const layers = (
    <>
      <RemoteImage
        uri={uri}
        fallback={fallback}
        contentPosition={contentPosition}
        style={StyleSheet.absoluteFill}
      />
      <Scrim preset={scrim} />
      {topLeft ? <View style={styles.topLeft}>{topLeft}</View> : null}
      {children ? <View style={styles.content}>{children}</View> : null}
    </>
  );

  if (props.onPress) {
    return (
      <PressableScale
        onPress={props.onPress}
        haptic={props.haptic}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
        accessibilityRole={props.accessibilityRole}
        testID={testID}
        style={frame}
      >
        {layers}
      </PressableScale>
    );
  }

  return (
    <View testID={testID} style={frame}>
      {layers}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: spacing.cardPadding,
  },
  withTopLeft: {
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  topLeft: {
    alignSelf: 'flex-start',
  },
  content: {
    alignSelf: 'stretch',
  },
});
