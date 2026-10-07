import { router } from 'expo-router';
import { ChevronRight, LogOut, Trash2, UserPen } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { LargeTitleHeader } from '@/components/header';
import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { sourceOf } from '@/config/data-source';
import { useSignOut } from '@/domains/auth';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';

import { useMyProfileQuery } from '../queries';
import { isAutomaticUsername } from '../username';

const CHEVRON_SIZE = 18;

function Chevron() {
  return <Icon icon={ChevronRight} size={CHEVRON_SIZE} color={colors.textMuted} />;
}

/**
 * O que a linha "Editar perfil" promete: com a API, "Nome, @, cidade e foto"
 * (ou o aviso do @ automático); sem ela, "Nome e cidade", o que a tela faz
 * nas fixtures (24.1, decisão 12).
 */
function editProfileMeta(username: string | null | undefined): string {
  if (sourceOf('profile') !== 'api') return t('settings.editProfileMetaBasic');
  return t(
    isAutomaticUsername(username)
      ? 'settings.editProfileMetaAutomatic'
      : 'settings.editProfileMeta',
  );
}

/**
 * Ajustes (sem desenho, no visual das outras telas), aberto pela engrenagem
 * do perfil: o perfil, com "Editar perfil" (bloco 9), e a conta, com Sair e
 * Excluir conta. Sair não pede confirmação (dá para entrar de novo) e por
 * isso não leva a seta de "abre outra tela"; excluir abre uma tela que diz o
 * que se perde.
 */
export function SettingsScreen() {
  const bottomInset = useTabBarInset();
  const email = useSessionStore((state) => state.user?.email ?? null);
  const signOut = useSignOut();
  const username = useMyProfileQuery().data?.username;
  // Depois de sair, a linha segue ocupada até o guard trocar a tela.
  const leaving = signOut.isPending || signOut.isSuccess;
  const profileMeta = editProfileMeta(username);

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader title={t('settings.title')} showBack />
      <SectionLabel style={styles.firstLabel}>{t('settings.profile')}</SectionLabel>
      <View style={styles.rows}>
        <ListRow
          leading={<IconTile icon={UserPen} tone="glass" />}
          title={t('settings.editProfile')}
          meta={profileMeta}
          trailing={<Chevron />}
          onPress={() => router.push('/editar-perfil')}
          accessibilityLabel={`${t('settings.editProfile')}. ${profileMeta}`}
          accessibilityHint={t('settings.editProfileHint')}
          testID="settings-edit-profile"
        />
      </View>
      <SectionLabel>{t('settings.account')}</SectionLabel>
      <View style={styles.rows}>
        <ListRow
          leading={<IconTile icon={LogOut} tone="glass" />}
          title={t('settings.signOut')}
          meta={email ? t('settings.signOutMeta', { email }) : undefined}
          trailing={leaving ? <ActivityIndicator color={colors.textMuted} /> : undefined}
          onPress={() => {
            if (!leaving) signOut.mutate();
          }}
          busy={leaving}
          accessibilityLabel={
            email
              ? `${t('settings.signOutLabel')}. ${t('settings.signOutMeta', { email })}`
              : t('settings.signOutLabel')
          }
          accessibilityHint={t('settings.signOutHint')}
          testID="settings-sign-out"
        />
        <ListRow
          leading={<IconTile icon={Trash2} tone="action" />}
          title={t('settings.deleteAccount')}
          meta={t('settings.deleteAccountMeta')}
          trailing={<Chevron />}
          onPress={() => router.push('/excluir-conta')}
          accessibilityLabel={`${t('settings.deleteAccount')}. ${t('settings.deleteAccountMeta')}`}
          accessibilityHint={t('settings.deleteAccountHint')}
          testID="settings-delete-account"
        />
      </View>
      {signOut.isError ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t('settings.signOutError')}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // O título já deixa 18 embaixo: a primeira sobrelinha não soma o espaço dela em cima.
  firstLabel: {
    paddingTop: 0,
  },
  rows: {
    gap: spacing.listGap,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
