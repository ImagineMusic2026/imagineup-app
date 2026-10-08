import { useLocalSearchParams } from 'expo-router';
import { ExternalLink, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
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
import { sourceOf } from '@/config/data-source';
import { firebaseEmulatorHost } from '@/config/server';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';

import { SOCIAL_PREFIX } from '../components/profile-read-only';
import { SOCIAL_NETWORKS, socialUrl } from '../details';
import { useFanProfileQuery } from '../queries';
import { SOCIAL_LABEL_KEYS } from '../schemas';
import type { FanPublicProfile, SocialNetwork } from '../types';

const LINK_ICON_SIZE = 16;

/**
 * Os links das redes abrem? Só com a API de verdade: nas fixtures e no
 * emulador, os usuários de exemplo (`thalita.teste.up` e os outros) seguem o
 * formato das redes, e qualquer pessoa pode registrá-los; o toque mandaria
 * quem testa para a conta de um estranho (28.1, decisão 25).
 */
const linksOpen = (): boolean => sourceOf('profile') === 'api' && !firebaseEmulatorHost;

/** Uma rede com o link montado (o usuário guardado passou no padrão da rede). */
interface SocialLink {
  network: SocialNetwork;
  handle: string;
  url: string;
}

/** As redes que aparecem, na ordem da lista fixa: a fora do padrão não sai (`socialUrl`). */
function socialLinksOf(profile: FanPublicProfile): SocialLink[] {
  return SOCIAL_NETWORKS.flatMap((network) => {
    const handle = profile.socials?.[network] ?? null;
    const url = socialUrl(network, handle);
    return handle && url ? [{ network, handle, url }] : [];
  });
}

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
  const network = t(SOCIAL_LABEL_KEYS[link.network]);
  const shown = `${SOCIAL_PREFIX[link.network]}${link.handle}`;
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
  const links = socialLinksOf(profile);
  const opens = linksOpen();
  const [openFailed, setOpenFailed] = useState(false);
  useAnnounceWhen(openFailed, t('fanProfile.openError'));

  const open = (url: string): void => {
    setOpenFailed(false);
    Linking.openURL(url).catch(() => {
      haptics.trigger('error');
      setOpenFailed(true);
    });
  };

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
 * o mesmo aviso nos três casos, para o bloqueio não aparecer. Sem botão de
 * bloquear nem de denunciar (28.1, decisão 22).
 *
 * Fora das abas: o `useTabBarInset` dá 0, e o `Screen` não soma a área segura
 * de baixo, então a tela passa o `insets.bottom`. Sem internet, a consulta
 * pausa, com o aviso de offline de sempre.
 */
export function FanProfileScreen() {
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
