import { Hammer } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, radii, spacing } from '@/theme';

export interface PlaceholderProps {
  /** Código da tela no protótipo (1b, 1d...), para achar o desenho. */
  designRef?: string;
}

/** Marca de tela ainda não construída. Sai quando a tela real entrar. */
export function Placeholder({ designRef }: PlaceholderProps) {
  return (
    <View style={styles.container}>
      <Icon icon={Hammer} size={18} color={colors.textMuted} />
      <Text variant="caption" color={colors.textMuted}>
        {designRef ? `${t('common.comingSoon')} · ${designRef}` : t('common.comingSoon')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderGlass,
  },
});
