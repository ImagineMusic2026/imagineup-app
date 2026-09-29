import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { colors, layout, radii, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

export type IconTileTone = 'action' | 'points' | 'events' | 'glass' | 'ink';
export type IconTileSize = 'md' | 'wide';

type IconSource =
  | { icon: LucideIcon; renderIcon?: never }
  | {
      icon?: never;
      /** Para o que o lucide não tem, como o `Glyph` de compartilhar cheio (1g). */
      renderIcon: (glyph: { color: string; size: number }) => ReactNode;
    };

export type IconTileProps = IconSource & {
  /**
   * Rosa, lima e ciano pelo assunto da missão ou recompensa; `glass` no que
   * está bloqueado ou fora do saldo; `ink` sobre o card lima (ícone lima).
   */
  tone?: IconTileTone;
  /** `md`: quadrado de 38 (1g). `wide`: largura toda e 74 de altura (1h). */
  size?: IconTileSize;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const ICON_SIZE: Record<IconTileSize, number> = { md: 19, wide: 30 };
const STROKE_WIDTH: Record<IconTileSize, number> = { md: 1.9, wide: 1.7 };

// O quadro grande da loja usa a tinta mais leve (.1); o quadrado da missão, .14.
const FILL_ALPHA: Record<IconTileSize, number> = {
  md: tints.soft.fill,
  wide: tints.faint.fill,
};

const TINTED = {
  action: colors.accent,
  points: colors.points,
  events: colors.events,
} as const;

function paint(tone: IconTileTone, size: IconTileSize): { background: string; foreground: string } {
  switch (tone) {
    case 'glass':
      return { background: colors.glass, foreground: colors.textMuted };
    case 'ink':
      return { background: colors.background, foreground: colors.points };
    default:
      return { background: withAlpha(TINTED[tone], FILL_ALPHA[size]), foreground: TINTED[tone] };
  }
}

/**
 * Quadro com o ícone do tipo de missão ou recompensa. É decorativo: o card em
 * volta diz o que é para o leitor de tela.
 */
export function IconTile({
  icon,
  renderIcon,
  tone = 'action',
  size = 'md',
  strokeWidth = STROKE_WIDTH[size],
  style,
  testID,
}: IconTileProps) {
  const { background, foreground } = paint(tone, size);
  const iconSize = ICON_SIZE[size];

  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.base, styles[size], { backgroundColor: background }, style]}
    >
      {renderIcon ? renderIcon({ color: foreground, size: iconSize }) : null}
      {icon ? (
        <Icon icon={icon} size={iconSize} color={foreground} strokeWidth={strokeWidth} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.xs,
  },
  md: {
    width: layout.iconTile,
    height: layout.iconTile,
  },
  wide: {
    alignSelf: 'stretch',
    height: layout.rewardTileHeight,
  },
});
