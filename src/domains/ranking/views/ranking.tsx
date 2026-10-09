import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import type { InfiniteData } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { CHIP_SLACK } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { PageGlow } from '@/components/page-glow';
import { Screen } from '@/components/screen';
import { fanProfileHref, useFanIdentity } from '@/domains/profile';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useNow } from '@/hooks/use-now';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, motion, spacing } from '@/theme';

import type { RankingSelf } from '../components/entry-avatar';
import { MyRankCard } from '../components/my-rank-card';
import { Podium } from '../components/podium';
import { RankingRow } from '../components/ranking-row';
import { RankingScopeChips } from '../components/ranking-scope-chips';
import { RankingSkeleton } from '../components/ranking-skeleton';
import { SeasonLine } from '../components/season-line';
import { useRankingRefresh } from '../hooks/use-ranking-refresh';
import { useRankingScope } from '../hooks/use-ranking-scope';
import { useSeasonOver } from '../hooks/use-season-over';
import { useLeaderboardInfiniteQuery, useMyRankQuery, useSeasonQuery } from '../queries';
import { scopeKey, type ScopeKey } from '../scope';
import type { LeaderboardEntry, LeaderboardPage } from '../types';

// O título até a linha de chips é 15 no protótipo, contado até o chip
// desenhado (não até o alvo de 44), e o `LargeTitleHeader` sem nada embaixo
// deixa 18: a linha de chips sobe a diferença mais a sobra de cima do alvo.
const CHIPS_OVERLAP = spacing.blockGap - spacing.titleToChips + CHIP_SLACK;
// Da base do chip desenhado até a linha da temporada: 16 no protótipo.
const SEASON_TOP = spacing.lg - CHIP_SLACK;
// Altura do card "Você" até ele medir a dele (60 no protótipo).
const CARD_HEIGHT_ESTIMATE = 60;
/**
 * Até onde o toque no card "Você" busca a linha do fã: a posição 200 (10
 * páginas de 20). Abaixo disso, o card só informa: um fã em 5.000º pediria
 * 250 páginas (bloco 8, 23.14).
 */
export const RANK_SEEK_MAX = 200;

/** Onde fica a linha (ou o pódio) do fã, no conteúdo da lista. */
interface Box {
  y: number;
  height: number;
}

function entriesOf(data: InfiniteData<LeaderboardPage> | undefined): LeaderboardEntry[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

/** Da 4ª posição em diante: as três primeiras ficam no pódio. */
function listRowsOf(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return entries.filter((entry) => entry.position > 3);
}

/**
 * Some e volta junto com a troca de recorte: todas as linhas leem o mesmo
 * valor, e as células que a lista recicla ao rolar já nascem visíveis.
 */
function Fade({
  progress,
  style,
  children,
}: {
  progress: SharedValue<number>;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

type ListState = 'loading' | 'error' | 'empty' | 'none';

function ListPlaceholder({
  state,
  hasSeason,
  seasonOver,
  retrying,
  onRetry,
}: {
  state: ListState;
  hasSeason: boolean;
  seasonOver: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  switch (state) {
    case 'loading':
      return <RankingSkeleton />;
    case 'error':
      return (
        <EmptyState
          tone="error"
          message={t('ranking.loadError')}
          onAction={onRetry}
          actionLoading={retrying}
        />
      );
    case 'empty':
      // Sem ninguém no ranking, o caminho para pontuar são as missões (1g).
      // Na temporada encerrada, o resultado já fechou: nada de "ainda" nem de
      // convite a pontuar (sem temporada em andamento, missão não rende nela).
      if (hasSeason && seasonOver) return <EmptyState message={t('ranking.emptyEnded')} />;
      return hasSeason ? (
        <EmptyState
          message={t('ranking.empty')}
          actionLabel={t('ranking.seeMissions')}
          onAction={() => router.push('/missoes')}
        />
      ) : (
        <EmptyState message={t('ranking.emptyNoSeason')} />
      );
    default:
      return null;
  }
}

/**
 * 1f. O ranking da temporada: o título, os chips (Geral e as centrais do
 * fã), a linha da temporada, o pódio e a lista do 4º em diante, numa
 * FlashList só, sob o brilho lima do topo. O card "Você" fica preso em cima
 * da tab bar (sólida nesta tela) enquanto a linha do fã não está à vista, e
 * tocar nele rola até ela, buscando as páginas que faltam.
 *
 * O recorte vem do parâmetro `?artista=<id>`, que o chip muda: o link a frio
 * `/ranking?artista=<id>` já abre com o chip da central escolhido (o "Ver
 * ranking" da página do artista, 1d, escolhe a aba interna de lá, proposta
 * padrão da pergunta 7.1.6). Posições, pontos, metas e a seta da semana vêm
 * da API (bloco 8); os pontos são os da temporada. Na temporada encerrada, a
 * lista é o resultado congelado, sem setas, e o card diz "Terminou em 12º";
 * quando o `endsAt` passa com a tela aberta, as setas somem na hora e o
 * ranking busca de novo (`useSeasonOver`).
 * Missões (1g) e Resgatar (1h) moram na pilha desta aba, e o fã chega a elas
 * pelo "+" do meio da tab bar.
 */
export function RankingScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const now = useNow();
  const reducedMotion = usePrefersReducedMotion();
  const identity = useFanIdentity();
  const { scope, artists, select } = useRankingScope();
  const key = scopeKey(scope);
  const season = useSeasonQuery();
  const board = useLeaderboardInfiniteQuery(scope);
  const myRank = useMyRankQuery(scope);
  const { refreshing, refresh } = useRankingRefresh(scope);
  const listRef = useRef<FlashListRef<LeaderboardEntry>>(null);
  // A linha (ou a coluna do pódio) do próprio fã, para o foco do leitor de tela.
  const meNode = useRef<View | null>(null);
  // Recorte cujo foco o card pediu e ainda não saiu: a linha pode montar só
  // depois, quando a lista desenha o trecho para onde rolou.
  const pendingFocus = useRef<ScopeKey | null>(null);
  // Recorte cuja linha do fã o card pediu, enquanto as páginas chegam.
  const pendingSeek = useRef<ScopeKey | null>(null);
  // O mesmo, para a tela: o card fica ocupado enquanto as páginas chegam.
  const [seeking, setSeeking] = useState<ScopeKey | null>(null);
  const [cardHeight, setCardHeight] = useState(CARD_HEIGHT_ESTIMATE);
  const [podiumBox, setPodiumBox] = useState<Box | null>(null);
  const scrollY = useRef(0);
  // A linha do fã à vista no recorte (a da lista ou, com ele lá, o pódio).
  const [meSeen, setMeSeen] = useState({ key, visible: false });

  const entries = entriesOf(board.data);
  const podium = entries.filter((entry) => entry.position <= 3);
  const rows = listRowsOf(entries);
  const loaded = board.data !== undefined;
  const listState: ListState = board.isPending
    ? 'loading'
    : !loaded
      ? 'error'
      : entries.length === 0
        ? 'empty'
        : 'none';
  // Acabou com a tela aberta: o ranking busca de novo (sem setas, encerrado).
  const seasonOver = useSeasonOver(season.data, now);
  const hasSeason = season.data !== null;
  const self: RankingSelf = {
    id: identity.uid ?? 'me',
    name: identity.name,
    photoUrl: identity.photoURL,
  };

  // O card some quando a linha do fã (ou o pódio, com ele lá) está à vista.
  const meOnPodium = podium.some((entry) => entry.isMe);
  const meIndex = rows.findIndex((entry) => entry.isMe);
  // Recorte novo, lista nova: a linha do fã ainda não foi vista nele.
  if (meSeen.key !== key) setMeSeen({ key, visible: false });
  const meInView = meSeen.key === key && meSeen.visible;
  const cardVisible = hasSeason && (myRank.data ? !meInView : myRank.isPending);
  const myPosition = myRank.data?.position ?? null;
  // Rola até a linha do fã só até a posição 200; abaixo, o card só informa.
  const canSeekMe = myPosition !== null && myPosition <= RANK_SEEK_MAX;

  // Troca de chip: as linhas somem na hora e voltam em fade quando o recorte
  // novo chega (na hora, se ele já estava no cache). O pódio sobe de novo
  // porque é montado outra vez (`key`).
  const fade = useSharedValue(loaded ? 1 : 0);
  const shownKey = loaded ? key : null;
  useLayoutEffect(() => {
    if (!reducedMotion) fade.set(0);
  }, [key, reducedMotion, fade]);
  useEffect(() => {
    if (shownKey === null) return;
    fade.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  }, [shownKey, reducedMotion, fade]);

  // Só com a 1f à vista: ela segue montada na pilha quando o fã abre as
  // missões, e a busca de fundo que falha ali não fala por ela.
  const settled = focused && board.isError && !board.isFetching;
  useAnnounceWhen(settled && !loaded, t('ranking.loadError'));
  useAnnounceWhen(settled && board.isRefetchError, t('ranking.updateError'));
  useAnnounceWhen(settled && board.isFetchNextPageError, t('ranking.moreError'));

  // O "Tentar de novo" some junto com o erro quando o ranking chega, e o foco
  // do leitor de tela iria com ele: o fã ouve que ele chegou.
  const retry = async (): Promise<void> => {
    const result = await board.refetch();
    if (result.isSuccess) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('ranking.loaded'), { queue: true });
    }
  };

  // O "Tentar de novo" do pé some quando as posições chegam, com o foco do
  // leitor de tela nele: o fã ouve que elas chegaram.
  const retryMore = async (): Promise<void> => {
    const result = await board.fetchNextPage();
    if (!result.isFetchNextPageError) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('ranking.moreLoaded'), {
        queue: true,
      });
    }
  };

  // Chegou ao fim da lista. Com uma busca a caminho, a página seguinte espera
  // por ela em vez de cancelá-la (o padrão do React Query cancela e pede de
  // novo): a página que o card já pediu não sai duas vezes, e a busca de fundo
  // (o "Eu vou" que invalida o ranking, a volta ao app) não perde as páginas
  // novas. Se era a de fundo, a página seguinte sai logo depois dela.
  const loadMore = async (): Promise<void> => {
    if (!board.hasNextPage || board.isFetchNextPageError) return;
    const pagesBefore = board.data?.pages.length ?? 0;
    const joined = await board.fetchNextPage({ cancelRefetch: false });
    const grew = (joined.data?.pages.length ?? 0) > pagesBefore;
    if (!joined.isError && joined.hasNextPage && !grew) {
      await board.fetchNextPage({ cancelRefetch: false });
    }
  };

  /**
   * A linha do fã conta como à vista com o meio dela entre o topo da lista e
   * a tab bar, que fica por cima do fim da lista. Assim o card some quando a
   * linha chega onde ele está, e ela toma o lugar dele. A viewability da
   * FlashList não serve: ela conta a parte da lista embaixo da tab bar.
   */
  const updateMeInView = (podiumLayout: Box | null = podiumBox): void => {
    const list = listRef.current;
    if (!list) return;
    const rowLayout = meIndex >= 0 ? list.getLayout(meIndex) : undefined;
    const box = meOnPodium
      ? podiumLayout
      : rowLayout
        ? { y: rowLayout.y + list.getFirstItemOffset(), height: rowLayout.height }
        : null;
    const middle = box ? box.y + box.height / 2 - scrollY.current : -1;
    const visible = middle > 0 && middle < list.getWindowSize().height - bottomInset;
    if (visible !== meInView) setMeSeen({ key, visible });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    scrollY.current = event.nativeEvent.contentOffset.y;
    updateMeInView();
  };

  const onPodiumLayout = (event: LayoutChangeEvent): void => {
    const { y, height } = event.nativeEvent.layout;
    const box = { y, height };
    setPodiumBox(box);
    updateMeInView(box);
  };

  // O perfil público de outro fã, por cima das abas; o voltar devolve à 1f.
  const openFan = (entry: LeaderboardEntry): void => {
    router.push(fanProfileHref(entry.userId));
  };

  const sendFocus = (node: View): void => {
    pendingFocus.current = null;
    setTimeout(() => AccessibilityInfo.sendAccessibilityEvent(node, 'focus'), motion.duration.fast);
  };

  // O foco vai para a linha do fã quando a rolagem termina. Se ela ainda não
  // está montada (sem animação, a lista só desenha o trecho novo depois que a
  // rolagem nativa volta ao JS), o foco espera por ela no `meRef`.
  const focusMe = (): void => {
    pendingFocus.current = key;
    const delay = reducedMotion ? 0 : motion.duration.slow;
    setTimeout(() => {
      if (pendingFocus.current === key && meNode.current) sendFocus(meNode.current);
    }, delay);
  };

  const meRef = (node: View | null): void => {
    meNode.current = node;
    if (node && pendingFocus.current === key) sendFocus(node);
  };

  // A linha fica no meio do espaço entre o topo e o card, que ela empurra
  // para fora quando aparece.
  const scrollToRow = (index: number): void => {
    const list = listRef.current;
    const target = list?.getLayout(index);
    if (!list || !target) return;
    const room = list.getWindowSize().height - bottomInset - cardHeight;
    const offset = Math.max(
      0,
      target.y + list.getFirstItemOffset() - Math.max(0, (room - target.height) / 2),
    );
    list.scrollToOffset({ offset, animated: !reducedMotion });
    focusMe();
  };

  // A página com a linha do fã chegou e a lista já a desenhou (o efeito roda
  // depois dela): a rolagem pedida pelo card segue daqui.
  const onMeRowLoaded = useEffectEvent(() => {
    if (pendingSeek.current !== key || meIndex < 0) return;
    pendingSeek.current = null;
    scrollToRow(meIndex);
  });
  useEffect(() => {
    onMeRowLoaded();
  }, [key, meIndex]);
  // A rolagem e o foco pedidos no recorte anterior não valem neste.
  useEffect(() => {
    pendingSeek.current = null;
    pendingFocus.current = null;
  }, [key]);

  // Tocar no card "Você": o pódio, se ele está lá; senão a linha dele, trazendo
  // as páginas que faltam (41º no Nenho, com 10 por página). Com uma página já
  // a caminho, espera por ela em vez de pedir o mesmo cursor de novo.
  const goToMe = async (): Promise<void> => {
    if (meOnPodium) {
      listRef.current?.scrollToOffset({ offset: 0, animated: !reducedMotion });
      focusMe();
      return;
    }
    if (meIndex >= 0) {
      scrollToRow(meIndex);
      return;
    }
    if (pendingSeek.current === key) return;
    pendingSeek.current = key;
    setSeeking(key);
    // O ocupado do card não é lido sozinho: o fã ouve que a busca começou.
    AccessibilityInfo.announceForAccessibilityWithOptions(t('ranking.me.seeking'), {
      queue: true,
    });
    let found = false;
    let more = board.hasNextPage;
    while (more && pendingSeek.current === key) {
      const result = await board.fetchNextPage({ cancelRefetch: false });
      // O efeito acima rola quando a linha chega; o erro aparece no pé da lista.
      if (result.isError) break;
      found = listRowsOf(entriesOf(result.data)).some((entry) => entry.isMe);
      if (found) break;
      more = result.hasNextPage;
    }
    setSeeking((current) => (current === key ? null : current));
    if (!found && pendingSeek.current === key) pendingSeek.current = null;
  };

  const header = (
    <View>
      <View style={styles.gutter}>
        <LargeTitleHeader title={t('ranking.title')} />
      </View>
      <RankingScopeChips
        artists={artists}
        value={scope}
        onChange={select}
        testID="ranking-scopes"
        style={styles.chips}
      />
      {season.isError && season.data === undefined ? null : (
        <SeasonLine season={season.data} now={now} style={[styles.gutter, styles.season]} />
      )}
      {/* O puxar para atualizar acontece aqui no topo: a falha aparece onde o fã puxou. */}
      {loaded && board.isRefetchError ? (
        <EmptyState
          tone="error"
          message={t('ranking.updateError')}
          onAction={() => void retry()}
          actionLoading={board.isFetching}
        />
      ) : null}
      {listState === 'none' || listState === 'empty' ? (
        <View onLayout={onPodiumLayout} testID="ranking-podium-area" style={styles.podium}>
          <Podium
            key={key}
            entries={podium}
            self={self}
            leaderTitle={season.data?.leaderTitle ?? null}
            meRef={meRef}
            onOpen={openFan}
            testID="ranking-podium"
          />
        </View>
      ) : null}
    </View>
  );

  const renderItem = ({ item, target }: ListRenderItemInfo<LeaderboardEntry>) => (
    <Fade progress={fade} style={styles.gutter}>
      <RankingRow
        entry={item}
        self={self}
        seasonOver={seasonOver}
        onPress={() => openFan(item)}
        ref={item.isMe && target === 'Cell' ? meRef : undefined}
        testID={target === 'Cell' ? `ranking-row-${item.position}` : undefined}
      />
    </Fade>
  );

  // No pé, só o que acontece no pé: a página seguinte que não veio.
  const footer =
    listState !== 'none' ? null : board.isFetchNextPageError ? (
      <EmptyState
        tone="error"
        message={t('ranking.moreError')}
        onAction={() => void retryMore()}
        actionLoading={board.isFetchingNextPage}
      />
    ) : board.isFetchingNextPage ? (
      <ActivityIndicator color={colors.textMuted} style={styles.nextPage} />
    ) : null;

  const cardSpace = hasSeason ? cardHeight + spacing.md : 0;

  return (
    <Screen padded={false} contentStyle={styles.screen} backdrop={<PageGlow preset="ranking" />}>
      <FlashList<LeaderboardEntry>
        ref={listRef}
        data={listState === 'none' ? rows : []}
        keyExtractor={(entry) => `${key}:${entry.userId}`}
        getItemType={(entry) => (entry.isMe ? 'me' : 'row')}
        renderItem={renderItem}
        extraData={{ self, seasonOver }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <ListPlaceholder
            state={listState}
            hasSeason={hasSeason}
            seasonOver={seasonOver}
            retrying={board.isFetching}
            onRetry={() => void retry()}
          />
        }
        ListFooterComponent={footer}
        onEndReached={() => void loadMore()}
        onScroll={handleScroll}
        onContentSizeChange={() => updateMeInView()}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.points}
            colors={[colors.onPoints]}
            progressBackgroundColor={colors.points}
          />
        }
        contentContainerStyle={{ paddingBottom: bottomInset + cardSpace + spacing.xl }}
        showsVerticalScrollIndicator={false}
      />
      {hasSeason ? (
        <MyRankCard
          myRank={myRank.data}
          seasonOver={seasonOver}
          self={self}
          visible={cardVisible}
          // Só com a lista na tela há para onde rolar; carregando ou com erro, o card só informa.
          onPress={canSeekMe && listState === 'none' ? () => void goToMe() : undefined}
          busy={seeking === key}
          screenFocused={focused}
          accessibilityHint={t(meOnPodium ? 'ranking.me.podiumHint' : 'ranking.me.hint')}
          scopeKey={key}
          onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
          testID="ranking-me"
          style={[styles.card, { bottom: bottomInset }]}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela, por baixo da tab bar; o espaço dela fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  // A lista vai de ponta a ponta, pelos chips; o resto fica na margem da tela.
  gutter: {
    paddingHorizontal: spacing.gutter,
  },
  chips: {
    marginTop: -CHIPS_OVERLAP,
  },
  season: {
    marginTop: SEASON_TOP,
  },
  // 18 da temporada ao pódio e 8 do pódio à primeira linha.
  podium: {
    paddingTop: spacing.blockGap,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.gutter,
  },
  nextPage: {
    paddingVertical: spacing.lg,
  },
  // Colado em cima da tab bar, com 12 dos lados (e não os 18 da margem).
  card: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
});
