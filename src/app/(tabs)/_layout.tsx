import { Tabs } from 'expo-router/js-tabs';
import { House, Search, Trophy, User } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { SwipeTabBar, useTabSwipe } from '@/components/tab-bar';
import { useQuickActions } from '@/domains/quick-actions';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { useStackFade } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { colors } from '@/theme';

/**
 * Abas JS do Expo Router com a tab bar desenhada no protótipo. As NativeTabs
 * não servem: não aceitam botão central nem o fundo em gradiente com blur.
 * Cada aba é uma pilha própria (pasta com _layout), para que o artista abra
 * dentro da aba sem esconder a barra. O "+" do meio abre os atalhos de
 * `@/domains/quick-actions` (Convidar, Missões, Recompensas). Arrastar para os
 * lados na base de uma aba traz a vizinha junto com o dedo (`useTabSwipe`),
 * pulando o "+".
 *
 * A troca de grupo na pilha raiz é seca: as abas entram do fundo escuro em
 * fade, como as telas de conta e a escolha de artistas, que saem para ele.
 */
export default function TabsLayout() {
  const reducedMotion = usePrefersReducedMotion();
  const quickActions = useQuickActions();
  const fade = useStackFade('tabs');
  const swipe = useTabSwipe(fade.entrance);

  return (
    <View style={styles.root}>
      {/* No Android, sem a composição fora da tela, cada camada apagaria sozinha. */}
      <Animated.View
        needsOffscreenAlphaCompositing
        onLayout={fade.onLayout}
        style={[styles.fill, fade.style]}
      >
        <Tabs
          // As abas fora de foco ficam montadas por trás, para o arraste mostrar a
          // vizinha. Com o `animation` ligado, o navegador não as esconde; com
          // reduzir movimento, esconde, e a troca sai seca.
          detachInactiveScreens={false}
          screenOptions={{
            headerShown: false,
            animation: reducedMotion ? 'none' : 'fade',
            sceneStyleInterpolator: swipe.sceneStyleInterpolator,
            // O fundo é da página de cada aba, que anda com o dedo.
            sceneStyle: styles.scene,
          }}
          screenLayout={swipe.screenLayout}
          tabBar={(props) => (
            <SwipeTabBar navigator={props} highlight={swipe.highlight} centerMenu={quickActions} />
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fill: {
    flex: 1,
  },
  scene: {
    backgroundColor: 'transparent',
  },
});
