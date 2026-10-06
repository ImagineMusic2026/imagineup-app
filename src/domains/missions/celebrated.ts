import type { ActionRewards } from './types';

/**
 * As missões que já festejaram na própria ação (o toque e o anúncio saíram
 * do "+N" de curtir, comentar, "Eu vou" ou entrar), em memória (22.12). A 1g
 * e a missão do dia da home continuam com o desenho delas (o check, o "+N",
 * o pulso), mas pulam o toque e o anúncio do que já foi marcado aqui: o fã não
 * ouve duas vezes. O que concluiu sem o fã ver (a missão de link de quem
 * convidou) festeja como antes, quando ele abre a tela.
 */
const celebrated = new Set<string>();

const keyOf = (missionId: string, completedAt: string | null) =>
  `${missionId}:${completedAt ?? ''}`;

export function noteMissionCelebrated(missionId: string, completedAt: string): void {
  celebrated.add(keyOf(missionId, completedAt));
}

export function wasMissionCelebrated(missionId: string, completedAt: string | null): boolean {
  return completedAt !== null && celebrated.has(keyOf(missionId, completedAt));
}

/** Marca as missões concluídas que a resposta da ação trouxe. */
export function noteRewardsCelebrated(rewards?: ActionRewards | null): void {
  for (const mission of rewards?.completedMissions ?? []) {
    noteMissionCelebrated(mission.id, mission.completedAt);
  }
}

/** Esquece tudo (fim da sessão e testes). */
export function resetCelebratedMissions(): void {
  celebrated.clear();
}
