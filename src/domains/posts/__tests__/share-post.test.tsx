import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Platform, Share } from 'react-native';

import { useShareArtist } from '@/domains/artist-page/hooks/use-share-artist';
import { api } from '@/services/api';

import { useSharePoints, useSharePost } from '../hooks/use-share-post';

// O build do Firebase que o Jest resolve é ESM; aqui nada chega a ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({
  ...jest.requireActual('@/services/api/errors'),
  api: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
}));
jest.mock('@/config/data-source', () => ({ sourceOf: () => 'api', usesFixtures: () => true }));

const get = jest.mocked(api.get);
const put = jest.mocked(api.put);

const INVITE = {
  code: 'K7P3M9QX',
  url: 'https://imagineup.app/?ref=K7P3M9QX',
  linkBase: 'https://imagineup.app',
  pointsPerVisit: 5,
  pointsPerSignup: 12,
};

const POST = {
  id: 'p-clipe',
  artist: { id: 'nettobrito', name: 'Netto Brito', verified: true, photoURL: null },
};

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const originalOS = Platform.OS;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  get.mockResolvedValue({ data: INVITE });
  put.mockResolvedValue({ data: { linkId: 'x', created: true } });
});

afterEach(() => {
  Platform.OS = originalOS;
  client.clear();
  jest.restoreAllMocks();
});

/** Espera o convite do servidor chegar ao cache (o código e a base). */
async function inviteLoaded(): Promise<void> {
  await waitFor(() => expect(client.getQueryData(['profile', 'invite'])).toEqual(INVITE));
}

describe('compartilhar um post conta o link', () => {
  it('folha compartilhada, com o código do servidor: o link na base dele e o PUT do post:<id>', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const { result } = renderHook(() => useSharePost(), { wrapper });
    await inviteLoaded();

    result.current(POST);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://imagineup.app/post/p-clipe?ref=K7P3M9QX' }),
    );
    expect(put).toHaveBeenCalledWith('/me/invite/links/post%3Ap-clipe', undefined, {
      headers: { 'Idempotency-Key': expect.any(String) },
    });
  });

  it('folha fechada sem compartilhar (iOS): não conta', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    const { result } = renderHook(() => useSharePost(), { wrapper });
    await inviteLoaded();

    result.current(POST);
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(put).not.toHaveBeenCalled();
  });

  it('sem o código (não carregou): o link sai puro e não conta', async () => {
    get.mockRejectedValue(new Error('sem rede'));
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const { result } = renderHook(() => useSharePost(), { wrapper });
    await waitFor(() => expect(client.getQueryState(['profile', 'invite'])?.status).toBe('error'));

    result.current(POST);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://imagineup-painel.vercel.app/post/p-clipe' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(put).not.toHaveBeenCalled();
  });

  it('a central conta como artist:<id>', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const { result } = renderHook(() => useShareArtist(), { wrapper });
    await inviteLoaded();

    result.current({ id: 'nettobrito', name: 'Netto Brito' });
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/me/invite/links/artist%3Anettobrito',
        undefined,
        expect.anything(),
      ),
    );
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://imagineup.app/artista/nettobrito?ref=K7P3M9QX' }),
    );
  });
});

describe('o "+N" do compartilhar', () => {
  it('é o pointsPerVisit do convite, o mesmo da sheet "Gerar meu link"', async () => {
    const { result } = renderHook(() => useSharePoints({ sharePointsPerVisit: 2 }), { wrapper });
    // Antes de o convite chegar, vale o do post de exemplo.
    expect(result.current).toBe(2);
    await waitFor(() => expect(result.current).toBe(5));
  });

  it('o post que não rende (null ou 0) não promete pontos', async () => {
    const empty = renderHook(() => useSharePoints({ sharePointsPerVisit: null }), { wrapper });
    const zero = renderHook(() => useSharePoints({ sharePointsPerVisit: 0 }), { wrapper });
    await inviteLoaded();
    expect(empty.result.current).toBe(0);
    expect(zero.result.current).toBe(0);
  });
});
