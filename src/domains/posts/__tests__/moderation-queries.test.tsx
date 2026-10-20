import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { fanClubKeys } from '@/domains/fan-club/keys';
import { fanKeys, type FanPublicProfile } from '@/domains/profile';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';
import { shouldPersistQuery } from '@/services/query/persister';

import { blockFan, fetchBlockedFans, reportComment, reportFan, unblockFan } from '../api';
import { moderationFixture } from '../fixtures';
import { moderationKeys, postKeys } from '../keys';
import {
  useBlockedFansInfiniteQuery,
  useBlockFanMutation,
  useCachedComment,
  useReportCommentMutation,
  useReportFanMutation,
  useUnblockFanMutation,
} from '../queries';
import type { BlockedFan, BlockedFansPage, Page, PostComment } from '../types';

// O perfil (Firestore) entra pelo domínio de perfil; nada aqui fala com ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));
// Denunciar e bloquear passam pelas fixtures; os testes trocam a resposta.
jest.mock('../api', () => {
  const actual = jest.requireActual<typeof import('../api')>('../api');
  return {
    ...actual,
    reportComment: jest.fn(actual.reportComment),
    blockFan: jest.fn(actual.blockFan),
    unblockFan: jest.fn(actual.unblockFan),
    reportFan: jest.fn(actual.reportFan),
    fetchBlockedFans: jest.fn(actual.fetchBlockedFans),
  };
});

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const comment = (id: string, authorId: string): PostComment => ({
  id,
  postId: 'p-clipe',
  authorId,
  authorName: authorId,
  authorAvatarUrl: null,
  authorIsArtist: false,
  text: `Comentário ${id}`,
  createdAt: '2026-09-29T20:00:00.000Z',
});

const page = (items: PostComment[]): InfiniteData<Page<PostComment>> => ({
  pages: [{ items, nextCursor: null }],
  pageParams: [null],
});

const ids = (postId: string) =>
  client
    .getQueryData<InfiniteData<Page<PostComment>>>(postKeys.comments(postId))
    ?.pages.flatMap((p) => p.items.map((item) => item.id));

beforeEach(() => {
  jest.clearAllMocks();
  moderationFixture.reset();
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  client.setQueryData(
    postKeys.comments('p-clipe'),
    page([comment('c1', 'uidEnzo'), comment('c2', 'uidBia'), comment('c3', 'uidEnzo')]),
  );
  client.setQueryData(postKeys.comments('p-show'), page([comment('c4', 'uidEnzo')]));
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('bloquear um fã', () => {
  it('no sucesso, os comentários do bloqueado saem de todo cache de comentários e as listas buscam de novo', async () => {
    const onDone = jest.fn();
    const { result } = renderHook(() => useBlockFanMutation('uidEnzo', { onDone }), { wrapper });
    act(() => result.current.block());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ fanId: 'uidEnzo', blocked: true }));
    expect(ids('p-clipe')).toEqual(['c2']);
    expect(ids('p-show')).toEqual([]);
    expect(client.getQueryState(postKeys.comments('p-clipe'))?.isInvalidated).toBe(true);
  });

  it('bloquear e desbloquear zeram o que os fãs veem dos fã-clubes (seção 34, decisões 19 e 32)', async () => {
    client.setQueryData(fanClubKeys.follows(), { items: [] });
    client.setQueryData(fanClubKeys.club('fc-1'), { id: 'fc-1' });
    const { result } = renderHook(() => useBlockFanMutation('uidEnzo'), { wrapper });
    act(() => result.current.block());
    await waitFor(() =>
      expect(client.getQueryState(fanClubKeys.follows())?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(fanClubKeys.club('fc-1'))?.isInvalidated).toBe(true);

    client.setQueryData(fanClubKeys.feed(), { pages: [], pageParams: [] });
    const unblock = renderHook(() => useUnblockFanMutation('uidEnzo'), { wrapper });
    act(() => unblock.result.current.unblock());
    await waitFor(() => expect(client.getQueryState(fanClubKeys.feed())?.isInvalidated).toBe(true));
  });

  it('no erro, nada sai do cache e o erro chega à sheet', async () => {
    jest.mocked(blockFan).mockRejectedValueOnce(new ApiError('server', 'Falhou.', 500));
    const onError = jest.fn();
    const { result } = renderHook(() => useBlockFanMutation('uidEnzo', { onError }), { wrapper });
    act(() => result.current.block());
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(ids('p-clipe')).toEqual(['c1', 'c2', 'c3']);
  });

  it('com a sheet fechada (o hook desmontado), tira do cache do mesmo jeito e só avisa', async () => {
    let resolve: (value: { fanId: string; blocked: boolean }) => void = () => undefined;
    jest.mocked(blockFan).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onDone = jest.fn();
    const hook = renderHook(() => useBlockFanMutation('uidEnzo', { onDone }), { wrapper });
    act(() => hook.result.current.block());
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));
    hook.unmount();
    await act(async () => resolve({ fanId: 'uidEnzo', blocked: true }));
    await waitFor(() => expect(ids('p-clipe')).toEqual(['c2']));
    expect(onDone).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Bloqueio feito. Os comentários somem para você.',
    );
  });

  it('depois de uma falha incerta, a mesma chave; depois de uma recusa, chave nova', async () => {
    const block = jest.mocked(blockFan);
    block
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', null))
      .mockRejectedValueOnce(new ApiError('validation', 'Recusado.', 409));
    const { result } = renderHook(() => useBlockFanMutation('uidEnzo'), { wrapper });
    act(() => result.current.block());
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => result.current.block());
    await waitFor(() => expect(block).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isError).toBe(true));
    act(() => result.current.block());
    await waitFor(() => expect(block).toHaveBeenCalledTimes(3));
    const keys = block.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});

describe('denunciar um comentário', () => {
  it('não muda cache nenhum; o resultado chega à sheet', async () => {
    const onDone = jest.fn();
    const { result } = renderHook(() => useReportCommentMutation('p-clipe', 'c1', { onDone }), {
      wrapper,
    });
    act(() => result.current.report('spam'));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ commentId: 'c1', status: 'reported' }),
    );
    expect(ids('p-clipe')).toEqual(['c1', 'c2', 'c3']);
    expect(client.getQueryState(postKeys.comments('p-clipe'))?.isInvalidated).toBe(false);
  });

  it('a mesma chave depois de falha incerta com o mesmo motivo; nova com outro motivo ou depois de recusa', async () => {
    const report = jest.mocked(reportComment);
    report
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', null))
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', null))
      .mockRejectedValueOnce(new ApiError('notFound', 'Sumiu.', 404));
    const { result } = renderHook(() => useReportCommentMutation('p-clipe', 'c1'), { wrapper });
    for (const reason of ['spam', 'spam', 'offensive', 'offensive'] as const) {
      const before = report.mock.calls.length;
      act(() => result.current.report(reason));
      await waitFor(() => expect(report.mock.calls.length).toBe(before + 1));
      await waitFor(() => expect(result.current.isPending).toBe(false));
    }
    const keys = report.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
  });
});

describe('o comentário da sheet (useCachedComment)', () => {
  it('vem do cache da lista do post; sem ele (aberta a frio), undefined', () => {
    const found = renderHook(() => useCachedComment('p-clipe', 'c2'), { wrapper });
    expect(found.result.current).toMatchObject({ id: 'c2', authorId: 'uidBia' });
    const missing = renderHook(() => useCachedComment('p-g1', 'c2'), { wrapper });
    expect(missing.result.current).toBeUndefined();
  });
});

const blockedFan = (uid: string): BlockedFan => ({
  uid,
  displayName: uid,
  username: uid.toLowerCase(),
  photoURL: null,
});

const THALITA: FanPublicProfile = {
  uid: 'uidThalita',
  displayName: 'Thalita Santos',
  username: 'thalitasan',
  photoURL: null,
  restricted: false,
  bio: null,
  socials: null,
  blockedByMe: false,
};

const blockedUids = () =>
  client
    .getQueryData<InfiniteData<BlockedFansPage>>(moderationKeys.blocked())
    ?.pages.flatMap((p) => p.items.map((item) => item.uid));

describe('bloquear e desbloquear pelo perfil público e pela lista (seção 29)', () => {
  beforeEach(() => {
    client.setQueryData(fanKeys.profile('uidThalita'), THALITA);
    client.setQueryData<InfiniteData<BlockedFansPage>>(moderationKeys.blocked(), {
      pages: [
        { items: [blockedFan('uidC'), blockedFan('uidThalita')], nextCursor: '1:uidThalita' },
        { items: [blockedFan('uidA')], nextCursor: null },
      ],
      pageParams: [null, '1:uidThalita'],
    });
  });

  it('bloquear muda o blockedByMe do perfil em cache e zera a lista (volta à primeira página)', async () => {
    jest.mocked(blockFan).mockResolvedValueOnce({ fanId: 'uidThalita', blocked: true });
    const onDone = jest.fn();
    const { result } = renderHook(() => useBlockFanMutation('uidThalita', { onDone }), {
      wrapper,
    });
    act(() => result.current.block());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(client.getQueryData<FanPublicProfile>(fanKeys.profile('uidThalita'))).toMatchObject({
      blockedByMe: true,
    });
    expect(client.getQueryState(fanKeys.profile('uidThalita'))?.isInvalidated).toBe(true);
    // A lista inativa sai do cache: a próxima abertura começa da primeira página.
    expect(client.getQueryData(moderationKeys.blocked())).toBeUndefined();
  });

  it('desbloquear tira o fã das páginas carregadas sem buscar de novo, e o perfil volta a "Bloquear"', async () => {
    client.setQueryData(fanKeys.profile('uidThalita'), { ...THALITA, blockedByMe: true });
    const onDone = jest.fn();
    const { result } = renderHook(() => useUnblockFanMutation('uidThalita', { onDone }), {
      wrapper,
    });
    act(() => result.current.unblock());
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ fanId: 'uidThalita', blocked: false }),
    );
    expect(blockedUids()).toEqual(['uidC', 'uidA']);
    expect(
      client.getQueryData<InfiniteData<BlockedFansPage>>(moderationKeys.blocked())?.pages[0]
        ?.nextCursor,
    ).toBe('1:uidThalita');
    expect(client.getQueryState(moderationKeys.blocked())?.isInvalidated).toBe(false);
    expect(fetchBlockedFans).not.toHaveBeenCalled();
    expect(client.getQueryData<FanPublicProfile>(fanKeys.profile('uidThalita'))).toMatchObject({
      blockedByMe: false,
    });
    // Os comentários do desbloqueado voltam: as listas buscam de novo.
    expect(client.getQueryState(postKeys.comments('p-clipe'))?.isInvalidated).toBe(true);
  });

  it('desbloquear um fã sem linha nas páginas carregadas zera a lista (volta à primeira página)', async () => {
    jest.mocked(unblockFan).mockResolvedValueOnce({ fanId: 'uidB', blocked: false });
    const onDone = jest.fn();
    const { result } = renderHook(() => useUnblockFanMutation('uidB', { onDone }), { wrapper });
    act(() => result.current.unblock());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // A lista inativa sai do cache: a próxima abertura começa da primeira página.
    expect(client.getQueryData(moderationKeys.blocked())).toBeUndefined();
  });

  it('nas fixtures, desbloquear pelo id do comentário (fa-thalita) tira a linha do id do ranking (fa-rank-01)', async () => {
    client.removeQueries({ queryKey: moderationKeys.blocked() });
    const list = renderHook(() => useBlockedFansInfiniteQuery(), { wrapper });
    const listed = () =>
      list.result.current.data?.pages.flatMap((p) => p.items.map((item) => item.uid));
    const block = renderHook(() => useBlockFanMutation('fa-thalita'), { wrapper });
    act(() => block.result.current.block());
    await waitFor(() => expect(listed()).toEqual(['fa-rank-01', 'fa-rank-13']));

    const unblock = renderHook(() => useUnblockFanMutation('fa-thalita'), { wrapper });
    act(() => unblock.result.current.unblock());
    await waitFor(() => expect(listed()).toEqual(['fa-rank-13']));
  });

  it('desbloquear: a mesma chave depois de falha incerta, nova depois de recusa, com o prefixo unblock-', async () => {
    const unblock = jest.mocked(unblockFan);
    unblock
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', null))
      .mockRejectedValueOnce(new ApiError('validation', 'Recusado.', 400));
    const { result } = renderHook(() => useUnblockFanMutation('uidThalita'), { wrapper });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      act(() => result.current.unblock());
      await waitFor(() => expect(unblock).toHaveBeenCalledTimes(attempt));
      await waitFor(() => expect(result.current.isPending).toBe(false));
    }
    const keys = unblock.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(keys[0]).toMatch(/^unblock-uidThalita-/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('desbloquear com o hook desmontado tira da lista do mesmo jeito e só avisa', async () => {
    let resolve: (value: { fanId: string; blocked: boolean }) => void = () => undefined;
    jest.mocked(unblockFan).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const hook = renderHook(() => useUnblockFanMutation('uidThalita'), { wrapper });
    act(() => hook.result.current.unblock());
    await waitFor(() => expect(hook.result.current.isPending).toBe(true));
    hook.unmount();
    await act(async () => resolve({ fanId: 'uidThalita', blocked: false }));
    await waitFor(() => expect(blockedUids()).toEqual(['uidC', 'uidA']));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Desbloqueio feito.');
  });
});

describe('denunciar um perfil (seção 29)', () => {
  it('não muda cache nenhum; o resultado chega à sheet', async () => {
    jest.mocked(reportFan).mockResolvedValueOnce({ fanId: 'uidThalita', status: 'reported' });
    const onDone = jest.fn();
    const { result } = renderHook(() => useReportFanMutation('uidThalita', { onDone }), {
      wrapper,
    });
    act(() => result.current.report(null));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ fanId: 'uidThalita', status: 'reported' }),
    );
    expect(jest.mocked(reportFan).mock.calls[0]?.[0]).toMatchObject({
      fanId: 'uidThalita',
      reason: null,
    });
    expect(ids('p-clipe')).toEqual(['c1', 'c2', 'c3']);
    expect(client.getQueryState(postKeys.comments('p-clipe'))?.isInvalidated).toBe(false);
  });

  it('a mesma chave depois de falha incerta com o mesmo motivo; nova com outro motivo ou depois de recusa', async () => {
    const report = jest.mocked(reportFan);
    report
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', null))
      .mockRejectedValueOnce(new ApiError('network', 'Sem rede.', null))
      .mockRejectedValueOnce(new ApiError('notFound', 'Sumiu.', 404, 'fan_not_found'));
    const { result } = renderHook(() => useReportFanMutation('uidThalita'), { wrapper });
    for (const reason of ['spam', 'spam', 'offensive', 'offensive'] as const) {
      const before = report.mock.calls.length;
      act(() => result.current.report(reason));
      await waitFor(() => expect(report.mock.calls.length).toBe(before + 1));
      await waitFor(() => expect(result.current.isPending).toBe(false));
    }
    const keys = report.mock.calls.map(([variables]) => variables.idempotencyKey);
    expect(keys[0]).toMatch(/^report-fan-uidThalita-/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(keys[3]).not.toBe(keys[2]);
  });
});

describe('a lista de bloqueados (seção 29)', () => {
  it('pagina pelo cursor do servidor e fica fora do disco (persist: false)', async () => {
    const { result } = renderHook(() => useBlockedFansInfiniteQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Nas fixtures, a fa-rank-13 do seed.
    expect(result.current.data?.pages[0]?.items.map((fan) => fan.uid)).toEqual(['fa-rank-13']);
    const query = client.getQueryCache().find({ queryKey: moderationKeys.blocked() });
    expect(query?.meta).toMatchObject({ persist: false });
    expect(shouldPersistQuery(query!, false)).toBe(false);
  });
});
