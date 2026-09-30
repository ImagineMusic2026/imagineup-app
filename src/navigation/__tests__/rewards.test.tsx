import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import {
  act,
  fireEvent,
  renderRouter,
  screen,
  testRouter,
  waitFor,
} from 'expo-router/testing-library';
import { AccessibilityInfo, BackHandler, Text } from 'react-native';

import RewardDetailsRoute from '@/app/recompensa/[recompensaId]';
import RewardsRoute from '@/app/(tabs)/(ranking)/recompensas';
import { profileKeys } from '@/domains/profile';
import { rewardKeys } from '@/domains/rewards';
import { REDEEM_ERROR_CODES } from '@/domains/rewards/consts';
import { buildRewardsFixture, rewardsFixture } from '@/domains/rewards/fixtures';
import type { RedeemResult, RewardsResponse } from '@/domains/rewards/types';
import { t } from '@/i18n';
import { api } from '@/services/api';
import { ApiError } from '@/services/api/errors';
import { fixtureWallet } from '@/services/fixtures';
import { haptics } from '@/services/haptics';

// O build do Firebase que o Jest resolve é ESM; a loja só lê a carteira do
// domínio de perfil, que também lê o Firestore.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));

// Sem .env no Jest: fixtures. Os testes de resposta do servidor trocam para a API.
let mockDataSource: 'api' | 'fixtures' = 'fixtures';
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  get dataSource() {
    return mockDataSource;
  },
  firebaseEmulatorHost: undefined,
}));

// Sem layout nativo no Jest, a FlashList não mede nada e não desenha item nenhum.
jest.mock('@shopify/flash-list/dist/recyclerview/utils/measureLayout', () => {
  const actual = jest.requireActual('@shopify/flash-list/dist/recyclerview/utils/measureLayout');
  const screenSize = { x: 0, y: 0, width: 402, height: 2400 };
  return {
    ...actual,
    measureParentSize: jest.fn(() => screenSize),
    measureFirstChildLayout: jest.fn(() => screenSize),
    measureItemLayout: jest.fn(() => ({ x: 0, y: 0, width: 366, height: 181 })),
  };
});

const get = jest.mocked(api.get);
const request = jest.mocked(api.request);

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

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

/** As abas com a 1h de verdade, a sheet do resgate de verdade e o resto vazio. */
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
  '(tabs)/(ranking)/missoes': label('missions'),
  '(tabs)/(ranking)/recompensas': RewardsRoute,
  '(tabs)/(perfil)/perfil': label('profile'),
  'recompensa/[recompensaId]': RewardDetailsRoute,
};

const TICKETS = 'Par de ingressos. Pra Encher e Derramar. 6.000 pontos.';
const VIDEO = 'Videochamada. 5 min com o artista. 8.500 pontos.';
const SHIRT = 'Camisa oficial. Coleção São João. Faltam 2.520 pontos.';
const SCREEN = 'Foto no telão. Durante o show. Faltam 7.520 pontos.';
const REDEEM_VIDEO = 'Resgatar por 8.500 pontos';
const CONFIRM = t('rewards.confirm.action');

const announcements = () =>
  jest
    .mocked(AccessibilityInfo.announceForAccessibilityWithOptions)
    .mock.calls.map(([text]) => text);

/** A 21 de outubro, como o São João de Irará das fixtures cai com o relógio de hoje. */
const featuredLabel = (value: string) =>
  new RegExp(
    `^Meet & greet com o Netto\\. Só \\d+ vagas\\. São João de Irará, 21 de \\p{L}+\\. ${value}\\.$`,
    'u',
  );

/** Promessa que o teste resolve quando quiser. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A API por rota: a loja das fixtures e a carteira pedida. */
function mockApi({
  balance = 12_480,
  rewards = () => buildRewardsFixture(new Date()),
}: { balance?: number; rewards?: () => RewardsResponse } = {}): void {
  mockDataSource = 'api';
  get.mockImplementation(async (url: string) => {
    if (url === '/rewards') return { data: rewards() } as never;
    if (url === '/me/wallet') {
      return { data: { balance, xp: 12_480, seasonPoints: 4_120 } } as never;
    }
    throw new Error(`rota sem resposta no teste: ${url}`);
  });
}

const videoResult: RedeemResult = {
  redemptionId: 'resgate-9',
  rewardId: 'videochamada',
  code: 'UP-2001',
  balance: 3_980,
  instructions: 'A equipe fala com você pelo e-mail da sua conta.',
  redeemedAt: new Date(2026, 8, 29, 20, 0).toISOString(),
};

/** A loja da API com a videochamada já resgatada (o que o servidor devolve depois). */
const withVideoRedeemed = (): RewardsResponse => ({
  rewards: buildRewardsFixture(new Date()).rewards.map((reward) =>
    reward.id === 'videochamada'
      ? {
          ...reward,
          redemptions: [
            {
              id: videoResult.redemptionId,
              code: videoResult.code,
              instructions: videoResult.instructions,
              redeemedAt: videoResult.redeemedAt,
            },
          ],
        }
      : reward,
  ),
});

/** Rótulos do que recebeu o foco do leitor de tela. */
const focused = () =>
  jest
    .mocked(AccessibilityInfo.sendAccessibilityEvent)
    .mock.calls.map(
      ([node]) => (node as { props?: { accessibilityLabel?: string } }).props?.accessibilityLabel,
    );

/** Da 1h até a confirmação da videochamada. */
async function openVideoConfirmation(): Promise<Router> {
  const view = renderRouter(appTree, { initialUrl: '/recompensas' });
  fireEvent.press(await screen.findByRole('button', { name: VIDEO }));
  await waitFor(() => expect(view.getPathname()).toBe('/recompensa/videochamada'));
  fireEvent.press(await screen.findByRole('button', { name: REDEEM_VIDEO }));
  expect(await screen.findByRole('header', { name: 'Confirmar resgate?' })).toBeTruthy();
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDataSource = 'fixtures';
  rewardsFixture.reset();
  fixtureWallet.reset();
  onlineManager.setOnline(true);
  // Como no app no modo fixtures: consulta não pausa offline; mutação segue o padrão.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, networkMode: 'always' } },
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  client.clear();
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

describe('detalhe do resgate aberto por link', () => {
  it('abre a sheet sozinha, e fechar leva à loja', async () => {
    const view = renderRouter(appTree, { initialUrl: '/recompensa/meet-netto' });

    expect(await screen.findByRole('header', { name: 'Meet & greet com o Netto' })).toBeTruthy();
    expect(screen.getByText('Só 20 vagas')).toBeTruthy();
    expect(view.getSegments()).toEqual(['recompensa', '[recompensaId]']);

    fireEvent.press(screen.getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));
    expect(
      await screen.findByRole('button', { name: featuredLabel('10.000 pontos') }),
    ).toBeTruthy();
  });

  it('recompensa que saiu da loja diz isso, sem quebrar', async () => {
    renderRouter(appTree, { initialUrl: '/recompensa/nao-existe' });
    expect(await screen.findByLabelText(t('rewards.details.notFound'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Resgatar/ })).toBeNull();
  });
});

describe('loja de recompensas (1h)', () => {
  it('monta com as fixtures: saldo, destaque, sobrelinha e a grade do menor custo para o maior', async () => {
    renderRouter(appTree, { initialUrl: '/recompensas' });

    expect(screen.getByRole('header', { name: 'Resgatar' })).toBeTruthy();
    expect(screen.getByLabelText(t('rewards.loading'))).toBeTruthy();

    expect(
      await screen.findByRole('button', { name: featuredLabel('10.000 pontos') }),
    ).toBeTruthy();
    expect(screen.getByLabelText('Seu saldo: 12.480 pontos')).toBeTruthy();
    const headers = screen.getAllByRole('header').map((node) => node.props.children);
    expect(headers).toEqual(['Resgatar', 'Ao seu alcance']);
    const cards = screen
      .getAllByRole('button')
      .map((node) => node.props.accessibilityLabel as string | undefined)
      .filter((name) => name?.endsWith('.'));
    expect(cards[0]).toMatch(featuredLabel('10.000 pontos'));
    expect(cards.slice(1)).toEqual([TICKETS, VIDEO, SHIRT, SCREEN]);
  });

  it('o voltar vem na linha do título e volta para o Ranking', async () => {
    const view = renderRouter(appTree, { initialUrl: '/recompensas' });
    await screen.findByRole('button', { name: VIDEO });

    fireEvent.press(screen.getByRole('button', { name: t('common.back') }));
    await waitFor(() => expect(view.getPathname()).toBe('/ranking'));
  });

  it('resgatar a Videochamada: detalhe, confirmação e instruções, e o saldo cai de 12.480 para 3.980', async () => {
    const view = renderRouter(appTree, { initialUrl: '/recompensas' });

    fireEvent.press(await screen.findByRole('button', { name: VIDEO }));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensa/videochamada'));
    // A sheet fica na raiz, por cima das abas.
    expect(rootRoutes(view)).toEqual(['(tabs)', 'recompensa/[recompensaId]']);

    // Detalhe: custo e saldo depois, sem pedir endereço.
    expect(await screen.findByRole('header', { name: 'Videochamada' })).toBeTruthy();
    expect(
      screen.getByLabelText('Custo: 8.500 pontos. Seu saldo depois: 3.980 pontos.'),
    ).toBeTruthy();
    expect(screen.queryByText(/endereço/i)).toBeNull();
    const redeem = screen.getByRole('button', { name: REDEEM_VIDEO });
    expect(redeem).toHaveProp('accessibilityHint', t('rewards.details.redeemHint'));

    // Confirmação: nada foi gasto ainda.
    fireEvent.press(redeem);
    expect(await screen.findByRole('header', { name: 'Confirmar resgate?' })).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Saldo agora: 12.480 pontos. Custo: 8.500 pontos. Seu saldo depois: 3.980 pontos.',
      ),
    ).toBeTruthy();
    expect(fixtureWallet.get().balance).toBe(12_480);

    // Confirmado: código, instruções do servidor e o saldo novo.
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    // O foco vai para o título, que já diz o saldo novo: um anúncio à parte
    // seria cortado por esse foco.
    const done = await screen.findByRole('header', {
      name: 'Resgate confirmado. Seu saldo agora é 3.980 pontos.',
    });
    expect(screen.getByText('Resgate confirmado')).toBeTruthy();
    await waitFor(() => expect(focused()).toContain(done.props.accessibilityLabel));
    expect(announcements()).toEqual([]);
    expect(screen.getByLabelText('Código do resgate: UP-1001')).toBeTruthy();
    expect(screen.getByText(/e-mail da sua conta em até 5 dias úteis/)).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('redeem');
    expect(haptics.trigger).not.toHaveBeenCalledWith('insufficientPoints');
    // Só o saldo cai: o nível e a temporada ficam.
    expect(fixtureWallet.get()).toEqual({ balance: 3_980, xp: 12_480, seasonPoints: 4_120 });
    // A carteira e o resto do perfil (1e) e a loja (estoque) buscam de novo.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rewardKeys.all });

    fireEvent.press(screen.getByRole('button', { name: t('rewards.success.done') }));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));
    expect(
      await screen.findByRole('button', {
        name: 'Par de ingressos. Pra Encher e Derramar. Faltam 2.020 pontos.',
      }),
    ).toBeTruthy();
    const video = screen.getByRole('button', {
      name: 'Videochamada. 5 min com o artista. Faltam 4.520 pontos.',
    });
    expect(screen.getByLabelText('Seu saldo: 3.980 pontos')).toBeTruthy();

    // Reaberta, a recompensa mostra o código e as instruções de novo.
    fireEvent.press(video);
    expect(await screen.findByRole('header', { name: 'Você já resgatou' })).toBeTruthy();
    expect(screen.getByLabelText(/^Código do resgate: UP-1001\. Resgatado em .+\.$/)).toBeTruthy();
    expect(screen.getByText(/e-mail da sua conta em até 5 dias úteis/)).toBeTruthy();
  });

  it('resgatar o meet & greet baixa as vagas do destaque: "Só 19 vagas"', async () => {
    const view = renderRouter(appTree, { initialUrl: '/recompensas' });
    fireEvent.press(await screen.findByRole('button', { name: featuredLabel('10.000 pontos') }));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensa/meet-netto'));
    fireEvent.press(await screen.findByRole('button', { name: 'Resgatar por 10.000 pontos' }));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM }));
    await screen.findByRole('header', { name: /^Resgate confirmado/ });

    fireEvent.press(screen.getByRole('button', { name: t('rewards.success.done') }));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));
    expect(
      await screen.findByRole('button', {
        name: /^Meet & greet com o Netto\. Só 19 vagas\. .* Faltam 7\.520 pontos\.$/,
      }),
    ).toBeTruthy();
    expect(screen.getByText('Só 19 vagas')).toBeTruthy();
  });

  it('sem saldo: o botão diz quanto falta, e "Ver missões" abre as missões por cima da loja', async () => {
    const view = renderRouter(appTree, { initialUrl: '/recompensas' });

    fireEvent.press(await screen.findByRole('button', { name: SHIRT }));
    expect(await screen.findByRole('header', { name: 'Camisa oficial' })).toBeTruthy();
    expect(screen.getByLabelText('Custo: 15.000 pontos. Seu saldo: 12.480 pontos.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Faltam 2.520 pontos' })).toBeDisabled();

    fireEvent.press(screen.getByRole('button', { name: t('rewards.details.seeMissions') }));
    await waitFor(() => expect(view.getPathname()).toBe('/missoes'));
    expect(view.getSegments()).toEqual(['(tabs)', '(ranking)', 'missoes']);
    // A sheet fechou, sem outra árvore de abas.
    expect(rootRoutes(view)).toEqual(['(tabs)']);

    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));
  });

  it('"Voltar" da confirmação volta ao detalhe sem gastar nada', async () => {
    await openVideoConfirmation();
    fireEvent.press(screen.getByRole('button', { name: t('rewards.confirm.back') }));
    expect(await screen.findByRole('button', { name: REDEEM_VIDEO })).toBeTruthy();
    expect(fixtureWallet.get().balance).toBe(12_480);
  });

  it('saldo que caiu por fora: o servidor recusa, vibra "sem pontos" e o detalhe mostra o que falta', async () => {
    await openVideoConfirmation();
    // Outro aparelho gastou 5.000 enquanto a sheet estava aberta.
    fixtureWallet.spend(5_000);

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));

    expect(await screen.findByRole('header', { name: 'Videochamada' })).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('insufficientPoints');
    expect(haptics.trigger).not.toHaveBeenCalledWith('redeem');
    // O motivo fica no pé, junto do botão, e recebe o foco: um anúncio seria
    // cortado por ele, e no fim do corpo o aviso caía abaixo da dobra.
    const notice = screen.getByLabelText(t('rewards.errors.insufficientPoints'));
    await waitFor(() => expect(focused()).toContain(notice.props.accessibilityLabel));
    expect(announcements()).toEqual([]);
    // A carteira busca de novo e o botão passa a dizer quanto falta.
    expect(await screen.findByRole('button', { name: 'Faltam 1.020 pontos' })).toBeDisabled();
    expect(fixtureWallet.get().balance).toBe(7_480);
  });

  it('o saldo que deixa de cobrir com a confirmação aberta volta ao detalhe, com o motivo', async () => {
    await openVideoConfirmation();
    fixtureWallet.spend(5_000);
    // A carteira busca de novo por fora (volta do app, puxar na 1h).
    await act(() => client.invalidateQueries({ queryKey: profileKeys.wallet() }));

    expect(await screen.findByRole('button', { name: 'Faltam 1.020 pontos' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: CONFIRM })).toBeNull();
    const notice = screen.getByLabelText(t('rewards.errors.insufficientPoints'));
    await waitFor(() => expect(focused()).toContain(notice.props.accessibilityLabel));
    expect(fixtureWallet.get().balance).toBe(7_480);
  });

  it('sem internet, o resgate fica desligado, com o aviso, e nada vai para a fila', async () => {
    const view = renderRouter(appTree, { initialUrl: '/recompensas' });
    fireEvent.press(await screen.findByRole('button', { name: VIDEO }));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensa/videochamada'));
    await screen.findByRole('button', { name: REDEEM_VIDEO });

    act(() => onlineManager.setOnline(false));

    expect(screen.getByRole('button', { name: REDEEM_VIDEO })).toBeDisabled();
    expect(screen.getByLabelText(t('rewards.details.offline'))).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: REDEEM_VIDEO }));
    expect(screen.queryByRole('header', { name: 'Confirmar resgate?' })).toBeNull();
    expect(client.getMutationCache().getAll()).toHaveLength(0);

    act(() => onlineManager.setOnline(true));
    expect(screen.getByRole('button', { name: REDEEM_VIDEO })).toBeEnabled();
  });
});

describe('resgate pela API', () => {
  it('manda POST com a chave de idempotência, e a nova tentativa depois de falha de rede leva a mesma chave', async () => {
    mockApi();
    request
      .mockRejectedValueOnce(new ApiError('network', 'sem rede'))
      .mockResolvedValueOnce({ data: videoResult } as never);
    await openVideoConfirmation();

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    expect(await screen.findByLabelText(t('rewards.errors.failed'))).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('error');
    // Continua na confirmação, com o foco no botão: o anúncio sai inteiro.
    expect(screen.getByRole('header', { name: 'Confirmar resgate?' })).toBeTruthy();
    expect(announcements()).toEqual([t('rewards.errors.failed')]);

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    expect(await screen.findByRole('header', { name: 'Resgate confirmado' })).toBeTruthy();
    expect(screen.getByLabelText('Código do resgate: UP-2001')).toBeTruthy();

    expect(request).toHaveBeenCalledTimes(2);
    const [first, second] = request.mock.calls.map(([config]) => config);
    expect(first).toMatchObject({
      method: 'POST',
      url: '/rewards/videochamada/redeem',
      headers: { 'Idempotency-Key': expect.any(String) },
    });
    expect(second?.headers).toEqual(first?.headers);
  });

  it('falha de rede, fechar a sheet e reabrir: a nova tentativa leva a mesma chave', async () => {
    mockApi();
    request
      .mockRejectedValueOnce(new ApiError('timeout', 'demorou'))
      .mockResolvedValueOnce({ data: videoResult } as never);
    const view = await openVideoConfirmation();
    const invalidate = jest.spyOn(client, 'invalidateQueries');

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    expect(await screen.findByLabelText(t('rewards.errors.failed'))).toBeTruthy();
    // O resgate pode ter sido gravado: a carteira e a loja buscam de novo.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: profileKeys.wallet() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rewardKeys.all });

    fireEvent.press(screen.getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));
    fireEvent.press(await screen.findByRole('button', { name: VIDEO }));
    fireEvent.press(await screen.findByRole('button', { name: REDEEM_VIDEO }));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM }));
    expect(await screen.findByLabelText('Código do resgate: UP-2001')).toBeTruthy();

    const [first, second] = request.mock.calls.map(([config]) => config);
    expect(second?.headers).toEqual(first?.headers);
  });

  it('dois toques no mesmo quadro na confirmação fazem um resgate só', async () => {
    mockApi();
    request.mockResolvedValue({ data: videoResult } as never);
    await openVideoConfirmation();

    const confirmButton = screen.getByRole('button', { name: CONFIRM });
    act(() => {
      fireEvent.press(confirmButton);
      fireEvent.press(confirmButton);
    });
    expect(await screen.findByLabelText('Código do resgate: UP-2001')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('o saldo da resposta entra na carteira antes de ela buscar de novo', async () => {
    mockApi();
    const walletAgain = deferred<{ data: unknown }>();
    const answer = get.getMockImplementation();
    request.mockImplementationOnce(async () => {
      // Depois do resgate, a carteira nova fica pendurada.
      get.mockImplementation(async (url: string) => {
        if (url === '/me/wallet') return walletAgain.promise as never;
        return answer?.(url) as never;
      });
      return { data: videoResult } as never;
    });
    await openVideoConfirmation();

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    await screen.findByRole('header', { name: /^Resgate confirmado/ });
    // Com a carteira ainda sem responder, o saldo novo já está no cache que a
    // pílula da sheet e a da 1h (embaixo dela) leem.
    expect(screen.getByLabelText('Seu saldo: 3.980 pontos')).toBeTruthy();
    expect(client.getQueryState(profileKeys.wallet())).toMatchObject({
      fetchStatus: 'fetching',
      data: expect.objectContaining({ balance: 3_980 }),
    });
    await act(async () =>
      walletAgain.resolve({ data: { balance: 3_980, xp: 12_480, seasonPoints: 4_120 } }),
    );
  });

  it('a sheet fechada no meio do resgate (arrasto do Android): o toque e o anúncio saem, e o código fica no detalhe', async () => {
    mockApi();
    const answer = deferred<{ data: RedeemResult }>();
    request.mockReturnValueOnce(answer.promise as never);
    const view = await openVideoConfirmation();

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('common.close') })).toBeDisabled(),
    );
    // O arrasto da sheet no Android não obedece ao gestureEnabled.
    act(() => testRouter.back());
    await waitFor(() => expect(view.getPathname()).toBe('/recompensas'));

    // O servidor gravou: a carteira e a loja que ele devolve já mostram o resgate.
    mockApi({ balance: videoResult.balance, rewards: withVideoRedeemed });
    await act(async () => answer.resolve({ data: videoResult }));
    expect(haptics.trigger).toHaveBeenCalledWith('redeem');
    expect(announcements()).toContain('Resgate confirmado. Seu saldo agora é 3.980 pontos.');

    fireEvent.press(
      await screen.findByRole('button', {
        name: 'Videochamada. 5 min com o artista. Faltam 4.520 pontos.',
      }),
    );
    expect(await screen.findByRole('header', { name: 'Você já resgatou' })).toBeTruthy();
    expect(screen.getByLabelText(/^Código do resgate: UP-2001\. Resgatado em .+\.$/)).toBeTruthy();
    expect(screen.getByText(videoResult.instructions)).toBeTruthy();
  });

  it('depois de uma recusa definitiva, a próxima tentativa é ação nova, com chave nova', async () => {
    mockApi();
    request
      .mockRejectedValueOnce(
        new ApiError('validation', 'sem saldo', 409, REDEEM_ERROR_CODES.insufficientPoints),
      )
      .mockResolvedValueOnce({ data: videoResult } as never);
    await openVideoConfirmation();

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));
    // O saldo que a API devolve continua cobrindo: o fã tenta de novo.
    fireEvent.press(await screen.findByRole('button', { name: REDEEM_VIDEO }));
    fireEvent.press(await screen.findByRole('button', { name: CONFIRM }));
    expect(await screen.findByRole('header', { name: 'Resgate confirmado' })).toBeTruthy();

    const [first, second] = request.mock.calls.map(([config]) => config);
    expect(second?.headers).not.toEqual(first?.headers);
  });

  it('enquanto o resgate vai, a sheet não fecha e o "Voltar" fica preso', async () => {
    mockApi();
    const answer = deferred<{ data: RedeemResult }>();
    request.mockReturnValueOnce(answer.promise as never);
    await openVideoConfirmation();
    const backPress = jest.spyOn(BackHandler, 'addEventListener');

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('common.close') })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: t('rewards.confirm.back') })).toBeDisabled();
    // O voltar do Android fica preso (o gesto do iOS também; o arrasto do Android, não).
    const [, stay] = backPress.mock.calls.find(([event]) => event === 'hardwareBackPress') ?? [];
    expect(stay?.({} as Parameters<NonNullable<typeof stay>>[0])).toBe(true);
    expect(screen.getByRole('button', { name: CONFIRM })).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ busy: true }),
    );

    await act(async () => answer.resolve({ data: videoResult }));
    expect(await screen.findByRole('header', { name: 'Resgate confirmado' })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('common.close') })).toBeEnabled();
  });

  it('esgotou no meio: avisa, vibra e o detalhe passa a dizer "Esgotado"', async () => {
    let soldOut = false;
    mockApi({
      rewards: () => {
        const response = buildRewardsFixture(new Date());
        if (!soldOut) return response;
        return {
          rewards: response.rewards.map((reward) =>
            reward.id === 'videochamada' ? { ...reward, status: 'soldOut' as const } : reward,
          ),
        };
      },
    });
    request.mockImplementationOnce(async () => {
      soldOut = true;
      throw new ApiError('validation', 'esgotou', 409, REDEEM_ERROR_CODES.soldOut);
    });
    await openVideoConfirmation();

    fireEvent.press(screen.getByRole('button', { name: CONFIRM }));

    expect(await screen.findByLabelText(t('rewards.errors.soldOut'))).toBeTruthy();
    expect(haptics.trigger).toHaveBeenCalledWith('warning');
    expect(await screen.findByRole('button', { name: t('rewards.soldOut') })).toBeDisabled();
  });
});

describe('detalhe do resgate quando algo não carrega', () => {
  it('aberto por link sem rede: anuncia a falha e, ao voltar, leva o foco ao título', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    get.mockImplementationOnce(async (url: string) => {
      if (url === '/rewards') throw new Error('fora do ar');
      return answer?.(url) as never;
    });
    renderRouter(appTree, { initialUrl: '/recompensa/videochamada' });

    expect(await screen.findByLabelText(t('rewards.details.loadError'))).toBeTruthy();
    await waitFor(() => expect(announcements()).toEqual([t('rewards.details.loadError')]));

    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    const title = await screen.findByRole('header', { name: 'Videochamada' });
    await waitFor(() => expect(focused()).toContain(title.props.accessibilityLabel));
  });

  it('recompensa que saiu da loja é anunciada', async () => {
    renderRouter(appTree, { initialUrl: '/recompensa/nao-existe' });
    await waitFor(() => expect(announcements()).toEqual([t('rewards.details.notFound')]));
  });
});

describe('loja (1h) quando algo não carrega', () => {
  it('loja que não carregou mostra "Tentar de novo", anuncia uma vez e busca de novo', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    get.mockImplementationOnce(async (url: string) => {
      if (url === '/rewards') throw new Error('fora do ar');
      return answer?.(url) as never;
    });
    renderRouter(appTree, { initialUrl: '/recompensas' });

    expect(await screen.findByLabelText(t('rewards.loadError'))).toBeTruthy();
    await waitFor(() => expect(announcements()).toEqual([t('rewards.loadError')]));

    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByRole('button', { name: VIDEO })).toBeTruthy();
    await waitFor(() =>
      expect(announcements()).toEqual([t('rewards.loadError'), t('rewards.loaded')]),
    );
  });

  it('saldo que não carregou: a pílula sai, a loja diz por quê e "Tentar de novo" busca o saldo', async () => {
    mockApi();
    const answer = get.getMockImplementation();
    get.mockImplementation(async (url: string) => {
      if (url === '/me/wallet') throw new Error('fora do ar');
      return answer?.(url) as never;
    });
    renderRouter(appTree, { initialUrl: '/recompensas' });

    expect(await screen.findByLabelText(t('rewards.balanceError'))).toBeTruthy();
    expect(screen.queryByLabelText(t('components.pointsPill.loading'))).toBeNull();
    await waitFor(() => expect(announcements()).toEqual([t('rewards.balanceError')]));
    // Sem o saldo, os preços aparecem sem dizer o que falta.
    expect(
      screen.getByRole('button', { name: 'Camisa oficial. Coleção São João. 15.000 pontos.' }),
    ).toBeTruthy();

    get.mockImplementation(answer);
    fireEvent.press(screen.getByRole('button', { name: t('common.retry') }));
    expect(await screen.findByLabelText('Seu saldo: 12.480 pontos')).toBeTruthy();
    expect(screen.getByRole('button', { name: SHIRT })).toBeTruthy();
    await waitFor(() =>
      expect(announcements()).toEqual([t('rewards.balanceError'), t('rewards.loaded')]),
    );
  });

  it('loja vazia diz que as recompensas aparecem quando ela abrir', async () => {
    mockApi({ rewards: () => ({ rewards: [] }) });
    renderRouter(appTree, { initialUrl: '/recompensas' });

    expect(await screen.findByLabelText(t('rewards.empty'))).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Ao seu alcance' })).toBeNull();
  });
});
