import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { AccessibilityInfo, Text } from 'react-native';

import BlockedFansRoute from '@/app/(tabs)/(perfil)/fas-bloqueados';
import SettingsRoute from '@/app/(tabs)/(perfil)/ajustes';
import type { BlockedFan, BlockedFansPage } from '@/domains/posts';
import { moderationFixture } from '@/domains/posts/fixtures';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureBlocks } from '@/services/fixtures';
import { haptics } from '@/services/haptics';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

// "Fãs bloqueados" (seção 29 de docs/arquitetura-api.md, frente B): a lista
// para desbloquear, aberta pela seção "Segurança" dos Ajustes.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), request: jest.fn() },
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
// Nas fixtures por padrão; os casos do servidor põem os posts na API.
let mockSources: Record<string, 'api' | 'fixtures'> = {};
jest.mock('@/config/data-source', () => ({
  sourceOf: (domain: string) => mockSources[domain] ?? 'fixtures',
  usesFixtures: () => true,
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 874 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 402, height: 64 })),
  };
});

const UID = 'uid-camila';
const INTRO =
  'Os comentários de quem está aqui não aparecem para você. Ninguém fica sabendo do bloqueio.';
const EMPTY =
  'Você não bloqueou ninguém. Para bloquear, abra o perfil de um fã ou as opções de um comentário.';

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
  '(tabs)/(perfil)/ajustes': SettingsRoute,
  '(tabs)/(perfil)/fas-bloqueados': BlockedFansRoute,
  '(tabs)/(perfil)/excluir-conta': label('delete'),
  'editar-perfil': label('edit-profile'),
};

const fan = (uid: string, displayName: string | null, username: string | null): BlockedFan => ({
  uid,
  displayName,
  username,
  photoURL: null,
});

const ENZO = fan('uidEnzo', 'Enzo Lima', 'enzolim');
const BIA = fan('uidBia', 'Bia Costa', 'biacos');
const NAMELESS = fan('uidSemNome', null, 'fa123456');

const get = jest.mocked(api.get);
const del = jest.mocked(api.delete);

/** O `GET /me/blocks` pelo cursor (`null` na primeira página). */
function mockBlocks(answer: (cursor: string | null) => BlockedFansPage | Promise<BlockedFansPage>) {
  mockSources = { posts: 'api' };
  get.mockImplementation(async (url, config) => {
    if (url !== '/me/blocks') throw new Error(`rota sem resposta no teste: ${url}`);
    const params = config?.params as { cursor?: string | null } | undefined;
    return { data: await answer(params?.cursor ?? null) };
  });
}

const cursors = () =>
  get.mock.calls
    .filter(([url]) => url === '/me/blocks')
    .map(([, config]) => (config as { params?: { cursor?: string | null } })?.params?.cursor);

const spoken = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);
const queued = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

beforeEach(() => {
  jest.clearAllMocks();
  mockSources = {};
  moderationFixture.reset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, networkMode: 'always' },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: UID,
      email: 'camila@teste.imagineup',
      displayName: 'Camila Ribeiro',
      photoURL: null,
    },
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: true,
    lastSessionUid: UID,
  });
  jest.mocked(getDoc).mockResolvedValue({
    exists: () => true,
    data: () => ({ displayName: 'Camila Ribeiro', username: 'camilarib', city: null }),
    metadata: { fromCache: false },
  } as never);
  jest.mocked(onSnapshot).mockReturnValue(() => undefined);
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('Fãs bloqueados (seção 29, frente B)', () => {
  it('nas fixtures, a entrada pelos Ajustes, na seção "Segurança", e a linha da fa-rank-13 do seed', async () => {
    const view = renderRouter(appTree, { initialUrl: '/ajustes' });

    expect(screen.getByRole('header', { name: 'Segurança' })).toBeTruthy();
    const entry = screen.getByRole('button', { name: 'Fãs bloqueados. Veja e desbloqueie' });
    expect(entry.props.accessibilityHint).toBe('Abre a lista de fãs bloqueados');
    fireEvent.press(entry);

    await waitFor(() => expect(view.getPathname()).toBe('/fas-bloqueados'));
    expect(view.getSegments()).toEqual(['(tabs)', '(perfil)', 'fas-bloqueados']);
    expect(screen.getByRole('header', { name: 'Fãs bloqueados' })).toBeTruthy();
    expect(screen.getByText(INTRO)).toBeTruthy();
    // A linha é um elemento só, sem toque; o botão irmão desbloqueia.
    expect(await screen.findByLabelText('Bruno Santana, @brunosan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Bruno Santana, @brunosan' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Desbloquear Bruno Santana' })).toBeTruthy();
  });

  it('desbloquear tira a linha, anuncia e toca o sucesso; sem ninguém, o vazio diz como bloquear', async () => {
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });

    fireEvent.press(await screen.findByRole('button', { name: 'Desbloquear Bruno Santana' }));

    expect(await screen.findByLabelText(EMPTY)).toBeTruthy();
    expect(screen.queryByLabelText('Bruno Santana, @brunosan')).toBeNull();
    expect(spoken()).toContain('Você desbloqueou Bruno Santana.');
    expect(haptics.trigger).toHaveBeenCalledWith('success');
    expect(fixtureBlocks.list()).toEqual([]);
  });

  it('com a API, as linhas do servidor, a sem nome como "Fã", e desbloquear não busca a lista de novo', async () => {
    mockBlocks(() => ({ items: [ENZO, NAMELESS], nextCursor: null }));
    del.mockResolvedValue({ data: { fanId: 'uidEnzo', blocked: false } });
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });

    expect(await screen.findByLabelText('Enzo Lima, @enzolim')).toBeTruthy();
    expect(screen.getByLabelText('Fã, @fa123456')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Desbloquear Enzo Lima' }));

    // `not.toBeOnTheScreen`, e não `toBeNull`: a mensagem da volta que ainda
    // acha a linha imprimiria a árvore inteira (o `_fiber`), segundos de CPU.
    await waitFor(() =>
      expect(screen.queryByLabelText('Enzo Lima, @enzolim')).not.toBeOnTheScreen(),
    );
    expect(del).toHaveBeenCalledWith('/me/blocks/uidEnzo', {
      headers: { 'Idempotency-Key': expect.stringMatching(/^unblock-uidEnzo-/) },
    });
    expect(screen.getByLabelText('Fã, @fa123456')).toBeTruthy();
    expect(cursors()).toEqual([null]);
  });

  it('o erro de uma linha fica embaixo dela, anunciado, com a frase do ritmo; a linha fica', async () => {
    mockBlocks(() => ({ items: [ENZO, BIA], nextCursor: null }));
    del.mockRejectedValue(new ApiError('rateLimited', 'ritmo', 429, 'rate_limited', null, 2000));
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });

    fireEvent.press(await screen.findByRole('button', { name: 'Desbloquear Bia Costa' }));

    const rate = 'Muitos pedidos seguidos. Espere alguns segundos e tente de novo.';
    expect(await screen.findByText(rate)).toBeTruthy();
    expect(spoken()).toContain(rate);
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    expect(screen.getByLabelText('Bia Costa, @biacos')).toBeTruthy();
    expect(screen.getByLabelText('Enzo Lima, @enzolim')).toBeTruthy();
  });

  it('a falha sem nada carregado: o erro, anunciado, e o "Tentar de novo" busca de novo', async () => {
    let fail = true;
    mockBlocks(() => {
      if (fail) throw new ApiError('server', 'fora do ar', 500);
      return { items: [ENZO], nextCursor: null };
    });
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });

    expect(await screen.findByLabelText('Não deu para carregar a lista.')).toBeTruthy();
    await waitFor(() => expect(queued()).toContain('Não deu para carregar a lista.'));

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByLabelText('Enzo Lima, @enzolim')).toBeTruthy();
  });

  it('com a API e ninguém bloqueado, o vazio', async () => {
    mockBlocks(() => ({ items: [], nextCursor: null }));
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });
    expect(await screen.findByLabelText(EMPTY)).toBeTruthy();
  });

  it('a página seguinte vem pelo cursor do servidor', async () => {
    mockBlocks((cursor) =>
      cursor === null
        ? { items: [ENZO, BIA], nextCursor: '3:uidBia' }
        : { items: [NAMELESS], nextCursor: null },
    );
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });

    expect(await screen.findByLabelText('Fã, @fa123456')).toBeTruthy();
    expect(screen.getByLabelText('Enzo Lima, @enzolim')).toBeTruthy();
    expect(cursors()).toEqual([null, '3:uidBia']);
  });

  it('a página seguinte que falha tem aviso próprio, anunciado, e o "Tentar de novo" busca só ela', async () => {
    let fail = true;
    mockBlocks((cursor) => {
      if (cursor === null) return { items: [ENZO], nextCursor: '1:uidEnzo' };
      if (fail) throw new ApiError('server', 'fora do ar', 500);
      return { items: [BIA], nextCursor: null };
    });
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });

    expect(await screen.findByLabelText('Não deu para carregar mais.')).toBeTruthy();
    await waitFor(() => expect(queued()).toContain('Não deu para carregar mais.'));
    expect(screen.getByLabelText('Enzo Lima, @enzolim')).toBeTruthy();

    fail = false;
    fireEvent.press(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByLabelText('Bia Costa, @biacos')).toBeTruthy();
    expect(cursors()).toEqual([null, '1:uidEnzo', '1:uidEnzo']);
  });

  it('a página que vem sem ninguém (o perfil que sumiu), com a seguinte por vir, pede a seguinte em vez do vazio', async () => {
    mockBlocks((cursor) =>
      cursor === null
        ? { items: [], nextCursor: '4:uidSumiu' }
        : { items: [BIA], nextCursor: null },
    );
    renderRouter(appTree, { initialUrl: '/fas-bloqueados' });

    expect(await screen.findByLabelText('Bia Costa, @biacos')).toBeTruthy();
    expect(cursors()).toEqual([null, '4:uidSumiu']);
    expect(screen.queryByLabelText(EMPTY)).toBeNull();
  });
});
