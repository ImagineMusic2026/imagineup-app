import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { BackButton } from '@/components/header';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { TextInput } from '@/components/text-input';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { ArtistGridSkeleton } from '../components/artist-grid-skeleton';
import { SelectableArtistCard } from '../components/artist-select-card';
import { useArtistsLoad, useFocusAfterRecovery } from '../hooks/use-artists-load';
import { filterArtists, sortByOrder } from '../selection';

const COLUMNS = 2;
const isIOS = Platform.OS === 'ios';

/** Aberta a frio, sem a 1l embaixo, a sheet volta para ela. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/artistas');
}

// Cada célula leva metade do vão entre as colunas dos dois lados, e a lista
// desconta essa metade da margem: as duas colunas ficam iguais sem depender da
// posição do item, que a FlashList não atualiza quando reaproveita a célula de
// um artista (a busca que tira os de antes da lista deixava o card fora do lugar).
const HALF_GAP = spacing.itemGap / 2;

/**
 * Sheet "Todos os artistas" da 1l (sem desenho no protótipo): a busca por nome,
 * sem acento nem maiúscula, e a grade com os mesmos cards. A escolha é a mesma
 * da tela de trás (store do domínio), então o botão lá atrás já volta com o
 * número certo. "Buscar por nome" abre com o campo já focado (`?buscar=1`).
 */
export function AllArtistsSheetScreen() {
  const { buscar } = useLocalSearchParams<{ buscar?: string }>();
  const insets = useSafeAreaInsets();
  const { artists, state, retrying, retry } = useArtistsLoad();
  const [query, setQuery] = useState('');
  const searchRef = useRef<NativeTextInput>(null);

  const ordered = artists ? sortByOrder(artists) : [];
  const results = filterArtists(ordered, query);
  const noResults = !!artists && results.length === 0;

  // A lista voltou depois de um erro: o foco vai para a busca, o começo da sheet.
  useFocusAfterRecovery(state, searchRef);

  // A busca que zera a lista é anunciada uma vez, e não a cada letra.
  const announcedEmpty = useRef(false);
  useEffect(() => {
    if (noResults && !announcedEmpty.current) {
      AccessibilityInfo.announceForAccessibility(t('onboarding.chooseArtists.noResults'));
    }
    announcedEmpty.current = noResults;
  }, [noResults]);

  return (
    <View style={styles.root}>
      <SheetGrabber />
      <View style={styles.header}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('onboarding.chooseArtists.allTitle')}
        </Text>
        <BackButton variant="close" onPress={closeSheet} />
      </View>

      <View style={styles.search}>
        <TextInput
          ref={searchRef}
          variant="glass"
          label={t('onboarding.chooseArtists.searchLabel')}
          labelHidden
          leadingIcon={Search}
          placeholder={t('onboarding.chooseArtists.search')}
          value={query}
          onChangeText={setQuery}
          autoFocus={buscar === '1'}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {state === 'ready' ? (
        <FlashList
          data={results}
          numColumns={COLUMNS}
          keyExtractor={(artist) => artist.id}
          renderItem={({ item }) => (
            <View style={styles.cell}>
              <SelectableArtistCard artist={item} />
            </View>
          )}
          ListEmptyComponent={
            <Text variant="body" color={colors.textSecondary} style={styles.empty}>
              {t('onboarding.chooseArtists.noResults')}
            </Text>
          }
          contentContainerStyle={{
            paddingHorizontal: spacing.gutterOnboarding - HALF_GAP,
            paddingBottom: insets.bottom + spacing.xl,
          }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // iOS: a busca abre com o teclado, e a grade ganha o espaço dele para
          // rolar os últimos cards até acima dele (como o `Screen`). No Android,
          // quem desvia do teclado é a própria sheet do react-native-screens.
          automaticallyAdjustKeyboardInsets={isIOS}
          showsVerticalScrollIndicator={false}
        />
      ) : state === 'error' ? (
        <EmptyState
          tone="error"
          message={t('onboarding.chooseArtists.loadError')}
          onAction={retry}
          actionLoading={retrying}
        />
      ) : (
        <View style={styles.loading}>
          <ArtistGridSkeleton />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  // Abaixo do puxador da sheet. O "×" fica colado ao fim do alvo, na mesma
  // coluna do campo de busca e da grade.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.gutterOnboarding,
  },
  title: {
    flex: 1,
  },
  search: {
    paddingHorizontal: spacing.gutterOnboarding,
    paddingTop: spacing.md,
    paddingBottom: spacing.blockGap,
  },
  cell: {
    paddingHorizontal: HALF_GAP,
    paddingBottom: spacing.itemGap,
  },
  empty: {
    textAlign: 'center',
    paddingTop: spacing.xl,
  },
  loading: {
    paddingHorizontal: spacing.gutterOnboarding,
  },
});
