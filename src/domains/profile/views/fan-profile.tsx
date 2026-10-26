import { useLocalSearchParams } from 'expo-router';
import { ExternalLink, Lock } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { Glyph } from '@/components/glyph';
import { BackHeader } from '@/components/header';
import { Icon } from '@/components/icon';
import { IconTile } from '@/components/icon-tile';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { colors, spacing } from '@/theme';

import { useOpenSocialLink } from '../hooks/use-open-social-link';
import { useFanProfileQuery } from '../queries';
import { linksOpen, socialLinksOf, socialLinkText, type SocialLink } from '../social-links';
import type { FanPublicProfile } from '../types';

const LINK_ICON_SIZE = 16;

interface SocialRowProps {
  link: SocialLink;
  /** `null` nas fixtures e no emulador: a linha só mostra o usuário, sem toque. */
  onOpen: ((url: string) => void) | null;
}

/**
 * Uma rede: o glifo, o nome e o usuário ("@thalita.teste.up", "in/..."). Com
 * os links abrindo, a linha é um botão só, com o `ExternalLink` oculto (o
 * rótulo e a dica dizem o que ele faz); sem, um elemento só, sem toque.
 */
function SocialRow({ link, onOpen }: SocialRowProps) {
  const { network, handle: shown } = socialLinkText(link);
  const props = {
    title: network,
    meta: shown,
    leading: (
      <IconTile
        tone="glass"
        renderIcon={({ color, size }) => <Glyph name={link.network} size={size} color={color} />}
      />
    ),
    accessibilityLabel: t('fanProfile.socialLabel', { network, handle: shown }),
    testID: `fan-social-${link.network}`,
  };
  if (!onOpen) return <ListRow {...props} />;
  return (
    <ListRow
      {...props}
      trailing={<Icon icon={ExternalLink} size={LINK_ICON_SIZE} color={colors.textMuted} />}
      accessibilityHint={t('fanProfile.socialHint', { network })}
      onPress={() => onOpen(link.url)}
    />
  );
}

/**
 * A bio e as redes do perfil completo. O link abre fora do app
 * (`Linking.openURL`, que cai no app da rede quando instalado); a falha mostra o
 * aviso embaixo da lista, anunciado, com o toque de erro. Nas fixtures e no
 * emulador, as linhas não abrem, e o aviso de exemplo diz por quê.
 */
function FanDetails({ profile }: { profile: FanPublicProfile }) {
  const links = socialLinksOf(profile.socials);
  const opens = linksOpen();
  const { open, failed: openFailed } = useOpenSocialLink();

  if (!profile.bio && links.length === 0) {
    return <EmptyState message={t('fanProfile.empty')} />;
  }

  return (
    <>
      {profile.bio ? (
        <Text variant="body" color={colors.textBody} style={[styles.bio, styles.centered]}>
          {profile.bio}
        </Text>
      ) : null}
      {links.length > 0 ? (
        <>
          <SectionLabel>{t('fanProfile.socials')}</SectionLabel>
          <View style={styles.rows}>
            {links.map((link) => (
              <SocialRow key={link.network} link={link} onOpen={opens ? open : null} />
            ))}
          </View>
          {opens ? null : (
            <Text variant="caption" color={colors.textMuted} style={styles.footnote}>
              {t('fanProfile.sampleLinks')}
            </Text>
          )}
          {openFailed ? (
            <Text variant="caption" color={colors.danger} style={styles.footnote}>
              {t('fanProfile.openError')}
            </Text>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * Perfil público de outro fã (`/fa/<uid>`, seção 28), aberto pelo ranking
 * (1f e a aba Ranking da 1d), pelo pódio, pelos top fãs da 1d e pelos
 * comentários. Tela fora do protótipo, aprovada pelo dono: o voltar sem
 * título, e no topo a foto, o nome (o cabeçalho da tela) e o @. Completo, a
 * bio e as redes; fechado (conta privada, suspensa ou que bloqueou quem vê),
 * o mesmo aviso nos três casos, para o bloqueio não aparecer.
 *
 * Denunciar e bloquear (seção 29) moram nos posts, que importam o perfil: a
 * rota monta esta tela pelo domínio de composição `fan-page`, que passa as
 * ações pelo `actions`. Elas aparecem depois da bio e das redes (ou do aviso
 * de perfil fechado), só com o perfil carregado: nunca carregando, no 404 nem
 * no erro.
 *
 * Fora das abas: o `useTabBarInset` dá 0, e o `Screen` não soma a área segura
 * de baixo, então a tela passa o `insets.bottom`. Sem internet, a consulta
 * pausa, com o aviso de offline de sempre.
 */
export interface FanProfileScreenProps {
  /** O que vem depois do perfil carregado (o bloco "Segurança" do `fan-page`). */
  actions?: (profile: FanPublicProfile) => ReactNode;
}

export function FanProfileScreen({ actions }: FanProfileScreenProps = {}) {
  const { fanId = '' } = useLocalSearchParams<{ fanId: string }>();
  const insets = useSafeAreaInsets();
  const query = useFanProfileQuery(fanId);
  const profile = query.data;

  // O fã saiu do ImagineUP: vale também com o perfil no cache (a busca de
  // novo que falha deixa o dado antigo no lugar).
  const missing = query.error instanceof ApiError && query.error.kind === 'notFound';
  const failed = profile === undefined && query.isError && !missing;
  useAnnounceWhen(missing, t('fanProfile.notFound'));
  useAnnounceWhen(failed && !query.isFetching, t('fanProfile.loadError'));

  const content = (() => {
    // O voltar é o do header: um segundo "Voltar" só repetiria para o leitor.
    if (missing) return <EmptyState message={t('fanProfile.notFound')} style={styles.state} />;
    if (failed) {
      return (
        <EmptyState
          tone="error"
          message={t('fanProfile.loadError')}
          onAction={() => void query.refetch()}
          actionLoading={query.isFetching}
          style={styles.state}
        />
      );
    }
    if (!profile) {
      return (
        <ActivityIndicator
          color={colors.textMuted}
          accessibilityLabel={t('fanProfile.loading')}
          style={styles.state}
        />
      );
    }
    return (
      <>
        <View style={styles.top}>
          <Avatar
            name={profile.displayName}
            id={profile.uid}
            photoUrl={profile.photoURL}
            size="profile"
          />
          <Text
            variant="titleCard"
            accessibilityRole="header"
            style={[styles.name, styles.centered]}
            testID="fan-profile-name"
          >
            {profile.displayName ?? t('profile.fallbackName')}
          </Text>
          {profile.username ? (
            <Text variant="body" color={colors.textSecondary} style={styles.centered}>
              {`@${profile.username}`}
            </Text>
          ) : null}
        </View>
        {profile.restricted ? (
          <EmptyState
            icon={Lock}
            title={t('fanProfile.closed')}
            message={t('fanProfile.closedText')}
          />
        ) : (
          <FanDetails profile={profile} />
        )}
        {actions?.(profile)}
      </>
    );
  })();

  return (
    <Screen scroll bottomInset={insets.bottom} header={<BackHeader />}>
      {content}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  name: {
    marginTop: spacing.rowGap,
    marginBottom: spacing.xs,
  },
  centered: {
    textAlign: 'center',
    maxWidth: '100%',
  },
  bio: {
    alignSelf: 'center',
  },
  rows: {
    gap: spacing.sm,
  },
  footnote: {
    paddingTop: spacing.sm,
  },
  state: {
    marginTop: spacing.xl,
  },
});
