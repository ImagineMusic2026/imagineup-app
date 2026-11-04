import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router, Stack, type Href } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { AccessibilityInfo, Alert, Platform, Text } from 'react-native';

import SupportRoute from '@/app/suporte/[tipo]';
import { supportDeviceOf } from '@/domains/settings/support-device';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { haptics } from '@/services/haptics';

// O Suporte dos Ajustes (seção 38 de docs/arquitetura-api.md): Reportar
// problema, Sugerir funcionalidade e Feedback geral, uma tela por tipo, com o
// X, o campo grande com o teclado aberto e o "Enviar".

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
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
// Na API por padrão; o caso das fixtures troca.
let mockSource: 'api' | 'fixtures' = 'api';
jest.mock('@/config/data-source', () => ({
  sourceOf: () => mockSource,
  usesFixtures: () => mockSource === 'fixtures',
}));
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: Object.create(actual.default, {
      expoConfig: { get: () => ({ name: 'ImagineUP', slug: 'imagineup', version: '0.1.0' }) },
    }),
  };
});
jest.mock('expo-updates', () => ({
  __esModule: true,
  isEmbeddedLaunch: false,
  createdAt: new Date(2026, 10, 3, 18, 18),
  updateId: '01a1a459-0000-4000-8000-000000000000',
}));

let client: QueryClient;

function RootLayout() {
  return (
    <QueryClientProvider client={client}>
      <Stack screenOptions={{ headerShown: false }} />
    </QueryClientProvider>
  );
}

const appTree = {
  _layout: RootLayout,
  index: () => <Text>ajustes</Text>,
  'suporte/[tipo]': SupportRoute,
};

const post = jest.mocked(api.post);
const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);

/** Abre a tela por cima de uma de baixo, como os Ajustes abrem. */
async function open(path: string) {
  const view = renderRouter(appTree, { initialUrl: '/' });
  act(() => router.push(path as Href));
  await waitFor(() => expect(view.getPathname()).toBe(path));
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSource = 'api';
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  post.mockResolvedValue({ data: { id: 'msg1', status: 'sent' } });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

describe('as três telas', () => {
  it.each([
    ['/suporte/problema', 'Reportar problema', 'Descreva o problema...'],
    ['/suporte/sugestao', 'Sugerir funcionalidade', 'Conte sua ideia...'],
    ['/suporte/feedback', 'Feedback geral', 'Conte o que você achou do app...'],
  ])(
    '%s: o título no meio, o X para fechar, o campo grande com o teclado aberto',
    async (path, title, placeholder) => {
      await open(path);

      expect(screen.getByRole('header', { name: title })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy();
      const field = screen.getByTestId('support-text');
      expect(field).toHaveProp('placeholder', placeholder);
      expect(field).toHaveProp('autoFocus', true);
      expect(field).toHaveProp('multiline', true);
      expect(field).toHaveProp('maxLength', 2_000);
      expect(screen.getByText('0/2000', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Enviar a mensagem' })).toBeTruthy();
    },
  );

  it('o endereço de outro tipo mostra a página não encontrada, com o X', async () => {
    await open('/suporte/elogio');
    expect(screen.getByText('Página não encontrada')).toBeTruthy();
    expect(screen.queryByTestId('support-text')).toBeNull();
  });

  it('o problema avisa que a versão do app e a do sistema vão junto; os outros, não', async () => {
    await open('/suporte/problema');
    expect(screen.getByTestId('support-note')).toHaveTextContent(/versão do app e a do sistema/);
    act(() => router.replace('/suporte/sugestao' as Href));
    await waitFor(() =>
      expect(screen.getByRole('header', { name: 'Sugerir funcionalidade' })).toBeTruthy(),
    );
    expect(screen.getByTestId('support-note')).not.toHaveTextContent(/versão do app/);
    expect(screen.getByTestId('support-note')).toHaveTextContent(/não responde por aqui/);
  });
});

describe('enviar', () => {
  it('o problema vai com o aparelho, a chave e o texto; a tela vira o "Mensagem enviada"', async () => {
    await open('/suporte/problema');

    fireEvent.changeText(screen.getByTestId('support-text'), 'A agenda fica em branco.');
    expect(screen.getByText('24/2000', { includeHiddenElements: true })).toBeTruthy();
    fireEvent.press(screen.getByTestId('support-send'));

    await waitFor(() => expect(screen.getByTestId('support-sent')).toBeTruthy());
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body, config] = post.mock.calls[0]!;
    expect(url).toBe('/me/support');
    expect(body).toEqual({
      kind: 'problem',
      text: 'A agenda fica em branco.',
      // A versão do sistema depende do Jest (no Android de verdade, "14"): os
      // casos dela estão no supportDeviceOf, no fim do arquivo.
      device: expect.objectContaining({
        platform: Platform.OS,
        appVersion: '0.1.0',
        updateId: '01a1a459',
      }),
    });
    expect((config as { headers: Record<string, string> }).headers['Idempotency-Key']).toMatch(
      /^support-problem-/,
    );
    expect(screen.getByText('Mensagem enviada')).toBeTruthy();
    expect(announced()).toContain('Mensagem enviada. Obrigado!');
    expect(haptics.trigger).toHaveBeenCalledWith('success');
  });

  it('a sugestão e o feedback vão sem o aparelho', async () => {
    await open('/suporte/feedback');
    fireEvent.changeText(screen.getByTestId('support-text'), 'Amei o app!');
    fireEvent.press(screen.getByTestId('support-send'));
    await waitFor(() => expect(screen.getByTestId('support-sent')).toBeTruthy());
    expect(post.mock.calls[0]![1]).toEqual({ kind: 'feedback', text: 'Amei o app!' });
  });

  it('sem texto, nada sai: a frase no campo e o anúncio', async () => {
    await open('/suporte/sugestao');
    fireEvent.changeText(screen.getByTestId('support-text'), '   ');
    fireEvent.press(screen.getByTestId('support-send'));
    await waitFor(() => expect(announced()).toContain('Escreva a mensagem antes de enviar.'));
    expect(post).not.toHaveBeenCalled();
  });

  it('o teto do dia: a frase do limite, e o texto fica no campo', async () => {
    post.mockRejectedValueOnce(
      new ApiError('dailyLimit', 'Ações demais.', 429, 'too_many_requests', {
        limit: 5,
        action: 'support',
      }),
    );
    await open('/suporte/sugestao');
    fireEvent.changeText(screen.getByTestId('support-text'), 'Salvar os posts.');
    fireEvent.press(screen.getByTestId('support-send'));

    await waitFor(() =>
      expect(screen.getByTestId('support-error')).toHaveTextContent(
        'Você chegou ao limite de mensagens de hoje. Tente amanhã.',
      ),
    );
    expect(screen.getByTestId('support-text')).toHaveProp('value', 'Salvar os posts.');
    expect(screen.queryByTestId('support-sent')).toBeNull();
  });

  it('a falha incerta: a nova tentativa do mesmo texto repete a chave', async () => {
    post.mockRejectedValueOnce(new ApiError('server', 'Fora.', 503, 'unavailable'));
    await open('/suporte/feedback');
    fireEvent.changeText(screen.getByTestId('support-text'), 'Muito bom.');
    fireEvent.press(screen.getByTestId('support-send'));
    await waitFor(() =>
      expect(screen.getByTestId('support-error')).toHaveTextContent(
        'Não deu para enviar agora. Tente de novo.',
      ),
    );
    fireEvent.press(screen.getByTestId('support-send'));
    await waitFor(() => expect(screen.getByTestId('support-sent')).toBeTruthy());
    const keys = post.mock.calls.map(
      ([, , config]) => (config as { headers: Record<string, string> }).headers['Idempotency-Key'],
    );
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('sem conexão, o botão fica desligado e a tela diz por quê', async () => {
    onlineManager.setOnline(false);
    await open('/suporte/problema');
    expect(screen.getByTestId('support-offline')).toHaveTextContent(
      'Sem conexão. Conecte-se para enviar.',
    );
    fireEvent.changeText(screen.getByTestId('support-text'), 'Travou.');
    fireEvent.press(screen.getByTestId('support-send'));
    expect(post).not.toHaveBeenCalled();
  });

  it('sem a API (o Expo Go sem o .env), finge o envio, sem chamar o servidor', async () => {
    mockSource = 'fixtures';
    await open('/suporte/sugestao');
    fireEvent.changeText(screen.getByTestId('support-text'), 'Ideia.');
    fireEvent.press(screen.getByTestId('support-send'));
    await waitFor(() => expect(screen.getByTestId('support-sent')).toBeTruthy());
    expect(post).not.toHaveBeenCalled();
  });
});

describe('fechar', () => {
  it('sem texto, o X fecha na hora', async () => {
    const view = await open('/suporte/feedback');
    fireEvent.press(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('com texto, o X pergunta antes; "Descartar" fecha', async () => {
    const view = await open('/suporte/sugestao');
    fireEvent.changeText(screen.getByTestId('support-text'), 'Uma ideia.');
    fireEvent.press(screen.getByRole('button', { name: 'Fechar' }));

    expect(Alert.alert).toHaveBeenCalledWith(
      'Descartar a mensagem?',
      'O que você escreveu não vai ser enviado.',
      expect.any(Array),
    );
    const buttons = jest.mocked(Alert.alert).mock.calls[0]![2]!;
    expect(buttons.map((button) => button.text)).toEqual(['Continuar escrevendo', 'Descartar']);
    act(() => buttons[1]!.onPress?.());
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });

  it('enviada, o "Fechar" volta para os Ajustes', async () => {
    const view = await open('/suporte/feedback');
    fireEvent.changeText(screen.getByTestId('support-text'), 'Muito bom.');
    fireEvent.press(screen.getByTestId('support-send'));
    await waitFor(() => expect(screen.getByTestId('support-sent')).toBeTruthy());
    fireEvent.press(screen.getByTestId('support-sent-close'));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
  });
});

describe('o aparelho do problema', () => {
  it('o sistema, as versões cortadas em 40 e o vazio como null; fora do Android e do iOS, null', () => {
    expect(
      supportDeviceOf({
        os: 'android',
        osVersion: '14',
        appVersion: '0.1.0',
        updateId: '01a1a459',
      }),
    ).toEqual({ platform: 'android', osVersion: '14', appVersion: '0.1.0', updateId: '01a1a459' });
    expect(
      supportDeviceOf({ os: 'ios', osVersion: 17.4, appVersion: null, updateId: null }),
    ).toEqual({ platform: 'ios', osVersion: '17.4', appVersion: null, updateId: null });
    expect(
      supportDeviceOf({
        os: 'android',
        osVersion: ' ',
        appVersion: 'x'.repeat(50),
        updateId: null,
      }),
    ).toEqual({ platform: 'android', osVersion: null, appVersion: 'x'.repeat(40), updateId: null });
    expect(
      supportDeviceOf({ os: 'web', osVersion: '1', appVersion: null, updateId: null }),
    ).toBeNull();
  });
});
