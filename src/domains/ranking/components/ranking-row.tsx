import { ArrowDown, ArrowUp } from 'lucide-react-native';
import type { Ref } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, radii, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatNumber } from '@/utils/number';

import { LARGE_TEXT_SCALE } from '../consts';
import { describeRow, entryName } from '../describe-rank';
import type { LeaderboardEntry } from '../types';

import { EntryAvatar, type RankingSelf } from './entry-avatar';

// A posição ocupa a mesma largura em toda linha (22 no protótipo), até 3 dígitos.
export const POSITION_WIDTH = 22;
const CHANGE_ICON_SIZE = 10;
const CHANGE_ICON_STROKE = 2.4;

export interface RankingRowProps {
  entry: LeaderboardEntry;
  self: RankingSelf;
  /**
   * A temporada já acabou pelo relógio: a seta some na hora (o resultado
   * congelado não tem seta), também antes de o servidor responder e sem rede.
   */
  seasonOver?: boolean;
  /** A linha do próprio fã (o card "Você" leva o foco até ela). */
  ref?: Ref<View>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Variação desde a semana anterior, embaixo dos pontos: seta para cima ou
 * para baixo e quantas posições. A cor muda com o sentido sem sair do branco
 * (lima é só dos pontos, rosa é ação): subida em branco cheio, queda apagada
 * (.5). Sem mudança, nada. O leitor ouve "subiu 3 posições" no rótulo da linha.
 */
function RankChange({ change }: { change: number }) {
  if (change === 0) return null;
  const up = change > 0;
  const color = up ? colors.text : colors.textMuted;
  return (
    <View style={styles.change}>
      <Icon
        icon={up ? ArrowUp : ArrowDown}
        size={CHANGE_ICON_SIZE}
        strokeWidth={CHANGE_ICON_STROKE}
        color={color}
      />
      <Text variant="labelTiny" color={color} tabular>
        {formatNumber(Math.abs(change))}
      </Text>
    </View>
  );
}

/**
 * Uma posição do ranking (1f), do 4º em diante: posição, avatar, nome inteiro
 * (com reticências; com a fonte grande, em até duas linhas), cidade quando o
 * fã informou, pontos da temporada e a variação. Um elemento só para o leitor, e não tocável: não existe perfil
 * público de outro fã. A linha do próprio fã diz "Você" e ganha um fundo rosa.
 */
export function RankingRow({
  entry: received,
  self,
  seasonOver,
  ref,
  style,
  testID,
}: RankingRowProps) {
  const entry = seasonOver && received.change !== 0 ? { ...received, change: 0 } : received;
  const name = entry.isMe ? t('ranking.you') : entryName(entry);
  const largeText = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE;

  return (
    <ListRow
      ref={ref}
      variant="divided"
      title={name}
      meta={entry.city ?? undefined}
      titleNumberOfLines={largeText ? 2 : 1}
      leading={
        <>
          <Text
            variant="points"
            color={colors.textMuted}
            tabular
            numberOfLines={1}
            style={styles.position}
          >
            {entry.position}
          </Text>
          <EntryAvatar entry={entry} self={self} size="md" />
        </>
      }
      trailing={
        <>
          <Text variant="points" tabular>
            {formatNumber(entry.points)}
          </Text>
          <RankChange change={entry.change} />
        </>
      }
      accessibilityLabel={describeRow(entry, name)}
      testID={testID}
      style={[entry.isMe && styles.me, style]}
    />
  );
}

const styles = StyleSheet.create({
  position: {
    minWidth: POSITION_WIDTH,
  },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    marginTop: spacing.xs,
  },
  // Rosa .1, sangrando 8 para os lados para o texto ficar alinhado com as outras linhas.
  me: {
    marginHorizontal: -spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderBottomColor: colors.transparent,
    backgroundColor: withAlpha(colors.accent, tints.faint.fill),
  },
});
