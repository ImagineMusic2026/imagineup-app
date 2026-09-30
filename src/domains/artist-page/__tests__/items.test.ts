import { buildAgendaEventsFixture } from '@/domains/agenda/fixtures';
import { buildMissionsFixture } from '@/domains/missions/fixtures';
import { missionsOfArtist } from '@/domains/missions';
import { buildPostsFixture } from '@/domains/posts/fixtures';
import { buildLeaderboardPageFixture } from '@/domains/ranking/fixtures';

import {
  agendaItems,
  artistListItems,
  gapBetween,
  missionItems,
  muralItems,
  postRows,
  rankingItems,
  type ArtistListItem,
} from '../items';

// Os índices dos domínios puxam telas com Firebase, que o Jest não roda (ESM).
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({ getFirebaseAuth: () => ({}), getDb: () => ({}) }));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  dataSource: 'fixtures',
  firebaseEmulatorHost: undefined,
}));

// Relógio fixo: terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

const types = (items: readonly ArtistListItem[]) => items.map((item) => item.type);

describe('Mural', () => {
  const netto = buildPostsFixture(NOW).filter((post) => post.artist.id === 'netto-brito');

  it('os posts vão em linhas de três, e a última pode vir incompleta', () => {
    const rows = postRows([...netto, netto[0]!].slice(0, 7));
    expect(rows.map((row) => row.length)).toEqual([3, 3, 1]);
  });

  it('começa pelo card de top fãs e segue com a grade', () => {
    const items = muralItems(netto, 'ready');
    expect(types(items)).toEqual(['topFans', 'postRow', 'postRow']);
  });

  it('carregando, com erro ou sem post, o card de top fãs fica e o estado vem embaixo', () => {
    expect(muralItems([], 'loading').map((item) => item.key)).toEqual([
      'top-fans',
      'mural-loading',
    ]);
    expect(muralItems([], 'error').map((item) => item.key)).toEqual(['top-fans', 'mural-error']);
    expect(muralItems([], 'ready').map((item) => item.key)).toEqual(['top-fans', 'mural-empty']);
  });
});

describe('Missões', () => {
  it('só as desta central, no desenho da 1g: a sobrelinha, a destacada em lima e as linhas', () => {
    const missions = missionsOfArtist(buildMissionsFixture(NOW).missions, 'netto-brito');
    expect(missions.map((mission) => mission.id)).toEqual([
      'm-clipe-netto',
      'm-comentar-central',
      'm-relampago-show',
    ]);
    expect(types(missionItems(missions, NOW, 'ready'))).toEqual([
      'missionLabel',
      'featuredMission',
      'mission',
      'mission',
    ]);
  });

  it('central sem missão mostra o vazio', () => {
    const missions = missionsOfArtist(buildMissionsFixture(NOW).missions, 'rock-salles');
    expect(missionItems(missions, NOW, 'ready').map((item) => item.key)).toEqual([
      'missions-empty',
    ]);
  });
});

describe('Agenda', () => {
  it('os shows em que o artista toca, com a sobrelinha de cada mês e sem destaque', () => {
    const events = buildAgendaEventsFixture(NOW).filter((event) =>
      event.artists.some((artist) => artist.id === 'netto-brito'),
    );
    const items = agendaItems(events, NOW, 'ready');
    expect(
      items.map((item) =>
        item.type === 'month' ? item.label : item.type === 'event' ? item.event.id : item.type,
      ),
    ).toEqual(['Outubro', 'sao-joao-irara', 'pra-encher-e-derramar', 'Janeiro', 'verao-arrochado']);
  });

  it('sem show, o vazio', () => {
    expect(agendaItems([], NOW, 'ready').map((item) => item.key)).toEqual(['agenda-empty']);
  });
});

describe('Ranking', () => {
  it('a linha da temporada e todas as posições da central, a partir do 1º', () => {
    const { items: entries } = buildLeaderboardPageFixture(
      { kind: 'artist', artistId: 'netto-brito' },
      null,
    );
    const items = rankingItems(entries, 'ready');
    expect(items[0]?.type).toBe('season');
    expect(items.slice(1).map((item) => (item.type === 'rank' ? item.entry.position : 0))).toEqual(
      entries.map((entry) => entry.position),
    );
    expect(items[1]?.type === 'rank' && items[1].entry.position).toBe(1);
  });

  it('carregando, a temporada fica e o esqueleto vem embaixo', () => {
    expect(rankingItems([], 'loading').map((item) => item.key)).toEqual([
      'season',
      'ranking-loading',
    ]);
  });
});

describe('a lista inteira', () => {
  it('as abas vêm sempre primeiro: são o item que gruda', () => {
    expect(artistListItems(muralItems([], 'loading'))[0]).toEqual({ type: 'tabs', key: 'tabs' });
  });

  it('os vãos seguem o desenho de cada tela de origem', () => {
    const [post] = buildPostsFixture(NOW);
    const row: ArtistListItem = { type: 'postRow', key: 'r', posts: [post!] };
    const tabs: ArtistListItem = { type: 'tabs', key: 'tabs' };
    const fans: ArtistListItem = { type: 'topFans', key: 'top-fans' };
    const label: ArtistListItem = { type: 'month', key: 'm', label: 'Outubro' };
    expect(gapBetween(row, row)).toBe('iconLabelGap');
    expect(gapBetween(fans, row)).toBe('cardPadding');
    expect(gapBetween(tabs, fans)).toBeNull();
    expect(gapBetween(label, row)).toBeNull();
  });
});
