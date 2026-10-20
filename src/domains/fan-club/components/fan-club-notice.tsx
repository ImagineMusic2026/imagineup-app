import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { colors, spacing } from '@/theme';

export interface FanClubNoticeProps {
  /** O título curto ("O regulamento mudou"), ou nada. */
  title?: string;
  body: string;
  /** `warning`: o fã-clube fora do ar e o regulamento velho, com a borda de atenção. */
  tone?: 'info' | 'warning';
  /** Os botões e links do aviso, embaixo do texto, com foco próprio. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Um aviso do fã-clube no topo da tela: o fã-clube fora do ar (o
 * `unavailableReason`), o regulamento que mudou e o @ automático na
 * candidatura. O texto é um foco só; as ações, irmãs dele, têm o delas.
 */
export function FanClubNotice({
  title,
  body,
  tone = 'info',
  children,
  style,
  testID,
}: FanClubNoticeProps) {
  return (
    <Card
      variant="compact"
      style={[styles.card, tone === 'warning' && styles.warning, style]}
      testID={testID}
    >
      <View accessible accessibilityLabel={title ? `${title}. ${body}` : body}>
        {title ? <Text variant="label">{title}</Text> : null}
        <Text variant="body" color={colors.textSecondary} style={title ? styles.body : null}>
          {body}
        </Text>
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  warning: {
    borderColor: colors.danger,
  },
  body: {
    marginTop: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
});
