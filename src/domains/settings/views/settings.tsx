import { router } from 'expo-router';
import {
  Ban,
  FileText,
  KeyRound,
  LogOut,
  Mail,
  MessageCircle,
  ScrollText,
  Shield,
  UserPen,
} from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/config/links';
import { useSignOut } from '@/domains/auth';
import { SuspendedNotice } from '@/domains/profile';
import { useRewardsRulesUrl } from '@/domains/rewards';
import { isFirebaseConfigured } from '@/firebase';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { openSupportEmail, openWebPage } from '@/services/web-page';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';

import { FanClubSection } from '../components/fan-club-section';
import { MenuRow, MenuSection } from '../components/menu';
import { readAppVersion, type AppVersionInfo } from '../version';

/** A linha de baixo e o rótulo do rodapé da versão: com o EAS Update, a data e o id curto dele. */
function versionTexts({ version, update }: AppVersionInfo): { meta?: string; label: string } {
  if (!version) return { label: t('settings.version') };
  if (!update) {
    return {
      meta: t('settings.versionMeta', { version }),
      label: t('settings.versionLabel', { version }),
    };
  }
  const params = { version, date: update.date, id: update.id };
  return {
    meta: t('settings.versionMetaUpdate', params),
    label: t('settings.versionLabelUpdate', params),
  };
}

/**
 * Ajustes, aberto pela engrenagem do perfil, no molde do menu de referência
 * do dono: linhas soltas, sem card, cada uma com o ícone simples, só o título
 * e a seta, e uma linha fina entre as seções. De cima para baixo: o aviso da
 * conta suspensa (só com a suspensão, seção 29, frente E); o perfil e a
 * conta, juntos, com "Editar perfil" (bloco 9) e "Trocar e-mail" e "Trocar
 * senha" (só na conta com senha, frente D); o fã-clube, só com a resposta do
 * servidor novo (seção 34); a privacidade e a segurança, juntas, com "Fãs
 * bloqueados" (frente B) e as páginas dos termos e da privacidade; o "Sobre"
 * (frente C), com o regulamento (só com o endereço no cache da loja) e o
 * contato; a zona de perigo, com o Sair na cor de perigo; e, no rodapé, o
 * nome e a versão. Excluir conta fica no fim do "Editar perfil", a última
 * opção. Sair não pede confirmação (dá para entrar de novo) e por isso não
 * leva a seta de "abre outra tela". As páginas abrem no navegador dentro do
 * app, com a seta de "fora do app".
 *
 * Mora no domínio de composição `settings` (seção 29, decisão 11): os Ajustes
 * juntam o perfil, a conta (`auth`), a lista de bloqueados (`posts`) e o
 * regulamento (`rewards`), e o `posts` e o `rewards` já importam o `profile`.
 */
export function SettingsScreen() {
  const bottomInset = useTabBarInset();
  // Trocar a senha e o e-mail só na conta que entra com senha, e com o Firebase configurado.
  const canChangeCredentials = useSessionStore(
    (state) => state.user?.hasPassword === true && isFirebaseConfigured,
  );
  const signOut = useSignOut();
  const rulesUrl = useRewardsRulesUrl();
  const [contactFailed, setContactFailed] = useState(false);
  // Depois de sair, a linha segue ocupada até o guard trocar a tela.
  const leaving = signOut.isPending || signOut.isSuccess;
  const version = versionTexts(readAppVersion());
  const contactError = t('settings.contactError', { email: SUPPORT_EMAIL });

  // Sem app de e-mail, o endereço aparece embaixo da seção, selecionável, e é anunciado.
  const writeToTeam = async (): Promise<void> => {
    const opened = await openSupportEmail(t('settings.contactSubject'));
    setContactFailed(!opened);
    if (!opened) AccessibilityInfo.announceForAccessibility(contactError);
  };

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader title={t('settings.title')} showBack />
      <SuspendedNotice style={styles.suspended} />
      <MenuSection title={t('settings.profileAccount')} first>
        <MenuRow
          icon={UserPen}
          title={t('settings.editProfile')}
          trailing="chevron"
          onPress={() => router.push('/editar-perfil')}
          accessibilityHint={t('settings.editProfileHint')}
          testID="settings-edit-profile"
        />
        {canChangeCredentials ? (
          <>
            <MenuRow
              icon={Mail}
              title={t('settings.changeEmail')}
              trailing="chevron"
              onPress={() => router.push('/trocar-email')}
              accessibilityHint={t('settings.changeEmailHint')}
              testID="settings-change-email"
            />
            <MenuRow
              icon={KeyRound}
              title={t('settings.changePassword')}
              trailing="chevron"
              onPress={() => router.push('/trocar-senha')}
              accessibilityHint={t('settings.changePasswordHint')}
              testID="settings-change-password"
            />
          </>
        ) : null}
      </MenuSection>
      <FanClubSection />
      <MenuSection title={t('settings.privacySecurity')}>
        <MenuRow
          icon={Ban}
          title={t('settings.blockedFans')}
          trailing="chevron"
          onPress={() => router.push('/fas-bloqueados')}
          accessibilityHint={t('settings.blockedFansHint')}
          testID="settings-blocked-fans"
        />
        <MenuRow
          icon={FileText}
          title={t('settings.terms')}
          trailing="external"
          onPress={() => openWebPage(TERMS_URL)}
          accessibilityRole="link"
          accessibilityHint={t('settings.pageHint')}
          testID="settings-terms"
        />
        <MenuRow
          icon={Shield}
          title={t('settings.privacy')}
          trailing="external"
          onPress={() => openWebPage(PRIVACY_URL)}
          accessibilityRole="link"
          accessibilityHint={t('settings.pageHint')}
          testID="settings-privacy"
        />
      </MenuSection>
      <MenuSection title={t('settings.about')}>
        {rulesUrl ? (
          <MenuRow
            icon={ScrollText}
            title={t('settings.rules')}
            trailing="external"
            onPress={() => openWebPage(rulesUrl)}
            accessibilityRole="link"
            accessibilityHint={t('settings.pageHint')}
            testID="settings-rules"
          />
        ) : null}
        <MenuRow
          icon={MessageCircle}
          title={t('settings.contact')}
          onPress={() => void writeToTeam()}
          accessibilityRole="link"
          accessibilityHint={t('settings.contactHint')}
          testID="settings-contact"
        />
      </MenuSection>
      {contactFailed ? (
        <Text
          variant="caption"
          color={colors.textSecondary}
          selectable
          style={styles.message}
          testID="settings-contact-error"
        >
          {contactError}
        </Text>
      ) : null}
      <MenuSection title={t('settings.dangerZone')}>
        <MenuRow
          icon={LogOut}
          title={t('settings.signOut')}
          danger
          busy={leaving}
          onPress={() => {
            if (!leaving) signOut.mutate();
          }}
          accessibilityLabel={t('settings.signOutLabel')}
          accessibilityHint={t('settings.signOutHint')}
          testID="settings-sign-out"
        />
      </MenuSection>
      {signOut.isError ? (
        <Text variant="caption" color={colors.danger} style={styles.message}>
          {t('settings.signOutError')}
        </Text>
      ) : null}
      {/* O nome e a versão, sem toque: um elemento só para o leitor de tela. */}
      <View
        accessible
        accessibilityLabel={version.label}
        testID="settings-version"
        style={styles.footer}
      >
        <Text variant="label" color={colors.textSecondary} style={styles.footerText}>
          {t('settings.appName')}
        </Text>
        {version.meta ? (
          <Text variant="caption" color={colors.textMuted} style={styles.footerText}>
            {version.meta}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // O aviso da conta suspensa, entre o título e a primeira sobrelinha.
  suspended: {
    marginBottom: spacing.lg,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  // O rodapé centralizado do menu de referência: o nome e, embaixo, a versão.
  footer: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  footerText: {
    textAlign: 'center',
  },
});
