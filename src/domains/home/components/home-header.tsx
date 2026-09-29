import { router } from 'expo-router';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { PressableScale } from '@/components/pressable-scale';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useFanIdentity } from '@/domains/profile';
import { useNow } from '@/hooks/use-now';
import { t } from '@/i18n';
import { colors, layout, radii, spacing, typography } from '@/theme';
import { dayPeriod } from '@/utils/date';

// O avatar desenha 40 dentro de um alvo de 44: a linha cresce 2 em cima e
// embaixo, e os paddings devolvem, para o bloco ficar na altura do protótipo.
// À direita, o alvo entra 2 na margem, para o anel encostar na linha de 18 do
// card da missão, como no desenho.
const AVATAR_OUTSET = (layout.minTouchTarget - layout.avatar.xl.size) / 2;
// Com a fonte grande, o nome quebra em duas linhas em vez de ser cortado; com
// a padrão, fica numa linha com reticências, como no protótipo.
const TWO_LINES_FROM = 1.3;
const NAME_SKELETON_WIDTH = 160;
// Cor estável do avatar antes de a sessão dizer quem é o fã.
const UNKNOWN_FAN_ID = 'fa';

/**
 * Header da home (1b): "Boa noite," e o nome inteiro do fã, com o avatar de
 * anel rosa para lima à direita, que abre o Perfil. O nome vem do perfil do
 * Firestore; enquanto ele não chega, fica o da sessão, e sem nenhum dos dois,
 * um esqueleto (ou "fã", se o perfil não pôde ser lido).
 */
export function HomeHeader() {
  const { uid, name, photoURL, loading } = useFanIdentity();
  const { fontScale } = useWindowDimensions();
  // A saudação troca sozinha quando o período muda com a tela aberta.
  const now = useNow();
  const greeting = t(`home.greeting.${dayPeriod(now)}`);
  const shownName = name ?? (loading ? null : t('home.fallbackName'));

  return (
    <View style={styles.row}>
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={
          shownName === null ? greeting : t('home.greetingLabel', { greeting, name: shownName })
        }
        style={styles.copy}
      >
        <Text variant="caption" color={colors.textMuted}>
          {greeting}
        </Text>
        {shownName === null ? (
          <Skeleton
            height={typography.titleGreeting.lineHeight}
            width={NAME_SKELETON_WIDTH}
            radius={radii.xxs}
          />
        ) : (
          <Text variant="titleGreeting" numberOfLines={fontScale > TWO_LINES_FROM ? 2 : 1}>
            {shownName}
          </Text>
        )}
      </View>
      <PressableScale
        onPress={() => router.navigate('/perfil')}
        accessibilityLabel={t('home.openProfile')}
        style={styles.avatarTarget}
      >
        <Avatar name={name} id={uid ?? UNKNOWN_FAN_ID} photoUrl={photoURL} size="xl" ring="brand" />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.xs - AVATAR_OUTSET,
    paddingBottom: spacing.md - AVATAR_OUTSET,
  },
  copy: {
    flex: 1,
    gap: spacing.xxs,
  },
  avatarTarget: {
    marginRight: -AVATAR_OUTSET,
    minWidth: layout.minTouchTarget,
    minHeight: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
