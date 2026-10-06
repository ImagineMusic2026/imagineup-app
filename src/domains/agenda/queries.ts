import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

// As centrais e as chaves dos posts pelos arquivos, fora dos index, como os
// posts fazem (pelo index seria um ciclo).
import { artistKeys } from '@/domains/artists/queries';
import { missionKeys } from '@/domains/missions';
import { postKeys } from '@/domains/posts/keys';
import { profileKeys } from '@/domains/profile';
import { rankingKeys } from '@/domains/ranking';
import { t } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { queryOptionsFor } from '@/services/query/client';
import { createIdempotencyKey } from '@/utils/id';

import { fetchAgenda, fetchArtistAgenda, fetchMyRsvps, setEventRsvp } from './api';
import type { AgendaEvent, AgendaPage, MyRsvps, RsvpResult, RsvpVariables } from './types';

/** A chave inclui tudo que muda o resultado. */
export const agendaKeys = {
  all: ['agenda'] as const,
  events: () => [...agendaKeys.all, 'events'] as const,
  /** Shows de uma central (1d), debaixo dos da agenda: invalidar a agenda leva estes junto. */
  byArtist: (artistId: string) => [...agendaKeys.events(), 'artist', artistId] as const,
  rsvps: () => [...agendaKeys.all, 'rsvps'] as const,
};

export const agendaMutationKeys = {
  rsvp: ['agenda', 'rsvp'] as const,
};

/**
 * Toda presença confirmada ou desfeita pode andar (ou voltar) uma missão de
 * presença, mesmo sem concluí-la e sem render pontos: as missões buscam de
 * novo sempre. O saldo (1e, 1h), o ranking (1f, pontos da temporada), a
 * posição e os pontos nas centrais (1b, 1e) e o "PTS DA CENTRAL" da 1d (os
 * pontos vão para uma central do show) só mudam quando a presença rendeu
 * pontos.
 */
function refreshPointsAfterRsvp(client: QueryClient, result: RsvpResult): void {
  void client.invalidateQueries({ queryKey: missionKeys.all });
  if (result.pointsAwarded <= 0) return;
  void client.invalidateQueries({ queryKey: profileKeys.wallet() });
  void client.invalidateQueries({ queryKey: rankingKeys.all });
  void client.invalidateQueries({ queryKey: artistKeys.centrals() });
  void client.invalidateQueries({ queryKey: artistKeys.details() });
}

const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.kind === 'notFound';

/**
 * O show saiu do ar ou encerrou entre a lista e o toque (o servidor recusa o
 * "Eu vou" com 404): a agenda e o mural buscam de novo, e o show some da
 * agenda e da linha do post de show.
 */
function refreshAfterGoneEvent(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: agendaKeys.events() });
  void client.invalidateQueries({ queryKey: postKeys.all });
}

/**
 * A presença feita offline fica salva e volta a rodar quando o app reabre.
 * Para isso a função precisa estar registrada aqui, fora do componente, com o
 * que ela muda nas outras telas (a do componente só vale com ele montado).
 */
export function registerAgendaMutationDefaults(client: QueryClient): void {
  client.setMutationDefaults(agendaMutationKeys.rsvp, {
    mutationFn: (variables: RsvpVariables) => setEventRsvp(variables),
    onSuccess: (result: RsvpResult) => refreshPointsAfterRsvp(client, result),
    onError: (error: unknown) => {
      if (isNotFound(error)) refreshAfterGoneEvent(client);
    },
  });
}

/**
 * Shows da agenda (1m), uma página por vez: a primeira traz os próximos meses
 * e o "Ver agenda completa" busca o resto. A presença não vem aqui: vem de
 * `useMyRsvpsQuery`, a mesma lista que o post de show da home lê.
 */
export function useAgendaQuery() {
  return useInfiniteQuery(agendaQueryOptions());
}

function agendaQueryOptions() {
  return infiniteQueryOptions({
    ...queryOptionsFor('agenda'),
    queryKey: agendaKeys.events(),
    queryFn: ({ pageParam }) => fetchAgenda(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

function findEvent(data: InfiniteData<AgendaPage>, eventId: string): AgendaEvent | null {
  for (const page of data.pages) {
    if (page.featured?.id === eventId) return page.featured;
    const event = page.items.find((item) => item.id === eventId);
    if (event) return event;
  }
  return null;
}

/**
 * Um show da agenda, procurado nas páginas que o fã já carregou (o "Chamar
 * amigos" da 1m abre o convite com ele). Não há página de um show só: fora das
 * páginas carregadas, ou sem `eventId`, devolve `null`.
 */
export function useAgendaEvent(eventId: string | null): AgendaEvent | null {
  const query = useInfiniteQuery({
    ...agendaQueryOptions(),
    enabled: eventId !== null,
    select: (data) => (eventId === null ? null : findEvent(data, eventId)),
  });
  return query.data ?? null;
}

/**
 * Shows de uma central (aba Agenda da 1d), uma página por vez. A presença vem
 * de `useMyRsvpsQuery`, como na agenda.
 */
export function useArtistAgendaQuery(artistId: string) {
  return useInfiniteQuery({
    ...queryOptionsFor('agenda'),
    queryKey: agendaKeys.byArtist(artistId),
    queryFn: ({ pageParam }) => fetchArtistAgenda(artistId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!artistId,
  });
}

/** Shows em que o fã confirmou presença. O feed e a agenda leem daqui. */
export function useMyRsvpsQuery() {
  return useQuery({
    ...queryOptionsFor('agenda'),
    queryKey: agendaKeys.rsvps(),
    queryFn: fetchMyRsvps,
  });
}

/** O fã vai a este show? `undefined` enquanto a lista não chegou. */
export function useIsGoing(eventId: string): boolean | undefined {
  const { data } = useQuery({
    ...queryOptionsFor('agenda'),
    queryKey: agendaKeys.rsvps(),
    queryFn: fetchMyRsvps,
    select: (rsvps) => rsvps.eventIds.includes(eventId),
  });
  return data;
}

function withRsvp(rsvps: MyRsvps | undefined, eventId: string, going: boolean): MyRsvps {
  const others = (rsvps?.eventIds ?? []).filter((id) => id !== eventId);
  return { eventIds: going ? [...others, eventId] : others };
}

/**
 * "Eu vou" num show (post de show da 1b, agenda da 1m). Aparece na hora
 * (otimista), anunciado ao leitor de tela, e desfaz se a API recusar.
 *
 * Sem rede, a presença espera na fila e sobrevive ao app fechado
 * (`mutationKey` registrada no `AppProviders`). O `scope` é por show:
 * confirmar e desfazer o mesmo show chegam ao servidor na ordem do toque, e
 * shows diferentes não esperam um pelo outro. Show que saiu do ar ou encerrou
 * (404): além de desfazer, a agenda e o mural buscam de novo.
 */
export function useRsvpMutation(eventId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationKey: agendaMutationKeys.rsvp,
    scope: { id: `agenda-rsvp-${eventId}` },
    mutationFn: (variables: RsvpVariables) => setEventRsvp(variables),
    onMutate: async ({ eventId: id, going }) => {
      await queryClient.cancelQueries({ queryKey: agendaKeys.rsvps() });
      const wasGoing =
        queryClient.getQueryData<MyRsvps>(agendaKeys.rsvps())?.eventIds.includes(id) ?? false;
      queryClient.setQueryData<MyRsvps>(agendaKeys.rsvps(), (current) =>
        withRsvp(current, id, going),
      );
      AccessibilityInfo.announceForAccessibility(
        t(going ? 'agenda.rsvp.confirmed' : 'agenda.rsvp.canceled'),
      );
      return { wasGoing };
    },
    onSuccess: (result) => refreshPointsAfterRsvp(queryClient, result),
    onError: (error, { eventId: id }, context) => {
      if (isNotFound(error)) refreshAfterGoneEvent(queryClient);
      // Volta só este show: a lista pode ter mudado em outro no meio.
      if (context) {
        queryClient.setQueryData<MyRsvps>(agendaKeys.rsvps(), (current) =>
          withRsvp(current, id, context.wasGoing),
        );
      }
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t('agenda.rsvp.error'));
    },
    onSettled: () => {
      // Com outra presença ainda indo, a busca traria a lista sem ela, e o
      // "Eu vou" dela piscaria; a última a terminar busca por todas.
      if (queryClient.isMutating({ mutationKey: agendaMutationKeys.rsvp }) > 1) return undefined;
      return queryClient.invalidateQueries({ queryKey: agendaKeys.rsvps() });
    },
  });

  return {
    ...mutation,
    setGoing: (going: boolean) =>
      mutation.mutate({ eventId, going, idempotencyKey: createIdempotencyKey() }),
  };
}
