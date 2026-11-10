import { Flame } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconTile } from '@/components/icon-tile';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { borderWidths, colors, fonts, radii, spacing } from '@/theme';

import { doneLabel, doneMeta } from '../describe-checkin';
import type { CheckinState } from '../types';

export interface CheckinDoneRowProps {
  state: CheckinState;
  style?: StyleProp<ViewStyle>;
}

/**
 * O check-in de hoje feito: uma linha escura e baixa, sem toque, com a chama
 * no quadro lima, "Check-in feito", a sequência e quanto vale o de amanhã (o
 * "+N" em lima). Escura, para o card lima da missão do dia logo embaixo
 * seguir o único bloco lima da Início. É um elemento só para o leitor, e o
 * cabeçalho da seção neste estado: "Check-in feito. 5 dias seguidos. Amanhã
 * vale 6 pontos."
 */
export function CheckinDoneRow({ state, style }: CheckinDoneRowProps) {
  const meta = doneMeta(state);

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={doneLabel(state)}
      testID="checkin-done"
      style={[styles.row, style]}
    >
      <IconTile icon={Flame} tone="points" />
      <View style={styles.texts}>
        <Text variant="label">{t('checkin.done.title')}</Text>
        <Text variant="caption" color={colors.textMuted} style={styles.meta}>
          {'text' in meta ? (
            meta.text
          ) : (
            <>
              {meta.before}
              <Text variant="caption" style={styles.points}>
                {meta.points}
              </Text>
              {meta.after}
            </>
          )}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.itemGap,
    marginHorizontal: spacing.gutter,
    padding: spacing.cardPadding,
    borderRadius: radii.lg,
    borderWidth: borderWidths.default,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    marginTop: spacing.metaGap,
  },
  points: {
    fontFamily: fonts.manropeBold,
    color: colors.points,
  },
});
