import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { artistKeys } from '@/domains/artists';
import { missionKeys, missionsFixture } from '@/domains/missions';
import { wasMissionCelebrated } from '@/domains/missions/celebrated';
import { RSVP_MISSION_POINTS as FIRST_RSVP_POINTS } from '@/domains/missions/fixtures';
import { profileKeys } from '@/domains/profile';
import { GLOBAL_SCOPE, rankingKeys } from '@/domains/ranking';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

import { fetchMyRsvps, setEventRsvp } from '../api';
import { RsvpChip } from '../components/rsvp-button';
import { rsvpFixture } from '../fixtures';
import {
  agendaKeys,
  agendaMutationKeys,
  registerAgendaMutationDefaults,
  useAgendaQuery,
  useArtistAgendaQuery,
  useIsGoing,
  useMyRsvpsQuery,
} from '../queries';

// O build do Firebase que o Jest resolve é ESM. A presença não fala com ele, mas
// invalida a carteira do domínio de perfil, que lê o Firestore.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));

// Lido na hora da chamada: cada teste escolhe a fonte.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const get = jest.mocked(api.get);
const request = jest.mocked(api.request);

// A pílula "+N" fica fora do leitor, e as consultas padrão ignoram o que o leitor não vê.
const hidden = { includeHiddenElements: true } as const;

const EVENT = { id: 'arrocha-na-praia', title: 'Arrocha na Praia' };
const goLabel = t('agenda.rsvp.label', { status: t('agenda.rsvp.go'), show: EVENT.title });
const goingLabel = t('agenda.rsvp.label', { status: t('agenda.rsvp.going'), show: EVENT.title });
// O show alvo da missão de presença (bloco 7): só a presença nele rende os pontos dela.
const TARGET = { id: 'sao-joao-irara', title: 'São João de Irará' };
const targetGoLabel = t('agenda.rsvp.label', { status: t('agenda.rsvp.go'), show: TARGET.title });
const targetGoingLabel = t('agenda.rsvp.label', {
  status: t('agenda.rsvp.going'),
  show: TARGET.title,
});

let client: QueryClient;
let announce: jest.SpyInstance;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  rsvpFixture.reset();
  missionsFixture.reset();
  fixtureWallet.reset();
  // Sem prazo de coleta: os timers dele deixariam o Jest aberto depois dos testes.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  jest.restoreAllMocks();
});

describe('presença nas fixtures', () => {
  it('a primeira confirmação rende os pontos da missão, uma vez só', () => {
    expect(rsvpFixture.set('sao-joao-irara', true, 'k1')).toEqual({
      eventId: 'sao-joao-irara',
      going: true,
      pointsAwarded: FIRST_RSVP_POINTS,
    });
    expect(rsvpFixture.set('festa-do-vaqueiro', true, 'k2').pointsAwarded).toBe(0);
    expect(fixtureWallet.get().balance).toBe(12_480 + FIRST_RSVP_POINTS);
    expect(rsvpFixture.mine().eventIds).toEqual(['sao-joao-irara', 'festa-do-vaqueiro']);
  });

  it('desfazer tira da lista e não rende ponto', () => {
    rsvpFixture.set('sao-joao-irara', true, 'k1');
    expect(rsvpFixture.set('sao-joao-irara', false, 'k2')).toEqual({
      eventId: 'sao-joao-irara',
      going: false,
      pointsAwarded: 0,
    });
    expect(rsvpFixture.mine().eventIds).toEqual([]);
  });

  it('a mesma chave de novo devolve a primeira resposta, sem contar outra vez', () => {
    const first = rsvpFixture.set('sao-joao-irara', true, 'k1');
    expect(rsvpFixture.set('sao-joao-irara', true, 'k1')).toEqual(first);
    expect(fixtureWallet.get().balance).toBe(12_480 + FIRST_RSVP_POINTS);
  });

  it('show que não está na agenda é recusado, como a API faria, sem contar na missão', () => {
    expect(() => rsvpFixture.set('show-que-nao-existe', true, 'k1')).toThrow(
      expect.objectContaining({ kind: 'notFound', status: 404 }),
    );
    expect(rsvpFixture.mine().eventIds).toEqual([]);
    expect(fixtureWallet.get().balance).toBe(12_480);
  });
});

describe('presença na API', () => {
  it('com a API, confirmar é PUT e desfazer é DELETE, com a chave de idempotência', async () => {
    mockDataSource = 'api';
    request.mockResolvedValue({ data: { eventId: 'show-a', going: true, pointsAwarded: 15 } });

    await setEventRsvp({ eventId: 'show-a', going: true, idempotencyKey: 'k1' });
    await setEventRsvp({ eventId: 'show-a', going: false, idempotencyKey: 'k2' });

    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'PUT',
      url: '/events/show-a/rsvp',
      headers: { 'Idempotency-Key': 'k1' },
    });
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: 'DELETE' }));
  });

  it('com a API, a lista vem de /me/rsvps', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { eventIds: ['show-a'] } });
    await expect(fetchMyRsvps()).resolves.toEqual({ eventIds: ['show-a'] });
    expect(get).toHaveBeenCalledWith('/me/rsvps');
  });
});

describe('"Eu vou" com o servidor (bloco 7)', () => {
  it('a primeira presença que destrava uma conquista sem pontos só anuncia, sem "+N"', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { eventIds: [] } });
    request.mockResolvedValue({
      data: {
        eventId: EVENT.id,
        going: true,
        pointsAwarded: 0,
        completedMissions: [],
        levelUp: null,
        unlockedAchievements: [{ id: 'fa-de-show', title: 'Fã de show' }],
        missionsChanged: false,
      },
    });
    client.setQueryData(missionKeys.list(), { season: null, missions: [] });
    client.setQueryData(profileKeys.achievements(), {
      unlockedCount: 0,
      totalCount: 10,
      highlights: [],
    });
    client.setQueryData(profileKeys.wallet(), { balance: 0, xp: 0, seasonPoints: 0 });
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: goLabel }));

    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Conquista nova: Fã de show.',
        { queue: true },
      ),
    );
    expect(screen.queryByText(/^\+\d/, hidden)).toBeNull();
    expect(client.getQueryState(profileKeys.achievements())?.isInvalidated).toBe(true);
    // Nenhuma missão andou: a 1g não busca de novo, e o saldo fica.
    expect(client.getQueryState(missionKeys.list())?.isInvalidated).toBe(false);
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(false);
  });

  it('com a célula reaproveitada para outro show antes da resposta, o "+N" não sobe no botão dele', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { eventIds: [] } });
    let answer: (value: unknown) => void = () => undefined;
    request.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const completedAt = '2026-10-05T22:31:04.000Z';
    const { rerender } = render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, {
      wrapper,
    });
    fireEvent.press(await screen.findByRole('button', { name: goLabel }));

    // A FlashList passa a célula para outro show com o pedido ainda indo.
    rerender(<RsvpChip eventId={TARGET.id} eventTitle={TARGET.title} />);
    await act(async () => {
      answer({
        data: {
          eventId: EVENT.id,
          going: true,
          pointsAwarded: 15,
          completedMissions: [
            { id: 'm-presenca', title: 'Confirme presença', rewardPoints: 15, completedAt },
          ],
          levelUp: null,
          unlockedAchievements: [],
          missionsChanged: true,
        },
      });
    });

    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.queryByText(/^\+\d/, hidden)).toBeNull();
    expect(haptics.trigger).not.toHaveBeenCalledWith('missionComplete');
    // Nada ficou marcado: a 1g festeja a missão quando o fã voltar a ela.
    expect(wasMissionCelebrated('m-presenca', completedAt)).toBe(false);
    expect(screen.getByRole('button', { name: targetGoLabel })).toBeTruthy();
  });
});

describe('"Eu vou" do post de show', () => {
  it('diz a que show se refere e confirma na hora, com os pontos subindo do chip', async () => {
    render(<RsvpChip eventId={TARGET.id} eventTitle={TARGET.title} />, { wrapper });
    const chip = await screen.findByRole('button', { name: targetGoLabel });
    expect(chip).not.toBeSelected();

    fireEvent.press(chip);

    // Otimista: "Confirmado" antes da resposta, e o leitor ouve.
    const confirmed = await screen.findByRole('button', { name: targetGoingLabel });
    expect(confirmed).toBeSelected();
    expect(confirmed).toHaveProp('accessibilityHint', t('agenda.rsvp.cancelHint'));
    expect(announce).toHaveBeenCalledWith(t('agenda.rsvp.confirmed'));

    expect(await screen.findByText(`+${FIRST_RSVP_POINTS}`, hidden)).toBeTruthy();
    expect(rsvpFixture.mine().eventIds).toEqual([TARGET.id]);
  });

  it('a presença que rende pontos faz o saldo, o ranking, as centrais e as missões (1b e 1g) buscarem de novo', async () => {
    client.setQueryData(profileKeys.wallet(), { balance: 12_480, xp: 12_480, seasonPoints: 4_120 });
    client.setQueryData(artistKeys.centrals(), []);
    client.setQueryData(artistKeys.detail('nenho'), null);
    client.setQueryData(rankingKeys.myRank(GLOBAL_SCOPE), {
      position: 12,
      points: 4_120,
      target: null,
    });
    client.setQueryData(missionKeys.daily(), null);
    client.setQueryData(missionKeys.list(), { season: null, missions: [] });
    render(<RsvpChip eventId={TARGET.id} eventTitle={TARGET.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: targetGoLabel }));

    await waitFor(() =>
      expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(missionKeys.daily())?.isInvalidated).toBe(true);
    // Os pontos da temporada mudaram: a posição do fã no ranking (1f) também.
    expect(client.getQueryState(rankingKeys.myRank(GLOBAL_SCOPE))?.isInvalidated).toBe(true);
    // A lista da 1g é a que festeja a missão concluída quando o fã volta a ela.
    expect(client.getQueryState(missionKeys.list())?.isInvalidated).toBe(true);
    // A posição e os pontos nas centrais ("você é #12" da 1b, "Suas centrais" da 1e).
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(true);
    // O "PTS DA CENTRAL" da 1d, que soma os pontos da central do show.
    expect(client.getQueryState(artistKeys.detail('nenho'))?.isInvalidated).toBe(true);
  });

  it('presença sem pontos (a segunda) não mexe no saldo, mas as missões buscam de novo', async () => {
    rsvpFixture.set('festa-do-vaqueiro', true, 'antes');
    client.setQueryData(profileKeys.wallet(), { balance: 12_495, xp: 12_495, seasonPoints: 4_135 });
    client.setQueryData(artistKeys.centrals(), []);
    client.setQueryData(rankingKeys.myRank(GLOBAL_SCOPE), {
      position: 12,
      points: 4_135,
      target: null,
    });
    client.setQueryData(missionKeys.list(), { season: null, missions: [] });
    client.setQueryData(artistKeys.detail('nenho'), null);
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: goLabel }));

    await waitFor(() => expect(rsvpFixture.mine().eventIds).toContain(EVENT.id));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(false);
    expect(client.getQueryState(rankingKeys.myRank(GLOBAL_SCOPE))?.isInvalidated).toBe(false);
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(false);
    expect(client.getQueryState(artistKeys.detail('nenho'))?.isInvalidated).toBe(false);
    // Uma missão de presença com meta maior que 1 anda sem concluir (e sem pontos).
    expect(client.getQueryState(missionKeys.list())?.isInvalidated).toBe(true);
  });

  it('a presença que volta da fila depois de o app reabrir também atualiza o saldo', async () => {
    registerAgendaMutationDefaults(client);
    client.setQueryData(profileKeys.wallet(), { balance: 12_480, xp: 12_480, seasonPoints: 4_120 });

    // Sem o componente montado: só as opções registradas no AppProviders.
    await client
      .getMutationCache()
      .build(client, { mutationKey: agendaMutationKeys.rsvp })
      .execute({ eventId: TARGET.id, going: true, idempotencyKey: 'da-fila' });

    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(true);
  });

  it('tocar de novo desfaz, sem pontos, e as missões buscam de novo', async () => {
    rsvpFixture.set(EVENT.id, true, 'antes');
    client.setQueryData(missionKeys.list(), { season: null, missions: [] });
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: goingLabel }));

    const chip = await screen.findByRole('button', { name: goLabel });
    expect(chip).not.toBeSelected();
    expect(announce).toHaveBeenCalledWith(t('agenda.rsvp.canceled'));
    await waitFor(() => expect(rsvpFixture.mine().eventIds).toEqual([]));
    expect(screen.queryByText(/^\+/, hidden)).toBeNull();
    await waitFor(() => expect(client.getQueryState(missionKeys.list())?.isInvalidated).toBe(true));
  });

  it('se a API recusar, volta ao estado de antes e avisa', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { eventIds: [] } });
    let refuse: (error: Error) => void = () => undefined;
    request.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: goLabel }));
    expect(await screen.findByRole('button', { name: goingLabel })).toBeTruthy();

    act(() => refuse(new ApiError('server', 'fora do ar', 500)));
    expect(await screen.findByRole('button', { name: goLabel })).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(t('agenda.rsvp.error'));
    expect(haptics.trigger).toHaveBeenCalledWith('error');
  });

  it('sem internet, a presença aparece e espera na fila para quando a rede voltar', async () => {
    registerAgendaMutationDefaults(client);
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });
    const chip = await screen.findByRole('button', { name: goLabel });

    act(() => onlineManager.setOnline(false));
    fireEvent.press(chip);

    expect(await screen.findByRole('button', { name: goingLabel })).toBeTruthy();
    const [paused] = client.getMutationCache().findAll({ mutationKey: agendaMutationKeys.rsvp });
    expect(paused?.state.isPaused).toBe(true);
    expect(paused?.options.scope).toEqual({ id: `agenda-rsvp-${EVENT.id}` });
    expect(rsvpFixture.mine().eventIds).toEqual([]);

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(rsvpFixture.mine().eventIds).toEqual([EVENT.id]));
    await waitFor(() =>
      expect(client.getQueryData(agendaKeys.rsvps())).toEqual({ eventIds: [EVENT.id] }),
    );
  });
});

describe('show que saiu do ar ou encerrou (bloco 6)', () => {
  it('a recusa notFound desfaz e faz a agenda e o mural buscarem de novo', async () => {
    mockDataSource = 'api';
    get.mockResolvedValue({ data: { eventIds: [] } });
    request.mockRejectedValue(new ApiError('notFound', 'Show não encontrado.', 404));
    client.setQueryData(agendaKeys.events(), { pages: [], pageParams: [] });
    client.setQueryData(['posts', 'feed'], { pages: [], pageParams: [] });
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: goLabel }));
    expect(await screen.findByRole('button', { name: goLabel })).toBeTruthy();
    await waitFor(() =>
      expect(client.getQueryState(agendaKeys.events())?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(['posts', 'feed'])?.isInvalidated).toBe(true);
  });

  it('a que volta da fila (sem a tela) e é recusada com notFound também busca de novo', async () => {
    mockDataSource = 'api';
    registerAgendaMutationDefaults(client);
    request.mockRejectedValue(new ApiError('notFound', 'Show não encontrado.', 404));
    client.setQueryData(agendaKeys.events(), { pages: [], pageParams: [] });
    await expect(
      client
        .getMutationCache()
        .build(client, { mutationKey: agendaMutationKeys.rsvp })
        .execute({ eventId: EVENT.id, going: true, idempotencyKey: 'chave-fila-1' }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(client.getQueryState(agendaKeys.events())?.isInvalidated).toBe(true);
  });
});

describe('consultas da agenda pela fonte (bloco 6)', () => {
  // O padrão de hoje (algum domínio nas fixtures): cada consulta diz o dela.
  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity, networkMode: 'always' } },
    });
  });

  const cases: [string, () => unknown, QueryKey][] = [
    ['useAgendaQuery', () => useAgendaQuery(), agendaKeys.events()],
    [
      'useArtistAgendaQuery',
      () => useArtistAgendaQuery('nettobrito'),
      agendaKeys.byArtist('nettobrito'),
    ],
    ['useMyRsvpsQuery', () => useMyRsvpsQuery(), agendaKeys.rsvps()],
    ['useIsGoing', () => useIsGoing(EVENT.id), agendaKeys.rsvps()],
  ];
  const queryOf = (queryKey: QueryKey) => client.getQueryCache().find({ queryKey, exact: true });

  it.each(cases)('%s com a API espera a rede e vai para o disco', async (_, hook, queryKey) => {
    mockDataSource = 'api';
    onlineManager.setOnline(false);
    renderHook(hook, { wrapper });
    await waitFor(() => expect(queryOf(queryKey)?.state.fetchStatus).toBe('paused'));
    expect(queryOf(queryKey)?.options.networkMode).toBe('online');
    expect(queryOf(queryKey)?.meta).toEqual({ realData: true });
    expect(get).not.toHaveBeenCalled();
  });

  it.each(cases)(
    '%s nas fixtures roda sem rede e fica fora do disco',
    async (_, hook, queryKey) => {
      onlineManager.setOnline(false);
      renderHook(hook, { wrapper });
      await waitFor(() => expect(queryOf(queryKey)?.state.status).toBe('success'));
      expect(queryOf(queryKey)?.options.networkMode).toBe('always');
      expect(queryOf(queryKey)?.meta).toEqual({ realData: false });
      expect(get).not.toHaveBeenCalled();
    },
  );
});
