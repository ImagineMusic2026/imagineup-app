import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { profileKeys, type PreparedFanClubPhoto } from '@/domains/profile';
import { ApiError } from '@/services/api/errors';
import { useSessionStore } from '@/stores/session';

import {
  applyForFanClub,
  createFanClubPost,
  fanClubFileUploaded,
  openFanClubUpload,
  removeFanClubPost,
  uploadFanClubFile,
  withdrawApplication,
} from '../api';
import { fanClubKeys } from '../keys';
import {
  useApplyForFanClubMutation,
  useCreateFanClubPostMutation,
  useRemoveFanClubPostMutation,
  useWithdrawApplicationMutation,
} from '../queries';
import type { FanClubApplicationBody, MyFanClub, OwnFanClubPost } from '../types';

// As gravações das telas da etapa 7 (34.9): a chave da tentativa, o envio da
// foto em três passos com a tentativa guardada, e o cache depois de cada uma.

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({ sourceOf: () => 'api', usesFixtures: () => false }));
jest.mock('../api', () => ({
  applyForFanClub: jest.fn(),
  withdrawApplication: jest.fn(),
  acceptFanClubRules: jest.fn(),
  removeFanClubPost: jest.fn(),
  openFanClubUpload: jest.fn(),
  uploadFanClubFile: jest.fn(),
  fanClubFileUploaded: jest.fn(),
  createFanClubPost: jest.fn(),
}));

const MINE: MyFanClub = {
  open: true,
  rulesUrl: null,
  rulesVersion: 'termos-2026-10',
  notice: null,
  application: null,
  club: null,
};

const BODY: FanClubApplicationBody = {
  artistId: 'nettobrito',
  name: 'Netto de Coração',
  instagram: 'camila',
  tiktok: null,
  whatsapp: '+5575991234567',
  pitch: 'Vou divulgar nos meus perfis e no grupo.',
  adult: true,
  rulesVersion: 'termos-2026-10',
};

const PHOTO: PreparedFanClubPhoto = {
  photo: { uri: 'file:///foto.jpg', size: 900_000, width: 1080, height: 1350 },
  thumb: { uri: 'file:///mini.jpg', size: 90_000, width: 480, height: 600 },
};

const POST: OwnFanClubPost = {
  id: 'fcp-1',
  clubId: 'fc-1',
  artistId: 'nettobrito',
  kind: 'photo',
  text: 'Que show!',
  photo: null,
  thumb: null,
  status: 'pending',
  rejectReason: null,
  submittedAt: '2026-10-20T15:00:00.000Z',
  publishedAt: null,
  reviewedAt: null,
};

const slot = (id: string, expiresAt = '2099-01-01T00:00:00.000Z') => ({
  photoPath: `fanClubMedia/uid-camila/club-photo-${id}.jpg`,
  thumbPath: `fanClubMedia/uid-camila/club-thumb-${id}.jpg`,
  expiresAt,
});

const network = () => new ApiError('network', 'Sem rede.');
const refused = (reason: string) =>
  new ApiError('validation', 'Recusado.', 409, 'fan_club_refused', { reason });

let client: QueryClient;

/**
 * Roda a gravação dentro do `act` e espera o aviso do Query ao hook, que sai
 * num `setTimeout`. A falha fica para as conferências de depois.
 */
async function settle(run: () => Promise<unknown>): Promise<void> {
  await act(async () => {
    await run().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  useSessionStore.setState({
    status: 'signedIn',
    user: { uid: 'uid-camila', email: null, displayName: null, photoURL: null },
    authHolds: 0,
  });
});

afterEach(() => client.clear());

describe('candidatar e desistir', () => {
  it('a mesma chave depois da falha incerta; o sucesso põe o estado e o WhatsApp no cache', async () => {
    jest.mocked(applyForFanClub).mockRejectedValueOnce(network());
    jest.mocked(applyForFanClub).mockResolvedValueOnce(MINE);
    const { result } = renderHook(() => useApplyForFanClubMutation(), { wrapper });

    await settle(() => result.current.mutateAsync(BODY));
    await settle(() => result.current.mutateAsync(BODY));

    const keys = jest.mocked(applyForFanClub).mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(keys[0]).toMatch(/^club-apply-/);
    expect(keys[1]).toBe(keys[0]);
    expect(client.getQueryData(fanClubKeys.mine())).toEqual(MINE);
    expect(client.getQueryData(profileKeys.contact())).toEqual({ whatsapp: '+5575991234567' });
  });

  it('depois da recusa definitiva, chave nova, e o estado do fã busca de novo', async () => {
    jest.mocked(applyForFanClub).mockRejectedValueOnce(refused('already_applied'));
    jest.mocked(applyForFanClub).mockResolvedValueOnce(MINE);
    client.setQueryData(fanClubKeys.mine(), MINE);
    const { result } = renderHook(() => useApplyForFanClubMutation(), { wrapper });

    await settle(() => result.current.mutateAsync(BODY));
    expect(client.getQueryState(fanClubKeys.mine())?.isInvalidated).toBe(true);
    await settle(() => result.current.mutateAsync(BODY));
    const keys = jest.mocked(applyForFanClub).mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('a resposta que chega depois da troca de sessão não vai ao cache do fã seguinte', async () => {
    let finish: (value: MyFanClub) => void = () => undefined;
    jest.mocked(applyForFanClub).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(() => useApplyForFanClubMutation(), { wrapper });
    await act(async () => {
      result.current.mutate(BODY);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    act(() =>
      useSessionStore.setState({
        user: { uid: 'outra', email: null, displayName: null, photoURL: null },
      }),
    );
    await settle(async () => finish(MINE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(fanClubKeys.mine())).toBeUndefined();
  });

  it('desistir põe o estado novo no cache', async () => {
    const withdrawn = { ...MINE, application: null };
    jest.mocked(withdrawApplication).mockResolvedValueOnce(withdrawn);
    const { result } = renderHook(() => useWithdrawApplicationMutation(), { wrapper });
    await settle(() => result.current.mutateAsync());
    expect(jest.mocked(withdrawApplication).mock.calls[0]![0].idempotencyKey).toMatch(
      /^club-withdraw-/,
    );
    expect(client.getQueryData(fanClubKeys.mine())).toEqual(withdrawn);
  });
});

describe('publicar', () => {
  it('só texto: o POST com a chave, sem vaga nem envio', async () => {
    jest.mocked(createFanClubPost).mockResolvedValueOnce({ ...POST, kind: 'text' });
    const { result } = renderHook(() => useCreateFanClubPostMutation(), { wrapper });
    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: null }));
    expect(openFanClubUpload).not.toHaveBeenCalled();
    expect(uploadFanClubFile).not.toHaveBeenCalled();
    expect(createFanClubPost).toHaveBeenCalledWith({
      text: 'Que show!',
      photo: false,
      idempotencyKey: expect.stringMatching(/^club-post-/),
    });
  });

  it('com foto: a vaga, os dois arquivos nos caminhos dela e o POST com photo: true', async () => {
    jest.mocked(openFanClubUpload).mockResolvedValueOnce(slot('a1b2c3d4'));
    jest.mocked(createFanClubPost).mockResolvedValueOnce(POST);
    client.setQueryData(fanClubKeys.mine(), MINE);
    const { result } = renderHook(() => useCreateFanClubPostMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));

    expect(openFanClubUpload).toHaveBeenCalledWith({
      idempotencyKey: expect.stringMatching(/^club-upload-/),
    });
    expect(jest.mocked(uploadFanClubFile).mock.calls).toEqual([
      ['fanClubMedia/uid-camila/club-photo-a1b2c3d4.jpg', 'file:///foto.jpg'],
      ['fanClubMedia/uid-camila/club-thumb-a1b2c3d4.jpg', 'file:///mini.jpg'],
    ]);
    expect(createFanClubPost).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Que show!', photo: true }),
    );
    // Sempre em análise: o estado do fã (o "em análise") busca de novo.
    expect(client.getQueryState(fanClubKeys.mine())?.isInvalidated).toBe(true);
  });

  it('a falha incerta no POST: a nova tentativa usa a mesma vaga, não sobe de novo o que chegou e repete a chave', async () => {
    jest.mocked(openFanClubUpload).mockResolvedValueOnce(slot('a1b2c3d4'));
    jest.mocked(fanClubFileUploaded).mockResolvedValue(true);
    jest.mocked(createFanClubPost).mockRejectedValueOnce(network()).mockResolvedValueOnce(POST);
    const { result } = renderHook(() => useCreateFanClubPostMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));
    expect(result.current.failedStep()).toBe('post');
    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));

    expect(openFanClubUpload).toHaveBeenCalledTimes(1);
    expect(uploadFanClubFile).toHaveBeenCalledTimes(2);
    expect(fanClubFileUploaded).toHaveBeenCalledTimes(2);
    const keys = jest.mocked(createFanClubPost).mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
  });

  it('a falha no envio de um arquivo: a nova tentativa confere, e sobe só o que não chegou', async () => {
    jest.mocked(openFanClubUpload).mockResolvedValueOnce(slot('a1b2c3d4'));
    jest
      .mocked(uploadFanClubFile)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TypeError('Não deu para ler o arquivo local.'))
      .mockResolvedValueOnce(undefined);
    jest.mocked(fanClubFileUploaded).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    jest.mocked(createFanClubPost).mockResolvedValueOnce(POST);
    const { result } = renderHook(() => useCreateFanClubPostMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));
    expect(result.current.failedStep()).toBe('upload');
    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));

    expect(jest.mocked(uploadFanClubFile).mock.calls.map(([path]) => path)).toEqual([
      'fanClubMedia/uid-camila/club-photo-a1b2c3d4.jpg',
      'fanClubMedia/uid-camila/club-thumb-a1b2c3d4.jpg',
      'fanClubMedia/uid-camila/club-thumb-a1b2c3d4.jpg',
    ]);
    expect(openFanClubUpload).toHaveBeenCalledTimes(1);
  });

  it('o upload_missing abre sozinho uma tentativa nova, uma vez, com a mesma foto', async () => {
    jest
      .mocked(openFanClubUpload)
      .mockResolvedValueOnce(slot('a1b2c3d4'))
      .mockResolvedValueOnce(slot('e5f6a7b8'));
    jest
      .mocked(createFanClubPost)
      .mockRejectedValueOnce(refused('upload_missing'))
      .mockResolvedValueOnce(POST);
    const { result } = renderHook(() => useCreateFanClubPostMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));

    const slotKeys = jest.mocked(openFanClubUpload).mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(slotKeys[1]).not.toBe(slotKeys[0]);
    expect(jest.mocked(uploadFanClubFile).mock.calls.map(([path]) => path)).toEqual([
      'fanClubMedia/uid-camila/club-photo-a1b2c3d4.jpg',
      'fanClubMedia/uid-camila/club-thumb-a1b2c3d4.jpg',
      'fanClubMedia/uid-camila/club-photo-e5f6a7b8.jpg',
      'fanClubMedia/uid-camila/club-thumb-e5f6a7b8.jpg',
    ]);
    const postKeys = jest.mocked(createFanClubPost).mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(postKeys[1]).not.toBe(postKeys[0]);
  });

  it('a vaga vencida abre outra, com chave nova', async () => {
    jest
      .mocked(openFanClubUpload)
      .mockResolvedValueOnce(slot('a1b2c3d4', '2000-01-01T00:00:00.000Z'))
      .mockResolvedValueOnce(slot('e5f6a7b8'));
    jest.mocked(createFanClubPost).mockRejectedValueOnce(network()).mockResolvedValueOnce(POST);
    const { result } = renderHook(() => useCreateFanClubPostMutation(), { wrapper });

    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));
    await settle(() => result.current.mutateAsync({ text: 'Que show!', photo: PHOTO }));

    expect(openFanClubUpload).toHaveBeenCalledTimes(2);
    expect(jest.mocked(uploadFanClubFile)).toHaveBeenLastCalledWith(
      'fanClubMedia/uid-camila/club-thumb-e5f6a7b8.jpg',
      'file:///mini.jpg',
    );
  });

  it('outro texto depois da falha é outra publicação, com chaves novas', async () => {
    jest.mocked(createFanClubPost).mockRejectedValueOnce(network()).mockResolvedValueOnce(POST);
    const { result } = renderHook(() => useCreateFanClubPostMutation(), { wrapper });
    await settle(() => result.current.mutateAsync({ text: 'Primeiro', photo: null }));
    await settle(() => result.current.mutateAsync({ text: 'Outro', photo: null }));
    const keys = jest.mocked(createFanClubPost).mock.calls.map(([vars]) => vars.idempotencyKey);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe('retirar e tirar do ar', () => {
  it('troca o status da linha na lista e busca o estado do fã de novo', async () => {
    client.setQueryData(fanClubKeys.myPosts(), {
      pages: [{ items: [POST], nextCursor: null }],
      pageParams: [null],
    });
    client.setQueryData(fanClubKeys.mine(), MINE);
    jest.mocked(removeFanClubPost).mockResolvedValueOnce({ ...POST, status: 'withdrawn' });
    const { result } = renderHook(() => useRemoveFanClubPostMutation(), { wrapper });

    await settle(() => result.current.mutateAsync('fcp-1'));

    expect(removeFanClubPost).toHaveBeenCalledWith({
      postId: 'fcp-1',
      idempotencyKey: expect.stringMatching(/^club-remove-/),
    });
    const data = client.getQueryData<{ pages: { items: OwnFanClubPost[] }[] }>(
      fanClubKeys.myPosts(),
    );
    expect(data?.pages[0]!.items[0]!.status).toBe('withdrawn');
    expect(client.getQueryState(fanClubKeys.mine())?.isInvalidated).toBe(true);
  });
});
