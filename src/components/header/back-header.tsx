import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, spacing } from '@/theme';

export interface BackHeaderProps {
  title?: string;
  onBack?: () => void;
  /** Ação à direita (compartilhar, mais opções). */
  right?: ReactNode;
}

const HIT_SLOP = (layout.minTouchTarget - layout.headerButtonSize) / 2;

/** Header fixo das telas empilhadas: voltar, título centralizado e ação opcional. */
export function BackHeader({ title, onBack, right }: BackHeaderProps) {
  const handleBack = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));

  return (
    <View style={styles.container}>
      <View style={styles.side}>
        <PressableScale
          onPress={handleBack}
          accessibilityLabel={t('common.back')}
          hitSlop={HIT_SLOP}
          style={styles.button}
        >
          <Icon icon={ChevronLeft} size={20} strokeWidth={2.2} />
        </PressableScale>
      </View>
      {title ? (
        <Text
          variant="headingSection"
          numberOfLines={1}
          accessibilityRole="header"
          style={styles.title}
        >
          {title}
        </Text>
      ) : (
        <View style={styles.title} />
      )}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTouchTarget,
    paddingVertical: spacing.xs,
  },
  side: {
    width: layout.minTouchTarget,
  },
  right: {
    alignItems: 'flex-end',
  },
  button: {
    width: layout.headerButtonSize,
    height: layout.headerButtonSize,
    borderRadius: layout.headerButtonSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.borderGlass,
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
});
