import { useEffect, useState, type Ref } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { maxFontScaleOf, Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import {
  borderWidths,
  colors,
  layout,
  motion,
  radii,
  spacing,
  tints,
  typography,
  type TypographyVariant,
} from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatNumber } from '@/utils/number';
import { firstNameAndInitial } from '@/utils/text';

import { LARGE_TEXT_SCALE } from '../consts';
import { describePodium, entryName } from '../describe-rank';
import type { LeaderboardEntry } from '../types';

import { EntryAvatar, type RankingSelf } from './entry-avatar';

export type PodiumPlace = 1 | 2 | 3;

type Place = PodiumPlace;

const PLACES: readonly Place[] = [1, 2, 3];

// Colunas de 111,5 / 124,9 / 111,5 em 366 no protótipo: o 1º é 12% mais largo.
export const COLUMN_FLEX: Record<Place, number> = { 1: 1.12, 2: 1, 3: 1 };
const TOTAL_FLEX = COLUMN_FLEX[1] + COLUMN_FLEX[2] + COLUMN_FLEX[3];
// O degrau fora o conteúdo: as bordas de cima e de baixo, 12 de padding em cima e 14 embaixo.
const STEP_CHROME = borderWidths.default * 2 + spacing.md + spacing.cardPadding;
/**
 * Escada (proposta padrão, 1f.4): o 3º na altura do conteúdo, o 2º 14 acima
 * dele e o 1º 16 acima do 2º. O protótipo tem 110 / 78 / 62, e o 3º cortava
 * os pontos; um piso fixo (110 / 94 / 80) ficava abaixo do conteúdo do 1º e
 * do 3º, e o 3º quase alcançava o 2º.
 */
const STAIR_GAP = { second: 14, first: 16 } as const;
// Título do 1º em lima a .75, como no protótipo (contraste de sobra sobre o degrau).
const TITLE_ALPHA = 0.75;

// Diferença de medida que não muda o degrau (arredondamento do Android).
const MEASURE_TOLERANCE = 0.5;

// Os degraus sobem da base na ordem 3º, 2º, 1º, com um intervalo curto.
const RISE = 16;
const RISE_STEP_MS = 70;
const RISE_ORDER: Record<Place, number> = { 3: 0, 2: 1, 1: 2 };

export interface PodiumProps {
  /** As posições 1 a 3; com menos gente, os degraus que faltam ficam vagos. */
  entries: readonly LeaderboardEntry[];
  self: RankingSelf;
  /** Título do 1º vindo do painel; `null` usa o neutro, "Líder da temporada". */
  leaderTitle: string | null;
  /** A coluna do próprio fã, quando ele está no pódio (o card "Você" leva o foco até ela). */
  meRef?: Ref<View>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

// Os textos de cada degrau, de cima para baixo (os vãos são os dos estilos no fim do arquivo).
const FIRST_TEXT = {
  number: 'numberPodiumFirst',
  name: 'buttonXs',
  points: 'chip',
  title: 'podiumTitle',
} as const satisfies Record<string, TypographyVariant>;
const OTHER_TEXT = {
  number: 'titleEvent',
  name: 'labelTiny',
  points: 'pointsTiny',
} as const satisfies Record<string, TypographyVariant>;

/** A entrelinha da variante na fonte do sistema, até o limite dela. */
function lineHeightAt(variant: TypographyVariant, fontScale: number): number {
  return typography[variant].lineHeight * Math.min(fontScale, maxFontScaleOf(variant));
}

/** O conteúdo de cada degrau com uma linha por texto, na fonte do sistema. */
function contentHeights(fontScale: number): Record<Place, number> {
  const line = (variant: TypographyVariant) => lineHeightAt(variant, fontScale);
  const other =
    line(OTHER_TEXT.number) +
    spacing.sm +
    line(OTHER_TEXT.name) +
    spacing.iconLabelGap +
    line(OTHER_TEXT.points);
  const first =
    line(FIRST_TEXT.number) +
    spacing.tileGap +
    line(FIRST_TEXT.name) +
    spacing.metaGap +
    line(FIRST_TEXT.points) +
    spacing.sm +
    line(FIRST_TEXT.title);
  return { 1: first, 2: other, 3: other };
}

/** Os degraus em escada, pelo conteúdo de cada um (o maior manda). */
function stairs(content: Record<Place, number>): Record<Place, number> {
  const third = content[3] + STEP_CHROME;
  const second = Math.max(content[2] + STEP_CHROME, third + STAIR_GAP.second);
  const first = Math.max(content[1] + STEP_CHROME, second + STAIR_GAP.first);
  return { 1: first, 2: second, 3: third };
}

/**
 * A altura de cada degrau na fonte do sistema (117 / 101 / 87 na padrão). O
 * esqueleto usa a mesma conta, para o pódio não saltar quando o ranking chega.
 */
export function podiumStepHeights(fontScale: number): Record<Place, number> {
  return stairs(contentHeights(fontScale));
}

function useRise(place: Place) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      progress.set(1);
      return;
    }
    progress.set(withDelay(RISE_ORDER[place] * RISE_STEP_MS, withSpring(1, motion.spring.gentle)));
  }, [place, reducedMotion, progress]);

  return progress;
}

interface ColumnProps {
  place: Place;
  entry: LeaderboardEntry | null;
  self: RankingSelf;
  title: string;
  /** Troca o lugar visual da coluna (a ordem na árvore é a de leitura). */
  shiftX: number;
  stepHeight: number;
  /** Com a fonte grande, nome e título quebram em vez de sair cortados. */
  largeText: boolean;
  onContentHeight: (place: Place, height: number) => void;
  meRef?: Ref<View>;
  testID?: string;
}

function PodiumColumn({
  place,
  entry,
  self,
  title,
  shiftX,
  stepHeight,
  largeText,
  onContentHeight,
  meRef,
  testID,
}: ColumnProps) {
  const progress = useRise(place);
  const first = place === 1;
  const text = first ? FIRST_TEXT : OTHER_TEXT;
  const name = entry ? (entry.isMe ? t('ranking.you') : firstNameAndInitial(entryName(entry))) : '';
  const avatarSize = first ? 'podiumFirst' : 'podium';

  const animatedStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return {
      opacity: Math.min(1, value),
      transform: [{ translateX: shiftX }, { translateY: (1 - value) * RISE }],
    };
  });

  return (
    <Animated.View
      ref={entry?.isMe ? meRef : undefined}
      accessible
      accessibilityLabel={describePodium(place, entry, name, first ? title : null)}
      testID={testID}
      style={[{ flex: COLUMN_FLEX[place] }, animatedStyle]}
    >
      <View style={styles.avatarSlot}>
        {entry ? (
          <EntryAvatar
            entry={entry}
            self={self}
            size={avatarSize}
            ring={entry.isMe ? 'self' : first ? 'points' : 'none'}
          />
        ) : (
          <View style={[styles.vacant, vacantSize(layout.avatar[avatarSize].size)]}>
            <Text variant="titleEvent" color={colors.textMuted}>
              {t('ranking.podium.vacant')}
            </Text>
          </View>
        )}
      </View>
      <View
        testID={testID ? `${testID}-step` : undefined}
        style={[
          styles.step,
          first ? styles.stepFirst : styles.stepOther,
          { minHeight: stepHeight },
        ]}
      >
        <View
          onLayout={(event) => onContentHeight(place, event.nativeEvent.layout.height)}
          testID={testID ? `${testID}-content` : undefined}
          style={styles.stepContent}
        >
          <Text variant={text.number} color={first ? colors.points : colors.textSubtle} tabular>
            {place}
          </Text>
          {entry ? (
            <>
              <Text
                variant={text.name}
                numberOfLines={largeText ? 2 : 1}
                style={[styles.centered, first ? styles.nameFirst : styles.name]}
              >
                {name}
              </Text>
              <Text
                variant={text.points}
                color={first ? colors.points : colors.textTertiary}
                tabular
                style={first ? styles.pointsFirst : styles.points}
              >
                {formatNumber(entry.points)}
              </Text>
              {first ? (
                <Text
                  variant={FIRST_TEXT.title}
                  color={withAlpha(colors.points, TITLE_ALPHA)}
                  numberOfLines={largeText ? 3 : 2}
                  style={[styles.centered, styles.title]}
                >
                  {title}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

function vacantSize(size: number): ViewStyle {
  return { width: size, height: size, borderRadius: size / 2 };
}

/**
 * Pódio do ranking (1f): o 1º no meio, mais alto e em lima, o 2º à esquerda
 * e o 3º à direita, todos com o primeiro nome e a inicial do último. Os
 * degraus sobem da base ao aparecer (parados com reduzir movimento).
 *
 * A escada sai do conteúdo medido de cada degrau, com a conta da fonte do
 * sistema como piso (o degrau vago só tem o número): com a fonte grande e um
 * nome em duas linhas, o 3º continua abaixo do 2º, e o 2º abaixo do 1º.
 *
 * O leitor de tela lê 1º, 2º e 3º, não a ordem da tela: as colunas ficam
 * nessa ordem na árvore, e o 1º e o 2º trocam de lugar só no desenho
 * (`translateX`, que não mexe no layout). Cada coluna é um elemento só.
 */
export function Podium({ entries, self, leaderTitle, meRef, style, testID }: PodiumProps) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  // Começa na largura da tela menos as margens; o onLayout corrige.
  const [width, setWidth] = useState(windowWidth - spacing.gutter * 2);
  // O conteúdo de cada degrau como a tela desenhou (nome em duas linhas, título longo).
  const [measured, setMeasured] = useState<Partial<Record<Place, number>>>({});
  const unit = (width - spacing.tileGap * 2) / TOTAL_FLEX;
  const title = leaderTitle ?? t('ranking.podium.leaderTitle');
  const base = contentHeights(fontScale);
  const steps = stairs({
    1: Math.max(base[1], measured[1] ?? 0),
    2: Math.max(base[2], measured[2] ?? 0),
    3: Math.max(base[3], measured[3] ?? 0),
  });

  const onContentHeight = (place: Place, height: number): void => {
    setMeasured((current) =>
      Math.abs((current[place] ?? 0) - height) < MEASURE_TOLERANCE
        ? current
        : { ...current, [place]: height },
    );
  };

  // Na árvore: 1º, 2º, 3º. Na tela: 2º, 1º, 3º (o 3º não sai do lugar).
  const shiftX: Record<Place, number> = {
    1: unit * COLUMN_FLEX[2] + spacing.tileGap,
    2: -(unit * COLUMN_FLEX[1] + spacing.tileGap),
    3: 0,
  };

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    if (next !== width) setWidth(next);
  };

  return (
    <View onLayout={onLayout} testID={testID} style={[styles.row, style]}>
      {PLACES.map((place) => (
        <PodiumColumn
          key={place}
          place={place}
          entry={entries.find((entry) => entry.position === place) ?? null}
          self={self}
          title={title}
          shiftX={shiftX[place]}
          stepHeight={steps[place]}
          largeText={fontScale >= LARGE_TEXT_SCALE}
          onContentHeight={onContentHeight}
          meRef={meRef}
          testID={testID ? `${testID}-${place}` : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.tileGap,
  },
  avatarSlot: {
    alignItems: 'center',
    marginBottom: spacing.tileGap,
  },
  vacant: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidths.default,
    borderStyle: 'dashed',
    borderColor: colors.borderGlass,
  },
  step: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.metaGap,
    paddingBottom: spacing.cardPadding,
    borderWidth: borderWidths.default,
    borderTopLeftRadius: radii.sm,
    borderTopRightRadius: radii.sm,
  },
  stepContent: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  // O protótipo usa lima a .12 / .45; as tintas `soft` (.14 / .4) são as mais próximas.
  stepFirst: {
    backgroundColor: withAlpha(colors.points, tints.soft.fill),
    borderColor: withAlpha(colors.points, tints.soft.border),
  },
  stepOther: {
    backgroundColor: colors.surface,
    borderColor: colors.track,
  },
  centered: {
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  name: {
    marginTop: spacing.sm,
  },
  nameFirst: {
    marginTop: spacing.tileGap,
  },
  points: {
    marginTop: spacing.iconLabelGap,
  },
  pointsFirst: {
    marginTop: spacing.metaGap,
  },
  title: {
    marginTop: spacing.sm,
  },
});
