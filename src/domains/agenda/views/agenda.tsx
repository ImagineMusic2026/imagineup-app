import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  RefreshControl,
  StyleSheet,
  View,
  type HostInstance,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { TextLink } from '@/components/text-link';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useNow } from '@/hooks/use-now';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, layout, motion, spacing } from '@/theme';

import { AgendaSkeleton } from '../components/agenda-skeleton';
import { EventHeroCard } from '../components/event-hero-card';
import { EventRow } from '../components/event-row';
import { CHIP_SLACK, MonthChips } from '../components/month-chips';
import {
  buildAgendaItems,
  groupByMonth,
  monthTargetIndex,
  type AgendaListItem,
} from '../group-by-month';
import { useAgendaRefresh } from '../hooks/use-agenda-refresh';
import { useMonthInView } from '../hooks/use-month-in-view';
import { useAgendaQuery } from '../queries';
import type { AgendaEvent } from '../types';

// Um item conta como à vista com metade dele na tela.
const VIEWABILITY = { itemVisiblePercentThreshold: 50 } as const;
// O título até a linha de chips é 15 no protótipo, contado até o chip
// desenhado (não até o alvo de 44), e o `LargeTitleHeader` sem nada embaixo
// deixa 18: a linha de chips sobe a diferença mais a sobra de cima do alvo.
const CHIPS_OVERLAP = spacing.blockGap - spacing.titleToChips + CHIP_SLACK;

/**
 * "Chamar amigos": a sheet do convite recebe o show, como recebe a missão e o
 * post da 1b e da 1g, e monta o link com o código do fã. Sem página de um show
 * só, o link leva à agenda.
 */
function openInvite(event: AgendaEvent): void {
  router.push({ pathname: '/convidar', params: { eventId: event.id } });
}

/** 10 entre duas linhas; a sobrelinha e o destaque trazem o próprio respiro. */
function ItemGap({
  leadingItem,
  trailingItem,
}: {
  leadingItem?: AgendaListItem;
  trailingItem?: AgendaListItem;
}) {
  if (leadingItem?.type !== 'event' || trailingItem?.type !== 'event') return null;
  return <View style={styles.gap} />;
}

type ListState = 'loading' | 'error' | 'empty' | 'none';

function ListPlaceholder({
  state,
  retrying,
  onRetry,
}: {
  state: ListState;
  retrying: boolean;
  onRetry: () => void;
}) {
  switch (state) {
    case 'loading':
      return <AgendaSkeleton />;
    case 'error':
      return (
        <EmptyState
          tone="error"
          message={t('agenda.loadError')}
          onAction={onRetry}
          actionLoading={retrying}
        />
      );
    case 'empty':
      return <EmptyState message={t('agenda.empty')} />;
    default:
      return null;
  }
}

/**
 * 1m. A agenda de shows: o título com o voltar na mesma linha (aprovado em
 * 2026-09-29), os chips dos meses (grudam no topo ao rolar), o show em
 * destaque e os outros por mês, cada mês com a sua sobrelinha. "Eu vou" é a
 * mesma presença do post de show da home, e a primeira rende os pontos da
 * missão de presença. Shows e pontos vêm da API e do painel; o destaque é o
 * marcado lá, ou o próximo show. Datas e horas no fuso do aparelho.
 */
export function AgendaScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const now = useNow();
  const reducedMotion = usePrefersReducedMotion();
  const query = useAgendaQuery();
  const { refreshing, refresh } = useAgendaRefresh();
  const listRef = useRef<FlashListRef<AgendaListItem>>(null);
  const monthView = useMonthInView();
  const [stuck, setStuck] = useState(false);
  // Altura do conteúdo da lista, para saber onde ela acaba antes de rolar.
  const contentHeight = useRef(0);
  // O que o leitor de tela pode focar depois de um toque no chip: o destaque e
  // as sobrelinhas, pela chave do item.
  const focusTargets = useRef(new Map<string, HostInstance>());
  const [arrival, setArrival] = useState<{ key: string } | null>(null);

  const events = query.data?.pages.flatMap((page) => page.items) ?? [];
  const sections = groupByMonth(events, now, query.data?.pages[0]?.featured ?? null);
  const loaded = query.data !== undefined;
  const listState: ListState = query.isPending
    ? 'loading'
    : !loaded
      ? 'error'
      : sections.featured
        ? 'none'
        : 'empty';
  const items = listState === 'none' ? buildAgendaItems(sections) : [];
  const hasChips = items[0]?.type === 'chips';
  const month = sections.chips.some((chip) => chip.key === monthView.picked)
    ? monthView.picked
    : (sections.chips[0]?.key ?? null);

  // Um toque no chip leva o foco do leitor de tela ao mês quando a lista chega
  // lá: a cópia dos chips em que ele estava sai do leitor quando gruda no
  // topo, e a grudada vem depois do último show na ordem de leitura.
  useEffect(() => {
    if (!arrival) return;
    const timer = setTimeout(() => {
      const node = focusTargets.current.get(arrival.key);
      if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
    }, motion.duration.fast);
    return () => clearTimeout(timer);
  }, [arrival]);

  // Só com a 1m à vista: ela segue montada na pilha quando o fã abre o
  // convite, e a busca de fundo que falha ali não fala por ela.
  const settled = focused && query.isError && !query.isFetching;
  useAnnounceWhen(settled && !loaded, t('agenda.loadError'));
  useAnnounceWhen(settled && query.isRefetchError, t('agenda.updateError'));
  useAnnounceWhen(settled && query.isFetchNextPageError, t('agenda.moreError'));

  // O "Tentar de novo" some junto com o erro quando a agenda chega, e o foco do
  // leitor de tela iria com ele: o fã ouve que ela chegou.
  const retry = async (): Promise<void> => {
    const result = await query.refetch();
    if (result.isSuccess) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('agenda.loaded'), { queue: true });
    }
  };

  // "Ver agenda completa" traz os meses seguintes e some: o fã ouve que chegaram.
  const loadMore = async (): Promise<void> => {
    if (query.isFetchingNextPage) return;
    const result = await query.fetchNextPage();
    if (!result.isFetchNextPageError) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('agenda.moreLoaded'), {
        queue: true,
      });
    }
  };

  // A rolagem pedida pelo chip chegou ao mês: o foco do leitor de tela vai até ele.
  const focusMonth = (key: string | null): void => {
    if (key === null) return;
    const focusKey = items[monthTargetIndex(items, key)]?.key;
    if (focusKey) setArrival({ key: focusKey });
  };

  // O mês para logo abaixo dos chips grudados, não embaixo deles. A conta é
  // feita aqui, e não no `scrollToIndex`: na FlashList 2.0.2 ele limita o
  // destino pela altura das linhas sem o título e o rodapé, e perto do fim da
  // lista rolava para cima, longe do mês tocado. A rolagem nativa já para no
  // fim de verdade.
  const scrollToMonth = (key: string): void => {
    const list = listRef.current;
    const index = monthTargetIndex(items, key);
    const target = index >= 0 ? list?.getLayout(index) : undefined;
    if (!list || !target) {
      focusMonth(monthView.pick(key, null));
      return;
    }
    const chipsHeight = list.getLayout(0)?.height ?? layout.minTouchTarget;
    const offset = Math.max(0, target.y + list.getFirstItemOffset() - chipsHeight);
    // Perto do fim, a lista para antes (ou nem rola, se cabe na tela): a
    // chegada é lá. Sem a altura do conteúdo ainda, vale o destino pedido.
    const end = Math.max(0, contentHeight.current - list.getWindowSize().height);
    focusMonth(monthView.pick(key, contentHeight.current > 0 ? Math.min(offset, end) : offset));
    list.scrollToOffset({ offset, animated: !reducedMotion });
  };

  // A cópia dos chips que rolou para cima sai do leitor de tela enquanto a
  // grudada no topo está à vista.
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const offset = listRef.current?.getFirstItemOffset();
    const next = hasChips && offset !== undefined && contentOffset.y >= offset;
    if (next !== stuck) setStuck(next);
    focusMonth(monthView.onScroll(contentOffset.y, contentSize.height - layoutMeasurement.height));
  };

  // Registra o que o foco pode alcançar enquanto a célula mostra aquele item
  // (a FlashList reaproveita a célula para outro item). Só a célula da lista.
  const focusTarget = (key: string, target: string) => (node: HostInstance | null) => {
    if (!node || target !== 'Cell') return undefined;
    const targets = focusTargets.current;
    targets.set(key, node);
    return () => {
      if (targets.get(key) === node) targets.delete(key);
    };
  };

  const renderItem = ({ item, target }: ListRenderItemInfo<AgendaListItem>) => {
    switch (item.type) {
      case 'chips':
        return month ? (
          <MonthChips
            chips={sections.chips}
            value={month}
            onSelect={scrollToMonth}
            hidden={target === 'Cell' && stuck}
            testID={target === 'Cell' ? 'agenda-months' : undefined}
          />
        ) : null;
      case 'featured':
        return (
          <View style={[styles.gutter, hasChips && styles.featuredBelowChips]}>
            <EventHeroCard
              event={item.event}
              now={now}
              onInvite={openInvite}
              infoRef={focusTarget(item.key, target)}
              testID="agenda-featured"
            />
          </View>
        );
      case 'month':
        return (
          <SectionLabel ref={focusTarget(item.key, target)} spacing="month" style={styles.gutter}>
            {item.label}
          </SectionLabel>
        );
      case 'event':
        return (
          <View style={styles.gutter}>
            <EventRow event={item.event} now={now} testID={`agenda-${item.event.id}`} />
          </View>
        );
    }
  };

  const footer =
    listState !== 'none' ? null : query.isFetchNextPageError ? (
      <EmptyState
        tone="error"
        message={t('agenda.moreError')}
        onAction={() => void loadMore()}
        actionLoading={query.isFetchingNextPage}
      />
    ) : query.isRefetchError ? (
      <EmptyState
        tone="error"
        message={t('agenda.updateError')}
        onAction={() => void retry()}
        actionLoading={query.isFetching}
      />
    ) : query.hasNextPage ? (
      <TextLink
        label={t('agenda.seeAll')}
        textVariant="labelCompact"
        accessibilityHint={t('agenda.seeAllHint')}
        disabled={query.isFetchingNextPage}
        onPress={() => void loadMore()}
        style={styles.seeAll}
      />
    ) : null;

  return (
    <Screen padded={false} contentStyle={styles.screen}>
      <FlashList<AgendaListItem>
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        extraData={{ month, now, stuck }}
        stickyHeaderIndices={hasChips ? [0] : undefined}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <View
            style={[
              styles.gutter,
              (hasChips || listState === 'loading') && styles.headerAboveChips,
            ]}
          >
            <LargeTitleHeader title={t('agenda.title')} showBack />
          </View>
        }
        ListEmptyComponent={
          <ListPlaceholder
            state={listState}
            retrying={query.isFetching}
            onRetry={() => void retry()}
          />
        }
        ListFooterComponent={footer}
        viewabilityConfig={VIEWABILITY}
        onViewableItemsChanged={monthView.onViewableItemsChanged}
        onScroll={handleScroll}
        onScrollBeginDrag={monthView.release}
        onMomentumScrollEnd={() => focusMonth(monthView.onScrollEnd())}
        onContentSizeChange={(_width, height) => {
          contentHeight.current = height;
        }}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.events}
            colors={[colors.events]}
            progressBackgroundColor={colors.surfaceRaised}
          />
        }
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
      />
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
  headerAboveChips: {
    marginBottom: -CHIPS_OVERLAP,
  },
  // 18 do chip desenhado ao destaque, descontada a sobra de baixo do alvo.
  featuredBelowChips: {
    paddingTop: spacing.blockGap - CHIP_SLACK,
  },
  gap: {
    height: spacing.listGap,
  },
  // O texto fica no meio do alvo de 44: a 14 da última linha, como no protótipo.
  seeAll: {
    alignSelf: 'center',
  },
});
