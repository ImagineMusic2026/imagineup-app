import { Tabs } from 'expo-router/js-tabs';
import { House, Search, Trophy, User } from 'lucide-react-native';

import { Icon } from '@/components/icon';
import { TabBar, toTabItems } from '@/components/tab-bar';
import { useQuickActions } from '@/domains/quick-actions';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { colors } from '@/theme';

/**
 * Abas JS do Expo Router com a tab bar desenhada no protótipo. As NativeTabs
 * não servem: não aceitam botão central nem o fundo em gradiente com blur.
 * Cada aba é uma pilha própria (pasta com _layout), para que o artista abra
 * dentro da aba sem esconder a barra. O "+" do meio abre os atalhos de
 * `@/domains/quick-actions` (Convidar, Missões, Recompensas).
 */
export default function TabsLayout() {
  const reducedMotion = usePrefersReducedMotion();
  const quickActions = useQuickActions();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reducedMotion ? 'none' : 'fade',
        sceneStyle: { backgroundColor: colors.background },
      }}
      tabBar={(props) => <TabBar items={toTabItems(props)} centerMenu={quickActions} />}
    >
      <Tabs.Screen
        name="(inicio)"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color }) => <Icon icon={House} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(explorar)"
        options={{
          title: t('tabs.explore'),
          tabBarIcon: ({ color }) => <Icon icon={Search} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(ranking)"
        options={{
          title: t('tabs.ranking'),
          tabBarIcon: ({ color }) => <Icon icon={Trophy} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(perfil)"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color }) => <Icon icon={User} color={color} />,
        }}
      />
    </Tabs>
  );
}
