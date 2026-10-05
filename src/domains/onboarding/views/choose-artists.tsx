import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactElement, type Ref } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';

import { BottomActionBar } from '@/components/bottom-action-bar';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { StepProgress } from '@/components/step-progress';
import { Text } from '@/components/text';
import type { Artist } from '@/domains/artists';
import { ENTRY_STEP_COUNT } from '@/domains/auth';
import { t } from '@/i18n';
import { colors, motion, spacing } from '@/theme';

import { ArtistGridSkeleton } from '../components/artist-grid-skeleton';
import { SelectableArtistCard } from '../components/artist-select-card';
import { CascadeIn } from '../components/cascade-in';
import { MoreArtistsCard } from '../components/more-artists-card';
import { SearchArtistsCard } from '../components/search-artists-card';
import { ARTISTS_STEP, MIN_ARTISTS, MORE_PREVIEW_COUNT } from '../consts';
import { useArtistSelection } from '../hooks/use-artist-selection';
import { useArtistsLoad, useFocusAfterRecovery } from '../hooks/use-artists-load';
import { useFinishOnboarding } from '../hooks/use-finish-onboarding';
import {
  continueLabel,
  minimumArtists,
  missingArtists,
  needMoreHint,
  splitFeatured,
} from '../selection';

const COLUMNS = 2;

function openAllArtists(search: boolean): void {
  router.push(
    search ? { pathname: '/todos-artistas', params: { buscar: '1' } } : '/todos-artistas',
  );
}

/** Linhas de duas células; a última, sozinha, fica com meia largura. */
function GridRows({ cells }: { cells: ReactElement[] }) {
  const rows: ReactElement[][] = [];
  for (let index = 0; index < cells.length; index += COLUMNS) {
    rows.push(cells.slice(index, index + COLUMNS));
  }
  return (
    <View style={styles.grid}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((cell, column) => (
            <CascadeIn key={cell.key} index={rowIndex * COLUMNS + column} style={styles.cell}>
              {cell}
            </CascadeIn>
          ))}
          {row.length < COLUMNS ? <View style={styles.cell} /> : null}
        </View>
      ))}
    </View>
  );
}

interface ArtistGridProps {
  artists: readonly Artist[];
  locked: boolean;
  /** O primeiro card, para o foco do leitor de tela. */
  firstCardRef: Ref<View>;
}

function ArtistGrid({ artists, locked, firstCardRef }: ArtistGridProps) {
  const { featured, rest } = splitFeatured(artists);
  const cells = featured.map((artist, index) => (
    <SelectableArtistCard
      key={artist.id}
      ref={index === 0 ? firstCardRef : undefined}
      artist={artist}
      disabled={locked}
    />
  ));
  if (rest.length > 0) {
    cells.push(
      <MoreArtistsCard
        key="more"
        preview={rest.slice(0, MORE_PREVIEW_COUNT)}
        count={rest.length}
        onPress={() => openAllArtists(false)}
        disabled={locked}
      />,
    );
  }
  cells.push(
    <SearchArtistsCard key="search" onPress={() => openAllArtists(true)} disabled={locked} />,
  );
  return <GridRows cells={cells} />;
}

/**
 * 1l. O fã escolhe pelo menos 3 artistas; abaixo disso o botão fica travado e
 * diz quantos faltam. "+N artistas" e "Buscar por nome" abrem a sheet de todos
 * os artistas, que escolhe na mesma lista. Ao continuar, segue as centrais e
 * conclui o onboarding; quem troca para as abas é o guard do layout raiz, e a
 * tela não navega.
 */
export function ChooseArtistsScreen() {
  const { artists, state: gridState, retrying, retry } = useArtistsLoad();
  const selectedIds = useArtistSelection((state) => state.selectedIds);
  const clearSelection = useArtistSelection((state) => state.clear);
  const retainSelection = useArtistSelection((state) => state.retain);
  const finish = useFinishOnboarding();
  const [barHeight, setBarHeight] = useState(0);
  const firstCardRef = useRef<View>(null);

  // Saiu da escolha (onboarding concluído, sessão que caiu): a próxima começa vazia.
  useEffect(() => clearSelection, [clearSelection]);

  // A lista mudou (buscou de novo depois de uma central sair do ar no meio):
  // o que sumiu dela sai da escolha.
  useEffect(() => {
    if (artists) retainSelection(artists.map((artist) => artist.id));
  }, [artists, retainSelection]);

  // Cada falha é anunciada; a busca de novo (com o botão ocupado) não.
  const failed = gridState === 'error' && !retrying;
  useEffect(() => {
    if (failed) AccessibilityInfo.announceForAccessibility(t('onboarding.chooseArtists.loadError'));
  }, [failed]);

  // O primeiro card aparece em cascata; o foco vai a ele quando já está à vista.
  useFocusAfterRecovery(gridState, firstCardRef, motion.duration.fast);

  // O erro de salvar é sobre a escolha que falhou: mudou a escolha, ele sai,
  // como o erro das telas de conta sai quando o fã volta a digitar.
  const { isError: saveFailed, reset: resetSave } = finish;
  const seenSelection = useRef(selectedIds);
  useEffect(() => {
    if (seenSelection.current === selectedIds) return;
    seenSelection.current = selectedIds;
    if (saveFailed) resetSave();
  }, [selectedIds, saveFailed, resetSave]);

  const saving = finish.isPending;
  const count = selectedIds.length;
  // O mínimo é 3, ou todas as publicadas quando o painel publicou menos que isso.
  const minimum = artists ? minimumArtists(artists.length) : MIN_ARTISTS;
  const missing = missingArtists(count, minimum);

  return (
    <Screen padded={false} contentStyle={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: barHeight }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Enche depois de a pilha entrar do escuro, para o fã ver a etapa andar. */}
        <StepProgress
          current={ARTISTS_STEP}
          total={ENTRY_STEP_COUNT}
          delay={motion.duration.slow}
          style={styles.steps}
        />
        <Text variant="titleOnboarding" accessibilityRole="header">
          {t('onboarding.chooseArtists.title')}
        </Text>
        <Text variant="body" color={colors.textMuted} style={styles.subtitle}>
          {t('onboarding.chooseArtists.subtitle', { min: minimum })}
        </Text>

        <View style={styles.body}>
          {gridState === 'ready' && artists ? (
            <ArtistGrid artists={artists} locked={saving} firstCardRef={firstCardRef} />
          ) : gridState === 'error' ? (
            <EmptyState
              tone="error"
              message={t('onboarding.chooseArtists.loadError')}
              onAction={retry}
              actionLoading={retrying}
            />
          ) : (
            <ArtistGridSkeleton />
          )}
        </View>
      </ScrollView>

      <BottomActionBar onHeightChange={setBarHeight}>
        {saveFailed ? (
          <Text variant="caption" color={colors.danger} style={styles.error}>
            {t('onboarding.chooseArtists.saveError')}
          </Text>
        ) : null}
        <Button
          label={continueLabel(count, minimum)}
          onPress={() => finish.follow(selectedIds)}
          disabled={missing > 0 || gridState !== 'ready'}
          loading={saving}
          // O toque de confirmação vem quando a escolha é salva.
          haptic={null}
          accessibilityHint={missing > 0 ? needMoreHint(minimum) : undefined}
        />
      </BottomActionBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // O rodapé fica preso ao pé da tela, por cima da lista.
  screen: {
    paddingBottom: 0,
  },
  content: {
    paddingTop: spacing.xxs,
    paddingHorizontal: spacing.gutterOnboarding,
  },
  steps: {
    marginBottom: spacing.gutterOnboarding,
  },
  subtitle: {
    marginTop: spacing.md,
  },
  body: {
    marginTop: spacing.gutterOnboarding,
  },
  grid: {
    gap: spacing.itemGap,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.itemGap,
  },
  cell: {
    flex: 1,
  },
  error: {
    textAlign: 'center',
  },
});
