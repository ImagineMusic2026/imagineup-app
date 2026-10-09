import {
  FlashList,
  type FlashListProps,
  type FlashListRef,
  type ListRenderItemInfo,
} from '@shopify/flash-list';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type Ref,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  View,
  type HostInstance,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { UnderlineTabs, type UnderlineTab } from '@/components/underline-tabs';
import { EventRow, useArtistAgendaQuery } from '@/domains/agenda';
import { useArtistQuery, useIsJoinPending, useJoinCentralMutation } from '@/domains/artists';
import {
  FeaturedMissionCard,
  MissionRow,
  missionHref,
  missionsOfArtist,
  useMissionAction,
  useMissionsQuery,
  type Mission,
} from '@/domains/missions';
import { useArtistPostsQuery } from '@/domains/posts';
import { fanProfileHref, useFanIdentity } from '@/domains/profile';
import {
  RankingRow,
  SeasonLine,
  useLeaderboardInfiniteQuery,
  useSeasonOver,
  useSeasonQuery,
  type LeaderboardEntry,
  type RankingScope,
  type RankingSelf,
} from '@/domains/ranking';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useNow } from '@/hooks/use-now';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { colors, motion, spacing } from '@/theme';

import { ArtistActions } from '../components/artist-actions';
import { ArtistCompactHeader } from '../components/artist-compact-header';
import { ArtistCover } from '../components/artist-cover';
import { ArtistStats } from '../components/artist-stats';
import { PostGridRow, PostGridSkeleton } from '../components/post-grid-row';
import { TabSkeleton } from '../components/tab-skeleton';
import { TopFansCard } from '../components/top-fans-card';
import {
  ARTIST_TABS,
  compactHeaderHeight,
  coverButtonsTop,
  coverHeight,
  type ArtistTab,
} from '../consts';
import { useArtistRefresh } from '../hooks/use-artist-refresh';
import { useShareArtist } from '../hooks/use-share-artist';
import {
  agendaItems,
  artistListItems,
  gapBetween,
  missionItems,
  muralItems,
  rankingItems,
  type ArtistListItem,
  type TabLoad,
} from '../items';

type ArtistListProps = FlashListProps<ArtistListItem> & {
  ref?: Ref<FlashListRef<ArtistListItem>>;
};

// A lista passa pelo Reanimated para a rolagem mover o header compacto e a
// capa no thread de UI, sem esperar o JS.
const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList as ComponentType<ArtistListProps>,
);

const TAB_LABELS: Record<ArtistTab, TranslationKey> = {
  mural: 'artist.tabs.mural',
  missions: 'artist.tabs.missions',
  agenda: 'artist.tabs.agenda',
  ranking: 'artist.tabs.ranking',
};

const TABS: UnderlineTab<ArtistTab>[] = ARTIST_TABS.map((tab) => ({
  value: tab,
  label: t(TAB_LABELS[tab]),
}));

// "Hoje" abre a lista a 22 das abas; "Esta semana" vem a 20 da última linha (1g).
const MISSION_SECTION_SPACING = { today: 'default', week: 'tight' } as const;

const STATUS_TEXT: Record<
  ArtistTab,
  { loading: TranslationKey; empty: TranslationKey; error: TranslationKey }
> = {
  mural: {
    loading: 'artist.posts.loading',
    empty: 'artist.posts.empty',
    error: 'artist.posts.loadError',
  },
  missions: {
    loading: 'artist.missions.loading',
    empty: 'artist.missions.empty',
    error: 'artist.missions.loadError',
  },
  agenda: {
    loading: 'artist.agenda.loading',
    empty: 'artist.agenda.empty',
    error: 'artist.agenda.loadError',
  },
  ranking: {
    loading: 'artist.ranking.loading',
    empty: 'artist.ranking.empty',
    error: 'artist.ranking.loadError',
  },
};

const MORE_ERROR: Partial<Record<ArtistTab, TranslationKey>> = {
  mural: 'artist.posts.moreError',
  agenda: 'artist.agenda.moreError',
  ranking: 'artist.ranking.moreError',
};

function loadOf(query: { isPending: boolean; data: unknown }): TabLoad {
  if (query.isPending) return 'loading';
  return query.data === undefined ? 'error' : 'ready';
}

/**
 * O conteúdo de cada aba entra em fade quando a aba muda. No render em que ela
 * muda, a célula da aba nova já nasce invisível (o thread de UI ainda está na
 * aba antiga), então nada aparece seco antes de o fade começar.
 */
function Fade({
  progress,
  shownTab,
  tab,
  reducedMotion,
  style,
  children,
}: {
  progress: SharedValue<number>;
  shownTab: SharedValue<ArtistTab>;
  tab: ArtistTab;
  reducedMotion: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 1 : shownTab.get() === tab ? progress.get() : 0,
  }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

function ItemGap({
  leadingItem,
  trailingItem,
}: {
  leadingItem?: ArtistListItem;
  trailingItem?: ArtistListItem;
}) {
  if (!leadingItem || !trailingItem) return null;
  const gap = gapBetween(leadingItem, trailingItem);
  return gap ? <View style={{ height: spacing[gap] }} /> : null;
}

/**
 * A aba desta página aonde a missão leva, quando o destino dela está aqui: a
 * que leva à própria central (curtir posts do artista) troca para o Mural, e
 * a de presença num show dele, para a Agenda. Sem isso, a agenda abriria na
 * aba Explorar (ela não está nas pilhas do Início e do Perfil), e o voltar
 * não traria o fã de volta à central.
 */
function tabOfMission(mission: Mission, artistId: string): ArtistTab | null {
  const href = missionHref(mission);
  if (href === '/agenda') return 'agenda';
  const here =
    typeof href === 'object' &&
    href !== null &&
    'pathname' in href &&
    href.pathname === '/artista/[artistaId]' &&
    (href.params as { artistaId?: string } | undefined)?.artistaId === artistId;
  return here ? 'mural' : null;
}

/**
 * 1d. A página do artista (a central): capa, números e "Entrar na central" no
 * cabeçalho de uma FlashList só; as abas (Mural, Missões, Agenda, Ranking)
 * grudam embaixo do header compacto; e o conteúdo da aba escolhida vem depois
 * delas. Rota compartilhada: abre dentro da aba de onde veio, com a tab bar.
 *
 * O Mural tem os top fãs da temporada (os três primeiros do ranking da
 * central, a mesma fonte da aba Ranking e da 1f) e a grade de posts. As
 * outras abas reaproveitam as linhas da 1g, da 1m e da 1f, com os dados das
 * mesmas consultas, filtrados pela central. "Ver ranking" escolhe a aba
 * Ranking e rola até as abas (proposta padrão da pergunta 7.1.6; a 1f segue
 * aceitando `/ranking?artista=<id>` para links). Fora do contrato e fora
 * daqui: o sino, a nota, os playlists, o "Perto de mim" da agenda e o
 * "Amigos" do ranking.
 *
 * Trocar de aba pela barra grudada, pelo "Ver ranking" ou por uma missão leva
 * o foco do leitor de tela ao começo do conteúdo novo: a barra grudada é lida
 * depois do último item, e o conteúdo novo ficaria para trás.
 *
 * Um link para outra central com esta aberta troca só o parâmetro da mesma
 * tela: a página nasce de novo (`key`), no Mural e no topo, sem a aba e a
 * rolagem da central anterior.
 */
export function ArtistDetailsScreen() {
  const params = useLocalSearchParams<{ artistaId: string }>();
  const artistId = typeof params.artistaId === 'string' ? params.artistaId : '';
  return <ArtistPage key={artistId} artistId={artistId} />;
}

function ArtistPage({ artistId }: { artistId: string }) {
  const insets = useSafeAreaInsets();
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const now = useNow();
  const reducedMotion = usePrefersReducedMotion();
  const identity = useFanIdentity();
  const self: RankingSelf = {
    id: identity.uid ?? 'me',
    name: identity.name,
    photoUrl: identity.photoURL,
  };

  const artistQuery = useArtistQuery(artistId);
  const artist = artistQuery.data;
  const { join, award } = useJoinCentralMutation(artistId);
  const joinPending = useIsJoinPending(artistId);
  const share = useShareArtist();
  const openMission = useMissionAction();

  const scope: RankingScope = { kind: 'artist', artistId };
  const board = useLeaderboardInfiniteQuery(scope);
  const season = useSeasonQuery();
  // Acabou com a página aberta: o ranking busca de novo (sem setas, encerrado).
  const seasonOver = useSeasonOver(season.data, now);
  const posts = useArtistPostsQuery(artistId);
  const missions = useMissionsQuery();
  const agenda = useArtistAgendaQuery(artistId);

  const [tab, setTab] = useState<ArtistTab>('mural');
  const [stuck, setStuck] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  // Espaço no pé para as abas continuarem grudadas numa aba curta.
  const [footerSpace, setFooterSpace] = useState(0);
  const listRef = useRef<FlashListRef<ArtistListItem>>(null);
  const contentHeight = useRef(0);
  // O começo do conteúdo da aba (o título dos top fãs, a primeira sobrelinha,
  // a temporada ou o aviso), para o foco do leitor de tela ir até ele.
  const contentStart = useRef<HostInstance | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const buttonsTop = coverButtonsTop(insets.top);
  const compactHeight = compactHeaderHeight(insets.top);
  const cover = coverHeight(insets.top);
  // A capa cresce além da altura do desenho quando o nome não cabe (fonte grande).
  const [coverSize, setCoverSize] = useState(cover);
  // Onde as abas grudam: o topo delas embaixo do header compacto.
  const stickAt = Math.max(0, headerHeight - compactHeight);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });

  // O conteúdo da aba nova entra em fade (150 ms), parado com reduzir movimento.
  const contentFade = useSharedValue(1);
  const shownTab = useSharedValue<ArtistTab>(tab);
  useEffect(() => {
    if (shownTab.get() === tab) return;
    contentFade.set(0);
    shownTab.set(tab);
    contentFade.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.fast, easing: motion.easing.out }),
    );
  }, [tab, reducedMotion, shownTab, contentFade]);

  const leaderboard = board.data?.pages.flatMap((page) => page.items) ?? [];
  const topFans = leaderboard.filter((entry) => entry.position <= 3);
  const artistPosts = posts.data?.pages.flatMap((page) => page.items) ?? [];
  const artistMissions = missionsOfArtist(missions.data?.missions ?? [], artistId);
  const artistEvents = agenda.data?.pages.flatMap((page) => page.items) ?? [];

  const content = ((): ArtistListItem[] => {
    switch (tab) {
      case 'mural':
        return muralItems(artistPosts, loadOf(posts));
      case 'missions':
        return missionItems(artistMissions, now, loadOf(missions));
      case 'agenda':
        return agendaItems(artistEvents, now, loadOf(agenda));
      case 'ranking':
        return rankingItems(leaderboard, loadOf(board));
    }
  })();
  const items = artistListItems(content);

  const tabQuery = { mural: posts, missions, agenda, ranking: board }[tab];
  const pagedQuery =
    tab === 'mural' ? posts : tab === 'agenda' ? agenda : tab === 'ranking' ? board : null;
  // Na aba Ranking, a consulta da aba é a mesma dos top fãs.
  const pageQueries = [...new Set([artistQuery, board, tabQuery])];
  const { refreshing, refresh } = useArtistRefresh(pageQueries);

  const notFound = artistQuery.error instanceof ApiError && artistQuery.error.kind === 'notFound';
  // A central que saiu do ar com a página aberta (a busca de novo dá 404) some
  // da tela: deixar a de antes, com "Tentar de novo", daria 404 para sempre.
  const artistFailed = artistQuery.isError && (artist === undefined || notFound);
  useAnnounceWhen(
    focused && artistFailed && !artistQuery.isFetching,
    t(notFound ? 'artist.notFound' : 'artist.loadError'),
  );
  // As falhas que só aparecem na tela também são anunciadas (o iOS não tem
  // live region): a aba que não carregou, a página seguinte e a atualização.
  const tabText = STATUS_TEXT[tab];
  useAnnounceWhen(
    focused && !artistFailed && loadOf(tabQuery) === 'error' && !tabQuery.isFetching,
    t(tabText.error),
  );
  const moreError = MORE_ERROR[tab];
  const moreFailed = moreError !== undefined && pagedQuery?.isFetchNextPageError === true;
  useAnnounceWhen(
    focused && moreFailed && pagedQuery?.isFetching === false,
    t(moreError ?? tabText.error),
  );
  // Com a página na tela, uma busca de novo que falha (o puxar para atualizar)
  // deixa o que já estava e avisa, como nas outras telas. O aviso fica na tela
  // enquanto tenta de novo (o botão ocupado), e cada falha nova é anunciada.
  const staleQueries = pageQueries.filter((query) => query.isRefetchError);
  const updateFailed = !artistFailed && staleQueries.length > 0;
  const updateRetrying = staleQueries.some((query) => query.isFetching);
  useAnnounceWhen(
    focused && updateFailed && !updateRetrying && !refreshing,
    t('artist.updateError'),
  );
  const retryUpdate = (): void => {
    for (const query of staleQueries) void query.refetch();
  };

  // Troca de aba pela barra grudada, pelo "Ver ranking" ou por uma missão: o
  // foco do leitor de tela vai ao começo do conteúdo novo quando a rolagem chega.
  useEffect(() => {
    if (focusRequest === 0) return;
    const timer = setTimeout(
      () => {
        const node = contentStart.current;
        if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
      },
      reducedMotion ? motion.duration.fast : motion.duration.slow,
    );
    return () => clearTimeout(timer);
  }, [focusRequest, reducedMotion]);

  /**
   * O pé ganha espaço para a lista rolar até as abas grudarem, mesmo com uma
   * aba curta: sem ele, trocar para a aba curta com as abas grudadas puxava a
   * página de volta para a capa.
   */
  const fitFooter = (space: number = footerSpace): void => {
    const list = listRef.current;
    if (!list || headerHeight === 0) return;
    const needed = stickAt + list.getWindowSize().height;
    const next = Math.max(0, Math.ceil(needed - (contentHeight.current - space)));
    if (Math.abs(next - space) > 1) setFooterSpace(next);
  };

  // Com a central no cache, a lista mede o conteúdo antes de o cabeçalho ter
  // altura, e nada mais pedia o pé depois: ele é conferido quando ela chega.
  const refitFooter = useEffectEvent(() => fitFooter());
  useEffect(() => {
    refitFooter();
  }, [headerHeight]);

  const selectTab = (
    next: ArtistTab,
    { reveal = false, focus = false }: { reveal?: boolean; focus?: boolean } = {},
  ): void => {
    const list = listRef.current;
    const offset = list?.getAbsoluteLastScrollOffset() ?? 0;
    if (next !== tab) {
      setTab(next);
      // A aba nova pode ser curta: o pé segura a altura até ela medir.
      if (list) setFooterSpace((space) => Math.max(space, list.getWindowSize().height));
    }
    if (focus) setFocusRequest((count) => count + 1);
    if (!list) return;
    if (reveal) list.scrollToOffset({ offset: stickAt, animated: !reducedMotion });
    else if (offset > stickAt) list.scrollToOffset({ offset: stickAt, animated: false });
  };

  const seeRanking = (): void => {
    selectTab('ranking', { reveal: true, focus: true });
  };

  // O perfil público de outro fã (os top fãs e a aba Ranking), por cima das
  // abas; o voltar devolve à 1d, na mesma aba.
  const openFan = (entry: LeaderboardEntry): void => {
    router.push(fanProfileHref(entry.userId));
  };

  const pressMission = (mission: Mission): void => {
    const destination = tabOfMission(mission, artistId);
    if (destination) {
      selectTab(destination, { reveal: true, focus: true });
      return;
    }
    openMission(mission);
  };

  const loadMore = (): void => {
    if (!pagedQuery?.hasNextPage || pagedQuery.isFetchNextPageError) return;
    void pagedQuery.fetchNextPage({ cancelRefetch: false });
  };

  const onHeaderLayout = (event: LayoutChangeEvent): void => {
    setHeaderHeight(event.nativeEvent.layout.height);
  };

  // Guarda o começo do conteúdo enquanto a célula mostra o primeiro item da
  // aba (a FlashList reaproveita a célula para outro item). Só a da lista.
  const startRef = (item: ArtistListItem, target: string) => {
    if (target !== 'Cell' || item.key !== items[1]?.key) return undefined;
    return (node: HostInstance | null) => {
      if (!node) return undefined;
      contentStart.current = node;
      return () => {
        if (contentStart.current === node) contentStart.current = null;
      };
    };
  };

  const renderStatus = (
    item: Extract<ArtistListItem, { type: 'status' }>,
    ref: Ref<View> | undefined,
  ): ReactNode => {
    const text = STATUS_TEXT[item.tab];
    if (item.status === 'loading') {
      // Depois do card de top fãs, que já traz o vão de 14 até a grade.
      return item.tab === 'mural' ? (
        <PostGridSkeleton />
      ) : (
        <TabSkeleton ref={ref} accessibilityLabel={t(text.loading)} />
      );
    }
    if (item.status === 'error') {
      return (
        <EmptyState
          ref={ref}
          tone="error"
          message={t(text.error)}
          onAction={() => void tabQuery.refetch()}
          actionLoading={tabQuery.isFetching}
          style={styles.status}
        />
      );
    }
    // Na temporada encerrada, o ranking vazio é um resultado fechado, sem "ainda".
    const empty = item.tab === 'ranking' && seasonOver ? 'artist.ranking.emptyEnded' : text.empty;
    return <EmptyState ref={ref} message={t(empty)} style={styles.status} />;
  };

  const renderContent = (item: ArtistListItem, target: string): ReactNode => {
    const ref = startRef(item, target);
    switch (item.type) {
      case 'tabs':
        return null;
      case 'topFans':
        // Sem o ranking, o card some; o resto da página continua.
        if (board.isError && board.data === undefined) return null;
        return (
          <View style={styles.topFans}>
            <TopFansCard
              entries={topFans}
              state={board.isPending ? 'loading' : 'ready'}
              self={self}
              onSeeRanking={seeRanking}
              onOpenFan={openFan}
              titleRef={ref}
            />
          </View>
        );
      case 'postRow':
        return <PostGridRow posts={item.posts} now={now} />;
      case 'missionLabel':
        return (
          <SectionLabel
            ref={ref}
            spacing={MISSION_SECTION_SPACING[item.section]}
            style={styles.gutter}
          >
            {t(`missions.sections.${item.section}`)}
          </SectionLabel>
        );
      case 'featuredMission':
        return (
          <View style={styles.gutter}>
            <FeaturedMissionCard mission={item.mission} onPress={pressMission} />
          </View>
        );
      case 'mission':
        return (
          <View style={styles.gutter}>
            <MissionRow mission={item.mission} onPress={pressMission} />
          </View>
        );
      case 'month':
        return (
          <SectionLabel ref={ref} spacing="month" style={styles.gutter}>
            {item.label}
          </SectionLabel>
        );
      case 'event':
        return (
          <View style={styles.gutter}>
            <EventRow event={item.event} now={now} testID={`artist-event-${item.event.id}`} />
          </View>
        );
      case 'season':
        // Sem a temporada, a linha some; as posições continuam.
        if (season.isError && season.data === undefined) return null;
        return (
          <View
            ref={ref}
            accessible
            testID={target === 'Cell' ? 'artist-season' : undefined}
            style={[styles.gutter, styles.season]}
          >
            <SeasonLine season={season.data} now={now} />
          </View>
        );
      case 'rank':
        return (
          <View style={styles.gutter}>
            <RankingRow
              entry={item.entry}
              self={self}
              seasonOver={seasonOver}
              onPress={() => openFan(item.entry)}
              testID={target === 'Cell' ? `artist-rank-${item.entry.position}` : undefined}
            />
          </View>
        );
      case 'status':
        return renderStatus(item, ref);
    }
  };

  const renderItem = ({ item, target }: ListRenderItemInfo<ArtistListItem>) => {
    if (item.type === 'tabs') {
      // A cópia que rolou para baixo do header sai do leitor enquanto a grudada aparece.
      const hidden = target === 'Cell' && stuck;
      const sticky = target === 'StickyHeader';
      return (
        <View
          accessibilityElementsHidden={hidden}
          importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
          // Só a grudada tem fundo: na lista, o brilho do botão passa por trás das abas.
          style={sticky ? styles.stuckTabs : undefined}
        >
          <UnderlineTabs
            tabs={TABS}
            value={tab}
            // Da grudada, o conteúdo novo fica para trás na ordem de leitura.
            onChange={(next) => selectTab(next, { focus: sticky })}
            testID={sticky ? 'artist-tabs-stuck' : 'artist-tabs'}
          />
        </View>
      );
    }
    return (
      <Fade progress={contentFade} shownTab={shownTab} tab={tab} reducedMotion={reducedMotion}>
        {renderContent(item, target)}
      </Fade>
    );
  };

  const footer = (
    <View>
      {moreFailed && moreError && pagedQuery ? (
        <EmptyState
          tone="error"
          message={t(moreError)}
          onAction={() => void pagedQuery.fetchNextPage({ cancelRefetch: false })}
          actionLoading={pagedQuery.isFetchingNextPage}
        />
      ) : pagedQuery?.isFetchingNextPage ? (
        <ActivityIndicator color={colors.textMuted} style={styles.nextPage} />
      ) : null}
      <View style={{ height: footerSpace }} />
    </View>
  );

  const header = (
    <View onLayout={onHeaderLayout} testID="artist-header">
      <ArtistCover
        artistId={artistId}
        artist={artist}
        height={cover}
        topClearance={compactHeight}
        scrollY={scrollY}
        onHeightChange={setCoverSize}
      />
      <ArtistStats artist={artist} />
      <ArtistActions
        artist={artist}
        onJoin={join}
        onLeave={() =>
          router.push({ pathname: '/sair-da-central/[artistaId]', params: { artistaId: artistId } })
        }
        joinPending={joinPending}
        award={award}
      />
      {/* O puxar para atualizar acontece aqui no topo: a falha aparece onde o fã puxou. */}
      {updateFailed ? (
        <EmptyState
          tone="error"
          message={t('artist.updateError')}
          onAction={retryUpdate}
          actionLoading={updateRetrying}
        />
      ) : null}
    </View>
  );

  return (
    <Screen safeTop={false} padded={false} bannerTop={compactHeight} contentStyle={styles.screen}>
      {artistFailed ? (
        // No meio do que fica à vista, entre o header compacto e a tab bar.
        <View style={[styles.failed, { paddingTop: compactHeight, paddingBottom: bottomInset }]}>
          <EmptyState
            tone={notFound ? 'empty' : 'error'}
            message={t(notFound ? 'artist.notFound' : 'artist.loadError')}
            onAction={notFound ? undefined : () => void artistQuery.refetch()}
            actionLoading={artistQuery.isFetching}
          />
        </View>
      ) : (
        <AnimatedFlashList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.key}
          // A linha "Você" (estática, sem toque) e as de outros fãs (botões) não
          // se reciclam uma na outra; o tipo do item não muda.
          getItemType={(item) => (item.type === 'rank' && item.entry.isMe ? 'rankMe' : item.type)}
          renderItem={renderItem}
          extraData={{ tab, stuck, now, self, board, season, artist, reducedMotion }}
          ItemSeparatorComponent={ItemGap}
          ListHeaderComponent={header}
          // A FlashList põe o tamanho do `offset` entre o cabeçalho e o primeiro
          // item (pensado para lista embaixo de uma barra fixa). Aqui a capa
          // passa por baixo do header compacto: a margem negativa desfaz o vão.
          ListHeaderComponentStyle={{ marginBottom: -compactHeight }}
          ListFooterComponent={footer}
          stickyHeaderIndices={[0]}
          stickyHeaderConfig={{ offset: compactHeight, hideRelatedCell: true }}
          onChangeStickyIndex={(current) => setStuck(current === 0)}
          maintainVisibleContentPosition={{ disabled: true }}
          onEndReached={loadMore}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(_width, height) => {
            contentHeight.current = height;
            fitFooter();
          }}
          onLayout={() => fitFooter()}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.accent}
              colors={[colors.accentStrong]}
              progressBackgroundColor={colors.surfaceRaised}
              progressViewOffset={compactHeight}
            />
          }
          contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
          showsVerticalScrollIndicator={false}
        />
      )}
      <ArtistCompactHeader
        name={artistFailed ? null : (artist?.name ?? null)}
        height={compactHeight}
        buttonsTop={buttonsTop}
        revealAt={Math.max(cover, coverSize) - compactHeight}
        scrollY={scrollY}
        onShare={artist && !artistFailed ? () => share(artist) : null}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela, por baixo da tab bar; o espaço dela fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  gutter: {
    paddingHorizontal: spacing.gutter,
  },
  // Fundo da página por baixo das abas grudadas: o conteúdo não aparece através delas.
  stuckTabs: {
    backgroundColor: colors.background,
  },
  topFans: {
    paddingTop: spacing.cardPadding,
  },
  season: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  status: {
    paddingTop: spacing.lg,
  },
  nextPage: {
    paddingVertical: spacing.lg,
  },
  failed: {
    flex: 1,
    justifyContent: 'center',
  },
});
