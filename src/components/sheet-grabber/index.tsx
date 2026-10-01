import { Platform, StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';

// O puxador nas medidas do nativo do iOS (36 x 5, a 8 do topo).
const GRABBER = { width: 36, height: 5, top: spacing.sm } as const;

/**
 * Puxador das sheets (`presentation: 'formSheet'`) no Android. O
 * `sheetGrabberVisible` só vale no iOS (react-native-screens 4.26), onde o
 * sistema desenha o dele; no Android a própria tela desenha este, no mesmo
 * lugar. Decorativo: fecha-se arrastando ou pelo "×" da sheet.
 */
export function SheetGrabber() {
  if (Platform.OS === 'ios') return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={styles.grabber}
    />
  );
}

const styles = StyleSheet.create({
  grabber: {
    position: 'absolute',
    top: GRABBER.top,
    alignSelf: 'center',
    width: GRABBER.width,
    height: GRABBER.height,
    borderRadius: radii.pill,
    backgroundColor: colors.borderGlassStrong,
  },
});
