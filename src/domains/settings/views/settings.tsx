import { router } from 'expo-router';
import {
  Ban,
  ChevronRight,
  ExternalLink,
  FileText,
  KeyRound,
  LogOut,
  Mail,
  ScrollText,
  Shield,
  Trash2,
  UserPen,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View } from 'react-native';

import { LargeTitleHeader } from '@/components/header';
import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { sourceOf } from '@/config/data-source';
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL } from '@/config/links';
import { useSignOut } from '@/domains/auth';
import {
  isAutomaticUsername,
  SuspendedNotice,
  useMyProfileQuery,
  usernameLock,
  type FanProfile,
} from '@/domains/profile';
import { useRewardsRulesUrl } from '@/domains/rewards';
import { isFirebaseConfigured } from '@/firebase';
import { useNow } from '@/hooks/use-now';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t, type TranslationKey } from '@/i18n';
import { openSupportEmail, openWebPage } from '@/services/web-page';
import { useSessionStore } from '@/stores/session';
import { colors, spacing } from '@/theme';

import { FanClubSection } from '../components/fan-club-section';
import { readAppVersion, type AppVersionInfo } from '../version';

const TRAILING_ICON_SIZE = 18;

function Chevron() {
  return <Icon icon={ChevronRight} size={TRAILING_ICON_SIZE} color={colors.textMuted} />;
}

/** "Abre fora do app": a seta das linhas que abrem uma página no navegador. */
function External() {
  return <Icon icon={ExternalLink} size={TRAILING_ICON_SIZE} color={colors.textMuted} />;
}

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

interface PageRowProps {
  icon: LucideIcon;
  titleKey: TranslationKey;
  url: string;
  testID: string;
}

/** Linha que abre uma página no navegador dentro do app (privacidade, termos, regulamento). */
function PageRow({ icon, titleKey, url, testID }: PageRowProps) {
  return (
    <ListRow
      leading={<IconTile icon={icon} tone="glass" />}
      title={t(titleKey)}
      trailing={<External />}
      onPress={() => openWebPage(url)}
      accessibilityRole="link"
      accessibilityLabel={t(titleKey)}
      accessibilityHint={t('settings.pageHint')}
      testID={testID}
    />
  );
}

/**
 * O que a linha "Editar perfil" promete: com a API, "Foto, nome, @, bio e
 * redes" (ou o aviso do @ automático, que não convida a trocar o @ travado
 * pelo prazo, seção 32); sem ela, a tela é só leitura (seção 28, decisão 12),
 * e a linha diz isso.
 */
function editProfileMeta(profile: FanProfile | null | undefined, now: Date): string {
  if (sourceOf('profile') !== 'api') return t('settings.editProfileMetaReadOnly');
  return t(
    isAutomaticUsername(profile?.username) && !usernameLock(profile, now)
      ? 'settings.editProfileMetaAutomatic'
      : 'settings.editProfileMeta',
  );
}

/**
 * Ajustes (sem desenho, no visual das outras telas), aberto pela engrenagem
 * do perfil, na ordem do menu de referência do dono. De cima para baixo: o
 * aviso da conta suspensa (só com a suspensão, seção 29, frente E); o perfil,
 * com "Editar perfil" (bloco 9); o fã-clube, só com o programa aberto ou com
 * candidatura (seção 34); a conta, com "Trocar e-mail" e "Trocar senha" (só
 * na conta com senha, frente D; sem elas, a seção some); a privacidade e a
 * segurança, juntas, com "Fãs bloqueados" (frente B) e as páginas dos termos
 * e da privacidade; o "Sobre" (frente C), com o regulamento (só com o
 * endereço no cache da loja) e o contato; a zona de perigo, com Sair e
 * Excluir conta na cor de perigo; e, no rodapé, o nome e a versão. Sair não
 * pede confirmação (dá para entrar de novo) e por isso não leva a seta de
 * "abre outra tela"; excluir abre uma tela que diz o que se perde. As páginas
 * abrem no navegador dentro do app, com a seta de "fora do app".
 *
 * Mora no domínio de composição `settings` (seção 29, decisão 11): os Ajustes
 * juntam o perfil, a conta (`auth`), a lista de bloqueados (`posts`) e o
 * regulamento (`rewards`), e o `posts` e o `rewards` já importam o `profile`.
 */
export function SettingsScreen() {
  const bottomInset = useTabBarInset();
  const email = useSessionStore((state) => state.user?.email ?? null);
  // Trocar a senha e o e-mail só na conta que entra com senha, e com o Firebase configurado.
  const canChangeCredentials = useSessionStore(
    (state) => state.user?.hasPassword === true && isFirebaseConfigured,
  );
  const signOut = useSignOut();
  const profile = useMyProfileQuery().data;
  const now = useNow();
  const rulesUrl = useRewardsRulesUrl();
  const [contactFailed, setContactFailed] = useState(false);
  // Depois de sair, a linha segue ocupada até o guard trocar a tela.
  const leaving = signOut.isPending || signOut.isSuccess;
  const profileMeta = editProfileMeta(profile, now);
  const version = versionTexts(readAppVersion());
  const contactError = t('settings.contactError', { email: SUPPORT_EMAIL });

  // Sem app de e-mail, o endereço aparece embaixo da lista, selecionável, e é anunciado.
  const writeToTeam = async (): Promise<void> => {
    const opened = await openSupportEmail(t('settings.contactSubject'));
    setContactFailed(!opened);
    if (!opened) AccessibilityInfo.announceForAccessibility(contactError);
  };

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader title={t('settings.title')} showBack />
      <SuspendedNotice style={styles.suspended} />
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
      <FanClubSection />
      {canChangeCredentials ? (
        <>
          <SectionLabel>{t('settings.account')}</SectionLabel>
          <View style={styles.rows}>
            <ListRow
              leading={<IconTile icon={Mail} tone="glass" />}
              title={t('settings.changeEmail')}
              meta={t('settings.changeEmailMeta')}
              trailing={<Chevron />}
              onPress={() => router.push('/trocar-email')}
              accessibilityLabel={`${t('settings.changeEmail')}. ${t('settings.changeEmailMeta')}`}
              accessibilityHint={t('settings.changeEmailHint')}
              testID="settings-change-email"
            />
            <ListRow
              leading={<IconTile icon={KeyRound} tone="glass" />}
              title={t('settings.changePassword')}
              meta={t('settings.changePasswordMeta')}
              trailing={<Chevron />}
              onPress={() => router.push('/trocar-senha')}
              accessibilityLabel={`${t('settings.changePassword')}. ${t('settings.changePasswordMeta')}`}
              accessibilityHint={t('settings.changePasswordHint')}
              testID="settings-change-password"
            />
          </View>
        </>
      ) : null}
      <SectionLabel>{t('settings.privacySecurity')}</SectionLabel>
      <View style={styles.rows}>
        <ListRow
          leading={<IconTile icon={Ban} tone="glass" />}
          title={t('settings.blockedFans')}
          meta={t('settings.blockedFansMeta')}
          trailing={<Chevron />}
          onPress={() => router.push('/fas-bloqueados')}
          accessibilityLabel={`${t('settings.blockedFans')}. ${t('settings.blockedFansMeta')}`}
          accessibilityHint={t('settings.blockedFansHint')}
          testID="settings-blocked-fans"
        />
        <PageRow
          icon={FileText}
          titleKey="settings.terms"
          url={TERMS_URL}
          testID="settings-terms"
        />
        <PageRow
          icon={Shield}
          titleKey="settings.privacy"
          url={PRIVACY_URL}
          testID="settings-privacy"
        />
      </View>
      <SectionLabel>{t('settings.about')}</SectionLabel>
      <View style={styles.rows}>
        {rulesUrl ? (
          <PageRow
            icon={ScrollText}
            titleKey="settings.rules"
            url={rulesUrl}
            testID="settings-rules"
          />
        ) : null}
        <ListRow
          leading={<IconTile icon={Mail} tone="glass" />}
          title={t('settings.contact')}
          meta={SUPPORT_EMAIL}
          onPress={() => void writeToTeam()}
          accessibilityRole="link"
          accessibilityLabel={`${t('settings.contact')}. ${SUPPORT_EMAIL}`}
          accessibilityHint={t('settings.contactHint')}
          testID="settings-contact"
        />
      </View>
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
      <SectionLabel>{t('settings.dangerZone')}</SectionLabel>
      <View style={styles.rows}>
        <ListRow
          leading={<IconTile icon={LogOut} tone="danger" />}
          tone="danger"
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
          leading={<IconTile icon={Trash2} tone="danger" />}
          tone="danger"
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
  // O título já deixa 18 embaixo: a primeira sobrelinha não soma o espaço dela em cima.
  firstLabel: {
    paddingTop: 0,
  },
  // O aviso da conta suspensa, entre o título e a primeira sobrelinha.
  suspended: {
    marginBottom: spacing.lg,
  },
  rows: {
    gap: spacing.listGap,
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
