import { FlashList } from '@shopify/flash-list';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Share, Text } from 'react-native';

import ArtistRoute from '@/app/(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]';
import LeaveCentralRoute from '@/app/sair-da-central/[artistaId]';
import {
  artistKeys,
  type FanCentral,
  type JoinCentralResult,
  type LeaveCentralResult,
} from '@/domains/artists';
import { fetchArtist, joinCentral, leaveCentral } from '@/domains/artists/api';
import {
  buildArtistDetailsFixture,
  buildFanCentralsFixture,
  followFixture,
  JOIN_CENTRAL_POINTS,
} from '@/domains/artists/fixtures';
import { missionKeys, missionsFixture } from '@/domains/missions';
import { buildMissionsFixture } from '@/domains/missions/fixtures';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet, setFixtureNow } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { motion } from '@/theme';

// O build do Firebase que o Jest resolve é ESM; a página lê o nome do fã no perfil.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
// Tudo nas fixtures; um teste põe as centrais na API (o modo misto do emulador).
let mockDomainSources: Record<string, 'api' | 'fixtures'> = {};
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => mockDomainSources[domain] ?? 'fixtures',
  usesFixtures: () => true,
}));
// A central vem das fixtures; um teste faz a busca de novo falhar, e outro segura a entrada.
jest.mock('@/domains/artists/api', () => {
  const actual =
    jest.requireActual<typeof import('@/domains/artists/api')>('@/domains/artists/api');
  return {
    ...actual,
    fetchArtist: jest.fn(actual.fetchArtist),
    joinCentral: jest.fn(actual.joinCentral),
    leaveCentral: jest.fn(actual.leaveCentral),
  };
});

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 874 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 60 })),
  };
});

// Relógio fixo, nas fixtures e na tela: terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const mockNow = NOW;
jest.mock('@/hooks/use-now', () => ({ useNow: () => mockNow }));

let client: QueryClient;

function RootLayout() {
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

/** As abas com a 1d de verdade, pela própria rota, e as outras telas vazias. */
const appTree = {
  _layout: RootLayout,
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(inicio,explorar,ranking,perfil)/_layout': {
    default: () => <Stack screenOptions={{ headerShown: false }} />,
    unstable_settings: {
      inicio: { anchor: 'index' },
      explorar: { anchor: 'explorar' },
      ranking: { anchor: 'ranking' },
      perfil: { anchor: 'perfil' },
    },
  },
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': ArtistRoute,
  'post/[postId]': label('post'),
  'sair-da-central/[artistaId]': LeaveCentralRoute,
};

/** A aba visível (a grudada, quando a lista a desenha grudada), pelo nome. */
const tab = (name: string) => screen.getAllByLabelText(name).at(-1)!;
const hidden = { includeHiddenElements: true } as const;
const selected = (name: string) => tab(name).props.accessibilityState?.selected === true;

/** O que recebeu o foco do leitor de tela: o texto do cabeçalho ou o `testID`. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.filter(([, event]) => event === 'focus')
    .map(([node]) => {
      const { props } = node as unknown as { props: { testID?: string; children?: unknown } };
      return props.testID ?? props.children;
    });

/** O foco sai quando a rolagem até as abas termina. */
const afterScroll = () => act(() => jest.advanceTimersByTime(motion.duration.slow));

async function openArtist(id: string) {
  const view = renderRouter(appTree, { initialUrl: `/artista/${id}` });
  await screen.findByTestId('artist-heading');
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
  setFixtureNow(NOW);
  mockDomainSources = {};
  followFixture.reset();
  missionsFixture.reset();
  fixtureWallet.reset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, networkMode: 'always' },
      mutations: { gcTime: Infinity },
    },
  });
});

afterEach(() => {
  client.clear();
  onlineManager.setOnline(true);
  setFixtureNow(null);
  jest.useRealTimers();
});

describe('página do artista (1d)', () => {
  it('a capa diz quem é, os números vêm lidos por extenso e o fã já está na central do Netto', async () => {
    await openArtist('nettobrito');

    expect(
      screen.getByLabelText('Netto Brito, artista verificado, gestão oficial Imagine'),
    ).toBeTruthy();
    expect(screen.getByLabelText('412 mil fãs')).toBeTruthy();
    expect(screen.getByLabelText('1.284 posts')).toBeTruthy();
    expect(screen.getByLabelText('8,4 milhões de pontos da central')).toBeTruthy();
    expect(await screen.findByLabelText('Você está na central de Netto Brito')).toBeTruthy();
  });

  it('as abas são Mural, Missões, Agenda e Ranking, com o Mural escolhido; Playlists não existe', async () => {
    await openArtist('nettobrito');

    expect(selected('Mural')).toBe(true);
    for (const name of ['Missões', 'Agenda', 'Ranking']) expect(selected(name)).toBe(false);
    expect(screen.queryByLabelText('Playlists')).toBeNull();
    // A fileira desenhada na lista e a grudada são a mesma tablist.
    const lists = [
      ...screen.queryAllByTestId('artist-tabs', hidden),
      ...screen.queryAllByTestId('artist-tabs-stuck', hidden),
    ];
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) expect(list.props.accessibilityRole).toBe('tablist');
  });

  it('os top fãs são os três primeiros do ranking da temporada na central, e "Ver ranking" abre a aba Ranking', async () => {
    await openArtist('nettobrito');

    expect(await screen.findByLabelText('1º lugar, Alan F., 7.467 pontos')).toBeTruthy();
    expect(screen.getByLabelText('2º lugar, Davi L., 7.150 pontos')).toBeTruthy();
    expect(screen.getByLabelText('3º lugar, Igor N., 6.819 pontos')).toBeTruthy();
    // Tudo nas fixtures (as builds de hoje): o ranking de exemplo não leva aviso.
    expect(screen.queryByTestId('artist-top-fans-example')).toBeNull();

    fireEvent.press(screen.getByLabelText('Ver o ranking da central'));

    expect(selected('Ranking')).toBe(true);
    // A aba mostra as mesmas posições, a partir do 1º.
    expect(await screen.findByTestId('artist-rank-1')).toBeTruthy();
    expect(screen.getByTestId('artist-rank-1').props.accessibilityLabel).toMatch(
      /^1º, Alan Ferreira, .*7\.467 pontos/,
    );
    // O leitor de tela vai à temporada, o começo da aba.
    afterScroll();
    expect(focused()).toEqual(['artist-season']);
  });

  it('com as centrais no servidor, os top fãs e a aba Ranking avisam que o ranking é de exemplo', async () => {
    mockDomainSources = { artists: 'api' };
    jest.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/artists/nettobrito') {
        return { data: { ...buildArtistDetailsFixture('nettobrito'), fanCount: 1 } };
      }
      if (url === '/me/centrals') return { data: [] };
      throw new Error(`rota sem resposta no teste: ${url}`);
    });
    await openArtist('nettobrito');

    expect(await screen.findByTestId('artist-top-fans-example')).toHaveTextContent(
      'Ranking de exemplo: as posições de verdade chegam com o ranking do servidor.',
    );
    fireEvent.press(tab('Ranking'));
    expect(await screen.findByTestId('artist-ranking-example')).toBeTruthy();
  });

  it('trocar de aba pela barra grudada leva o foco do leitor ao começo do conteúdo novo; pela da lista, não', async () => {
    await openArtist('nettobrito');

    // Na lista, o conteúdo vem logo depois das abas na ordem de leitura.
    fireEvent.press(screen.getByTestId('artist-tabs-agenda', hidden));
    expect(await screen.findByTestId('artist-event-sao-joao-irara')).toBeTruthy();
    afterScroll();
    expect(focused()).toEqual([]);

    // A grudada é lida depois do último item: o conteúdo novo ficaria para trás.
    fireEvent.press(screen.getByTestId('artist-tabs-stuck-missions'));
    expect(await screen.findByText('Comente em 3 posts da central')).toBeTruthy();
    afterScroll();
    expect(focused()).toEqual(['Hoje']);
  });

  it('a aba Missões mostra só as missões desta central, no desenho da 1g', async () => {
    await openArtist('nettobrito');

    fireEvent.press(tab('Missões'));

    expect(selected('Missões')).toBe(true);
    expect(await screen.findByText('Comente em 3 posts da central')).toBeTruthy();
    expect(screen.queryByText('Curta 5 posts do Nenho')).toBeNull();
    expect(screen.queryByText('Traga 3 amigos novos pro app')).toBeNull();
  });

  it('a missão que leva à própria central só troca para o Mural', async () => {
    await openArtist('nenho');
    fireEvent.press(tab('Missões'));

    fireEvent.press(await screen.findByText('Curta 5 posts do Nenho'));

    expect(selected('Mural')).toBe(true);
    expect(await screen.findByTestId('artist-top-fans')).toBeTruthy();
    afterScroll();
    expect(focused()).toEqual(['TOP FÃS DA TEMPORADA']);
  });

  it('a missão de presença num show do artista troca para a Agenda da página, sem sair dela', async () => {
    // Uma missão de presença ligada ao Netto, como a API pode mandar.
    const base = buildMissionsFixture(NOW);
    client.setQueryDefaults(missionKeys.all, { staleTime: Infinity });
    client.setQueryData(missionKeys.list(), {
      ...base,
      missions: base.missions.map((mission) =>
        mission.action === 'rsvp'
          ? { ...mission, target: { ...mission.target, artistId: 'nettobrito' } }
          : mission,
      ),
    });
    const view = await openArtist('nettobrito');
    fireEvent.press(tab('Missões'));

    fireEvent.press(await screen.findByText('Confirme presença em um show'));

    expect(selected('Agenda')).toBe(true);
    expect(await screen.findByTestId('artist-event-sao-joao-irara')).toBeTruthy();
    expect(view.getPathname()).toBe('/artista/nettobrito');
  });

  it('a aba Agenda mostra os shows em que o artista toca, com o "Eu vou" da agenda', async () => {
    await openArtist('nettobrito');

    fireEvent.press(tab('Agenda'));

    expect(await screen.findByTestId('artist-event-sao-joao-irara')).toBeTruthy();
    expect(screen.getByTestId('artist-event-pra-encher-e-derramar')).toBeTruthy();
    expect(screen.queryByTestId('artist-event-festa-do-vaqueiro')).toBeNull();
    expect(screen.getByTestId('artist-event-sao-joao-irara-rsvp')).toBeTruthy();
  });

  it('tocar num post da grade abre o post, fora das abas', async () => {
    await openArtist('nettobrito');

    fireEvent.press(await screen.findByTestId('artist-post-p-clipe'));

    expect(await screen.findByText('post')).toBeTruthy();
  });

  it('entrar na central do Rock Salles: vira "Na central" na hora, sobe o "+N" da API e a central entra nas do fã', async () => {
    const trigger = jest.spyOn(haptics, 'trigger');
    // "Suas centrais" já carregada (home e perfil), para ver a central entrar nela.
    client.setQueryData(artistKeys.centrals(), buildFanCentralsFixture());
    await openArtist('rocksalles');

    fireEvent.press(await screen.findByLabelText('Entrar na central de Rock Salles'));

    expect(await screen.findByLabelText('Você está na central de Rock Salles')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Você entrou na central de Rock Salles.',
    );
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        `Mais ${JOIN_CENTRAL_POINTS} pontos`,
        { queue: true },
      ),
    );
    expect(trigger).toHaveBeenCalledWith('confirm');
    expect(trigger).toHaveBeenCalledWith('pointsEarned');
    expect(followFixture.followedIds()).toContain('rocksalles');
    await waitFor(() =>
      expect(
        client
          .getQueryData<FanCentral[]>(artistKeys.centrals())
          ?.some((central) => central.artistId === 'rocksalles'),
      ).toBe(true),
    );
  });

  it('"Na central" abre a sheet provisória de sair; "Sair da central" volta a página para "Entrar na central"', async () => {
    client.setQueryData(artistKeys.centrals(), buildFanCentralsFixture());
    const before = fixtureWallet.get();
    await openArtist('nettobrito');

    fireEvent.press(
      await screen.findByRole('button', { name: 'Você está na central de Netto Brito' }),
    );
    expect(await screen.findByText('Sair da central?')).toBeTruthy();
    expect(
      screen.getByText(
        'A central sai de Suas centrais. Os pontos que você ganhou nela continuam com você, e entrar de novo não rende os pontos de entrada outra vez. Os posts desta central saem do seu mural.',
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Sair da central' }));

    expect(await screen.findByLabelText('Entrar na central de Netto Brito')).toBeTruthy();
    expect(screen.queryByText('Sair da central?')).toBeNull();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Você saiu da central.',
    );
    expect(followFixture.followedIds()).not.toContain('nettobrito');
    expect(
      client
        .getQueryData<FanCentral[]>(artistKeys.centrals())
        ?.some((central) => central.artistId === 'nettobrito'),
    ).toBe(false);
    // Sair não tira pontos.
    expect(fixtureWallet.get()).toEqual(before);
  });

  it('a sheet fechada com o pedido indo (o arrasto do Android) não tira a 1d da pilha quando o servidor responde', async () => {
    let settle: () => void = () => undefined;
    jest.mocked(leaveCentral).mockImplementationOnce(
      ({ artistId, idempotencyKey }) =>
        new Promise<LeaveCentralResult>((resolve) => {
          settle = () => resolve(followFixture.leave(artistId, idempotencyKey));
        }),
    );
    const view = await openArtist('nettobrito');
    fireEvent.press(
      await screen.findByRole('button', { name: 'Você está na central de Netto Brito' }),
    );
    fireEvent.press(await screen.findByRole('button', { name: 'Sair da central' }));
    await waitFor(() => expect(jest.mocked(leaveCentral)).toHaveBeenCalled());

    // O voltar do Android e o gesto do iOS ficam presos; o arrasto da sheet no Android, não.
    act(() => router.back());
    await waitFor(() => expect(screen.queryByText('Sair da central?')).toBeNull());
    expect(view.getPathname()).toBe('/artista/nettobrito');

    await act(async () => settle());

    expect(await screen.findByLabelText('Entrar na central de Netto Brito')).toBeTruthy();
    expect(view.getPathname()).toBe('/artista/nettobrito');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Você saiu da central.',
    );
  });

  it('"Continuar na central" fecha a sheet sem mudar nada', async () => {
    await openArtist('nettobrito');
    fireEvent.press(
      await screen.findByRole('button', { name: 'Você está na central de Netto Brito' }),
    );
    expect(await screen.findByText('Sair da central?')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Continuar na central' }));

    await waitFor(() => expect(screen.queryByText('Sair da central?')).toBeNull());
    expect(
      screen.getByRole('button', { name: 'Você está na central de Netto Brito' }),
    ).toBeTruthy();
    expect(followFixture.followedIds()).toContain('nettobrito');
  });

  it('enquanto a entrada vai, o "Na central" fica sem toque (sair chegaria antes da entrada)', async () => {
    // A resposta só chega quando o teste manda, e aí a entrada vale nas fixtures.
    let settle: () => void = () => undefined;
    jest.mocked(joinCentral).mockImplementationOnce(
      ({ artistId, idempotencyKey }) =>
        new Promise<JoinCentralResult>((resolve) => {
          settle = () => resolve(followFixture.join(artistId, idempotencyKey));
        }),
    );
    await openArtist('rocksalles');
    fireEvent.press(await screen.findByLabelText('Entrar na central de Rock Salles'));

    const status = await screen.findByLabelText('Você está na central de Rock Salles');
    expect(status.props.accessibilityRole).toBe('text');
    fireEvent.press(status);
    expect(screen.queryByText('Sair da central?')).toBeNull();

    await act(async () => settle());
    expect(
      await screen.findByRole('button', { name: 'Você está na central de Rock Salles' }),
    ).toBeTruthy();
  });

  it('com a página montada de novo sobre uma entrada pausada sem rede, o "Na central" segue sem toque', async () => {
    const first = await openArtist('rocksalles');
    act(() => onlineManager.setOnline(false));
    fireEvent.press(await screen.findByLabelText('Entrar na central de Rock Salles'));
    expect(await screen.findByLabelText('Você está na central de Rock Salles')).toBeTruthy();
    expect(client.getMutationCache().getAll()[0]?.state.isPaused).toBe(true);
    first.unmount();

    // A página nasce de novo (outra instância do hook), com a entrada ainda na fila.
    await openArtist('rocksalles');
    const status = await screen.findByLabelText('Você está na central de Rock Salles');
    expect(status.props.accessibilityRole).toBe('text');
    fireEvent.press(status);
    expect(screen.queryByText('Sair da central?')).toBeNull();

    // A rede volta, a entrada chega ao servidor, e o "Na central" volta a abrir a sheet.
    await act(async () => onlineManager.setOnline(true));
    expect(
      await screen.findByRole('button', { name: 'Você está na central de Rock Salles' }),
    ).toBeTruthy();
    expect(followFixture.followedIds()).toContain('rocksalles');
  });

  it('entrar numa central que saiu do ar com a página aberta: a página diz que ela não existe mais', async () => {
    const trigger = jest.spyOn(haptics, 'trigger');
    await openArtist('rocksalles');
    const gone = () => new ApiError('notFound', 'Central não encontrada.', 404);
    jest.mocked(joinCentral).mockRejectedValueOnce(gone());
    jest.mocked(fetchArtist).mockRejectedValueOnce(gone());

    fireEvent.press(await screen.findByLabelText('Entrar na central de Rock Salles'));

    expect(await screen.findByText('Esta central não existe mais.')).toBeTruthy();
    expect(screen.queryByTestId('artist-heading')).toBeNull();
    expect(trigger).toHaveBeenCalledWith('error');
    // Sem o "Tente de novo": tentar de novo daria 404 para sempre.
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(
      'Não deu para entrar na central. Tente de novo.',
    );
  });

  it('compartilhar manda o link da central com o código de convite do fã', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await openArtist('nettobrito');
    await waitFor(() => expect(client.getQueryData(['profile', 'invite'])).toBeDefined());

    fireEvent.press(screen.getByLabelText('Compartilhar a central'));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(/\/artista\/nettobrito\?ref=CAMILA12$/),
        message: 'Entra na central de Netto Brito no ImagineUP',
      }),
    );
  });

  it('central que não existe mostra o aviso, com o voltar para a raiz da aba', async () => {
    const view = renderRouter(appTree, { initialUrl: '/artista/ninguem' });

    expect(await screen.findByText('Esta central não existe mais.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Voltar'));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });

  it('a atualização que falha deixa a central na tela, avisa e tenta de novo', async () => {
    await openArtist('nettobrito');
    jest.mocked(fetchArtist).mockRejectedValueOnce(new ApiError('server', 'Erro.', 500));

    await act(async () => {
      screen.UNSAFE_getByType(FlashList).props.refreshControl.props.onRefresh();
    });

    expect(await screen.findByText('Não deu para atualizar a central.')).toBeTruthy();
    expect(screen.getByTestId('artist-heading')).toBeTruthy();
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Não deu para atualizar a central.',
        { queue: true },
      ),
    );

    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.queryByText('Não deu para atualizar a central.')).toBeNull());
  });

  it('um link para outra central com esta aberta nasce de novo no Mural', async () => {
    await openArtist('nettobrito');
    fireEvent.press(tab('Agenda'));
    expect(selected('Agenda')).toBe(true);

    act(() => router.setParams({ artistaId: 'nenho' }));

    expect(
      await screen.findByLabelText('Nenho, artista verificado, gestão oficial Imagine'),
    ).toBeTruthy();
    expect(selected('Mural')).toBe(true);
  });
});
