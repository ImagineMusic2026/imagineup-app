import { FlashList } from '@shopify/flash-list';
import { router, useIsFocused, useLocalSearchParams, useNavigationContainerRef } from 'expo-router';
import { Check, Ellipsis, Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { BackButton, HeaderIconButton } from '@/components/header';
import { Pill } from '@/components/pill';
import { PointsToast } from '@/components/points-toast';
import { PressableScale } from '@/components/pressable-scale';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { openArtistOverStack, useBlockFanMutation } from '@/domains/posts';
import { fanProfileHref, SuspensionContact } from '@/domains/profile';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useIsOnline } from '@/hooks/use-is-online';
import { useNow } from '@/hooks/use-now';
import { t, type TranslationKey, type TranslationParams } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, layout, radii, spacing } from '@/theme';

import { FanClubPostCard } from '../components/club-post-card';
import { UnofficialBand } from '../components/unofficial-band';
import { FAN_CLUB_ERROR_CODES } from '../consts';
import { fanClubErrorText } from '../describe';
import { isDefinitiveRefusal } from '../entry';
import { followersText, personName } from '../format';
import {
  useFanClubGate,
  useFanClubPageQuery,
  useFanClubPostsQuery,
  useFollowFanClubMutation,
  useShareFanClub,
} from '../queries';
import type { FanClubPage, FanClubPost } from '../types';

const SKELETON_HEIGHT = 180;

const noop = (): void => undefined;

const isClubGone = (error: unknown): boolean =>
  error instanceof ApiError && error.code === FAN_CLUB_ERROR_CODES.notFound;

function announce(message: string): void {
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

/** A recusa do seguir como a página mostra: a frase, o link do suspenso e o atalho do limite. */
type Failure = {
  key: TranslationKey;
  params?: TranslationParams;
  suspended: boolean;
  followLimit: boolean;
} | null;

function ItemGap() {
  return <View style={styles.gap} />;
}

/**
 * "/fa-clube/[clubeId]" (34.9, item 7): a página pública do fã-clube, na pilha
 * raiz, sem a tab bar, como o perfil público e o post (o destino do link de
 * convite). Inerte antes da abertura: sem a resposta da trava, diz que o
 * fã-clube não está disponível e não chama mais nada (o link a frio cai aqui
 * também). O fã-clube que saiu do ar, o de gestor bloqueado e o que não existe
 * dão o 404: "Este fã-clube não está disponível."
 */
export function FanClubPageScreen() {
  const params = useLocalSearchParams<{ clubeId: string }>();
  const clubId = typeof params.clubeId === 'string' ? params.clubeId : '';
  return <ClubScreen key={clubId} clubId={clubId} />;
}

function ClubScreen({ clubId }: { clubId: string }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const now = useNow();
  const share = useShareFanClub();
  const { query: gate, live } = useFanClubGate();
  const page = useFanClubPageQuery(clubId, live !== null);
  const posts = useFanClubPostsQuery(clubId, live !== null);
  // O gestor bloqueado aqui: a página some na hora, com o nome dele.
  const [blocked, setBlocked] = useState<string | null>(null);
  const club = page.data;
  const gone = isClubGone(page.error) || isClubGone(posts.error);
  const shown = live !== null && club !== undefined && !gone && blocked === null;

  const gateFailed = live === null && gate.isError && !isDefinitiveRefusal(gate.error);
  useAnnounceWhen(focused && gateFailed && !gate.isFetching, t('fanClub.loadError'));
  useAnnounceWhen(focused && gone && blocked === null, t('fanClub.notFound'));
  useAnnounceWhen(
    focused && live !== null && !gone && page.isError && !club && !page.isFetching,
    t('fanClub.loadError'),
  );

  const shareClub = (target: FanClubPage): void =>
    share({ id: target.id, name: target.name, artistName: target.artist.name });

  let body;
  if (blocked !== null) {
    body = (
      <View testID="fan-club-page-blocked">
        <EmptyState message={t('fanClub.page.blockedState', { name: blocked })} />
      </View>
    );
  } else if (live === null) {
    body = gate.isPending ? (
      <PageSkeleton />
    ) : gateFailed ? (
      <EmptyState
        tone="error"
        message={t('fanClub.loadError')}
        onAction={() => void gate.refetch()}
        actionLoading={gate.isFetching}
      />
    ) : (
      <View testID="fan-club-not-available">
        <EmptyState message={t('fanClub.notAvailable')} />
      </View>
    );
  } else if (gone) {
    body = (
      <View testID="fan-club-page-not-found">
        <EmptyState message={t('fanClub.notFound')} />
      </View>
    );
  } else if (!club) {
    body = page.isError ? (
      <EmptyState
        tone="error"
        message={t('fanClub.loadError')}
        onAction={() => void page.refetch()}
        actionLoading={page.isFetching}
      />
    ) : (
      <PageSkeleton />
    );
  }

  return (
    <Screen
      padded
      contentStyle={styles.screen}
      header={
        <View style={styles.headerRow}>
          <BackButton />
          {shown ? (
            <View style={styles.headerActions}>
              <HeaderIconButton
                icon={Share2}
                onPress={() => shareClub(club)}
                accessibilityLabel={t('fanClub.page.share')}
                accessibilityHint={t('fanClub.page.shareHint')}
                testID="fan-club-page-share"
              />
              {club.isOwner ? null : (
                <BlockMenu club={club} onBlocked={(name) => setBlocked(name)} />
              )}
            </View>
          ) : null}
        </View>
      }
    >
      {shown ? (
        <FlashList<FanClubPost>
          data={posts.data?.pages.flatMap((item) => item.items) ?? []}
          keyExtractor={(post) => post.id}
          getItemType={(post) => post.kind}
          renderItem={({ item }) => (
            <FanClubPostCard
              post={item}
              now={now}
              variant="page"
              canReport={!club.isOwner}
              onShare={() => shareClub(club)}
              onReport={(post) =>
                router.push({
                  pathname: '/denunciar-publicacao/[publicacaoId]',
                  params: { publicacaoId: post.id },
                })
              }
              testID={`fan-club-post-${item.id}`}
            />
          )}
          extraData={{ now, club }}
          ItemSeparatorComponent={ItemGap}
          ListHeaderComponent={<ClubHeader club={club} />}
          ListEmptyComponent={<PostsPlaceholder query={posts} />}
          ListFooterComponent={<PostsFooter query={posts} />}
          onEndReached={() => {
            if (posts.hasNextPage && !posts.isFetchingNextPage && !posts.isFetchNextPageError) {
              void posts.fetchNextPage({ cancelRefetch: false });
            }
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          showsVerticalScrollIndicator={false}
          testID="fan-club-page"
        />
      ) : (
        <View style={styles.body}>{body}</View>
      )}
    </Screen>
  );
}

function PageSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('fanClub.page.loading')}>
      <Skeleton height={SKELETON_HEIGHT} tone="surface" radius={radii.lg} />
    </SkeletonGroup>
  );
}

/**
 * O menu da página (decisão 19): "Bloquear e denunciar" o gestor, pelo
 * `Alert` do sistema, que foca, anuncia e já é a confirmação; avisa que você
 * deixa de seguir. O bloqueio que dá certo some com a página e abre a sheet
 * "Denunciar perfil" com o gestor (a denúncia de perfil de hoje).
 */
function BlockMenu({ club, onBlocked }: { club: FanClubPage; onBlocked: (name: string) => void }) {
  const online = useIsOnline();
  const owner = personName(club.owner);
  const block = useBlockFanMutation(club.owner.uid, {
    onDone: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(t('fanClub.page.blocked', { name: owner }));
      onBlocked(owner);
      router.push({
        pathname: '/denunciar-perfil/[fanId]',
        params: { fanId: club.owner.uid, clube: club.id },
      });
    },
    onError: (error) => {
      haptics.trigger('error');
      Alert.alert(t(actionRefusal(error, 'block').key));
    },
  });

  const open = (): void => {
    Alert.alert(
      t('fanClub.page.blockTitle', { name: owner }),
      t('fanClub.page.blockMessage', { name: owner }),
      [
        { text: t('fanClub.page.cancel'), style: 'cancel' },
        {
          text: t('fanClub.page.blockConfirm'),
          style: 'destructive',
          onPress: () => block.block(),
        },
      ],
    );
  };

  return (
    <HeaderIconButton
      icon={Ellipsis}
      onPress={open}
      accessibilityLabel={t('fanClub.page.more')}
      accessibilityHint={t('fanClub.page.moreHint')}
      disabled={!online}
      busy={block.isPending}
      testID="fan-club-page-more"
    />
  );
}

/**
 * O topo da página: a faixa não oficial antes do nome (um foco, com o papel de
 * cabeçalho), "feito por @gestor" (abre o perfil público dele), o artista (abre
 * a central), os seguidores e o Destaque, e o seguir.
 */
function ClubHeader({ club }: { club: FanClubPage }) {
  const navigation = useNavigationContainerRef();
  const owner = personName(club.owner);
  const followers = followersText(club.followerCount);
  return (
    <View style={styles.top} testID="fan-club-page-header">
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={t('fanClub.page.headerLabel', { name: club.name })}
        style={styles.title}
      >
        <UnofficialBand />
        <Text variant="titlePage">{club.name}</Text>
      </View>
      <TextLink
        label={t('fanClub.page.by', { owner })}
        onPress={() => router.push(fanProfileHref(club.owner.uid))}
        accessibilityLabel={t('fanClub.page.byLabel', { owner })}
        accessibilityHint={t('fanProfile.openHint', { name: owner })}
        style={styles.owner}
        testID="fan-club-page-owner"
      />
      <PressableScale
        onPress={() => openArtistOverStack(navigation.getRootState(), club.artist.id)}
        accessibilityRole="link"
        accessibilityLabel={t('fanClub.page.artistLabel', { artist: club.artist.name })}
        accessibilityHint={t('fanClub.page.artistHint')}
        style={styles.artist}
        testID="fan-club-page-artist"
      >
        <Avatar
          name={club.artist.name}
          id={club.artist.id}
          photoUrl={club.artist.thumbUrl}
          size="sm"
        />
        <Text variant="label" style={styles.artistName}>
          {club.artist.name}
        </Text>
      </PressableScale>
      <View
        accessible
        accessibilityLabel={
          club.featured ? `${followers}. ${t('fanClub.artistCard.featuredLabel')}` : followers
        }
        style={styles.stats}
        testID="fan-club-page-followers"
      >
        <Text variant="label">{followers}</Text>
        {club.featured ? (
          <Pill label={t('fanClub.page.featured')} tone="accentStrong" size="xs" />
        ) : null}
      </View>
      <FollowArea club={club} />
      <SectionLabel>{t('fanClub.page.postsTitle')}</SectionLabel>
    </View>
  );
}

/**
 * O seguir (decisão 26): "Seguir o fã-clube", com a linha "Você também entra
 * na central de {{artist}}" para quem não é membro (que entra no rótulo do
 * botão); depois, "Seguindo", que abre a sheet "Deixar de seguir". É o mesmo
 * botão, para o foco do leitor ficar nele quando o rótulo troca. O gestor vê
 * "Seu fã-clube", sem toque. O seguir que fez a entrada sobe o "+N" e diz que
 * entrou na central. A recusa fica embaixo, anunciada: o limite de 50 leva a
 * "Fã-clubes que sigo", e a conta suspensa tem o link da equipe.
 */
function FollowArea({ club }: { club: FanClubPage }) {
  const online = useIsOnline();
  const follow = useFollowFanClubMutation();
  const [failure, setFailure] = useState<Failure>(null);
  const joinLine = !club.isOwner && !club.isFollowing && !club.isMember;

  const run = (): void => {
    setFailure(null);
    follow.mutate(
      { id: club.id, artistId: club.artist.id },
      {
        onSuccess: (result) => {
          haptics.trigger('success');
          announce(t('fanClub.page.followed', { name: club.name }));
          if (result.joined) announce(t('artist.join.joined', { name: club.artist.name }));
        },
        onError: (error) => {
          const text = fanClubErrorText(error);
          const refusal = actionRefusal(error, 'clubFollow');
          const key = text?.key ?? refusal.key;
          setFailure({
            key,
            params: text?.params,
            suspended: refusal.type === 'suspended',
            followLimit:
              error instanceof ApiError &&
              error.code === FAN_CLUB_ERROR_CODES.refused &&
              error.details?.reason === 'follow_limit',
          });
          haptics.trigger('error');
          AccessibilityInfo.announceForAccessibility(t(key, text?.params));
        },
      },
    );
  };

  let button;
  if (club.isOwner) {
    button = (
      <Button
        label={t('fanClub.page.own')}
        variant="secondary"
        size="md"
        readOnly
        onPress={noop}
        accessibilityLabel={t('fanClub.page.ownLabel', { name: club.name })}
        testID="fan-club-follow"
      />
    );
  } else {
    const following = club.isFollowing;
    button = (
      <Button
        label={t(following ? 'fanClub.page.following' : 'fanClub.page.follow')}
        icon={following ? Check : undefined}
        variant={following ? 'secondary' : 'primary'}
        size="md"
        loading={follow.isPending}
        disabled={!following && !online}
        haptic={following ? 'tap' : 'confirm'}
        onPress={
          following
            ? () => {
                setFailure(null);
                router.push({
                  pathname: '/deixar-de-seguir/[clubeId]',
                  params: { clubeId: club.id },
                });
              }
            : run
        }
        accessibilityLabel={
          following
            ? t('fanClub.page.followingLabel', { name: club.name })
            : t(joinLine ? 'fanClub.page.followJoinLabel' : 'fanClub.page.followLabel', {
                name: club.name,
                artist: club.artist.name,
              })
        }
        accessibilityHint={following ? t('fanClub.page.followingHint') : undefined}
        testID="fan-club-follow"
      />
    );
  }

  return (
    <View style={styles.follow}>
      {/* O "+N" nasce na borda de cima do botão. */}
      <View>
        {button}
        <PointsToast
          points={follow.award?.points ?? 0}
          trigger={follow.award?.id ?? null}
          announcement={follow.award?.announcement}
          haptic={follow.award?.haptic}
          testID="fan-club-follow-points"
        />
      </View>
      {joinLine ? (
        // No rótulo do botão; aqui, só para quem vê.
        <Text
          variant="caption"
          color={colors.textSecondary}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.joinLine}
        >
          {t('fanClub.page.followJoinLine', { artist: club.artist.name })}
        </Text>
      ) : null}
      {failure ? (
        <View style={styles.failure}>
          <Text variant="caption" color={colors.danger} style={styles.center}>
            {t(failure.key, failure.params)}
          </Text>
          {failure.suspended ? <SuspensionContact align="center" /> : null}
          {failure.followLimit ? (
            <TextLink
              label={t('fanClub.page.seeFollows')}
              // A página fica por cima das abas: o `dismissTo` a fecha e abre a
              // lista na pilha do Perfil, com a raiz dela embaixo.
              onPress={() =>
                router.dismissTo('/(tabs)/(perfil)/fa-clubes-que-sigo', { withAnchor: true })
              }
              style={styles.centerLink}
              testID="fan-club-follow-limit"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type PostsQuery = ReturnType<typeof useFanClubPostsQuery>;

/** As publicações carregando, a falha (com "Tentar de novo") ou a lista vazia. */
function PostsPlaceholder({ query }: { query: PostsQuery }) {
  if (query.isPending) {
    return (
      <SkeletonGroup accessibilityLabel={t('fanClub.page.postsLoading')}>
        <Skeleton height={layout.buttonHeight.lg * 3} tone="surface" radius={radii.lg} />
      </SkeletonGroup>
    );
  }
  if (query.isError && !query.data) {
    return (
      <EmptyState
        tone="error"
        message={t('fanClub.page.postsError')}
        onAction={() => void query.refetch()}
        actionLoading={query.isFetching}
      />
    );
  }
  return <EmptyState message={t('fanClub.page.postsEmpty')} />;
}

/** A página seguinte chegando, ou a que falhou, com "Tentar de novo" só para ela. */
function PostsFooter({ query }: { query: PostsQuery }) {
  if (query.isFetchNextPageError) {
    return (
      <EmptyState
        tone="error"
        message={t('fanClub.page.postsMoreError')}
        onAction={() => void query.fetchNextPage({ cancelRefetch: false })}
        actionLoading={query.isFetchingNextPage}
        style={styles.footer}
      />
    );
  }
  if (query.isFetchingNextPage) {
    return <ActivityIndicator color={colors.textMuted} style={styles.footer} />;
  }
  return null;
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela; o espaço da área segura fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: layout.minTouchTarget,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  body: {
    paddingTop: spacing.lg,
  },
  top: {
    paddingTop: spacing.md,
  },
  title: {
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  owner: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  artist: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
  },
  artistName: {
    flexShrink: 1,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  follow: {
    marginTop: spacing.lg,
  },
  joinLine: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  failure: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  center: {
    textAlign: 'center',
  },
  centerLink: {
    alignSelf: 'center',
  },
  gap: {
    height: spacing.listGap,
  },
  footer: {
    paddingVertical: spacing.lg,
  },
});
