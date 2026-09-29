import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

export type EmptyStateTone = 'empty' | 'error';

export interface EmptyStateProps {
  message: string;
  /** `error` quando a lista não carregou: texto mais forte e "Tentar de novo" por padrão. */
  tone?: EmptyStateTone;
  icon?: LucideIcon;
  /** Linha de cima, para o erro de tela inteira ("Algo deu errado"). */
  title?: string;
  /** No erro, o padrão é "Tentar de novo"; no vazio, sem rótulo não há botão. */
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

const ICON_SIZE = 22;

const messageColor: Record<EmptyStateTone, string> = {
  empty: colors.textTertiary,
  error: colors.textSecondary,
};

/**
 * Lista vazia ou que não carregou. Título e mensagem são um foco só para o
 * leitor de tela, e o botão é outro. O anúncio da falha
 * (`announceForAccessibility`) fica com a tela, para sair num lugar só.
 */
export function EmptyState({
  message,
  tone = 'empty',
  icon,
  title,
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  const label = actionLabel ?? (tone === 'error' ? t('common.retry') : undefined);

  return (
    <View style={[styles.container, style]}>
      {icon ? <Icon icon={icon} size={ICON_SIZE} color={colors.textMuted} /> : null}
      <View
        accessible
        accessibilityLabel={title ? `${title}. ${message}` : message}
        style={styles.copy}
      >
        {title ? (
          <Text variant="headingSection" style={styles.centered}>
            {title}
          </Text>
        ) : null}
        <Text variant="body" color={messageColor[tone]} style={styles.centered}>
          {message}
        </Text>
      </View>
      {onAction && label ? (
        <Button variant="secondary" size="md" label={label} onPress={onAction} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  copy: {
    alignItems: 'center',
    gap: spacing.metaGap,
  },
  centered: {
    textAlign: 'center',
  },
});
