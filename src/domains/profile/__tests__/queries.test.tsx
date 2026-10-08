import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { getDoc, onSnapshot } from 'firebase/firestore';
import type { ReactNode } from 'react';

import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore, type SessionUser } from '@/stores/session';

import { api } from '@/services/api';

import { useFanIdentity } from '../hooks/use-fan-identity';
import {
  fanKeys,
  profileKeys,
  useFanProfileQuery,
  useMyProfileQuery,
  useUpdateProfileMutation,
  useWatchMyProfile,
} from '../queries';
import type { EditableProfile, FanPublicProfile } from '../types';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(),
}));
jest.mock('@/firebase', () => ({ getDb: () => ({}) }));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), put: jest.fn() } }));
// Sem .env no Jest: o aviso de Firebase sem configuração não polui a saída.
jest.mock('@/config/env', () => ({ firebaseEmulatorHost: undefined }));
// Lido na hora da chamada: os testes do ✓ põem o perfil na API.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

const getDocMock = jest.mocked(getDoc);
const onSnapshotMock = jest.mocked(onSnapshot);

const SESSION_CAMILA: SessionUser = {
  uid: 'uid-camila',
  email: 'camila@teste.imagineup',
  displayName: 'Camila da Sessão',
  photoURL: null,
};

function profileSnapshot(displayName: string | null) {
  return {
    exists: () => true,
    data: () => ({ displayName, username: 'camilarib', city: null, photoURL: null }),
    metadata: { fromCache: false },
  };
}

const missing = { exists: () => false, data: () => undefined, metadata: { fromCache: false } };
const missingFromSdkCache = { ...missing, metadata: { fromCache: true } };

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function signIn(status: 'signedIn' | 'loading' = 'signedIn'): void {
  useSessionStore.setState({
    status,
    user: status === 'signedIn' ? SESSION_CAMILA : null,
    authHolds: 0,
  });
  usePreferencesStore.setState({ hydrated: true, lastSessionUid: 'uid-camila' });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  // O padrão das consultas no modo fixtures é `always`: o perfil precisa passar por cima.
  // A mutação que termina sem observador marcaria 5 min para sair do cache, e o
  // timer seguraria o Jest aberto: `gcTime` infinito nas mutações também.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, networkMode: 'always', gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  onSnapshotMock.mockReturnValue(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  client.clear();
});

describe('perfil do fã', () => {
  it('com a sessão confirmada, lê o perfil do próprio uid', async () => {
    signIn();
    getDocMock.mockResolvedValue(profileSnapshot('Camila Ribeiro') as never);

    const { result } = renderHook(() => useMyProfileQuery(), { wrapper });

    await waitFor(() => expect(result.current.data?.displayName).toBe('Camila Ribeiro'));
    expect(client.getQueryData(profileKeys.me('uid-camila'))).toMatchObject({
      username: 'camilarib',
    });
  });

  it('com a sessão só presumida, mostra o salvo e não lê o Firestore antes do Auth', () => {
    signIn('loading');
    client.setQueryData(profileKeys.me('uid-camila'), {
      uid: 'uid-camila',
      displayName: 'Camila Salva',
      username: 'camilarib',
      city: null,
      photoURL: null,
      createdAt: null,
    });

    const { result } = renderHook(() => useMyProfileQuery(), { wrapper });

    expect(result.current.data?.displayName).toBe('Camila Salva');
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('sem internet a leitura espera a rede, mesmo com o padrão das fixtures', async () => {
    signIn();
    onlineManager.setOnline(false);
    getDocMock.mockResolvedValue(profileSnapshot('Camila Ribeiro') as never);

    const { result } = renderHook(() => useMyProfileQuery(), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('paused'));
    expect(getDocMock).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(result.current.data?.displayName).toBe('Camila Ribeiro'));
  });

  it('a escuta põe no cache cada versão do perfil e desliga ao sair da tela', () => {
    signIn();
    const unsubscribe = jest.fn();
    onSnapshotMock.mockReturnValue(unsubscribe);

    const { unmount } = renderHook(() => useWatchMyProfile(), { wrapper });
    const [, next] = onSnapshotMock.mock.calls[0] as unknown as [unknown, (value: unknown) => void];
    act(() => next(profileSnapshot('Camila Ribeiro')));

    expect(client.getQueryData(profileKeys.me('uid-camila'))).toMatchObject({
      displayName: 'Camila Ribeiro',
    });
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('a escuta sem rede, com o cache do SDK vazio, não troca o perfil salvo por null', () => {
    signIn();
    const saved = {
      uid: 'uid-camila',
      displayName: 'Camila Salva',
      username: 'camilarib',
      city: null,
      photoURL: null,
      createdAt: null,
    };
    client.setQueryData(profileKeys.me('uid-camila'), saved);

    renderHook(() => useWatchMyProfile(), { wrapper });
    const [, next] = onSnapshotMock.mock.calls[0] as unknown as [unknown, (value: unknown) => void];
    act(() => next(missingFromSdkCache));

    expect(client.getQueryData(profileKeys.me('uid-camila'))).toEqual(saved);
  });

  it('o perfil é dado de verdade: vai para o disco também no modo fixtures', async () => {
    signIn();
    getDocMock.mockResolvedValue(profileSnapshot('Camila Ribeiro') as never);

    renderHook(() => useMyProfileQuery(), { wrapper });

    await waitFor(() =>
      expect(client.getQueryState(profileKeys.me('uid-camila'))?.status).toBe('success'),
    );
    const query = client.getQueryCache().find({ queryKey: profileKeys.me('uid-camila') });
    expect(query?.meta).toEqual({ realData: true });
  });
});

describe('nome e foto das telas', () => {
  it('com o perfil, vale o nome dele', async () => {
    signIn();
    getDocMock.mockResolvedValue(profileSnapshot('Camila Ribeiro') as never);

    const { result } = renderHook(() => useFanIdentity(), { wrapper });

    await waitFor(() =>
      expect(result.current).toEqual({
        uid: 'uid-camila',
        name: 'Camila Ribeiro',
        photoURL: null,
        loading: false,
      }),
    );
  });

  it('carrega enquanto a leitura não respondeu, com o nome da sessão no lugar', () => {
    signIn();
    getDocMock.mockReturnValue(new Promise(() => undefined) as never);

    const { result } = renderHook(() => useFanIdentity(), { wrapper });

    expect(result.current).toEqual({
      uid: 'uid-camila',
      name: 'Camila da Sessão',
      photoURL: null,
      loading: true,
    });
  });

  it('perfil que não existe no servidor fica com o nome da sessão e para de carregar', async () => {
    signIn();
    getDocMock.mockResolvedValue(missing as never);

    const { result } = renderHook(() => useFanIdentity(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBe('Camila da Sessão');
  });

  it('sem perfil e sem nome na sessão, não prende a tela no esqueleto', async () => {
    signIn();
    useSessionStore.setState({ user: { ...SESSION_CAMILA, displayName: null } });
    getDocMock.mockResolvedValue(missing as never);

    const { result } = renderHook(() => useFanIdentity(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBeNull();
  });

  it('perfil que nasceu sem nome (o nome do cadastro chegou depois da função) mostra o da sessão', async () => {
    signIn();
    getDocMock.mockResolvedValue(profileSnapshot(null) as never);

    const { result } = renderHook(() => useFanIdentity(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBe('Camila da Sessão');
  });

  it.each([
    ['com quebra de linha', 'Camila\nRibeiro'],
    ['só de caracteres em branco', 'ㅤㅤ'],
  ])('nome %s, que o servidor recusou (null no perfil), não volta pela sessão', async (_, name) => {
    signIn();
    useSessionStore.setState({ user: { ...SESSION_CAMILA, displayName: name } });
    getDocMock.mockResolvedValue(profileSnapshot(null) as never);

    const { result } = renderHook(() => useFanIdentity(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBeNull();
  });

  it('leitura que falhou para de carregar, para a tela cair no nome de reserva', async () => {
    signIn();
    getDocMock.mockRejectedValue(new Error('permission-denied'));

    const { result } = renderHook(() => useFanIdentity(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.name).toBe('Camila da Sessão');
  });
});

describe('perfil público de outro fã (seção 28)', () => {
  it('nas fixtures, o perfil de exemplo, com retrato de 30 s e fora do disco', async () => {
    const { result } = renderHook(() => useFanProfileQuery('fa-rank-01'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      uid: 'fa-rank-01',
      displayName: 'Thalita Santos',
      restricted: false,
    });
    const query = client.getQueryCache().find({ queryKey: fanKeys.profile('fa-rank-01') });
    expect(query?.meta).toMatchObject({ persist: false });
    expect(result.current.isStale).toBe(false);
    // O prazo exato: o `isStale` falso logo depois da busca passaria com qualquer
    // valor positivo, `Infinity` inclusive.
    expect(query?.observers[0]?.options.staleTime).toBe(30_000);
  });

  it('o ✓ que salva invalida o perfil público do próprio fã, e o de outro fica', async () => {
    signIn();
    mockDataSource = 'api';
    const edited: EditableProfile = {
      displayName: 'Camila Ribeiro',
      username: 'camilarib',
      usernameChangeableAt: null,
      bio: 'Oi',
      city: null,
      gender: null,
      privateAccount: false,
      socials: { instagram: null, tiktok: null, linkedin: null, x: null },
    };
    jest.mocked(api.put).mockResolvedValue({ data: edited });
    const mine = { uid: 'uid-camila' } as FanPublicProfile;
    const other = { uid: 'fa-rank-01' } as FanPublicProfile;
    client.setQueryData(fanKeys.profile('uid-camila'), mine);
    client.setQueryData(fanKeys.profile('fa-rank-01'), other);

    const { result } = renderHook(() => useUpdateProfileMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ bio: 'Oi' });
    });

    const state = (fanId: string) =>
      client.getQueryCache().find({ queryKey: fanKeys.profile(fanId) })?.state.isInvalidated;
    expect(state('uid-camila')).toBe(true);
    expect(state('fa-rank-01')).toBe(false);
  });
});
