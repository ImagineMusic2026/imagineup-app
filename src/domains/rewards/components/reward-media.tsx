import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { RemoteImage } from '@/components/remote-image';
import { radii } from '@/theme';

import { useMutedProgress } from '../hooks/use-muted-progress';
import type { Reward } from '../types';
import { RewardIcon } from './reward-icon';

/** Proporção do destaque da 1h (366 x 196), a mesma da foto que o painel manda. */
export const REWARD_PHOTO_ASPECT = 366 / 196;
// O quadro do ícone no detalhe: mais alto que o da grade (74), com o mesmo ícone.
const ICON_HEIGHT = 120;

export interface RewardMediaProps {
  reward: Reward;
  /** Fora do alcance (faltam pontos ou esgotou): o quadro fica de vidro, como na grade. */
  outOfReach: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Topo do detalhe do resgate: a foto (ou o placeholder de marca do destaque,
 * como na 1h) ou o quadro do ícone do tipo, na cor do assunto. Decorativo.
 */
export function RewardMedia({ reward, outOfReach, style }: RewardMediaProps) {
  const progress = useMutedProgress(reward.id, outOfReach);

  if (reward.imageUrl || reward.featured) {
    return (
      <RemoteImage
        uri={reward.imageUrl}
        fallback={{ kind: 'brand', seed: reward.id }}
        style={[styles.photo, style]}
      />
    );
  }
  return <RewardIcon reward={reward} progress={progress} height={ICON_HEIGHT} style={style} />;
}

const styles = StyleSheet.create({
  photo: {
    alignSelf: 'stretch',
    aspectRatio: REWARD_PHOTO_ASPECT,
    borderRadius: radii.xl,
  },
});
