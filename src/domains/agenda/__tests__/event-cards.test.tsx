import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Dimensions } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { PressableScale } from '@/components/pressable-scale';
import { missionsFixture } from '@/domains/missions';
import { RSVP_MISSION_POINTS } from '@/domains/missions/fixtures';
import { PostRow } from '@/domains/posts';
import { buildPostsFixture } from '@/domains/posts/fixtures';
import { profileKeys } from '@/domains/profile';
import { buildMyInviteFixture } from '@/domains/profile/fixtures';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

import { EventHeroCard } from '../components/event-hero-card';
import { EventRow } from '../components/event-row';
import { buildAgendaEventsFixture, rsvpFixture } from '../fixtures';
import { agendaKeys, registerAgendaMutationDefaults } from '../queries';
import type { AgendaEvent } from '../types';

// O build do Firebase que o Jest resolve é ESM. Os cards não falam com ele, mas
// a presença invalida a carteira do domínio de perfil, que lê o Firestore.
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
  firebaseEnv: null,
  apiUrl: undefined,
  get dataSource() {
    return mockDataSource;
  },
  firebaseEmulatorHost: undefined,
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

const request = jest.mocked(api.request);
const get = jest.mocked(api.get);

// A pílula "+N" fica fora do leitor, e as consultas padrão ignoram o que o leitor não vê.
const hidden = { includeHiddenElements: true } as const;

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const EVENTS = buildAgendaEventsFixture(NOW);
const byId = (id: string) => EVENTS.find((event) => event.id === id) as AgendaEvent;
const IRARA = byId('sao-joao-irara');
const PRAIA = byId('arrocha-na-praia');

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Pressáveis que moram dentro de outro pressável (a regra do workspace proíbe). */
function nestedPressables(): ReactTestInstance[] {
  const pressables = screen.UNSAFE_getAllByType(PressableScale);
  return pressables.filter((pressable) => {
    let parent = pressable.parent;
    while (parent) {
      if (pressables.includes(parent)) return true;
      parent = parent.parent;
    }
    return false;
  });
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
  client.setQueryData(agendaKeys.rsvps(), { eventIds: [] });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
  jest.restoreAllMocks();
});

describe('linha de show', () => {
  it('data, show e lugar são um foco só; o "Eu vou" tem o seu, com o nome do show', () => {
    render(<EventRow event={PRAIA} now={NOW} />, { wrapper });
    expect(screen.getByLabelText('3 de outubro, Arrocha na Praia, Aracaju, Sergipe')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Eu vou, Arrocha na Praia' })).not.toBeSelected();
    // A linha não é pressável (não há detalhe do show): só o "Eu vou" é tocável.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(nestedPressables()).toEqual([]);
  });

  it('mostra o dia com dois dígitos, o mês e a cidade com a UF, como o protótipo', () => {
    render(<EventRow event={PRAIA} now={NOW} />, { wrapper });
    expect(screen.getByText('03', hidden)).toBeTruthy();
    expect(screen.getByText('OUT', hidden)).toBeTruthy();
    expect(screen.getByText('Aracaju, SE', hidden)).toBeTruthy();
  });

  it('o "Eu vou" desenha 29 dentro de um alvo de 44', () => {
    render(<EventRow event={PRAIA} now={NOW} />, { wrapper });
    const button = screen.getByRole('button', { name: 'Eu vou, Arrocha na Praia' });
    expect(button).toHaveStyle({ minHeight: 44, minWidth: 44 });
  });

  it('"Eu vou" confirma na hora, e a primeira presença sobe "+15" uma vez só', async () => {
    render(<EventRow event={PRAIA} now={NOW} />, { wrapper });

    fireEvent.press(screen.getByRole('button', { name: 'Eu vou, Arrocha na Praia' }));

    const confirmed = await screen.findByRole('button', { name: 'Confirmado, Arrocha na Praia' });
    expect(confirmed).toBeSelected();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Presença confirmada');
    expect(await screen.findByText(`+${RSVP_MISSION_POINTS}`, hidden)).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('pointsEarned');
    const earned = jest
      .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
      .mock.calls.filter(([text]) => text === `Mais ${RSVP_MISSION_POINTS} pontos`);
    expect(earned).toHaveLength(1);

    // A segunda presença não rende: nada de "+N" de novo.
    render(<EventRow event={IRARA} now={NOW} />, { wrapper });
    fireEvent.press(screen.getByRole('button', { name: 'Eu vou, São João de Irará' }));
    await waitFor(() => expect(rsvpFixture.mine().eventIds).toContain(IRARA.id));
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(
      jest
        .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
        .mock.calls.filter(([text]) => String(text).startsWith('Mais ')),
    ).toHaveLength(1);
  });

  it('se a API recusar, o "Eu vou" volta e o fã é avisado', async () => {
    mockDataSource = 'api';
    let refuse: (error: Error) => void = () => undefined;
    request.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    get.mockResolvedValue({ data: { eventIds: [] } });
    render(<EventRow event={PRAIA} now={NOW} />, { wrapper });

    fireEvent.press(screen.getByRole('button', { name: 'Eu vou, Arrocha na Praia' }));
    expect(
      await screen.findByRole('button', { name: 'Confirmado, Arrocha na Praia' }),
    ).toBeTruthy();

    act(() => refuse(new ApiError('server', 'fora do ar', 500)));
    expect(await screen.findByRole('button', { name: 'Eu vou, Arrocha na Praia' })).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Não foi possível salvar sua presença. Tente de novo.',
    );
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(screen.queryByText(/^\+/, hidden)).toBeNull();
  });

  describe('com a fonte do sistema', () => {
    const window = Dimensions.get('window');
    const setFontScale = (fontScale: number) =>
      Dimensions.set({ window: { ...window, fontScale } });
    afterEach(() => act(() => setFontScale(window.fontScale)));

    it.each<[number, number | undefined, string, 'row' | 'column']>([
      [1, 2, 'ao lado', 'row'],
      [1.15, 2, 'ao lado', 'row'],
      [1.3, undefined, 'embaixo', 'column'],
      [2, undefined, 'embaixo', 'column'],
    ])(
      'a %sx, o título vai até %s linhas, e o "Eu vou" fica %s',
      (scale, lines, _where, direction) => {
        setFontScale(scale);
        render(<EventRow event={PRAIA} now={NOW} testID="linha" />, { wrapper });
        expect(screen.getByText('Arrocha na Praia', hidden).props.numberOfLines).toBe(lines);
        expect(screen.getByTestId('linha')).toHaveStyle({ flexDirection: direction });
      },
    );

    it('a 2x, título e meta do destaque quebram inteiros', () => {
      setFontScale(2);
      render(<EventHeroCard event={IRARA} now={NOW} onInvite={jest.fn()} />, { wrapper });
      expect(screen.getByText('São João de Irará', hidden)).not.toHaveProp('numberOfLines');
      expect(screen.getByText('Netto Brito + Nenho · Irará, BA · 22 h', hidden)).not.toHaveProp(
        'numberOfLines',
      );
    });
  });

  it('no dia do show, o selo diz "Hoje"', () => {
    const today = { ...PRAIA, startsAt: new Date(2026, 8, 29, 22).toISOString() };
    render(<EventRow event={today} now={NOW} />, { wrapper });
    expect(screen.getByText('Hoje', hidden)).toBeTruthy();
    expect(screen.getByLabelText('hoje, Arrocha na Praia, Aracaju, Sergipe')).toBeTruthy();
  });
});

describe('show em destaque', () => {
  it('a informação é um foco só, o selo fica fora do leitor e os botões têm foco próprio', () => {
    render(<EventHeroCard event={IRARA} now={NOW} onInvite={jest.fn()} />, { wrapper });
    expect(
      screen.getByLabelText(
        'Show em destaque. 21 de outubro, São João de Irará, Netto Brito e Nenho, Irará, Bahia, 22 horas',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Netto Brito + Nenho · Irará, BA · 22 h', hidden)).toBeTruthy();
    // O selo "21 OUT" repete a data do rótulo: fora do leitor.
    expect(screen.queryByText('21')).toBeNull();
    expect(screen.getByText('21', hidden)).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
      'Eu vou, São João de Irará',
      'Chamar amigos para São João de Irará, 10 pontos por cadastro',
    ]);
    expect(nestedPressables()).toEqual([]);
  });

  it('"Chamar amigos +10" leva o show a quem abre o convite', () => {
    const onInvite = jest.fn();
    render(<EventHeroCard event={IRARA} now={NOW} onInvite={onInvite} />, { wrapper });
    expect(screen.getByText('Chamar amigos +10')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: /^Chamar amigos/ }));
    expect(onInvite).toHaveBeenCalledWith(IRARA);
  });

  it('"Eu vou" confirma a presença, e a missão e o saldo buscam de novo', async () => {
    client.setQueryData(profileKeys.wallet(), { balance: 12_480, xp: 12_480, seasonPoints: 4_120 });
    render(<EventHeroCard event={IRARA} now={NOW} onInvite={jest.fn()} />, { wrapper });

    fireEvent.press(screen.getByRole('button', { name: 'Eu vou, São João de Irará' }));

    expect(
      await screen.findByRole('button', { name: 'Confirmado, São João de Irará' }),
    ).toBeSelected();
    await waitFor(() =>
      expect(client.getQueryState(profileKeys.wallet())?.isInvalidated).toBe(true),
    );
    expect(fixtureWallet.get().balance).toBe(12_480 + RSVP_MISSION_POINTS);
  });

  it('sem internet, a presença aparece na hora e espera na fila', async () => {
    registerAgendaMutationDefaults(client);
    render(<EventHeroCard event={IRARA} now={NOW} onInvite={jest.fn()} />, { wrapper });

    act(() => onlineManager.setOnline(false));
    fireEvent.press(screen.getByRole('button', { name: 'Eu vou, São João de Irará' }));
    expect(
      await screen.findByRole('button', { name: 'Confirmado, São João de Irará' }),
    ).toBeTruthy();
    expect(rsvpFixture.mine().eventIds).toEqual([]);

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(rsvpFixture.mine().eventIds).toEqual([IRARA.id]));
  });
});

describe('agenda e feed', () => {
  it('nunca discordam: o "Eu vou" da agenda aparece no post do show, e o do post na agenda', async () => {
    client.setQueryData(profileKeys.invite(), buildMyInviteFixture());
    const post = buildPostsFixture(NOW).find(({ kind }) => kind === 'event');
    if (!post) throw new Error('falta o post de show nas fixtures');
    render(
      <>
        <PostRow post={post} />
        <EventRow event={PRAIA} now={NOW} />
      </>,
      { wrapper },
    );

    const [inFeed, inAgenda] = screen.getAllByRole('button', { name: 'Eu vou, Arrocha na Praia' });
    if (!inFeed || !inAgenda) throw new Error('faltou um dos dois "Eu vou"');

    fireEvent.press(inAgenda);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Confirmado, Arrocha na Praia' })).toHaveLength(
        2,
      ),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));

    const [confirmedInFeed] = screen.getAllByRole('button', {
      name: 'Confirmado, Arrocha na Praia',
    });
    if (!confirmedInFeed) throw new Error('faltou o "Confirmado" do post');
    fireEvent.press(confirmedInFeed);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Eu vou, Arrocha na Praia' })).toHaveLength(2),
    );
    await waitFor(() => expect(rsvpFixture.mine().eventIds).toEqual([]));
  });
});
