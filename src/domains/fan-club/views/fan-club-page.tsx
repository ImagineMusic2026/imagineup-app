import { FlashList } from '@shopify/flash-list';
import { router, useIsFocused, useLocalSearchParams, useNavigationContainerRef } from 'expo-router';
import { Check, ChevronRight, Ellipsis, Share2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { BackButton, HeaderIconButton } from '@/components/header';
import { Icon } from '@/components/icon';
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
import { formatNumber } from '@/utils/number';

import { FanClubPostCard } from '../components/club-post-card';
import { ClubName } from '../components/club-name';
import { FAN_CLUB_ERROR_CODES } from '../consts';
import { fanClubErrorText } from '../describe';
import { isDefinitiveRefusal } from '../entry';
import { clubNameLabel, followersText, personName, postsCountText } from '../format';
import {
  useFanClubGate,
  useFanClubPageQuery,
  useFanClubPostsQuery,
  useFollowFanClubMutation,
  useShareFanClub,
} from '../queries';
import type { FanClubPage, FanClubPost } from '../types';

const SKELETON_HEIGHT = 180;
const CHEVRON_SIZE = 16;

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
  const focused = useIsFocused();
  const { query: gate, live } = useFanClubGate();
  const page = useFanClubPageQuery(clubId, live !== null);
  const posts = useFanClubPostsQuery(clubId, live !== null);
  // O gestor bloqueado aqui: a página some na hora, com o nome dele.
  const [blocked, setBlocked] = useState<string | null>(null);
  const club = page.data;
  const gone = isClubGone(page.error) || isClubGone(posts.error);

  const gateFailed = live === null && gate.isError && !isDefinitiveRefusal(gate.error);
  useAnnounceWhen(focused && gateFailed && !gate.isFetching, t('fanClub.loadError'));
  useAnnounceWhen(focused && gone && blocked === null, t('fanClub.notFound'));
  useAnnounceWhen(
    focused && live !== null && !gone && page.isError && !club && !page.isFetching,
    t('fanClub.loadError'),
  );

  if (live !== null && club && !gone && blocked === null) {
    return <ClubContent club={club} posts={posts} onBlocked={setBlocked} />;
  }

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
        </View>
      }
    >
      <View style={styles.body}>{body}</View>
    </Screen>
  );
}

/**
 * A página com o fã-clube, só depois da trava: o compartilhar (com o código
 * de convite, `GET /me/invite`) e o menu moram aqui, para nada sair antes da
 * abertura.
 */
function ClubContent({
  club,
  posts,
  onBlocked,
}: {
  club: FanClubPage;
  posts: PostsQuery;
  onBlocked: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const now = useNow();
  const share = useShareFanClub();
  // A falha das publicações só aparece na lista: o leitor ouve também.
  const focused = useIsFocused();
  const settled = focused && posts.isError && !posts.isFetching;
  useAnnounceWhen(settled && posts.data === undefined, t('fanClub.page.postsError'));
  useAnnounceWhen(settled && posts.isFetchNextPageError, t('fanClub.page.postsMoreError'));
  const shareClub = (): void =>
    share({ id: club.id, name: club.name, artistName: club.artist.name });

  return (
    <Screen
      padded
      contentStyle={styles.screen}
      header={
        <View style={styles.headerRow}>
          <BackButton />
          <View style={styles.headerActions}>
            <HeaderIconButton
              icon={Share2}
              onPress={shareClub}
              accessibilityLabel={t('fanClub.page.share')}
              accessibilityHint={t('fanClub.page.shareHint')}
              testID="fan-club-page-share"
            />
            {club.isOwner ? null : <BlockMenu club={club} onBlocked={onBlocked} />}
          </View>
        </View>
      }
    >
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
            onShare={shareClub}
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
        ListEmptyComponent={<PostsPlaceholder query={posts} isOwner={club.isOwner} />}
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
 * `Alert` do sistema, que foca, anuncia e já é a confirmação; para quem segue,
 * avisa que você deixa de seguir. O bloqueio que dá certo some com a página e abre a sheet
 * "Denunciar perfil" com o gestor (a denúncia de perfil de hoje).
 */
function BlockMenu({ club, onBlocked }: { club: FanClubPage; onBlocked: (name: string) => void }) {
  const online = useIsOnline();
  const owner = personName(club.owner);
  // Só quem segue deixa de seguir (decisão 32): a frase não diz o que não acontece.
  const following = club.isFollowing;
  const block = useBlockFanMutation(club.owner.uid, {
    onDone: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(
        t(following ? 'fanClub.page.blocked' : 'fanClub.page.blockedNotFollowing', { name: owner }),
      );
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
      t(following ? 'fanClub.page.blockMessage' : 'fanClub.page.blockMessageNotFollowing', {
        name: owner,
      }),
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

/** Um número do topo, no molde dos números do perfil (1e): o valor e a palavra embaixo, um foco só. */
function PageNumber({
  value,
  word,
  label,
  testID,
}: {
  value: number;
  word: string;
  label: string;
  testID: string;
}) {
  return (
    <View accessible accessibilityLabel={label} style={styles.number} testID={testID}>
      <Text variant="titleHeader">{formatNumber(value)}</Text>
      <Text variant="caption" color={colors.textSecondary} style={styles.numberWord}>
        {word}
      </Text>
    </View>
  );
}

/**
 * O topo da página (34.24): o nome, com o selo do oficial ao lado (34.23; um
 * foco, com o papel de cabeçalho, "Netto de Coração, fã-clube oficial");
 * "Fã-clube de {{artist}}", com a foto do artista, que abre a central (o
 * visitante entende que é um espaço de fãs do artista, e não a página dele);
 * "feito por @gestor", com a foto dele, que abre o perfil público; os
 * seguidores e as publicações no ar, no molde dos números do perfil, e o
 * Destaque; e o seguir. Nunca prêmio nem pontos (decisão 48).
 */
function ClubHeader({ club }: { club: FanClubPage }) {
  const navigation = useNavigationContainerRef();
  const owner = personName(club.owner);
  const artistOf = t('fanClub.page.artistOf', { artist: club.artist.name });
  return (
    <View style={styles.top} testID="fan-club-page-header">
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={clubNameLabel(club.name, club.official)}
        testID="fan-club-page-title"
      >
        <ClubName name={club.name} official={club.official} variant="titlePage" badgeSize={22} />
      </View>
      <PressableScale
        onPress={() => openArtistOverStack(navigation.getRootState(), club.artist.id)}
        accessibilityRole="link"
        accessibilityLabel={artistOf}
        accessibilityHint={t('fanClub.page.artistHint')}
        style={[styles.link, styles.artist]}
        testID="fan-club-page-artist"
      >
        <Avatar
          name={club.artist.name}
          id={club.artist.id}
          photoUrl={club.artist.thumbUrl}
          size="sm"
        />
        <Text variant="label" style={styles.linkText}>
          {artistOf}
        </Text>
        <Icon icon={ChevronRight} size={CHEVRON_SIZE} color={colors.textMuted} />
      </PressableScale>
      <PressableScale
        onPress={() => router.push(fanProfileHref(club.owner.uid))}
        accessibilityRole="link"
        accessibilityLabel={t('fanClub.page.byLabel', { owner })}
        accessibilityHint={t('fanProfile.openHint', { name: owner })}
        style={styles.link}
        testID="fan-club-page-owner"
      >
        <Avatar
          name={club.owner.name ?? club.owner.username}
          id={club.owner.uid}
          photoUrl={club.owner.photoURL}
          size="xs"
        />
        <Text variant="body" color={colors.textSecondary} style={styles.linkText}>
          {t('fanClub.page.by', { owner })}
        </Text>
        <Icon icon={ChevronRight} size={CHEVRON_SIZE} color={colors.textMuted} />
      </PressableScale>
      <View style={styles.numbers}>
        <PageNumber
          value={club.followerCount}
          word={t(
            club.followerCount === 1
              ? 'fanClub.page.followersWordOne'
              : 'fanClub.page.followersWord',
          )}
          label={followersText(club.followerCount)}
          testID="fan-club-page-followers"
        />
        <PageNumber
          value={club.postCount}
          word={t(club.postCount === 1 ? 'fanClub.page.postsWordOne' : 'fanClub.page.postsWord')}
          label={postsCountText(club.postCount)}
          testID="fan-club-page-posts"
        />
        {club.featured ? (
          <Pill
            label={t('fanClub.page.featured')}
            accessibilityLabel={t('fanClub.artistCard.featuredLabel')}
            tone="accentStrong"
            size="xs"
            style={styles.featured}
            testID="fan-club-page-featured"
          />
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
 * "Gerenciar meu fã-clube", que volta ao modo gestor (34.24; antes, o "Seu
 * fã-clube" parado). O seguir que fez a entrada sobe o "+N" e diz que
 * entrou na central. A recusa fica embaixo, anunciada: o limite de 50 leva a
 * "Fã-clubes que sigo", e a conta suspensa tem o link da equipe. Com
 * "Seguindo" (o sucesso, ou a falha incerta que gravou), a tentativa aberta
 * acaba e o aviso sai.
 */
function FollowArea({ club }: { club: FanClubPage }) {
  const online = useIsOnline();
  const follow = useFollowFanClubMutation();
  const [lastFailure, setFailure] = useState<Failure>(null);
  const joinLine = !club.isOwner && !club.isFollowing && !club.isMember;
  const { closeAttempt } = follow;
  // O seguir depois de deixar de seguir leva chave nova, e não a resposta guardada.
  useEffect(() => {
    if (club.isFollowing) closeAttempt(club.id);
  }, [club.isFollowing, club.id, closeAttempt]);
  // O aviso é do "Seguir": com "Seguindo", não fica embaixo.
  const failure = club.isFollowing ? null : lastFailure;

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
    // O gestor volta ao modo gestor (34.24): vindo do olho do cabeçalho, o
    // `dismissTo` fecha a página e volta ao Painel; vindo de outro lugar, troca
    // a página pelo "Meu fã-clube".
    button = (
      <Button
        label={t('fanClub.page.manage')}
        variant="secondary"
        size="md"
        onPress={() => router.dismissTo('/meu-fa-clube')}
        accessibilityHint={t('fanClub.page.manageHint')}
        testID="fan-club-manage"
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

/**
 * As publicações carregando, a falha (com "Tentar de novo") ou a lista vazia;
 * para o gestor, a vazia diz que as dele aparecem quando a equipe aprova.
 */
function PostsPlaceholder({ query, isOwner }: { query: PostsQuery; isOwner: boolean }) {
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
  return (
    <EmptyState message={t(isOwner ? 'fanClub.page.ownerEmpty' : 'fanClub.page.postsEmpty')} />
  );
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
  // As linhas do artista e do gestor: a foto, o texto e a seta, um alvo de 44.
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
  },
  artist: {
    marginTop: spacing.xs,
  },
  linkText: {
    flexShrink: 1,
  },
  // Como os números do perfil: cada coluna da largura do que mostra, e a que não cabe desce.
  numbers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing.xl,
    rowGap: spacing.sm,
    marginTop: spacing.md,
  },
  number: {
    minWidth: layout.minTouchTarget,
    alignItems: 'flex-start',
  },
  numberWord: {
    marginTop: spacing.xxs,
  },
  featured: {
    alignSelf: 'center',
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
