import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { borderWidths, colors, layout, motion, spacing } from '@/theme';
import { revealOffset, type ScrollItemBox, type ScrollViewport } from '@/utils/reveal-in-scroll';

export interface UnderlineTab<T extends string> {
  value: T;
  label: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export interface UnderlineTabsProps<T extends string> {
  tabs: readonly UnderlineTab<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A aba no conteúdo da rolagem e o rótulo dentro da aba, que é onde vai o traço. */
interface TabMeasure {
  tab?: ScrollItemBox;
  label?: ScrollItemBox;
}

const TIMING = { duration: motion.duration.base, easing: motion.easing.out };

// O vão de 20 entre as abas (1d) vira margem de dentro, metade para cada lado:
// o toque cobre o vão e nenhuma aba fica com menos de 44 de largura.
const TAB_INSET = spacing.sectionTopTight / 2;
// Com a margem da primeira aba, o primeiro rótulo continua a 18 da borda.
const ROW_INSET = spacing.gutter - TAB_INSET;

function useFade(visible: boolean, reducedMotion: boolean) {
  return useAnimatedStyle(() => {
    const target = visible ? 1 : 0;
    return { opacity: reducedMotion ? target : withTiming(target, TIMING) };
  });
}

function TabButton<T extends string>({
  tab,
  selected,
  onPress,
  onLayout,
  onLabelLayout,
  testID,
}: {
  tab: UnderlineTab<T>;
  selected: boolean;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  onLabelLayout: (event: LayoutChangeEvent) => void;
  testID?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const activeLabelStyle = useFade(selected, reducedMotion);
  const idleLabelStyle = useFade(!selected, reducedMotion);

  return (
    <PressableScale
      onPress={onPress}
      onLayout={onLayout}
      haptic={selected ? null : 'selection'}
      // No iOS o papel "tab" não vira nenhum trait e o VoiceOver não diz que é
      // tocável: lá a aba é botão com "selecionado", como na tab bar.
      accessibilityRole={Platform.OS === 'ios' ? 'button' : 'tab'}
      accessibilityState={{ selected }}
      accessibilityLabel={tab.accessibilityLabel ?? tab.label}
      accessibilityHint={tab.accessibilityHint}
      testID={testID}
      style={styles.tab}
    >
      <View onLayout={onLabelLayout} testID={testID ? `${testID}-label` : undefined}>
        <Animated.View style={activeLabelStyle}>
          <Text variant="buttonSmall" numberOfLines={1}>
            {tab.label}
          </Text>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, styles.idleLabel, idleLabelStyle]}>
          <Text variant="tabItem" color={colors.textMuted} numberOfLines={1}>
            {tab.label}
          </Text>
        </Animated.View>
      </View>
    </PressableScale>
  );
}

function Indicator({ box, testID }: { box: ScrollItemBox; testID?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const animatedStyle = useAnimatedStyle(() => ({
    width: reducedMotion ? box.width : withTiming(box.width, TIMING),
    transform: [{ translateX: reducedMotion ? box.x : withTiming(box.x, TIMING) }],
  }));

  return (
    <Animated.View testID={testID} pointerEvents="none" style={[styles.indicator, animatedStyle]} />
  );
}

// Leva a aba escolhida para dentro da tela quando ela está cortada (fonte
// grande), com o primeiro rótulo na margem da tela.
function revealTab(
  scroll: ScrollView | null,
  tab: ScrollItemBox | undefined,
  viewport: ScrollViewport,
  animated: boolean,
): void {
  if (!scroll || !tab) return;
  const x = revealOffset(tab, viewport, ROW_INSET);
  if (x !== null) scroll.scrollTo({ x, animated });
}

/** O traço vai sob o rótulo, não sob a aba inteira, que tem a margem do toque. */
function underlineOf(measure: TabMeasure | undefined): ScrollItemBox | null {
  if (!measure?.tab || !measure.label) return null;
  return { x: measure.tab.x + measure.label.x, width: measure.label.width };
}

/**
 * Abas internas com sublinhado (Mural, Missões, Agenda e Ranking da 1d). O
 * traço de 2 pt desliza até a aba escolhida; a linha de baixo vai de ponta a
 * ponta, então a fileira não leva margem de quem chama.
 *
 * Com a fonte grande as abas não cabem na largura da tela: a fileira rola, como
 * os chips, e a aba escolhida é trazida para dentro da tela.
 *
 * Como no `Chip`, cada rótulo tem as duas versões montadas (Sora 800 na
 * escolhida, Manrope 600 nas outras) e troca por opacidade: a aba mede pela
 * mais larga e o traço não precisa correr atrás de uma largura que muda.
 */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  style,
  testID,
}: UnderlineTabsProps<T>) {
  const reducedMotion = usePrefersReducedMotion();
  const [measures, setMeasures] = useState<Partial<Record<T, TabMeasure>>>({});
  const scrollRef = useRef<ScrollView>(null);
  const tabBoxes = useRef(new Map<T, ScrollItemBox>());
  const viewport = useRef<ScrollViewport>({ offset: 0, width: 0 });
  const underline = underlineOf(measures[value]);

  useEffect(() => {
    revealTab(scrollRef.current, tabBoxes.current.get(value), viewport.current, !reducedMotion);
  }, [value, reducedMotion]);

  // Na abertura as medidas chegam depois do efeito: a escolhida aparece sem animar.
  const revealOnMount = (): void => {
    revealTab(scrollRef.current, tabBoxes.current.get(value), viewport.current, false);
  };

  const handleLayout = (tabValue: T, part: keyof TabMeasure, event: LayoutChangeEvent): void => {
    const { x, width } = event.nativeEvent.layout;
    if (part === 'tab') {
      tabBoxes.current.set(tabValue, { x, width });
      if (tabValue === value) revealOnMount();
    }
    setMeasures((current) => {
      const previous = current[tabValue]?.[part];
      if (previous && previous.x === x && previous.width === width) return current;
      return { ...current, [tabValue]: { ...current[tabValue], [part]: { x, width } } };
    });
  };

  const handleViewportLayout = (event: LayoutChangeEvent): void => {
    viewport.current.width = event.nativeEvent.layout.width;
    revealOnMount();
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    viewport.current.offset = event.nativeEvent.contentOffset.x;
  };

  return (
    <View accessibilityRole="tablist" testID={testID} style={[styles.row, style]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        // Na fonte padrão as quatro cabem: a fileira não quica à toa no iOS.
        alwaysBounceHorizontal={false}
        onLayout={handleViewportLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={styles.content}
      >
        {tabs.map((tab) => (
          <TabButton
            key={tab.value}
            tab={tab}
            selected={tab.value === value}
            onPress={() => {
              if (tab.value !== value) onChange(tab.value);
            }}
            onLayout={(event) => handleLayout(tab.value, 'tab', event)}
            onLabelLayout={(event) => handleLayout(tab.value, 'label', event)}
            testID={testID ? `${testID}-${tab.value}` : undefined}
          />
        ))}
        {/* Só aparece medido: nasce já na aba escolhida, sem deslizar da esquerda. */}
        {underline ? (
          <Indicator box={underline} testID={testID ? `${testID}-indicator` : undefined} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: borderWidths.default,
    borderBottomColor: colors.border,
  },
  content: {
    flexDirection: 'row',
    paddingHorizontal: ROW_INSET,
  },
  // O protótipo tem 26,5 de altura; a aba cresce para cima até 44 e o texto
  // fica a 11 do traço, que encosta na linha de baixo.
  tab: {
    minHeight: layout.minTouchTarget,
    minWidth: layout.minTouchTarget,
    paddingHorizontal: TAB_INSET,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: spacing.gridGap + borderWidths.strong,
  },
  idleLabel: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: borderWidths.strong,
    backgroundColor: colors.text,
  },
});
