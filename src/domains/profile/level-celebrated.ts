// As missões pelo arquivo, sem o index: este arquivo fica sem React nem API.
import { noteRewardsCelebrated } from '@/domains/missions/celebrated';
import type { ActionRewards } from '@/domains/missions/types';

/**
 * Os níveis que já festejaram na própria ação (o toque `levelUp` e o anúncio
 * saíram do "+N" de curtir, comentar, "Eu vou" ou entrar), em memória e por
 * fã (22.12). O `useLevelUp` da 1e continua acendendo o selo, mas pula o
 * toque e o anúncio do nível já marcado. Fica num arquivo sem React nem API:
 * os domínios das ações importam daqui direto, fora do index, como o
 * `profile/keys`.
 */
const celebrated = new Set<string>();

const keyOf = (uid: string | null, number: number) => `${uid ?? ''}:${number}`;

export function noteLevelCelebrated(uid: string | null, number: number): void {
  celebrated.add(keyOf(uid, number));
}

export function wasLevelCelebrated(uid: string | null, number: number): boolean {
  return celebrated.has(keyOf(uid, number));
}

/** Esquece tudo (fim da sessão e testes). */
export function resetCelebratedLevels(): void {
  celebrated.clear();
}

/**
 * Marca o que a resposta de uma ação já festejou no "+N" ou no anúncio dela:
 * as missões concluídas (`missions/celebrated`) e o nível novo deste fã.
 */
export function noteActionCelebrated(
  rewards: ActionRewards | null | undefined,
  uid: string | null,
): void {
  noteRewardsCelebrated(rewards);
  if (rewards?.levelUp) noteLevelCelebrated(uid, rewards.levelUp.number);
}
