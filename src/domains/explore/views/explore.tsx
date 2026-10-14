import { FlashList } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, RefreshControl, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { TextInput } from '@/components/text-input';
import { useAgendaQuery } from '@/domains/agenda';
import {
  ArtistGridSkeleton,
  CentralTile,
  useArtistsQuery,
  useFanCentralsQuery,
} from '@/domains/artists';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useNow } from '@/hooks/use-now';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { ShowsSection } from '../components/shows-section';
import { useExploreRefresh } from '../hooks/use-explore-refresh';
import { exploreCentrals, type ExploreCentral } from '../showcase';

const COLUMNS = 2;
// A primeira tela da grade enquanto as centrais carregam.
const SKELETON_TILES = 6;
const isIOS = Platform.OS === 'ios';

// Cada célula leva metade do vão entre as colunas dos dois lados, e a lista
// desconta essa metade da margem: as duas colunas ficam iguais sem depender da
// posição do item, que a FlashList não atualiza quando reaproveita a célula
// (o truque da sheet de todos os artistas). O cabeçalho e o vazio devolvem a
// metade, para ficar na margem da tela.
const HALF_GAP = spacing.itemGap / 2;

type CentralsState = 'loading' | 'error' | 'empty' | 'noResults' | 'ready';

interface ExploreHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  now: Date;
}

/**
 * O que vem antes da grade: o título, a busca, os próximos shows e a
 * sobrelinha das centrais. Componente do módulo, passado como elemento: o
 * cabeçalho não monta de novo a cada letra, e o campo fica com o foco e o
 * teclado. Com a busca preenchida, os shows saem e fica só a grade.
 */
function ExploreHeader({ query, onQueryChange, now }: ExploreHeaderProps) {
  return (
    <View style={styles.inset}>
      <LargeTitleHeader title={t('explore.title')} />
      <TextInput
        variant="glass"
        label={t('explore.searchLabel')}
        labelHidden
        leadingIcon={Search}
        placeholder={t('explore.searchPlaceholder')}
        value={query}
        onChangeText={onQueryChange}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {query.trim() === '' ? <ShowsSection now={now} /> : null}
      <SectionLabel>{t('explore.centrals')}</SectionLabel>
    </View>
  );
}

function CentralsPlaceholder({
  state,
  query,
  retrying,
  onRetry,
}: {
  state: CentralsState;
  query: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  switch (state) {
    case 'loading':
      return (
        <View style={styles.inset}>
          <ArtistGridSkeleton count={SKELETON_TILES} accessibilityLabel={t('explore.loading')} />
        </View>
      );
    case 'error':
      return (
        <EmptyState
          tone="error"
          message={t('explore.centralsError')}
          onAction={onRetry}
          actionLoading={retrying}
        />
      );
    case 'empty':
      return <EmptyState message={t('explore.centralsEmpty')} />;
    case 'noResults':
      return <EmptyState message={t('explore.searchEmpty', { query: query.trim() })} />;
    default:
      return null;
  }
}

/**
 * Raiz da aba Explorar (seção 29, frente G), a vitrine das centrais: a busca
 * local pelo nome, os próximos shows e todas as centrais em grade de duas
 * colunas, com a marca "Na central" nas do fã. Tocar numa central abre a
 * página dela (1d) dentro da pilha da Explorar. Só com rotas que já existem
 * (`/artists`, `/me/centrals`, `/agenda` e `/me/rsvps`). A busca fica dentro
 * da aba, com a tab bar por cima da grade enquanto o fã digita: rolar a
 * lista fecha o teclado, e um toque num card com ele aberto já abre a central.
 */
export function ExploreScreen() {
  const bottomInset = useTabBarInset();
  // A raiz da aba fica montada embaixo da agenda e do artista: as falhas só
  // são anunciadas com ela à vista.
  const focused = useIsFocused();
  const now = useNow();
  const artists = useArtistsQuery();
  const centrals = useFanCentralsQuery();
  const agenda = useAgendaQuery();
  const { refreshing, refresh } = useExploreRefresh();
  const [query, setQuery] = useState('');

  const items = artists.data ? exploreCentrals(artists.data, centrals.data, query) : [];
  const state: CentralsState = !artists.data
    ? artists.isPending
      ? 'loading'
      : 'error'
    : artists.data.length === 0
      ? 'empty'
      : items.length === 0
        ? 'noResults'
        : 'ready';

  const settled = (result: { isError: boolean; isFetching: boolean }) =>
    focused && result.isError && !result.isFetching;
  useAnnounceWhen(settled(artists) && !artists.data, t('explore.centralsError'));
  useAnnounceWhen(settled(agenda) && !agenda.data && query.trim() === '', t('explore.showsError'));

  // A busca que zera a grade é anunciada uma vez, quando zera, e não a cada letra.
  const noResults = state === 'noResults';
  const announcedEmpty = useRef(false);
  useEffect(() => {
    if (noResults && !announcedEmpty.current && focused) {
      AccessibilityInfo.announceForAccessibility(t('explore.searchEmpty', { query: query.trim() }));
    }
    announcedEmpty.current = noResults;
  }, [noResults, query, focused]);

  return (
    <Screen padded={false} contentStyle={styles.screen}>
      <FlashList<ExploreCentral>
        data={items}
        numColumns={COLUMNS}
        keyExtractor={(item) => item.artist.id}
        renderItem={({ item }) => (
          <View style={styles.cell}>
            <CentralTile
              artist={item.artist}
              member={item.member}
              testID={`explore-central-${item.artist.id}`}
            />
          </View>
        )}
        ListHeaderComponent={<ExploreHeader query={query} onQueryChange={setQuery} now={now} />}
        ListEmptyComponent={
          <CentralsPlaceholder
            state={state}
            query={query}
            retrying={artists.isFetching}
            onRetry={() => void artists.refetch()}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceRaised}
          />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // iOS: com o teclado aberto, a grade ganha o espaço dele para rolar os
        // últimos cards até acima dele (como na sheet de todos os artistas).
        automaticallyAdjustKeyboardInsets={isIOS}
        contentContainerStyle={{
          paddingHorizontal: spacing.gutter - HALF_GAP,
          paddingBottom: bottomInset + spacing.xl,
        }}
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
  inset: {
    paddingHorizontal: HALF_GAP,
  },
  cell: {
    flexGrow: 1,
    paddingHorizontal: HALF_GAP,
    paddingBottom: spacing.itemGap,
  },
});
