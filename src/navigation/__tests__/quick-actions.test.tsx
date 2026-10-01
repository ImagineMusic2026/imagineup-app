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
import { Platform, Text } from 'react-native';

import { TabBar, toTabItems } from '@/components/tab-bar';
import { QUICK_ACTIONS, useQuickActions } from '@/domains/quick-actions';
import { t } from '@/i18n';

/**
 * Tab bar de verdade com os atalhos de verdade: o "+" abre o menu, e cada atalho
 * leva à rota dele, que precisa existir na árvore do app.
 */
function TabsLayout() {
  const quickActions = useQuickActions();
  return (
    <Tabs tabBar={(props) => <TabBar items={toTabItems(props)} centerMenu={quickActions} />} />
  );
}

// O papel das abas da tab bar própria ("button" no iOS).
const TAB_ROLE = Platform.OS === 'ios' ? 'button' : 'tab';

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

const appTree = {
  _layout: () => <Stack />,
  '(tabs)/_layout': TabsLayout,
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
  '(tabs)/(ranking)/missoes': label('missions'),
  '(tabs)/(ranking)/recompensas': label('rewards'),
  '(tabs)/(perfil)/perfil': label('profile'),
  convidar: label('invite'),
};

describe('atalhos do "+"', () => {
  it('todo atalho tem texto em pt-BR', () => {
    for (const action of QUICK_ACTIONS) {
      expect(t(action.labelKey)).not.toBe(action.labelKey);
    }
  });

  it.each([
    ['Missões', '/missoes', 'missions'],
    ['Recompensas', '/recompensas', 'rewards'],
    ['Convidar', '/convidar', 'invite'],
  ])('%s leva a %s', async (actionLabel, pathname, screenText) => {
    const view = renderRouter(appTree, { initialUrl: '/' });
    fireEvent.press(screen.getByLabelText('Abrir atalhos'));
    fireEvent.press(screen.getByLabelText(actionLabel));
    await waitFor(() => expect(view.getPathname()).toBe(pathname));
    expect(screen.getByText(screenText)).toBeTruthy();
  });

  describe('na pilha do Ranking, com a 1f embaixo', () => {
    type Router = ReturnType<typeof renderRouter>;
    type StateNode = { index?: number; routes?: { name: string; state?: StateNode }[] };

    /** As telas da pilha da aba Ranking, de baixo para cima. */
    const rankingStack = (view: Router): string[] => {
      const findRanking = (node: StateNode | undefined): StateNode | undefined => {
        for (const route of node?.routes ?? []) {
          if (route.name === '(ranking)') return route.state;
          const found = findRanking(route.state);
          if (found) return found;
        }
        return undefined;
      };
      const stack = findRanking(view.getRouterState() as StateNode | undefined);
      return stack?.routes?.map((route) => route.name) ?? [];
    };

    function openShortcut(actionLabel: string): void {
      fireEvent.press(screen.getByLabelText('Abrir atalhos'));
      fireEvent.press(screen.getByLabelText(actionLabel));
    }

    it.each([
      ['Missões', '/missoes', 'missoes'],
      ['Recompensas', '/recompensas', 'recompensas'],
    ])(
      'vindo do Início, %s abre por cima da 1f, e o voltar cai no Ranking',
      async (actionLabel, pathname, route) => {
        const view = renderRouter(appTree, { initialUrl: '/' });
        openShortcut(actionLabel);
        await waitFor(() => expect(view.getPathname()).toBe(pathname));
        expect(rankingStack(view)).toEqual(['ranking', route]);

        act(() => testRouter.back());
        expect(view.getPathname()).toBe('/ranking');
        expect(screen.getByText('ranking')).toBeTruthy();
      },
    );

    it('depois de Missões pelo "+", a aba Ranking volta à 1f', async () => {
      const view = renderRouter(appTree, { initialUrl: '/' });
      openShortcut('Missões');
      await waitFor(() => expect(view.getPathname()).toBe('/missoes'));

      // A aba já focada volta a pilha dela ao topo.
      fireEvent.press(screen.getByRole(TAB_ROLE, { name: '(ranking)' }));
      await waitFor(() => expect(view.getPathname()).toBe('/ranking'));
    });

    it('o mesmo atalho duas vezes não empilha a tela de novo', async () => {
      const view = renderRouter(appTree, { initialUrl: '/' });
      openShortcut('Missões');
      await waitFor(() => expect(view.getPathname()).toBe('/missoes'));
      openShortcut('Missões');
      await waitFor(() => expect(rankingStack(view)).toEqual(['ranking', 'missoes']));

      act(() => testRouter.back());
      expect(view.getPathname()).toBe('/ranking');
    });
  });
});
