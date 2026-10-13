import type { AgendaEvent, AgendaPage } from '@/domains/agenda';
import type { Artist, FanCentral } from '@/domains/artists';

import { exploreCentrals, showcaseOf } from '../showcase';

// O build do Firebase que o Jest resolve é ESM. A vitrine não fala com ele, mas
// o `isUpcoming` e a busca vêm dos index da agenda e dos artistas, que chegam à API.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

const show = (id: string, startsAt: Date): AgendaEvent => ({
  id,
  title: id,
  artists: [],
  city: 'Salvador',
  state: 'BA',
  startsAt: startsAt.toISOString(),
  imageUrl: null,
  invitePointsPerSignup: null,
});

const yesterday = show('ontem', new Date(2026, 8, 28, 22));
// O show de hoje fica até o dia virar, mesmo depois da hora de começo.
const today = show('hoje', new Date(2026, 8, 29, 18));
const oct3 = show('3-out', new Date(2026, 9, 3, 22));
const oct21 = show('21-out', new Date(2026, 9, 21, 22));
const oct28 = show('28-out', new Date(2026, 9, 28, 21));
const nov12 = show('12-nov', new Date(2026, 10, 12, 20));

const page = (featured: AgendaEvent | null, items: AgendaEvent[]): AgendaPage => ({
  featured,
  items,
  nextCursor: null,
});

const ids = (events: readonly AgendaEvent[]) => events.map((event) => event.id);

describe('próximos shows da vitrine', () => {
  it.each([
    [
      'o destaque marcado e os três seguintes, sem repetir o destaque',
      page(oct21, [oct3, oct21, oct28, nov12]),
      '21-out',
      ['3-out', '28-out', '12-nov'],
    ],
    [
      'no máximo três linhas, em ordem de data, sem show passado nem repetido',
      page(null, [nov12, yesterday, oct28, today, oct3, oct28, oct21]),
      null,
      ['hoje', '3-out', '21-out'],
    ],
    [
      'o destaque que já passou sai, e as linhas ficam',
      page(yesterday, [yesterday, oct3]),
      null,
      ['3-out'],
    ],
    ['o destaque sozinho, fora das linhas', page(oct21, []), '21-out', []],
    ['nenhum show por vir', page(yesterday, [yesterday]), null, []],
  ])('%s', (_case, agenda, featured, rows) => {
    const shows = showcaseOf(agenda, NOW);
    expect(shows.featured?.id ?? null).toBe(featured);
    expect(ids(shows.rows)).toEqual(rows);
  });

  it('o máximo de linhas é de quem chama', () => {
    expect(ids(showcaseOf(page(null, [oct3, oct21, oct28]), NOW, 1).rows)).toEqual(['3-out']);
  });
});

describe('a grade das centrais', () => {
  const artist = (id: string, name: string, order: number, fanCount: number): Artist => ({
    id,
    name,
    photoURL: null,
    fanCount,
    order,
  });
  const artists = [
    artist('rock', 'Rock Salles', 2, 96_000),
    artist('netto', 'Netto Brito', 0, 412_000),
    artist('angela', 'Ângela Maria', 1, 10),
  ];
  const mine: FanCentral[] = [
    {
      artistId: 'netto',
      name: 'Netto Brito',
      shortName: null,
      photoURL: null,
      fanCount: 412_001,
      fanRank: 12,
      seasonPoints: 4_120,
    },
  ];

  it('na ordem de destaque, com a marca e o número de fãs das centrais do fã', () => {
    expect(exploreCentrals(artists, mine, '')).toEqual([
      { artist: { ...artists[1], fanCount: 412_001 }, member: true },
      { artist: artists[2], member: false },
      { artist: artists[0], member: false },
    ]);
  });

  it('sem as centrais do fã ainda, ninguém tem a marca', () => {
    expect(exploreCentrals(artists, undefined, '').map((item) => item.member)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it.each([
    ['angela', ['angela']],
    ['NETTO', ['netto']],
    ['  rock  ', ['rock']],
    ['ninguém', []],
  ])('a busca "%s" encontra %j', (query, found) => {
    expect(exploreCentrals(artists, mine, query).map((item) => item.artist.id)).toEqual(found);
  });

  it('não mexe na lista que veio do cache', () => {
    const original = artists.map((item) => ({ ...item }));
    exploreCentrals(artists, mine, '');
    expect(artists).toEqual(original);
  });
});
