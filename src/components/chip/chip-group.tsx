import { useEffect, useRef } from 'react';
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

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { spacing } from '@/theme';
import { revealOffset, type ScrollItemBox, type ScrollViewport } from '@/utils/reveal-in-scroll';

import { Chip } from './chip';

export interface ChipItem<T extends string> {
  value: T;
  label: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

interface ChipGroupBaseProps<T extends string> {
  items: readonly ChipItem<T>[];
  /**
   * Espaço antes do primeiro e depois do último chip. A fileira vai de ponta a
   * ponta da tela e rola por baixo da margem, então quem chama não põe padding
   * em volta dela.
   */
  gutter?: keyof typeof spacing | 'none';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface SingleSelection<T extends string> {
  multiple?: false;
  value: T;
  onChange: (value: T) => void;
  /**
   * Toque no chip que já está escolhido. Na 1m o escolhido segue a rolagem, e
   * tocar nele volta ao começo do mês.
   */
  onReselect?: (value: T) => void;
}

interface MultipleSelection<T extends string> {
  multiple: true;
  value: readonly T[];
  /** Os escolhidos na ordem dos `items`, não na ordem dos toques. */
  onChange: (value: T[]) => void;
  onReselect?: undefined;
}

export type ChipGroupProps<T extends string> = ChipGroupBaseProps<T> &
  (SingleSelection<T> | MultipleSelection<T>);

// Leva o chip escolhido para dentro da tela quando ele está cortado, com a
// margem da fileira sobrando do lado. Na 1m a seleção acompanha a rolagem da
// lista, então o mês escolhido pode estar fora da tela.
function revealChip(
  scroll: ScrollView | null,
  chip: ScrollItemBox | undefined,
  viewport: ScrollViewport,
  gutter: number,
  animated: boolean,
): void {
  if (!scroll || !chip) return;
  const x = revealOffset(chip, viewport, gutter);
  if (x !== null) scroll.scrollTo({ x, animated });
}

/**
 * Fileira de chips com rolagem horizontal (1f, 1m). Na seleção única vira uma
 * `tablist` no Android (no iOS o papel não existe e cada chip é botão com
 * "selecionado"); na múltipla, cada chip é uma caixa de marcar.
 */
export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  const { items, gutter = 'gutter', style, testID } = props;
  const reducedMotion = usePrefersReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const boxes = useRef(new Map<T, ScrollItemBox>());
  const viewport = useRef<ScrollViewport>({ offset: 0, width: 0 });
  const gutterSize = gutter === 'none' ? 0 : spacing[gutter];
  const single = props.multiple ? null : props.value;

  useEffect(() => {
    if (single === null) return;
    revealChip(
      scrollRef.current,
      boxes.current.get(single),
      viewport.current,
      gutterSize,
      !reducedMotion,
    );
  }, [single, gutterSize, reducedMotion]);

  // Na abertura as medidas chegam depois do efeito: o escolhido aparece sem animar.
  const revealOnMount = (): void => {
    if (single === null) return;
    revealChip(scrollRef.current, boxes.current.get(single), viewport.current, gutterSize, false);
  };

  const isSelected = (value: T): boolean =>
    props.multiple ? props.value.includes(value) : props.value === value;

  const press = (value: T): void => {
    if (!props.multiple) {
      if (value !== props.value) props.onChange(value);
      else props.onReselect?.(value);
      return;
    }
    const next = new Set(props.value);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    props.onChange(items.filter((item) => next.has(item.value)).map((item) => item.value));
  };

  const handleChipLayout = (value: T, event: LayoutChangeEvent): void => {
    const { x, width } = event.nativeEvent.layout;
    boxes.current.set(value, { x, width });
    if (value === single) revealOnMount();
  };

  const handleViewportLayout = (event: LayoutChangeEvent): void => {
    viewport.current.width = event.nativeEvent.layout.width;
    revealOnMount();
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    viewport.current.offset = event.nativeEvent.contentOffset.x;
  };

  return (
    <View
      testID={testID}
      accessibilityRole={Platform.OS === 'android' && !props.multiple ? 'tablist' : undefined}
      style={style}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onLayout={handleViewportLayout}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutterSize }]}
      >
        {items.map((item) => (
          <Chip
            key={item.value}
            label={item.label}
            selected={isSelected(item.value)}
            mode={props.multiple ? 'multiple' : 'single'}
            reselectable={props.onReselect !== undefined}
            onPress={() => press(item.value)}
            onLayout={(event) => handleChipLayout(item.value, event)}
            accessibilityLabel={item.accessibilityLabel}
            accessibilityHint={item.accessibilityHint}
            testID={testID ? `${testID}-${item.value}` : undefined}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.chipGap,
  },
});
