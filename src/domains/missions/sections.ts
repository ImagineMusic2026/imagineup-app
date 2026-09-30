import { isMissionOver } from './describe-mission';
import type { Mission, MissionPeriod } from './types';

export type MissionSection = 'today' | 'week';

/**
 * Célula da lista da 1g. Cada tipo reaproveita só células do mesmo desenho
 * (`getItemType`): sobrelinha, card lima e linha.
 */
export type MissionListItem =
  | { type: 'label'; key: string; section: MissionSection }
  | { type: 'featured'; key: string; mission: Mission }
  | { type: 'mission'; key: string; mission: Mission };

const SECTIONS: readonly { section: MissionSection; period: MissionPeriod }[] = [
  { section: 'today', period: 'daily' },
  { section: 'week', period: 'weekly' },
];

/**
 * "Hoje" e "Esta semana", na ordem do painel, com a destacada no topo da sua
 * seção. Missão aberta com o prazo vencido sai na hora; seção sem missão some
 * com a sobrelinha.
 */
export function buildMissionItems(missions: readonly Mission[], now: Date): MissionListItem[] {
  const items: MissionListItem[] = [];
  for (const { section, period } of SECTIONS) {
    const current = missions.filter(
      (mission) => mission.period === period && !isMissionOver(mission, now),
    );
    if (current.length === 0) continue;
    items.push({ type: 'label', key: `section-${section}`, section });
    for (const mission of current.filter((item) => item.featured)) {
      items.push({ type: 'featured', key: mission.id, mission });
    }
    for (const mission of current.filter((item) => !item.featured)) {
      items.push({ type: 'mission', key: mission.id, mission });
    }
  }
  return items;
}

/**
 * As missões de uma central (aba Missões da 1d): as que o painel ligou ao
 * artista, na ordem dele. Passam depois por `buildMissionItems`, como na 1g.
 */
export function missionsOfArtist(missions: readonly Mission[], artistId: string): Mission[] {
  return missions.filter((mission) => mission.target?.artistId === artistId);
}
