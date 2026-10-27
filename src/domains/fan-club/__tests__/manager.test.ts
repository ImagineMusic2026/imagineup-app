import {
  managerTabOf,
  POST_FILTER_KEYS,
  POST_FILTERS,
  postBlockOf,
  postFilterOf,
  postsIn,
} from '../manager';
import type { FanClubPostStatus, MyFanClubClub, OwnFanClubPost } from '../types';

const club = (patch: Partial<MyFanClubClub> = {}): MyFanClubClub => ({
  id: 'fc-1',
  name: 'Netto de Coração',
  artistId: 'nettobrito',
  artistName: 'Netto Brito',
  status: 'active',
  postCount: 2,
  pendingPosts: 1,
  photosAllowed: true,
  featuredUntil: null,
  official: false,
  lastReward: null,
  available: true,
  unavailableReason: null,
  rulesOutdated: false,
  ...patch,
});

const post = (id: string, status: FanClubPostStatus): OwnFanClubPost => ({
  id,
  clubId: 'fc-1',
  artistId: 'nettobrito',
  kind: 'text',
  text: id,
  photo: null,
  thumb: null,
  status,
  rejectReason: null,
  submittedAt: '2026-10-19T15:00:00.000Z',
  publishedAt: null,
  reviewedAt: null,
});

describe('managerTabOf', () => {
  it.each([
    ['painel', 'painel'],
    ['publicacoes', 'publicacoes'],
    ['premios', 'premios'],
    ['conta', 'conta'],
    [undefined, 'painel'],
    ['membros', 'painel'],
    [['conta'], 'painel'],
  ])('%p vira %p', (value, expected) => {
    expect(managerTabOf(value)).toBe(expected);
  });
});

describe('postFilterOf', () => {
  it.each([
    ['no-ar', 'no-ar'],
    ['em-analise', 'em-analise'],
    ['recusadas', 'recusadas'],
    ['outras', 'outras'],
    [undefined, 'no-ar'],
    ['agendados', 'no-ar'],
  ])('%p vira %p', (value, expected) => {
    expect(postFilterOf(value)).toBe(expected);
  });
});

describe('os filtros de Publicações', () => {
  it('cada status do contrato cai em um filtro só, e nenhum fica de fora', () => {
    const statuses: FanClubPostStatus[] = [
      'pending',
      'published',
      'rejected',
      'withdrawn',
      'hidden',
      'removed',
    ];
    for (const status of statuses) {
      const filters = POST_FILTER_KEYS.filter((key) =>
        (POST_FILTERS[key] as readonly FanClubPostStatus[]).includes(status),
      );
      expect([status, filters.length]).toEqual([status, 1]);
    }
  });

  it('separa as publicações pelo filtro, na ordem em que vieram', () => {
    const posts = [
      post('a', 'published'),
      post('b', 'pending'),
      post('c', 'rejected'),
      post('d', 'withdrawn'),
      post('e', 'published'),
      post('f', 'hidden'),
      post('g', 'removed'),
    ];
    const ids = (filter: Parameters<typeof postsIn>[1]) => postsIn(posts, filter).map((p) => p.id);
    expect(ids('no-ar')).toEqual(['a', 'e']);
    expect(ids('em-analise')).toEqual(['b']);
    expect(ids('recusadas')).toEqual(['c']);
    expect(ids('outras')).toEqual(['d', 'f', 'g']);
  });
});

describe('postBlockOf', () => {
  it('no ar, com o regulamento em dia e vaga, o "+" abre a nova publicação', () => {
    expect(postBlockOf(club())).toBeNull();
    expect(postBlockOf(club({ pendingPosts: 2 }))).toBeNull();
  });

  it.each([
    ['paused', 'fanClub.unavailable.paused'],
    ['artist_off', 'fanClub.unavailable.artistOff'],
    ['program_closed', 'fanClub.unavailable.programClosed'],
    ['not_member', 'fanClub.unavailable.notMember'],
    ['closed', 'fanClub.unavailable.closed'],
  ] as const)('fora do ar (%s), o motivo do aviso', (reason, key) => {
    expect(postBlockOf(club({ available: false, unavailableReason: reason }))).toEqual({
      kind: 'unavailable',
      key,
    });
  });

  it('fora do ar sem motivo, a frase de que não dá para publicar', () => {
    expect(postBlockOf(club({ available: false }))).toEqual({
      kind: 'unavailable',
      key: 'fanClub.newPost.unavailable',
    });
  });

  it('a ordem do servidor: fora do ar, depois o regulamento, depois as 3 em análise', () => {
    expect(
      postBlockOf(
        club({
          available: false,
          unavailableReason: 'paused',
          rulesOutdated: true,
          pendingPosts: 3,
        }),
      )?.kind,
    ).toBe('unavailable');
    expect(postBlockOf(club({ rulesOutdated: true, pendingPosts: 3 }))).toEqual({ kind: 'rules' });
    expect(postBlockOf(club({ pendingPosts: 3 }))).toEqual({ kind: 'full' });
  });
});
