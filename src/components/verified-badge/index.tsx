import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme';

/** 13 no feed (1b) e nos comentários, 14 no autor do post, 20 na capa do artista (1d). */
export type VerifiedBadgeSize = 13 | 14 | 20;

export interface VerifiedBadgeProps {
  size?: VerifiedBadgeSize;
}

// Paths do protótipo (viewBox 24). O BadgeCheck do lucide é só contorno e,
// preenchido, engole o check; por isso o desenho próprio.
const ROSETTE =
  'M8.73 4.1Q12 -3.25 15.27 4.1Q22.78 1.22 19.9 8.73Q27.25 12 19.9 15.27Q22.78 22.78 15.27 19.9Q12 27.25 8.73 19.9Q1.22 22.78 4.1 15.27Q-3.25 12 4.1 8.73Q1.22 1.22 8.73 4.1Z';
const CHECK = 'M7.5 12.3l3.2 3.3 5.9-6.9';
const CHECK_STROKE = 2.9;

/**
 * Selo de artista verificado: roseta rosa com check branco. Decorativo; o
 * "artista verificado" entra no rótulo do bloco em volta (nome, post, capa).
 */
export function VerifiedBadge({ size = 14 }: VerifiedBadgeProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Path d={ROSETTE} fill={colors.accent} />
      <Path
        d={CHECK}
        stroke={colors.onAccent}
        strokeWidth={CHECK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
