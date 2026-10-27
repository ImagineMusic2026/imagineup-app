import { FAN_CLUB_REACTIONS, type FanClubReaction } from './consts';
import type { FanClubPost, FanClubReactionCounts } from './types';

// As contas das reações no app (seção 37, R1 e 37.9), puras: a troca
// otimista do card, os emojis mais usados e a ação do leitor de tela. O
// servidor faz as mesmas contas (`reactionDelta` e `applyReactionDelta` de
// `functions/src/fan-clubs/model.ts`), e a resposta dele acerta os números.

/** Os mais usados ao lado do total (37.9, item 1). */
export const TOP_REACTIONS_MAX = 3;

/** O prefixo das ações do leitor de tela que reagem com um emoji ("react-fire"). */
const REACT_ACTION_PREFIX = 'react-';

export const emptyReactionCounts = (): FanClubReactionCounts => ({
  heart: 0,
  fire: 0,
  laugh: 0,
  wow: 0,
  clap: 0,
});

export const isFanClubReaction = (value: unknown): value is FanClubReaction =>
  (FAN_CLUB_REACTIONS as readonly unknown[]).includes(value);

/**
 * A publicação com a reação de quem pede trocada, na hora, com os números
 * junto: sem reação antes, o total e o emoji novo sobem 1; na troca, o emoji
 * de antes desce e o novo sobe; ao tirar, o total e o emoji de antes descem.
 * Nunca abaixo de zero. A mesma reação devolve a publicação como estava. Vale
 * para a publicação da página, da Início e da tela dela (o `FanClubPostDetails`).
 */
export function withReaction<T extends FanClubPost>(post: T, next: FanClubReaction | null): T {
  const before = post.myReaction ?? null;
  if (before === next) return post;
  const counts = { ...emptyReactionCounts(), ...post.reactionCounts };
  if (before !== null) counts[before] = Math.max(0, counts[before] - 1);
  if (next !== null) counts[next] += 1;
  const delta = (next === null ? 0 : 1) - (before === null ? 0 : 1);
  return {
    ...post,
    myReaction: next,
    reactionCount: Math.max(0, (post.reactionCount ?? 0) + delta),
    reactionCounts: counts,
  };
}

/**
 * Até 3 emojis, os mais usados na publicação, do mais usado ao menos; no
 * empate, na ordem da fileira. Sem contagem, nenhum.
 */
export function topReactions(
  counts: FanClubReactionCounts | undefined,
  max: number = TOP_REACTIONS_MAX,
): FanClubReaction[] {
  if (!counts) return [];
  return FAN_CLUB_REACTIONS.filter((reaction) => counts[reaction] > 0)
    .map((reaction, order) => ({ reaction, order, count: counts[reaction] }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, max)
    .map(({ reaction }) => reaction);
}

/** O nome da ação do leitor de tela que reage com o emoji. */
export const reactActionName = (reaction: FanClubReaction): string =>
  `${REACT_ACTION_PREFIX}${reaction}`;

/** O emoji de uma ação do leitor de tela ("react-fire"), ou null para as outras. */
export function reactionOfAction(actionName: string): FanClubReaction | null {
  if (!actionName.startsWith(REACT_ACTION_PREFIX)) return null;
  const reaction = actionName.slice(REACT_ACTION_PREFIX.length);
  return isFanClubReaction(reaction) ? reaction : null;
}
