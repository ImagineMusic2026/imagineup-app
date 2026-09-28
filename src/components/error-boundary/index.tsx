import type { ErrorBoundaryProps } from 'expo-router';
import { Pressable, Text, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { colors, radii, spacing } from '@/theme';

/**
 * Tela de erro do app, no lugar da padrão do expo-router (em inglês e com a
 * mensagem técnica). Ela renderiza no lugar do layout que quebrou, possivelmente
 * antes das fontes e fora dos providers: por isso usa o Text do React Native com
 * a fonte do sistema e nada de React Query ou tema de navegação.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {t('errors.title')}
        </Text>
        <Text style={styles.message}>{t('errors.message')}</Text>
        {__DEV__ ? <Text style={styles.detail}>{error.message}</Text> : null}
        <Pressable
          onPress={() => {
            retry().catch(() => undefined);
          }}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.gutterAuth,
    gap: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
  },
  message: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  detail: {
    color: colors.textMuted,
    fontSize: 12,
  },
  button: {
    minHeight: 50,
    borderRadius: radii.cta,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentStrong,
  },
  pressed: {
    opacity: 0.8,
  },
  buttonLabel: {
    color: colors.onAccent,
    fontSize: 15,
    fontWeight: '800',
  },
});
