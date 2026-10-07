import { describeRewards, rewardsRefresh } from '../describe-rewards';
import type { ActionRewards } from '../types';

const MISSION = {
  id: 'm-curtir-nenho',
  title: 'Curta 5 posts do Nenho',
  rewardPoints: 10,
  completedAt: '2026-10-05T22:31:04.000Z',
};
const LEVEL = { number: 8, name: 'Xodó', minXp: 15_000 };
const SHOW = { id: 'fa-de-show', title: 'Fã de show' };

describe('a frase e o toque do que a ação rendeu (describeRewards)', () => {
  it.each<[string, number, ActionRewards | undefined, string | null, string]>([
    ['só pontos', 2, undefined, 'Mais 2 pontos.', 'pointsEarned'],
    ['um ponto', 1, {}, 'Mais 1 ponto.', 'pointsEarned'],
    [
      'pontos e missão',
      11,
      { completedMissions: [MISSION] },
      'Mais 11 pontos. Missão concluída: Curta 5 posts do Nenho.',
      'missionComplete',
    ],
    [
      'missão e nível',
      21,
      { completedMissions: [MISSION], levelUp: LEVEL },
      'Mais 21 pontos. Missão concluída: Curta 5 posts do Nenho. Você subiu para o nível 8, Xodó.',
      'levelUp',
    ],
    [
      'tudo',
      21,
      { completedMissions: [MISSION], levelUp: LEVEL, unlockedAchievements: [SHOW] },
      'Mais 21 pontos. Missão concluída: Curta 5 posts do Nenho. Você subiu para o nível 8, Xodó. Conquista nova: Fã de show.',
      'levelUp',
    ],
    [
      'conquista sem pontos (o "Eu vou" valendo 0)',
      0,
      { unlockedAchievements: [SHOW] },
      'Conquista nova: Fã de show.',
      'pointsEarned',
    ],
    ['nada', 0, { completedMissions: [], unlockedAchievements: [] }, null, 'pointsEarned'],
  ])('%s', (_name, points, rewards, announcement, haptic) => {
    expect(describeRewards(points, rewards)).toEqual({ announcement, haptic });
  });
});

describe('o que buscar de novo (rewardsRefresh)', () => {
  it.each<[string, ActionRewards | undefined, { missions: boolean; achievements: boolean }]>([
    [
      'sem o campo (as fixtures): as missões buscam',
      undefined,
      { missions: true, achievements: false },
    ],
    ['missionsChanged: true', { missionsChanged: true }, { missions: true, achievements: false }],
    [
      'missionsChanged: false',
      { missionsChanged: false },
      { missions: false, achievements: false },
    ],
    [
      'conquista nova',
      { missionsChanged: false, unlockedAchievements: [SHOW] },
      { missions: false, achievements: true },
    ],
    [
      'subida de nível',
      { missionsChanged: false, levelUp: LEVEL },
      { missions: false, achievements: true },
    ],
  ])('%s', (_name, rewards, expected) => {
    expect(rewardsRefresh(rewards)).toEqual(expected);
  });
});
