import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { act, renderRouter, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import {
  InviteCaptureScreen,
  inviteRoute,
  parseInviteLink,
  readPendingInvite,
} from '@/domains/invites';
import { useSessionGate } from '@/hooks/use-session-gate';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

/**
 * Layout raiz com os mesmos guards do app e a tela de convite real. Trava o
 * caso em que o convite, aberto sem sessão, ficava numa tela em branco (rota
 * barrada pelo guard é ignorada em silêncio) e o caso em que, com o app
 * aberto, ele empilhava uma segunda árvore de abas.
 */
function RootLayout() {
  const { signedIn, onboarded } = useSessionGate();
  return (
    <Stack>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="fa/[fanId]" />
        <Stack.Screen name="editar-perfil" />
      </Stack.Protected>
      <Stack.Screen name="convite/[codigo]" />
    </Stack>
  );
}

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

const appTree = {
  _layout: RootLayout,
  '(auth)/_layout': () => <Stack />,
  '(auth)/entrar': label('login'),
  '(auth)/cadastro': label('signup'),
  '(onboarding)/_layout': () => <Stack />,
  '(onboarding)/artistas': label('onboarding'),
  '(tabs)/_layout': () => <Tabs />,
  '(tabs)/(inicio,explorar,ranking,perfil)/_layout': {
    default: () => <Stack />,
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
  '(tabs)/(inicio,explorar,ranking,perfil)/artista/[artistaId]': label('artist'),
  'fa/[fanId]': label('fan'),
  'editar-perfil': label('edit-profile'),
  'convite/[codigo]': InviteCaptureScreen,
};

function setSession(signedIn: boolean, onboarded: boolean): void {
  useSessionStore.setState({
    status: signedIn ? 'signedIn' : 'signedOut',
    user: signedIn ? { uid: 'fa', email: null, displayName: null, photoURL: null } : null,
    authHolds: 0,
  });
  usePreferencesStore.setState({
    hydrated: true,
    hasCompletedOnboarding: onboarded,
    lastSessionUid: signedIn ? 'fa' : null,
  });
}

type Router = ReturnType<typeof renderRouter>;
type StateNode = { routes?: { name: string; state?: StateNode }[] };

/** Rotas da pilha raiz (o nível de cima é o contêiner `__root`). */
const rootRoutes = (view: Router): string[] => {
  const container = view.getRouterState() as StateNode | undefined;
  return container?.routes?.[0]?.state?.routes?.map((route) => route.name) ?? [];
};

const newAccount = {
  uid: 'nova',
  email: 'nova@x.com',
  displayName: 'Beatriz Santos',
  photoURL: null,
};

describe('cadastro com os guards de sessão', () => {
  it('a conta nasce logada, mas o guard segura o cadastro até o perfil existir', async () => {
    setSession(false, false);
    const view = renderRouter(appTree, { initialUrl: '/cadastro' });
    view.getByText('signup');

    // Passo 1 do cadastro: o listener do Firebase já avisa que a conta existe.
    let release = (): void => undefined;
    act(() => {
      release = useSessionStore.getState().holdAuth();
      useSessionStore.getState().setSignedIn(newAccount);
    });
    expect(view.getPathname()).toBe('/cadastro');
    expect(view.getByText('signup')).toBeTruthy();
    expect(rootRoutes(view)).toEqual(['(auth)']);

    // O perfil nasceu: o guard troca para a escolha de artistas.
    act(() => release());
    await waitFor(() => expect(view.getPathname()).toBe('/artistas'));
    expect(rootRoutes(view)).toEqual(['(onboarding)']);
  });

  it('um fluxo não solta o fã que outro ainda segura', async () => {
    setSession(false, false);
    const view = renderRouter(appTree, { initialUrl: '/cadastro' });

    let first = (): void => undefined;
    let second = (): void => undefined;
    act(() => {
      first = useSessionStore.getState().holdAuth();
      second = useSessionStore.getState().holdAuth();
      useSessionStore.getState().setSignedIn(newAccount);
    });
    // Soltar duas vezes vale uma.
    act(() => {
      second();
      second();
    });
    expect(view.getPathname()).toBe('/cadastro');
    expect(rootRoutes(view)).toEqual(['(auth)']);

    act(() => first());
    await waitFor(() => expect(view.getPathname()).toBe('/artistas'));
  });
});

describe('"Editar perfil" na pilha raiz, dentro dos guards (seção 28)', () => {
  it('sem sessão, o link de "Editar perfil" não abre a tela e cai na entrada', async () => {
    setSession(false, false);
    const view = renderRouter(appTree, { initialUrl: '/editar-perfil' });
    // A rota barrada fica de fora em silêncio, e o guard mostra a entrada.
    expect(await view.findByText('login')).toBeTruthy();
    expect(view.queryByText('edit-profile')).toBeNull();
  });

  it('logado sem onboarding, também não abre', async () => {
    setSession(true, false);
    const view = renderRouter(appTree, { initialUrl: '/editar-perfil' });
    expect(await view.findByText('onboarding')).toBeTruthy();
    expect(view.queryByText('edit-profile')).toBeNull();
  });

  it('logado, abre por cima das abas', async () => {
    setSession(true, true);
    const view = renderRouter(appTree, { initialUrl: '/perfil' });
    act(() => router.push('/editar-perfil'));
    await waitFor(() => expect(view.getPathname()).toBe('/editar-perfil'));
    expect(view.getByText('edit-profile')).toBeTruthy();
    expect(rootRoutes(view)).toEqual(['(tabs)', 'editar-perfil']);
  });
});

describe('perfil público de outro fã na pilha raiz, dentro dos guards (seção 28)', () => {
  it('sem sessão, o link do perfil de um fã não abre a tela e cai na entrada', async () => {
    setSession(false, false);
    const view = renderRouter(appTree, { initialUrl: '/fa/x' });
    expect(await view.findByText('login')).toBeTruthy();
    expect(view.queryByText('fan')).toBeNull();
  });

  it('logado sem onboarding, também não abre', async () => {
    setSession(true, false);
    const view = renderRouter(appTree, { initialUrl: '/fa/x' });
    expect(await view.findByText('onboarding')).toBeTruthy();
    expect(view.queryByText('fan')).toBeNull();
  });

  it('logado, abre por cima das abas', async () => {
    setSession(true, true);
    const view = renderRouter(appTree, { initialUrl: '/ranking' });
    act(() => router.push({ pathname: '/fa/[fanId]', params: { fanId: 'fa-rank-01' } }));
    await waitFor(() => expect(view.getPathname()).toBe('/fa/fa-rank-01'));
    expect(view.getByText('fan')).toBeTruthy();
    expect(rootRoutes(view)).toEqual(['(tabs)', 'fa/[fanId]']);
  });
});

describe('convite com os guards de sessão', () => {
  it('sem sessão, guarda o código e vai para o login', async () => {
    setSession(false, false);
    const view = renderRouter(appTree, { initialUrl: '/convite/ABC123' });
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(view.getByText('login')).toBeTruthy();
  });

  it('logado sem onboarding, vai para a escolha de artistas', async () => {
    setSession(true, false);
    const view = renderRouter(appTree, { initialUrl: '/convite/ABC123' });
    await waitFor(() => expect(view.getPathname()).toBe('/artistas'));
  });

  it('logado, segue para a página que o link abria', async () => {
    setSession(true, true);
    const view = renderRouter(appTree, {
      initialUrl: '/convite/ABC123?destino=%2Fartista%2Fnetto',
    });
    await waitFor(() => expect(view.getPathname()).toBe('/artista/netto'));
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });

  it('com o app aberto nas abas, não empilha outra árvore de abas', async () => {
    setSession(true, true);
    const view = renderRouter(appTree, { initialUrl: '/explorar' });
    view.getByText('explore');
    act(() => router.navigate('/convite/ABC123'));
    await waitFor(() => expect(view.getPathname()).toBe('/'));
    expect(rootRoutes(view)).toEqual(['(tabs)']);
  });
});

describe('convite guardado pela rota /convite/[codigo]', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('o ?ref= em minúsculas guarda o código normalizado, com a página e a campanha do link', async () => {
    setSession(false, false);
    const link =
      'https://imagineup-painel.vercel.app/post/p-clipe?ref=k7p3m9qx&utm_source=instagram&utm_content=ana';
    const invite = parseInviteLink(link)!;
    const view = renderRouter(appTree, { initialUrl: inviteRoute(invite) });
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(await readPendingInvite()).toMatchObject({
      code: 'K7P3M9QX',
      origin: { path: '/post/p-clipe', utm: { source: 'instagram' } },
    });
  });

  it('código fora do formato não guarda nada e segue', async () => {
    setSession(false, false);
    const view = renderRouter(appTree, { initialUrl: '/convite/a!b' });
    await waitFor(() => expect(view.getPathname()).toBe('/entrar'));
    expect(await readPendingInvite()).toBeNull();
  });
});
