import { Lock } from 'lucide-react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Glyph } from '@/components/glyph';
import { IconTile } from '@/components/icon-tile';
import { colors } from '@/theme';
import { withAlpha } from '@/utils/color';

import { MISSION_ICONS } from '../consts';
import type { Mission } from '../types';

// Cadeado da bloqueada: 18 de traço 1,7 no protótipo; o quadro usa o de 19.
const LOCK_STROKE = 1.7;

export interface MissionIconProps {
  mission: Mission;
  /** No card lima: quadro escuro com o ícone lima, na cor que o tipo tiver. */
  onPoints?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Quadro de 38 com o ícone do tipo da missão, na cor do assunto. Bloqueada
 * leva o cadeado num quadro de vidro apagado, como o card dela; no card lima,
 * o quadro escuro com o cadeado lima (o vidro sumiria sobre o lima).
 * Decorativo: quem fala é o card.
 */
export function MissionIcon({ mission, onPoints = false, style }: MissionIconProps) {
  if (mission.status === 'locked') {
    return (
      <IconTile
        icon={Lock}
        tone={onPoints ? 'ink' : 'glass'}
        strokeWidth={LOCK_STROKE}
        style={[!onPoints && styles.lockedTile, style]}
      />
    );
  }
  const spec = MISSION_ICONS[mission.action];
  const tone = onPoints ? 'ink' : spec.tone;
  if (spec.glyph) {
    const { glyph } = spec;
    return (
      <IconTile
        tone={tone}
        renderIcon={({ color, size }) => <Glyph name={glyph} size={size} color={color} />}
        style={style}
      />
    );
  }
  return <IconTile icon={spec.icon} tone={tone} strokeWidth={spec.strokeWidth} style={style} />;
}

const styles = StyleSheet.create({
  // O vidro de .06 dentro do card a .5 do protótipo: .03 sobre o card apagado.
  lockedTile: {
    backgroundColor: withAlpha(colors.text, 0.03),
  },
});
