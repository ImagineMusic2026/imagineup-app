import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { AccessibilityInfo, RefreshControl, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useNow } from '@/hooks/use-now';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { FeaturedMissionCard } from '../components/featured-mission-card';
import { MissionRow } from '../components/mission-row';
import { MissionsSkeleton } from '../components/missions-skeleton';
import { SeasonGoalCard } from '../components/season-goal-card';
import { isMissionOver } from '../describe-mission';
import { useMissionAction } from '../hooks/use-mission-action';
import { useMissionCelebrations } from '../hooks/use-mission-celebrations';
import { useMissionsRefresh } from '../hooks/use-missions-refresh';
import { missionKeys, useMissionsQuery } from '../queries';
import { buildMissionItems, type MissionListItem } from '../sections';
import type { SeasonGoal } from '../types';

// "Hoje" abre a lista a 22 do card de cima; "Esta semana" vem a 20 da última linha.
const SECTION_SPACING = { today: 'default', week: 'tight' } as const;

/** Título (com o voltar na mesma linha, aprovado em 2026-09-29) e a meta da temporada. */
function MissionsHeader({ season }: { season: SeasonGoal | null }) {
  return (
    <View>
      <LargeTitleHeader title={t('missions.title')} subtitle={t('missions.subtitle')} showBack />
      {season ? <SeasonGoalCard season={season} /> : null}
    </View>
  );
}

/** 10 entre dois cards; nada junto da sobrelinha, que já traz o próprio respiro. */
function ItemGap({
  leadingItem,
  trailingItem,
}: {
  leadingItem?: MissionListItem;
  trailingItem?: MissionListItem;
}) {
  if (leadingItem?.type === 'label' || trailingItem?.type === 'label') return null;
  return <View style={styles.gap} />;
}

type ListState = 'loading' | 'error' | 'empty';

function ListPlaceholder({
  state,
  retrying,
  onRetry,
}: {
  state: ListState;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (state === 'loading') return <MissionsSkeleton />;
  if (state === 'error') {
    return (
      <EmptyState
        tone="error"
        message={t('missions.loadError')}
        onAction={onRetry}
        actionLoading={retrying}
      />
    );
  }
  return <EmptyState message={t('missions.empty')} />;
}

/**
 * 1g. Meta da temporada e as missões de "Hoje" (a destacada em lima no topo) e
 * de "Esta semana", numa FlashList só. Cada missão leva à própria ação; a que
 * é concluída em outra tela ganha o check e o "+N" quando o fã volta aqui.
 * Os valores e as missões vêm da API: a régua é configurável no painel.
 */
export function MissionsScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const now = useNow();
  const queryClient = useQueryClient();
  const query = useMissionsQuery();
  const { refreshing, refresh } = useMissionsRefresh();
  const openMission = useMissionAction();
  const missions = query.data?.missions;
  const celebrations = useMissionCelebrations(missions, focused);
  const items = buildMissionItems(missions ?? [], now);
  const loaded = query.data !== undefined;
  // Com a lista em mãos, a busca que falhou é "não deu para atualizar", no pé.
  const listState: ListState = query.isPending ? 'loading' : loaded ? 'empty' : 'error';

  // Missão aberta que venceu com a tela aberta sai na hora; a busca traz o que entrou no lugar.
  const somethingOver = (missions ?? []).some((mission) => isMissionOver(mission, now));
  useEffect(() => {
    if (somethingOver) void queryClient.invalidateQueries({ queryKey: missionKeys.list() });
  }, [somethingOver, queryClient]);

  // Só com a 1g à vista: ela segue montada na pilha quando uma missão leva a
  // outra aba, e a busca de fundo que falha lá não fala por ela. Sem foco, o
  // anúncio sai quando o fã volta.
  const settled = focused && query.isError && !query.isFetching;
  useAnnounceWhen(settled && !loaded, t('missions.loadError'));
  useAnnounceWhen(settled && loaded, t('missions.updateError'));

  // O "Tentar de novo" some junto com o erro quando a lista chega, e o foco do
  // leitor de tela iria com ele: o fã ouve que ela chegou.
  const retry = async (): Promise<void> => {
    const result = await query.refetch();
    if (result.isSuccess) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('missions.loaded'), { queue: true });
    }
  };

  const renderItem = ({ item }: { item: MissionListItem }) => {
    if (item.type === 'label') {
      return (
        <SectionLabel spacing={SECTION_SPACING[item.section]}>
          {t(`missions.sections.${item.section}`)}
        </SectionLabel>
      );
    }
    const props = {
      mission: item.mission,
      onPress: openMission,
      celebration: celebrations.get(item.mission.id),
    };
    return item.type === 'featured' ? (
      <FeaturedMissionCard {...props} />
    ) : (
      <MissionRow {...props} />
    );
  };

  return (
    <Screen contentStyle={styles.screen}>
      <FlashList<MissionListItem>
        data={items}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        extraData={celebrations}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={<MissionsHeader season={query.data?.season ?? null} />}
        ListEmptyComponent={
          <ListPlaceholder
            state={listState}
            retrying={query.isFetching}
            onRetry={() => void retry()}
          />
        }
        ListFooterComponent={
          query.isError && loaded ? (
            <EmptyState
              tone="error"
              message={t('missions.updateError')}
              onAction={() => void retry()}
              actionLoading={query.isFetching}
            />
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.points}
            colors={[colors.onPoints]}
            progressBackgroundColor={colors.points}
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
  gap: {
    height: spacing.listGap,
  },
});
