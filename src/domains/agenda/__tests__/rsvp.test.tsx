import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { artistKeys } from '@/domains/artists';
import { missionKeys, missionsFixture } from '@/domains/missions';
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
import { agendaKeys, agendaMutationKeys, registerAgendaMutationDefaults } from '../queries';

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
jest.mock('@/config/env', () => ({
  get dataSource() {
    return mockDataSource;
  },
}));

const get = jest.mocked(api.get);
const request = jest.mocked(api.request);

// A pílula "+N" fica fora do leitor, e as consultas padrão ignoram o que o leitor não vê.
const hidden = { includeHiddenElements: true } as const;

const EVENT = { id: 'arrocha-na-praia', title: 'Arrocha na Praia' };
const goLabel = t('agenda.rsvp.label', { status: t('agenda.rsvp.go'), show: EVENT.title });
const goingLabel = t('agenda.rsvp.label', { status: t('agenda.rsvp.going'), show: EVENT.title });

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

describe('"Eu vou" do post de show', () => {
  it('diz a que show se refere e confirma na hora, com os pontos subindo do chip', async () => {
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });
    const chip = await screen.findByRole('button', { name: goLabel });
    expect(chip).not.toBeSelected();

    fireEvent.press(chip);

    // Otimista: "Confirmado" antes da resposta, e o leitor ouve.
    const confirmed = await screen.findByRole('button', { name: goingLabel });
    expect(confirmed).toBeSelected();
    expect(confirmed).toHaveProp('accessibilityHint', t('agenda.rsvp.cancelHint'));
    expect(announce).toHaveBeenCalledWith(t('agenda.rsvp.confirmed'));

    expect(await screen.findByText(`+${FIRST_RSVP_POINTS}`, hidden)).toBeTruthy();
    expect(rsvpFixture.mine().eventIds).toEqual([EVENT.id]);
  });

  it('a presença que rende pontos faz o saldo, o ranking, as centrais e as missões (1b e 1g) buscarem de novo', async () => {
    client.setQueryData(profileKeys.wallet(), { balance: 12_480, xp: 12_480, seasonPoints: 4_120 });
    client.setQueryData(artistKeys.centrals(), []);
    client.setQueryData(rankingKeys.myRank(GLOBAL_SCOPE), {
      position: 12,
      points: 4_120,
      target: null,
    });
    client.setQueryData(missionKeys.daily(), null);
    client.setQueryData(missionKeys.list(), { season: null, missions: [] });
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: goLabel }));

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
    render(<RsvpChip eventId={EVENT.id} eventTitle={EVENT.title} />, { wrapper });

    fireEvent.press(await screen.findByRole('button', { name: goLabel }));

    await waitFor(() => expect(rsvpFixture.mine().eventIds).toContain(EVENT.id));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(false);
    expect(client.getQueryState(rankingKeys.myRank(GLOBAL_SCOPE))?.isInvalidated).toBe(false);
    expect(client.getQueryState(artistKeys.centrals())?.isInvalidated).toBe(false);
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
      .execute({ eventId: EVENT.id, going: true, idempotencyKey: 'da-fila' });

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
