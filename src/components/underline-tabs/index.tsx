import { Fragment, useEffect, useEffectEvent, useRef, useState } from 'react';
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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

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

/** Largura do rótulo de uma aba escolhida (Sora 800) e não escolhida (Manrope 600). */
interface LabelWidths {
  active: number;
  idle: number;
}

/** Onde a aba fica no conteúdo da rolagem e onde vai o traço, sob o rótulo. */
interface TabBox {
  tab: ScrollItemBox;
  underline: ScrollItemBox;
}

const TIMING = { duration: motion.duration.base, easing: motion.easing.out };

// O vão de 20 entre as abas (1d) vira margem de dentro, metade para cada lado:
// o toque cobre o vão e nenhuma aba fica com menos de 44 de largura.
const TAB_INSET = spacing.sectionTopTight / 2;
// Com a margem da primeira aba, o primeiro rótulo continua a 18 da borda.
const ROW_INSET = spacing.gutter - TAB_INSET;
// Nenhum rótulo chega perto disso, nem com a fonte grande.
const RULER_WIDTH = 1000;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/** Largura natural de um rótulo, medida fora da fileira, sem nada apertando o texto. */
function widthOf(event: LayoutChangeEvent): number {
  return Math.ceil(event.nativeEvent.layout.width);
}

function ActiveLabel({ label }: { label: string }) {
  return (
    <Text variant="buttonSmall" numberOfLines={1}>
      {label}
    </Text>
  );
}

function IdleLabel({ label }: { label: string }) {
  return (
    <Text variant="tabItem" color={colors.textMuted} numberOfLines={1}>
      {label}
    </Text>
  );
}

/**
 * Onde cada aba e o traço ficam com a escolha atual: a escolhida mede o
 * rótulo em Sora, as outras em Manrope. `null` até todos os rótulos medirem.
 */
function layoutTabs<T extends string>(
  tabs: readonly UnderlineTab<T>[],
  value: T,
  widths: Partial<Record<T, LabelWidths>>,
): Record<T, TabBox> | null {
  const boxes = {} as Record<T, TabBox>;
  let x = ROW_INSET;
  for (const tab of tabs) {
    const measured = widths[tab.value];
    if (!measured) return null;
    const label = tab.value === value ? measured.active : measured.idle;
    const width = Math.max(layout.minTouchTarget, label + 2 * TAB_INSET);
    boxes[tab.value] = {
      tab: { x, width },
      underline: { x: x + (width - label) / 2, width: label },
    };
    x += width;
  }
  return boxes;
}

function TabButton<T extends string>({
  tab,
  selected,
  widths,
  onPress,
  testID,
}: {
  tab: UnderlineTab<T>;
  selected: boolean;
  /** Antes de medir, o rótulo do estado atual dá a largura. */
  widths: LabelWidths | undefined;
  onPress: () => void;
  testID?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    const target = selected ? 1 : 0;
    progress.set(reducedMotion ? target : withTiming(target, TIMING));
  }, [selected, reducedMotion, progress]);

  // A caixa do rótulo anda da largura de um estado à do outro junto com o
  // traço, e as vizinhas acompanham no mesmo passo.
  const boxStyle = useAnimatedStyle(() =>
    widths ? { width: widths.idle + (widths.active - widths.idle) * progress.get() } : {},
  );
  const activeStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const idleStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.get() }));

  return (
    <PressableScale
      onPress={onPress}
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
      <Animated.View
        style={[styles.labelBox, boxStyle]}
        testID={testID ? `${testID}-label` : undefined}
      >
        {/* O rótulo do estado atual fica no fluxo; o outro, por cima, sumindo.
            Cada um tem a própria largura e fica no meio da caixa: o que é mais
            largo que ela passa dos dois lados, sem cortar nem quebrar. */}
        <Animated.View style={[styles.layer, !selected && styles.overlay, activeStyle]}>
          <View style={widths && { width: widths.active }}>
            <ActiveLabel label={tab.label} />
          </View>
        </Animated.View>
        <Animated.View style={[styles.layer, selected && styles.overlay, idleStyle]}>
          <View style={widths && { width: widths.idle }}>
            <IdleLabel label={tab.label} />
          </View>
        </Animated.View>
      </Animated.View>
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

/**
 * Abas internas com sublinhado (Mural, Missões, Agenda e Ranking da 1d). O
 * traço de 2 pt desliza até a aba escolhida; a linha de baixo vai de ponta a
 * ponta, então a fileira não leva margem de quem chama.
 *
 * Com a fonte grande as abas não cabem na largura da tela: a fileira rola, como
 * os chips, e a aba escolhida é trazida para dentro da tela.
 *
 * Cada aba tem a largura do rótulo que mostra (Sora 800 na escolhida, Manrope
 * 600 nas outras), com o vão de 20 do protótipo entre elas. As larguras dos
 * dois estados são medidas fora da fileira, e o traço vai direto para o lugar
 * final dele: na troca, os rótulos trocam por opacidade, a caixa da aba anda
 * de uma largura à outra e as vizinhas andam 1 ou 2 pt, tudo no mesmo tempo
 * do traço.
 */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  style,
  testID,
}: UnderlineTabsProps<T>) {
  const reducedMotion = usePrefersReducedMotion();
  const [widths, setWidths] = useState<Partial<Record<T, Partial<LabelWidths>>>>({});
  const scrollRef = useRef<ScrollView>(null);
  const viewport = useRef<ScrollViewport>({ offset: 0, width: 0 });
  // A aba que a fileira já trouxe para a tela; na primeira vez, sem animar.
  const revealed = useRef<T | null>(null);

  const complete: Partial<Record<T, LabelWidths>> = {};
  for (const tab of tabs) {
    const measured = widths[tab.value];
    if (measured?.active !== undefined && measured.idle !== undefined) {
      complete[tab.value] = { active: measured.active, idle: measured.idle };
    }
  }
  const boxes = layoutTabs(tabs, value, complete);
  const layoutKey = boxes
    ? tabs.map((tab) => `${boxes[tab.value].tab.x}:${boxes[tab.value].tab.width}`).join('|')
    : null;

  const reveal = useEffectEvent(() => {
    if (!boxes) return;
    const animated = revealed.current !== null && revealed.current !== value && !reducedMotion;
    revealed.current = value;
    revealTab(scrollRef.current, boxes[value].tab, viewport.current, animated);
  });

  useEffect(() => {
    reveal();
  }, [value, layoutKey]);

  const handleRulerLayout = (tabValue: T, part: keyof LabelWidths, event: LayoutChangeEvent) => {
    const width = widthOf(event);
    setWidths((current) => {
      if (current[tabValue]?.[part] === width) return current;
      return { ...current, [tabValue]: { ...current[tabValue], [part]: width } };
    });
  };

  const handleViewportLayout = (event: LayoutChangeEvent): void => {
    viewport.current.width = event.nativeEvent.layout.width;
    // Na abertura, a escolhida aparece sem animar.
    if (boxes) revealTab(scrollRef.current, boxes[value].tab, viewport.current, false);
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
            widths={complete[tab.value]}
            onPress={() => {
              if (tab.value !== value) onChange(tab.value);
            }}
            testID={testID ? `${testID}-${tab.value}` : undefined}
          />
        ))}
        {/* Só aparece medido: nasce já na aba escolhida, sem deslizar da esquerda. */}
        {boxes ? (
          <Indicator
            box={boxes[value].underline}
            testID={testID ? `${testID}-indicator` : undefined}
          />
        ) : null}
      </ScrollView>
      {/* Réguas invisíveis: a largura natural de cada rótulo nos dois estados, com a fonte do aparelho. */}
      <View pointerEvents="none" {...hiddenFromReader} style={styles.rulers}>
        {tabs.map((tab) => (
          <Fragment key={tab.value}>
            <View
              onLayout={(event) => handleRulerLayout(tab.value, 'active', event)}
              testID={testID ? `${testID}-${tab.value}-ruler-active` : undefined}
            >
              <ActiveLabel label={tab.label} />
            </View>
            <View
              onLayout={(event) => handleRulerLayout(tab.value, 'idle', event)}
              testID={testID ? `${testID}-${tab.value}-ruler-idle` : undefined}
            >
              <IdleLabel label={tab.label} />
            </View>
          </Fragment>
        ))}
      </View>
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
  labelBox: {
    alignItems: 'center',
  },
  layer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: borderWidths.strong,
    backgroundColor: colors.text,
  },
  rulers: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RULER_WIDTH,
    alignItems: 'flex-start',
    opacity: 0,
  },
});
