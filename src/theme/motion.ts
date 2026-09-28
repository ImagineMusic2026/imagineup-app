import { Easing, type WithSpringConfig } from 'react-native-reanimated';

/**
 * Movimento fluido e discreto: curvas suaves, nada de troca seca, e sempre
 * respeitando "reduzir movimento" (as animações do Reanimated já seguem a
 * configuração do sistema por padrão; não passe `ReduceMotion.Never`).
 */
export const motion = {
  duration: {
    fast: 150,
    base: 250,
    slow: 400,
    counter: 700,
  },
  easing: {
    out: Easing.bezier(0.23, 1, 0.32, 1),
    inOut: Easing.bezier(0.65, 0, 0.35, 1),
  },
  spring: {
    gentle: { damping: 18, stiffness: 220, mass: 0.7 },
    snappy: { damping: 16, stiffness: 320, mass: 0.6 },
  } satisfies Record<string, WithSpringConfig>,
  pressScale: 0.97,
} as const;
