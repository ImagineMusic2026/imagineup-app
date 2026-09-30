import { buildMissionsFixture } from '@/domains/missions/fixtures';
import { buildPostsFixture } from '@/domains/posts/fixtures';
import { buildRewardsFixture } from '@/domains/rewards/fixtures';
import { api } from '@/services/api';

import { fetchAgenda } from '../api';
import { AGENDA_PAGE_SIZE, buildAgendaEventsFixture, buildAgendaPageFixture } from '../fixtures';
import { groupByMonth } from '../group-by-month';

// O build do Firebase que o Jest resolve é ESM; a agenda não fala com ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));

let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  get dataSource() {
    return mockDataSource;
  },
}));

const get = jest.mocked(api.get);

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
});

describe('agenda de exemplo', () => {
  it('traz os shows do protótipo nos meses seguintes, em ordem de data', () => {
    const events = buildAgendaEventsFixture(NOW);
    expect(events.slice(0, AGENDA_PAGE_SIZE).map(({ id, startsAt }) => [id, startsAt])).toEqual([
      ['arrocha-na-praia', new Date(2026, 9, 3, 22).toISOString()],
      ['sao-joao-irara', new Date(2026, 9, 21, 22).toISOString()],
      ['pra-encher-e-derramar', new Date(2026, 9, 28, 21).toISOString()],
      ['festa-do-vaqueiro', new Date(2026, 10, 12, 20).toISOString()],
      ['vaquejada-de-serrinha', new Date(2026, 11, 2, 22).toISOString()],
      ['arrocha-do-nenho', new Date(2026, 11, 16, 22).toISOString()],
    ]);
    for (const event of events) {
      expect(Date.parse(event.startsAt)).toBeGreaterThan(NOW.getTime());
      expect(event.imageUrl).toBeNull();
    }
  });

  it('o destaque é o São João de Irará: o mesmo da missão de presença e do meet & greet', () => {
    const page = buildAgendaPageFixture(NOW, null);
    const { featured } = groupByMonth(page.items, NOW, page.featured);
    expect(featured).toBe(page.featured);
    expect(featured).toMatchObject({
      id: 'sao-joao-irara',
      title: 'São João de Irará',
      artists: [
        { id: 'netto-brito', name: 'Netto Brito' },
        { id: 'nenho', name: 'Nenho' },
      ],
      city: 'Irará',
      state: 'BA',
    });

    const rsvpMission = buildMissionsFixture(NOW).missions.find(({ action }) => action === 'rsvp');
    expect(rsvpMission?.target).toEqual({ eventId: featured?.id });
    expect(rsvpMission?.event).toEqual({ name: featured?.title, startsAt: featured?.startsAt });

    const [meet] = buildRewardsFixture(NOW).rewards;
    expect(meet?.event).toEqual({ name: featured?.title, startsAt: featured?.startsAt });
  });

  it('o show do post do Nenho na home é o Arrocha na Praia da agenda, na mesma data', () => {
    const post = buildPostsFixture(NOW).find(({ kind }) => kind === 'event');
    const show = buildAgendaEventsFixture(NOW).find(({ id }) => id === post?.event?.id);
    expect(show).toBeDefined();
    expect(post?.event).toEqual({
      id: show?.id,
      title: show?.title,
      startsAt: show?.startsAt,
      city: `${show?.city}, ${show?.state}`,
    });
  });

  it('o convite de cada show rende pontos por cadastro (exemplo; vem do painel)', () => {
    for (const event of buildAgendaEventsFixture(NOW)) {
      expect(event.invitePointsPerSignup).toBe(10);
    }
  });

  it('a primeira página traz os próximos meses e a segunda, o resto', () => {
    const first = buildAgendaPageFixture(NOW, null);
    expect(first.items).toHaveLength(AGENDA_PAGE_SIZE);
    expect(first.nextCursor).toBe(String(AGENDA_PAGE_SIZE));

    // O destaque vem só na primeira, fora da paginação.
    expect(first.featured?.id).toBe('sao-joao-irara');

    const second = buildAgendaPageFixture(NOW, first.nextCursor);
    expect(second.featured).toBeNull();
    expect(second.items.map(({ id }) => id)).toEqual([
      'verao-arrochado',
      'festival-do-sertao',
      'carnaval-do-nenho',
    ]);
    expect(second.nextCursor).toBeNull();
  });
});

describe('agenda pela API', () => {
  it('nas fixtures, a página vem sem rede', async () => {
    const page = await fetchAgenda(null);
    expect(page.items.length).toBeGreaterThan(0);
    expect(get).not.toHaveBeenCalled();
  });

  it('com a API, a página vem de /agenda com o cursor', async () => {
    mockDataSource = 'api';
    const empty = { featured: null, items: [], nextCursor: null };
    get.mockResolvedValue({ data: empty });
    await expect(fetchAgenda('6')).resolves.toEqual(empty);
    expect(get).toHaveBeenCalledWith('/agenda', { params: { cursor: '6' } });
  });
});
