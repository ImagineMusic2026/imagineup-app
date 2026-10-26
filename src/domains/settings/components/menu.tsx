import { ChevronRight, ExternalLink, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type AccessibilityRole } from 'react-native';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SectionLabel } from '@/components/section-label';
import { borderWidths, colors, spacing } from '@/theme';

const ICON_SIZE = 22;
const TRAILING_ICON_SIZE = 18;

interface MenuSectionProps {
  title: string;
  /** A primeira seção não leva a linha em cima: o título da tela já separa. */
  first?: boolean;
  children: ReactNode;
}

/**
 * Uma seção do menu dos Ajustes, no molde do menu de referência do dono: a
 * linha fina de ponta a ponta em cima (fora a primeira), o nome sem caixa alta
 * e as linhas soltas, sem card.
 */
export function MenuSection({ title, first = false, children }: MenuSectionProps) {
  return (
    <>
      {first ? null : <View style={styles.divider} testID="settings-menu-divider" />}
      <SectionLabel variant="plain" style={first ? styles.firstLabel : styles.label}>
        {title}
      </SectionLabel>
      <View>{children}</View>
    </>
  );
}

interface MenuRowProps {
  icon: LucideIcon;
  title: string;
  onPress: () => void;
  /** A seta de "abre outra tela" ou a de "abre fora do app"; sem ela, a ação é na hora (Sair). */
  trailing?: 'chevron' | 'external';
  /** Sair: o título e o ícone na cor de perigo. */
  danger?: boolean;
  /** A ação está andando (sair): o indicador à direita, e o leitor ouve que ela está ocupada. */
  busy?: boolean;
  accessibilityRole?: AccessibilityRole;
  /** Padrão: o título. */
  accessibilityLabel?: string;
  accessibilityHint: string;
  testID: string;
}

/** Uma linha do menu dos Ajustes: o ícone simples, só o título e a seta. */
export function MenuRow({
  icon,
  title,
  onPress,
  trailing,
  danger = false,
  busy = false,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: MenuRowProps) {
  const trailingNode = busy ? (
    <ActivityIndicator color={colors.textMuted} />
  ) : trailing ? (
    <Icon
      icon={trailing === 'external' ? ExternalLink : ChevronRight}
      size={TRAILING_ICON_SIZE}
      color={colors.textMuted}
    />
  ) : undefined;

  return (
    <ListRow
      variant="menu"
      tone={danger ? 'danger' : 'default'}
      leading={<Icon icon={icon} size={ICON_SIZE} color={danger ? colors.danger : colors.text} />}
      title={title}
      trailing={trailingNode}
      onPress={onPress}
      busy={busy}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  // De ponta a ponta: a linha passa por cima do recuo da tela, como na referência.
  divider: {
    height: borderWidths.default,
    marginTop: spacing.md,
    marginHorizontal: -spacing.gutter,
    backgroundColor: colors.divider,
  },
  // O título da tela já deixa 18 embaixo: a primeira seção não soma o espaço dela em cima.
  firstLabel: {
    paddingTop: 0,
    paddingBottom: spacing.xs,
  },
  label: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
});
