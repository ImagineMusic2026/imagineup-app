import { FlashList } from '@shopify/flash-list';
import { router, useIsFocused } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Pill } from '@/components/pill';
import { PressableScale } from '@/components/pressable-scale';
import { Screen } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, isLargeText, radii, spacing } from '@/theme';

import { UnofficialBand } from '../components/unofficial-band';
import { isDefinitiveRefusal } from '../entry';
import { personName } from '../format';
import { useFanClubGate, useFollowedFanClubsQuery } from '../queries';
import { fanClubHref } from '../share';
import type { FollowedFanClub } from '../types';

// Linhas do esqueleto: a altura de uma linha com o avatar e o botão.
const SKELETON_ROWS = 3;
const SKELETON_ROW_HEIGHT = 72;

function ItemGap() {
  return <View style={styles.gap} />;
}

/**
 * Um fã-clube seguido: o gestor, o nome e o artista, num botão que abre a
 * página; e o "Deixar de seguir" irmão (nunca dentro do outro pressável), que
 * abre a sheet. O indisponível (pausado, encerrado, fora do ar, fechado para o
 * artista, ou de gestor bloqueado) aparece com o nome, quando há, e
 * "Indisponível", sem abrir nada, só com o Deixar de seguir: é aqui que o fã
 * libera a vaga dos 50 (decisão 34). Com a fonte grande, o botão desce.
 */
function FollowedRow({ club }: { club: FollowedFanClub }) {
  const stacked = isLargeText(useWindowDimensions().fontScale);
  const name = club.name ?? t('fanClub.follows.unavailableName');
  const of = t('fanClub.follows.of', { artist: club.artistName });
  const label = club.available
    ? t('fanClub.follows.rowLabel', { name, artist: club.artistName })
    : t('fanClub.follows.rowUnavailableLabel', { name, artist: club.artistName });
  const content = (
    <View style={styles.content}>
      {club.owner ? (
        <Avatar
          name={club.owner.name}
          id={club.owner.uid}
          photoUrl={club.owner.photoURL}
          size="md"
        />
      ) : null}
      <View style={styles.texts}>
        <Text variant="label" color={club.available ? colors.text : colors.textSecondary}>
          {name}
        </Text>
        <Text variant="caption" color={colors.textSecondary}>
          {club.owner ? `${of} · ${personName(club.owner)}` : of}
        </Text>
        {club.available ? null : (
          <Pill
            label={t('fanClub.follows.unavailable')}
            tone="neutral"
            size="xs"
            style={styles.unavailable}
          />
        )}
      </View>
    </View>
  );

  return (
    <Card
      variant="compact"
      style={[styles.row, stacked && styles.rowStacked]}
      testID={`followed-fan-club-${club.id}`}
    >
      {club.available ? (
        <PressableScale
          onPress={() => router.push(fanClubHref(club.id))}
          accessibilityLabel={label}
          accessibilityHint={t('fanClub.artistCard.hint')}
          style={stacked ? undefined : styles.main}
          testID={`followed-fan-club-open-${club.id}`}
        >
          {content}
        </PressableScale>
      ) : (
        <View accessible accessibilityLabel={label} style={stacked ? undefined : styles.main}>
          {content}
        </View>
      )}
      <Button
        label={t('fanClub.follows.unfollow')}
        variant="secondary"
        size="sm"
        onPress={() =>
          router.push({ pathname: '/deixar-de-seguir/[clubeId]', params: { clubeId: club.id } })
        }
        accessibilityLabel={t('fanClub.follows.unfollowLabel', { name })}
        testID={`followed-fan-club-unfollow-${club.id}`}
      />
    </Card>
  );
}

/**
 * "Fã-clubes que sigo" (`/fa-clubes-que-sigo`, 34.9, item 10), na pilha do
 * Perfil, aberta pela linha dos Ajustes e pelo limite de 50 da página. A lista
 * do `GET /me/fan-club-follows`, do mais novo ao mais antigo, fora do disco.
 * Inerte antes da abertura: sem a resposta da trava, diz que o fã-clube não
 * está disponível e não chama mais nada.
 */
export function FollowedFanClubsScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const { query: gate, live } = useFanClubGate();
  const query = useFollowedFanClubsQuery(live !== null);
  const items = query.data?.items ?? [];
  const settled = focused && query.isError && !query.isFetching;
  useAnnounceWhen(settled && query.data === undefined, t('fanClub.follows.loadError'));

  let empty;
  if (live === null) {
    const failed = gate.isError && !isDefinitiveRefusal(gate.error);
    empty = gate.isPending ? (
      <FollowedSkeleton />
    ) : failed ? (
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
  } else if (query.isPending) {
    empty = <FollowedSkeleton />;
  } else if (query.data === undefined) {
    empty = (
      <EmptyState
        tone="error"
        message={t('fanClub.follows.loadError')}
        onAction={() => void query.refetch()}
        actionLoading={query.isFetching}
      />
    );
  } else {
    empty = (
      <EmptyState title={t('fanClub.follows.empty')} message={t('fanClub.follows.emptyText')} />
    );
  }

  return (
    <Screen contentStyle={styles.screen}>
      <FlashList<FollowedFanClub>
        data={live === null ? [] : items}
        keyExtractor={(club) => club.id}
        renderItem={({ item }) => <FollowedRow key={item.id} club={item} />}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <View>
            <LargeTitleHeader
              title={t('fanClub.follows.title')}
              subtitle={live === null ? undefined : t('fanClub.follows.intro')}
              showBack
            />
            {live === null ? null : (
              <View style={styles.band}>
                <UnofficialBand />
              </View>
            )}
          </View>
        }
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
        testID="followed-fan-clubs-list"
      />
    </Screen>
  );
}

function FollowedSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('fanClub.follows.loading')} style={styles.skeleton}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} height={SKELETON_ROW_HEIGHT} radius={radii.lg} />
      ))}
    </SkeletonGroup>
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
  band: {
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  main: {
    flex: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  unavailable: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  skeleton: {
    gap: spacing.listGap,
    marginTop: spacing.lg,
  },
});
