import { FlashList } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, RefreshControl, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useNow } from '@/hooks/use-now';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';

import { LedgerRow } from '../components/ledger-row';
import { buildLedgerItems, isVisibleLedgerEntry, type LedgerListItem } from '../describe-ledger';
import { useLedgerInfiniteQuery } from '../queries';

// Linhas do esqueleto: a altura de uma linha da 1g.
const SKELETON_ROWS = 5;
const SKELETON_ROW_HEIGHT = 68;

/** 10 entre duas linhas; nada junto da sobrelinha, que já traz o próprio respiro. */
function ItemGap({
  leadingItem,
  trailingItem,
}: {
  leadingItem?: LedgerListItem;
  trailingItem?: LedgerListItem;
}) {
  if (leadingItem?.type === 'day' || trailingItem?.type === 'day') return null;
  return <View style={styles.gap} />;
}

function LedgerSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('ledger.loading')} style={styles.skeleton}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} height={SKELETON_ROW_HEIGHT} radius={radii.lg} />
      ))}
    </SkeletonGroup>
  );
}

/**
 * O extrato de pontos (tela provisória do bloco 7, sem desenho; segue a
 * aprovação de 28/09 de telas sem desenho no visual das outras, e a cliente
 * valida o que ela mostra). Aberta pelo card de pontos da 1e, na pilha do
 * Perfil: cada lançamento diz de onde veio (curtida, comentário, convite,
 * missão, entrada na central, resgate, ajuste), o contexto (a central ou o
 * título da missão), o valor e a hora, agrupados por dia. Pagina pelo fim da
 * lista; puxar para atualizar busca de novo.
 */
export function LedgerScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const now = useNow();
  const query = useLedgerInfiniteQuery();
  const pages = query.data?.pages;
  const entries = pages?.flatMap((page) => page.items) ?? [];
  const items = buildLedgerItems(entries, now);
  const loaded = query.data !== undefined;
  const [pulling, setPulling] = useState(false);

  // Página que não acrescenta linha visível (os ajustes só de central) e ainda
  // tem a seguinte: pede a seguinte sozinha, uma vez por página.
  const asked = useRef(0);
  const lastPage = pages?.at(-1);
  const lastPageEmpty = !!lastPage && !lastPage.items.some(isVisibleLedgerEntry);
  useEffect(() => {
    const count = pages?.length ?? 0;
    if (!lastPageEmpty || !query.hasNextPage || asked.current >= count) return;
    asked.current = count;
    void query.fetchNextPage({ cancelRefetch: false });
  }, [lastPageEmpty, pages?.length, query]);

  // Só com o extrato à vista: a falha de fundo não fala por ele. A página
  // seguinte que não veio tem aviso próprio, como na agenda e no ranking.
  const settled = focused && query.isError && !query.isFetching;
  useAnnounceWhen(settled && !loaded, t('ledger.loadError'));
  useAnnounceWhen(settled && query.isRefetchError, t('ledger.updateError'));
  useAnnounceWhen(settled && query.isFetchNextPageError, t('ledger.moreError'));

  // O "Tentar de novo" some junto com o erro, e o foco do leitor de tela iria
  // com ele: o fã ouve que o extrato chegou.
  const retry = async (): Promise<void> => {
    const result = await query.refetch();
    if (result.isSuccess) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('ledger.loaded'), { queue: true });
    }
  };

  // A página que falhou, e só ela: o refetch buscaria de novo as já carregadas.
  const retryMore = async (): Promise<void> => {
    const result = await query.fetchNextPage({ cancelRefetch: false });
    if (!result.isFetchNextPageError) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('ledger.moreLoaded'), {
        queue: true,
      });
    }
  };

  const refresh = async (): Promise<void> => {
    haptics.trigger('refresh');
    setPulling(true);
    await query.refetch();
    setPulling(false);
  };

  const renderItem = ({ item }: { item: LedgerListItem }) =>
    item.type === 'day' ? (
      <SectionLabel spacing="tight">{item.label}</SectionLabel>
    ) : (
      <LedgerRow entry={item.entry} now={now} testID={`ledger-${item.entry.id}`} />
    );

  let empty;
  if (query.isPending) empty = <LedgerSkeleton />;
  else if (!loaded) {
    empty = (
      <EmptyState
        tone="error"
        message={t('ledger.loadError')}
        onAction={() => void retry()}
        actionLoading={query.isFetching}
      />
    );
  } else empty = <EmptyState message={t('ledger.empty')} />;

  return (
    <Screen contentStyle={styles.screen}>
      <FlashList<LedgerListItem>
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        extraData={now}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <LargeTitleHeader title={t('ledger.title')} subtitle={t('ledger.subtitle')} showBack />
        }
        ListEmptyComponent={empty}
        ListFooterComponent={
          query.isFetchNextPageError ? (
            <EmptyState
              tone="error"
              message={t('ledger.moreError')}
              onAction={() => void retryMore()}
              actionLoading={query.isFetchingNextPage}
            />
          ) : query.isRefetchError ? (
            <EmptyState
              tone="error"
              message={t('ledger.updateError')}
              onAction={() => void retry()}
              actionLoading={query.isFetching}
            />
          ) : null
        }
        onEndReached={() => {
          // Depois de uma falha, a página seguinte espera o "Tentar de novo" do pé.
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
            void query.fetchNextPage({ cancelRefetch: false });
          }
        }}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void refresh()}
            tintColor={colors.points}
            colors={[colors.onPoints]}
            progressBackgroundColor={colors.points}
          />
        }
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
        testID="ledger-list"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela, por baixo da tab bar; o espaço dela fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  gap: {
    height: spacing.listGap,
  },
  skeleton: {
    gap: spacing.listGap,
    marginTop: spacing.lg,
  },
});
