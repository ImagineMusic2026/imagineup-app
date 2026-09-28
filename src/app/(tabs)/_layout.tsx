import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { House, Plus, Search, Trophy, User } from 'lucide-react-native';

import { Icon } from '@/components/icon';
import { TabBar, toTabItems } from '@/components/tab-bar';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { colors } from '@/theme';

/**
 * Abas JS do Expo Router com a tab bar desenhada no protótipo. As NativeTabs
 * não servem: não aceitam botão central nem o fundo em gradiente com blur.
 * Cada aba é uma pilha própria (pasta com _layout), para que o artista abra
 * dentro da aba sem esconder a barra.
 */
export default function TabsLayout() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reducedMotion ? 'none' : 'fade',
        sceneStyle: { backgroundColor: colors.background },
      }}
      tabBar={(props) => (
        <TabBar
          items={toTabItems(props)}
          centerAction={{
            icon: Plus,
            accessibilityLabel: t('tabs.invite'),
            onPress: () => router.push('/convidar'),
          }}
        />
      )}
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
