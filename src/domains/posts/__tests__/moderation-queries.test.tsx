import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';

import { blockFan, reportComment } from '../api';
import { moderationFixture } from '../fixtures';
import { postKeys } from '../keys';
import { useBlockFanMutation, useCachedComment, useReportCommentMutation } from '../queries';
import type { Page, PostComment } from '../types';

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
