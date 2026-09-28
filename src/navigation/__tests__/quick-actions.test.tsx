import { Stack } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

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
});
