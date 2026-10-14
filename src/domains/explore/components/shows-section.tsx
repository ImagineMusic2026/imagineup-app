import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { SectionHeader } from '@/components/section-header';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { EventHeroCard, EventRow, useAgendaQuery, type AgendaEvent } from '@/domains/agenda';
import { t } from '@/i18n';
import { layout, radii, spacing } from '@/theme';

import { showcaseOf } from '../showcase';

/**
 * "Chamar amigos" do destaque: a sheet do convite com o show, como o
 * `openInvite` da 1m. Sem página de um show só, o link leva à agenda.
 */
function openInvite(event: AgendaEvent): void {
  router.push({ pathname: '/convidar', params: { eventId: event.id } });
}

/** A agenda completa (1m), dentro da pilha da Explorar. */
function openAgenda(): void {
  router.push('/agenda');
}

/**
 * "Próximos shows" da Explorar (seção 29, frente G): o destaque marcado no
 * painel e até três shows seguintes, com o "Eu vou" de sempre (a mesma lista
 * de presenças da 1m e da 1b) e o "Ver agenda". Lê a primeira página da
 * agenda, o mesmo cache da 1m. Carregando, o esqueleto do destaque; sem
 * nenhum show por vir, "Nenhum show marcado"; a falha fica aqui, com
 * "Tentar de novo", sem derrubar a grade das centrais.
 */
export function ShowsSection({ now }: { now: Date }) {
  const agenda = useAgendaQuery();
  const page = agenda.data?.pages[0];
  const shows = page ? showcaseOf(page, now) : null;

  const body = !shows ? (
    agenda.isPending ? (
      <SkeletonGroup accessibilityLabel={t('explore.showsLoading')}>
        <Skeleton tone="surface" height={layout.eventHeroMinHeight} radius={radii.xl} />
      </SkeletonGroup>
    ) : (
      <EmptyState
        tone="error"
        message={t('explore.showsError')}
        onAction={() => void agenda.refetch()}
        actionLoading={agenda.isFetching}
      />
    )
  ) : !shows.featured && shows.rows.length === 0 ? (
    <EmptyState message={t('explore.showsEmpty')} />
  ) : (
    <View style={styles.shows}>
      {shows.featured ? (
        <EventHeroCard
          event={shows.featured}
          now={now}
          onInvite={openInvite}
          testID="explore-featured"
        />
      ) : null}
      {shows.rows.map((event) => (
        <EventRow key={event.id} event={event} now={now} testID={`explore-${event.id}`} />
      ))}
    </View>
  );

  return (
    <View>
      <SectionHeader
        title={t('explore.shows')}
        action={{
          label: t('explore.seeAgenda'),
          accessibilityLabel: t('explore.seeAgenda'),
          accessibilityHint: t('explore.seeAgendaHint'),
          onPress: openAgenda,
        }}
      />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  shows: {
    gap: spacing.listGap,
  },
});
