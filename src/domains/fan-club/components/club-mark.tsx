import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { Text } from '@/components/text';
import { colors, gradients, layout, radii } from '@/theme';
import { initialsOf } from '@/utils/text';

/**
 * O ícone quadrado do fã-clube no modo gestor (o Claude Design aprovado em
 * 26/10/2026): as iniciais do nome sobre o degradê rosa. É desenho: o nome
 * vem logo ao lado, e o ícone fica fora do leitor de tela.
 */
export function ClubMark({ name }: { name: string }) {
  const { colors: stops, locations, start, end } = gradients.clubMark;
  return (
    <LinearGradient
      colors={stops}
      locations={locations}
      start={start}
      end={end}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={styles.mark}
      testID="fan-club-mark"
    >
      <Text variant="buttonSmall" color={colors.onAccent} maxFontSizeMultiplier={1}>
        {initialsOf(name)}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: layout.iconTile,
    height: layout.iconTile,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
