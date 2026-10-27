import { router, useIsFocused } from 'expo-router';
import { ChartColumn, CircleUser, FileText, Gift, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Alert,
  BackHandler,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Screen } from '@/components/screen';
import { TabBar, type TabItem } from '@/components/tab-bar';
import { Text } from '@/components/text';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { t, type TranslationKey } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, layout, motion, spacing } from '@/theme';

import type { NextRound } from '../entry';
import { postBlockOf, type ManagerTab, type PostBlock, type PostFilter } from '../manager';
import type { MyFanClub, MyFanClubClub } from '../types';
import { ManagerAccount } from './manager-account';
import { ManagerHeader } from './manager-header';
import { ManagerPanel } from './manager-panel';
import { ManagerPosts } from './manager-posts';
import { PrizesCard } from './prizes-card';

const TABS: readonly { key: ManagerTab; label: TranslationKey; icon: LucideIcon }[] = [
  { key: 'painel', label: 'fanClub.manager.tabs.panel', icon: ChartColumn },
  { key: 'publicacoes', label: 'fanClub.manager.tabs.posts', icon: FileText },
  { key: 'premios', label: 'fanClub.manager.tabs.prizes', icon: Gift },
  { key: 'conta', label: 'fanClub.manager.tabs.account', icon: CircleUser },
];

const noop = (): void => undefined;

/**
 * A aba que entra aparece em fade, por valor animado (e não pelo `entering`
 * do Reanimated, que apagava a tela no Android, CLAUDE.md): a troca não sai
 * seca. Com reduzir movimento, o Reanimated pula para o fim.
 */
function PaneFade({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }));
  }, [opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** Por que o "+" não abre a nova publicação, num `Alert`, com o caminho para resolver. */
function explainBlock(
  block: NonNullable<PostBlock>,
  onOpen: (tab: ManagerTab, filter?: PostFilter) => void,
): void {
  haptics.trigger('locked');
  const title = t('fanClub.manager.blocked.title');
  const close = { text: t('fanClub.manager.blocked.close'), style: 'cancel' as const };
  switch (block.kind) {
    case 'unavailable':
      Alert.alert(title, t(block.key), [close]);
      return;
    case 'rules':
      Alert.alert(title, t('fanClub.manager.blocked.rules'), [
        close,
        { text: t('fanClub.manager.blocked.seeRules'), onPress: () => onOpen('painel') },
      ]);
      return;
    case 'full':
      Alert.alert(title, t('fanClub.errors.refused.tooManyPending'), [
        close,
        {
          text: t('fanClub.manager.blocked.seePending'),
          onPress: () => onOpen('publicacoes', 'em-analise'),
        },
      ]);
  }
}

export interface ManagerModeProps {
  mine: MyFanClub;
  club: MyFanClubClub;
  /** Só no encerrado: quando vem a próxima candidatura. */
  next: NextRound | null;
  tab: ManagerTab;
  filter: PostFilter;
  /** Troca a aba (e o filtro de Publicações), no endereço da tela. */
  onOpen: (tab: ManagerTab, filter?: PostFilter) => void;
}

/**
 * O modo gestor do "Meu fã-clube" (34.24, o Claude Design aprovado pelo dono
 * em 26/10/2026, só com o que o fã-clube já tem): o cabeçalho fixo e a barra
 * própria, no molde da tab bar do app, com Painel, Publicações, o "+" rosa no
 * meio, Prêmios e Conta. A aba e o filtro de Publicações moram no endereço
 * (`?aba=` e `?filtro=`), para a nova publicação voltar a "Em análise". O "+"
 * abre a nova publicação ou, quando o gestor não pode publicar (fora do ar,
 * regulamento velho ou 3 em análise), diz o motivo. Com o teclado aberto (o
 * WhatsApp da Conta), a barra sai, como nas abas do app. O voltar do Android
 * fora do Painel volta ao Painel, como nas abas.
 */
export function ManagerMode({ mine, club, next, tab, filter, onOpen }: ManagerModeProps) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const keyboard = useKeyboardVisible();
  const [barHeight, setBarHeight] = useState(layout.tabBarContentHeight + insets.bottom);
  const block = postBlockOf(club);

  useEffect(() => {
    if (!focused || tab === 'painel') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onOpen('painel');
      return true;
    });
    return () => subscription.remove();
  }, [focused, tab, onOpen]);

  // A troca pedida de dentro da aba (os atalhos do Painel, o aviso do "+")
  // desmonta o que tinha o foco do leitor: ele ouve para onde foi. Pela barra,
  // a própria aba já diz que ficou selecionada.
  const openFromContent = (target: ManagerTab, targetFilter?: PostFilter): void => {
    onOpen(target, targetFilter);
    const label = TABS.find((item) => item.key === target)?.label;
    if (label) AccessibilityInfo.announceForAccessibility(t(label));
  };

  const items: TabItem[] = TABS.map((item) => ({
    key: item.key,
    label: t(item.label),
    accessibilityLabel: t(item.label),
    focused: tab === item.key,
    renderIcon: (color) => <Icon icon={item.icon} color={color} />,
    onPress: () => {
      if (tab !== item.key) onOpen(item.key);
    },
    onLongPress: noop,
  }));

  const header = <ManagerHeader club={club} />;
  let pane: ReactNode;
  switch (tab) {
    case 'painel':
      pane = (
        <Screen key={tab} scroll header={header} bottomInset={barHeight}>
          <PaneFade>
            <ManagerPanel mine={mine} club={club} next={next} onOpen={openFromContent} />
          </PaneFade>
        </Screen>
      );
      break;
    case 'publicacoes':
      // A lista vai de ponta a ponta, com a margem dentro dela: no Android, o
      // leitor ordena pela posição, e a lista que começa depois da aba
      // "Painel" (e passa por baixo da barra) era lida depois dela.
      pane = (
        <Screen
          key={tab}
          padded={false}
          header={<View style={styles.gutter}>{header}</View>}
          contentStyle={styles.list}
        >
          <PaneFade style={styles.fill}>
            <ManagerPosts
              club={club}
              filter={filter}
              onFilter={(value) => onOpen('publicacoes', value)}
              bottomInset={barHeight}
            />
          </PaneFade>
        </Screen>
      );
      break;
    case 'premios':
      pane = (
        <Screen key={tab} scroll header={header} bottomInset={barHeight}>
          <PaneFade style={styles.pane}>
            <Text variant="titlePage" accessibilityRole="header">
              {t('fanClub.manager.prizes.title')}
            </Text>
            <PrizesCard lastReward={club.lastReward} />
          </PaneFade>
        </Screen>
      );
      break;
    case 'conta':
      pane = (
        <Screen key={tab} scroll header={header} bottomInset={barHeight}>
          <PaneFade>
            <ManagerAccount club={club} />
          </PaneFade>
        </Screen>
      );
      break;
  }

  return (
    <View style={styles.root} testID="fan-club-manager">
      {pane}
      {keyboard ? null : (
        <TabBar
          items={items}
          centerAction={{
            accessibilityLabel: t('fanClub.manager.newPost'),
            accessibilityHint: t(
              block ? 'fanClub.manager.newPostBlockedHint' : 'fanClub.manager.newPostHint',
            ),
            haptic: block ? null : 'tap',
            onPress: () => {
              if (block) explainBlock(block, openFromContent);
              else router.push('/meu-fa-clube/nova-publicacao');
            },
            testID: 'fan-club-new-post',
          }}
          onHeightChange={setBarHeight}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // A lista vai até o pé da tela; o espaço da barra fica no conteúdo dela.
  list: {
    paddingBottom: 0,
  },
  fill: {
    flex: 1,
  },
  gutter: {
    paddingHorizontal: spacing.gutter,
  },
  pane: {
    gap: spacing.lg,
    paddingTop: spacing.sm,
  },
});
