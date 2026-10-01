import { useAgendaEvent } from '@/domains/agenda';
import { useMissionQuery, type Mission } from '@/domains/missions';
import { usePostQuery } from '@/domains/posts';

import type { InviteTarget } from '../describe-link';

/** Parâmetros da rota `/convidar`, de quem abre a sheet. */
export type InviteParams = {
  /** A missão do "Gerar meu link" (1b) e do card lima (1g). */
  missionId?: string;
  /** O post alvo da missão: o link leva a ele. */
  postId?: string;
  /** O show do "Chamar amigos" (1m): o link leva à agenda. */
  eventId?: string;
};

/**
 * Para onde o link leva e para qual missão ele é, a partir do que veio na
 * rota. O post e a missão saem das mesmas consultas da 1b e da 1g, e o show,
 * das páginas da agenda que o fã já carregou.
 */
export function useInviteTarget(params: InviteParams): {
  target: InviteTarget;
  mission: Mission | null;
} {
  const postId = params.postId || null;
  const eventId = postId ? null : params.eventId || null;
  const post = usePostQuery(postId ?? '');
  const event = useAgendaEvent(eventId);
  const mission = useMissionQuery(params.missionId || null);

  let target: InviteTarget = { kind: 'app' };
  if (postId) {
    target = { kind: 'post', postId, artistName: post.data?.artist.name ?? null };
  } else if (eventId) {
    target = { kind: 'event', showTitle: event?.title ?? null };
  }
  return { target, mission: mission.data ?? null };
}
