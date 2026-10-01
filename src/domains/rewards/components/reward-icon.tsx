import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { IconTile } from '@/components/icon-tile';
import { RemoteImage } from '@/components/remote-image';
import { colors, layout, radii } from '@/theme';
import { withAlpha } from '@/utils/color';

import { REWARD_ICONS } from '../consts';
import type { Reward } from '../types';

// Foto fora do alcance: apagada pela cor do card, como o quadro de vidro.
const PHOTO_DIM = withAlpha(colors.surface, 0.5);

export interface RewardIconProps {
  reward: Reward;
  /** 0 no alcance (quadro na cor do tipo), 1 fora dele (vidro). */
  progress: SharedValue<number>;
  /** Altura do quadro; padrão, a da grade da 1h (74). */
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Quadro de largura cheia com o ícone do tipo da recompensa (ou a foto, se o
 * painel mandar), na cor do assunto. Fora do alcance, o vidro apagado entra
 * por cima em fade, no mesmo passo do preço. Decorativo: quem fala é o card.
 */
export function RewardIcon({
  reward,
  progress,
  height = layout.rewardTileHeight,
  style,
}: RewardIconProps) {
  const spec = REWARD_ICONS[reward.kind];
  const mutedStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const size = { height };

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.frame, size, style]}
    >
      {reward.imageUrl ? (
        <>
          <RemoteImage
            uri={reward.imageUrl}
            fallback={{ kind: 'brand', seed: reward.id }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View style={[StyleSheet.absoluteFill, styles.photoDim, mutedStyle]} />
        </>
      ) : (
        <>
          <IconTile icon={spec.icon} tone={spec.tone} size="wide" style={size} />
          {/* O vidro é translúcido: por baixo dele, a cor do card, para a tinta sumir. */}
          <Animated.View style={[StyleSheet.absoluteFill, styles.glassBase, mutedStyle]}>
            <IconTile icon={spec.icon} tone="glass" size="wide" style={size} />
          </Animated.View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    borderRadius: radii.xs,
    overflow: 'hidden',
  },
  photoDim: {
    backgroundColor: PHOTO_DIM,
  },
  glassBase: {
    backgroundColor: colors.surface,
  },
});
