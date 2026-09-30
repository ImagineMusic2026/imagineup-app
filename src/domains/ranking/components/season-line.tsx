import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { colors, typography } from '@/theme';

import { describeSeason } from '../describe-rank';
import type { Season } from '../types';

export interface SeasonLineProps {
  /** `undefined` enquanto carrega; `null` sem temporada em andamento. */
  season: Season | null | undefined;
  now: Date;
  style?: StyleProp<ViewStyle>;
}

// Largura da barra de carregamento, a da linha do protótipo.
const LOADING_WIDTH = 236;

/**
 * "Temporada de São João · encerra em 12 dias" (1f). Conta os dias do
 * calendário até o fim; depois do prazo, "encerrada" (o resultado fica
 * congelado), e sem temporada, "Nenhuma temporada em andamento". Não é
 * tocável: as regras da temporada não têm desenho.
 */
export function SeasonLine({ season, now, style }: SeasonLineProps) {
  return (
    <View style={style}>
      {season === undefined ? (
        <View style={styles.loading}>
          <Skeleton tone="line" width={LOADING_WIDTH} height={typography.labelSmall.fontSize} />
        </View>
      ) : (
        <Text variant="labelSmall" color={colors.textMuted}>
          {describeSeason(season, now)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // A altura da linha de texto, para nada saltar quando a temporada chega.
  loading: {
    height: typography.labelSmall.lineHeight,
    justifyContent: 'center',
  },
});
