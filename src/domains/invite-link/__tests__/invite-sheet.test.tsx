import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { t } from '@/i18n';
import { api } from '@/services/api';

import { InviteSheetScreen } from '../views/invite-sheet';

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), request: jest.fn() },
}));

// Fixtures por padrão; o teste do código que não veio troca para a API.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockDataSource,
  usesFixtures: () => mockDataSource === 'fixtures',
}));

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const get = jest.mocked(api.get);
const put = jest.mocked(api.put);

let client: QueryClient;

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}

const shareButton = () => screen.getByRole('button', { name: t('invite.share') });

describe('sheet "Gerar meu link"', () => {
  beforeEach(() => {
    mockDataSource = 'fixtures';
    mockParams = {};
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
    get.mockReset();
    put.mockReset();
  });

  it('pelo "+", o link leva ao app com o código do fã e diz quanto rende cada pessoa', async () => {
    render(<InviteSheetScreen />, { wrapper });

    expect(
      await screen.findByLabelText(
        'Seu link, com o seu código de convite, CAMILA12. Leva para o ImagineUP.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('imagineup-painel.vercel.app/?ref=CAMILA12')).toBeTruthy();
    expect(screen.getByLabelText('2 pontos por pessoa que abre o link no app')).toBeTruthy();
    expect(screen.getByLabelText('10 pontos por pessoa que se cadastra pelo link')).toBeTruthy();
    expect(screen.queryByText(t('invite.noCode'))).toBeNull();
  });

  it('da missão do clipe, o link leva ao post e a tela diz para qual missão é', async () => {
    mockParams = { missionId: 'm-clipe-netto', postId: 'p-clipe' };
    render(<InviteSheetScreen />, { wrapper });

    expect(
      await screen.findByLabelText(
        'Seu link, com o seu código de convite, CAMILA12. Leva para o post de Netto Brito.',
      ),
    ).toBeTruthy();
    expect(
      await screen.findByText('Para a missão “Leve 5 pessoas para o clipe novo do Netto”'),
    ).toBeTruthy();

    fireEvent.press(shareButton());
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Olha esse post de Netto Brito no ImagineUP'),
      }),
    );
    const [content] = jest.mocked(Share.share).mock.calls[0] ?? [];
    expect(JSON.stringify(content)).toContain(
      'https://imagineup-painel.vercel.app/post/p-clipe?ref=CAMILA12',
    );
  });

  it('do "Chamar amigos", o link leva à agenda e a mensagem fala do show', async () => {
    mockParams = { eventId: 'sao-joao-irara' };
    render(<InviteSheetScreen />, { wrapper });

    expect(
      await screen.findByLabelText(
        'Seu link, com o seu código de convite, CAMILA12. Leva para a agenda de shows: São João de Irará.',
      ),
    ).toBeTruthy();
    fireEvent.press(shareButton());
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          'Vamos juntos? São João de Irará está na agenda do ImagineUP',
        ),
      }),
    );
  });

  it('sem o código, o link sai puro, a tela avisa que não rende pontos e deixa tentar de novo', async () => {
    mockDataSource = 'api';
    get.mockRejectedValue(new Error('sem rede'));
    render(<InviteSheetScreen />, { wrapper });

    expect(await screen.findByText(t('invite.noCode'))).toBeTruthy();
    expect(
      screen.getByLabelText('Seu link, ainda sem o seu código de convite. Leva para o ImagineUP.'),
    ).toBeTruthy();
    // As regras de pontos vêm com o código: sem ele, não aparecem.
    expect(screen.queryByLabelText('2 pontos por pessoa que abre o link no app')).toBeNull();
    expect(shareButton()).not.toBeDisabled();

    get.mockResolvedValue({
      data: { code: 'CAMILA12', pointsPerVisit: 2, pointsPerSignup: 10 },
    } as never);
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    // A nova busca leva quase 1 s no Jest: com a máquina ocupada, o prazo padrão estourava.
    expect(
      await screen.findByLabelText(
        'Seu link, com o seu código de convite, CAMILA12. Leva para o ImagineUP.',
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
    expect(screen.queryByText(t('invite.noCode'))).toBeNull();
  });
});

describe('o link nos "links criados" do Perfil', () => {
  beforeEach(() => {
    mockDataSource = 'api';
    mockParams = {};
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
    get.mockResolvedValue({
      data: {
        code: 'K7P3M9QX',
        url: 'https://imagineup.app/?ref=K7P3M9QX',
        linkBase: 'https://imagineup.app',
        pointsPerVisit: 3,
        pointsPerSignup: 12,
      },
    } as never);
    put.mockResolvedValue({ data: { linkId: 'invite', created: true } } as never);
  });

  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
    get.mockReset();
    put.mockReset();
  });

  it('com o código do servidor e a folha compartilhada, conta o link (invite), com a base do servidor', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    render(<InviteSheetScreen />, { wrapper });
    expect(await screen.findByText('imagineup.app/?ref=K7P3M9QX')).toBeTruthy();
    expect(screen.getByLabelText('3 pontos por pessoa que abre o link no app')).toBeTruthy();

    fireEvent.press(shareButton());
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('/me/invite/links/invite', undefined, {
      headers: { 'Idempotency-Key': expect.any(String) },
    });
  });

  it('do show, o link conta como agenda', async () => {
    mockParams = { eventId: 'sao-joao-irara' };
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    render(<InviteSheetScreen />, { wrapper });
    await screen.findByText(/imagineup\.app\/agenda\?ref=K7P3M9QX/);
    fireEvent.press(shareButton());
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/me/invite/links/agenda', undefined, expect.anything()),
    );
  });

  it('a folha fechada sem compartilhar (iOS) não conta', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    render(<InviteSheetScreen />, { wrapper });
    await screen.findByText('imagineup.app/?ref=K7P3M9QX');
    fireEvent.press(shareButton());
    await waitFor(() => expect(Share.share).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(put).not.toHaveBeenCalled();
  });
});
