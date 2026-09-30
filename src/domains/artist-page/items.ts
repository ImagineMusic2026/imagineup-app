import { groupUpcomingByMonth, type AgendaEvent } from '@/domains/agenda';
import { buildMissionItems, type Mission, type MissionSection } from '@/domains/missions';
import type { Post } from '@/domains/posts';
import type { LeaderboardEntry } from '@/domains/ranking';

import { GRID_COLUMNS, type ArtistTab } from './consts';

/**
 * A página do artista (1d) é uma FlashList só: a capa, os números e o botão
 * no cabeçalho; as abas no primeiro item (gruda embaixo do header compacto); e
 * o conteúdo da aba escolhida depois dela. Cada tipo reaproveita só células do
 * mesmo desenho (`getItemType`).
 */

/** Como o conteúdo de uma aba está: chegando, com erro ou na tela. */
export type TabLoad = 'loading' | 'error' | 'ready';

export type TabStatus = 'loading' | 'error' | 'empty';

export type ArtistListItem =
  | { type: 'tabs'; key: 'tabs' }
  | { type: 'topFans'; key: 'top-fans' }
  | { type: 'postRow'; key: string; posts: Post[] }
  | { type: 'missionLabel'; key: string; section: MissionSection }
  | { type: 'featuredMission'; key: string; mission: Mission }
  | { type: 'mission'; key: string; mission: Mission }
  | { type: 'month'; key: string; label: string }
  | { type: 'event'; key: string; event: AgendaEvent }
  | { type: 'season'; key: 'season' }
  | { type: 'rank'; key: string; entry: LeaderboardEntry }
  | { type: 'status'; key: string; tab: ArtistTab; status: TabStatus };

export type ArtistListItemType = ArtistListItem['type'];

const TABS_ITEM: ArtistListItem = { type: 'tabs', key: 'tabs' };

function status(tab: ArtistTab, value: TabStatus): ArtistListItem {
  return { type: 'status', key: `${tab}-${value}`, tab, status: value };
}

/** Linhas de três posts, na ordem da API. A última pode vir incompleta. */
export function postRows(posts: readonly Post[]): Post[][] {
  const rows: Post[][] = [];
  for (let start = 0; start < posts.length; start += GRID_COLUMNS) {
    rows.push(posts.slice(start, start + GRID_COLUMNS));
  }
  return rows;
}

/** Mural: o card de top fãs e a grade de posts. */
export function muralItems(posts: readonly Post[], load: TabLoad): ArtistListItem[] {
  const items: ArtistListItem[] = [{ type: 'topFans', key: 'top-fans' }];
  if (load !== 'ready') return [...items, status('mural', load)];
  if (posts.length === 0) return [...items, status('mural', 'empty')];
  for (const row of postRows(posts)) {
    items.push({
      type: 'postRow',
      key: `posts-${row.map((post) => post.id).join('+')}`,
      posts: row,
    });
  }
  return items;
}

/** Missões desta central no desenho da 1g: "Hoje" e "Esta semana", com a destacada em lima. */
export function missionItems(
  missions: readonly Mission[],
  now: Date,
  load: TabLoad,
): ArtistListItem[] {
  if (load !== 'ready') return [status('missions', load)];
  const items = buildMissionItems(missions, now).map((item): ArtistListItem => {
    switch (item.type) {
      case 'label':
        return { type: 'missionLabel', key: item.key, section: item.section };
      case 'featured':
        return { type: 'featuredMission', key: `featured-${item.key}`, mission: item.mission };
      case 'mission':
        return { type: 'mission', key: `mission-${item.key}`, mission: item.mission };
    }
  });
  return items.length > 0 ? items : [status('missions', 'empty')];
}

/** Shows desta central no desenho da 1m: cada mês com a sua sobrelinha. */
export function agendaItems(
  events: readonly AgendaEvent[],
  now: Date,
  load: TabLoad,
): ArtistListItem[] {
  if (load !== 'ready') return [status('agenda', load)];
  const items: ArtistListItem[] = [];
  for (const month of groupUpcomingByMonth(events, now)) {
    items.push({ type: 'month', key: `month-${month.key}`, label: month.label });
    for (const event of month.events) {
      items.push({ type: 'event', key: `event-${event.id}`, event });
    }
  }
  return items.length > 0 ? items : [status('agenda', 'empty')];
}

/** O ranking da temporada nesta central no desenho da 1f: a temporada e as posições. */
export function rankingItems(
  entries: readonly LeaderboardEntry[],
  load: TabLoad,
): ArtistListItem[] {
  const items: ArtistListItem[] = [{ type: 'season', key: 'season' }];
  if (load !== 'ready') return [...items, status('ranking', load)];
  if (entries.length === 0) return [...items, status('ranking', 'empty')];
  return [
    ...items,
    ...entries.map((entry): ArtistListItem => ({
      type: 'rank',
      key: `rank-${entry.userId}`,
      entry,
    })),
  ];
}

/** A lista inteira: as abas e o conteúdo da escolhida. */
export function artistListItems(content: readonly ArtistListItem[]): ArtistListItem[] {
  return [TABS_ITEM, ...content];
}

/**
 * O vão entre dois itens, pelo desenho de cada tela de origem: 5 entre as
 * linhas da grade (1d), 14 do card de top fãs à grade, 10 entre cards (1g e
 * 1m). As sobrelinhas trazem o próprio respiro, e as linhas do ranking são
 * divididas por traço, sem vão.
 */
export function gapBetween(leading: ArtistListItem, trailing: ArtistListItem): GapToken | null {
  if (leading.type === 'tabs') return null;
  if (trailing.type === 'missionLabel' || trailing.type === 'month') return null;
  if (leading.type === 'missionLabel' || leading.type === 'month') return null;
  if (leading.type === 'postRow' && trailing.type === 'postRow') return 'iconLabelGap';
  if (leading.type === 'topFans') return 'cardPadding';
  if (
    (leading.type === 'mission' || leading.type === 'featuredMission') &&
    (trailing.type === 'mission' || trailing.type === 'featuredMission')
  ) {
    return 'listGap';
  }
  if (leading.type === 'event' && trailing.type === 'event') return 'listGap';
  return null;
}

export type GapToken = 'iconLabelGap' | 'cardPadding' | 'listGap';
