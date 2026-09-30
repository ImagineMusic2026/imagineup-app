import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Avatar } from '@/components/avatar';
import { PressableScale } from '@/components/pressable-scale';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, motion, radii, shadows, spacing } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatNumber } from '@/utils/number';

import { describeMyRank, describeMyRankStatus } from '../describe-rank';
import type { MyRank } from '../types';

import type { RankingSelf } from './entry-avatar';

// Fundo do avatar sem foto sobre o rosa, como no protótipo (ink a .35).
const AVATAR_FILL_ALPHA = 0.35;
// Escondido, o card desce um pouco enquanto some.
const HIDDEN_OFFSET = 16;
// Posição e pontos enquanto a posição carrega (e sem posição).
const EMPTY_VALUE = '·';
// A posição ocupa a mesma largura (26 no protótipo), até 3 dígitos.
const POSITION_WIDTH = 26;

export interface MyRankCardProps {
  /** `undefined` enquanto carrega. */
  myRank: MyRank | undefined;
  seasonOver: boolean;
  self: RankingSelf;
  /**
   * Some (descendo, com fade) quando a linha do fã está à vista, ou quando
   * não há o que mostrar; volta quando ela sai.
   */
  visible: boolean;
  /** Rola até a linha do fã. Sem ele (fã sem posição, lista sem carregar), o card só informa. */
  onPress?: () => void;
  /**
   * Buscando as páginas até a linha do fã, depois do toque: o card fica
   * ocupado para o leitor e um indicador toma o lugar dos pontos.
   */
  busy?: boolean;
  /**
   * A 1f está à vista. Ela segue montada fora de foco (outra aba, missões por
   * cima), e o ranking busca de novo por lá (o "Eu vou" da agenda, a volta ao
   * app): subir de posição só festeja quando o fã volta a ela.
   */
  screenFocused?: boolean;
  /** "Mostra sua linha no ranking" ou, no pódio, "Mostra o pódio". */
  accessibilityHint?: string;
  /** Muda com o chip: subir de posição só conta dentro do mesmo recorte. */
  scopeKey: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Subiu de posição no mesmo recorte desde a última vez que o fã viu o card:
 * toque `rankUp` e, para o leitor de tela, "Você subiu para o 11º lugar.".
 * Fora de foco, nada acontece e a posição vista não muda: a festa sai uma vez
 * quando o fã volta à tela.
 */
function useRankUpFeedback(
  scopeKey: string,
  position: number | null | undefined,
  screenFocused: boolean,
): void {
  const last = useRef<{ scopeKey: string; position: number } | null>(null);

  useEffect(() => {
    if (!screenFocused || position === undefined || position === null) return;
    const previous = last.current;
    if (previous && previous.scopeKey === scopeKey && position < previous.position) {
      haptics.trigger('rankUp');
      AccessibilityInfo.announceForAccessibilityWithOptions(t('ranking.me.rankUp', { position }), {
        queue: true,
      });
    }
    last.current = { scopeKey, position };
  }, [scopeKey, position, screenFocused]);
}

function useShowHide(visible: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  const shown = useSharedValue(0);

  useEffect(() => {
    const target = visible ? 1 : 0;
    if (reducedMotion) {
      shown.set(target);
      return;
    }
    // Aparece subindo da tab bar com mola; some em fade, sem balanço.
    shown.set(
      visible
        ? withSpring(target, motion.spring.gentle)
        : withTiming(target, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  }, [visible, reducedMotion, shown]);

  return useAnimatedStyle(() => {
    const value = shown.get();
    return {
      opacity: Math.min(1, Math.max(0, value)),
      transform: [{ translateY: (1 - value) * HIDDEN_OFFSET }],
    };
  });
}

/**
 * Card fixo "Você" do ranking (1f), colado em cima da tab bar: posição,
 * avatar, o que falta para a próxima meta e os pontos da temporada no
 * recorte. Rosa `accentStrong` com o subtítulo em branco cheio (o branco .8
 * do protótipo sobre o rosa reprova contraste), separado do "Você" pelo peso e
 * pelo tamanho: o Manrope 600 do protótipo (`micro`), que aqui cresce até
 * 200% como o resto do card. Um elemento só para o leitor.
 */
export function MyRankCard({
  myRank,
  seasonOver,
  self,
  visible,
  onPress,
  busy = false,
  screenFocused = true,
  accessibilityHint,
  scopeKey,
  onLayout,
  style,
  testID,
}: MyRankCardProps) {
  const showStyle = useShowHide(visible);
  useRankUpFeedback(scopeKey, myRank?.position, screenFocused);

  const loading = myRank === undefined;
  const status = loading ? t('ranking.me.loading') : describeMyRankStatus(myRank, seasonOver).text;
  const label = loading ? t('ranking.me.loading') : describeMyRank(myRank, seasonOver);
  const position = myRank?.position ?? null;

  const content = (
    <>
      <Text variant="points" tabular numberOfLines={1} style={styles.position}>
        {position === null ? EMPTY_VALUE : position}
      </Text>
      <Avatar
        name={self.name}
        id={self.id}
        photoUrl={self.photoUrl}
        size="md"
        fallbackColor={withAlpha(colors.background, AVATAR_FILL_ALPHA)}
      />
      <View style={styles.texts}>
        <Text variant="label" numberOfLines={1}>
          {t('ranking.you')}
        </Text>
        <Text variant="micro" maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.status}>
          {status}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text variant="points" tabular>
          {loading ? EMPTY_VALUE : formatNumber(myRank.points)}
        </Text>
      )}
    </>
  );

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      onLayout={onLayout}
      testID={testID}
      style={[style, showStyle]}
    >
      {onPress && !loading ? (
        <PressableScale
          onPress={onPress}
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          accessibilityState={busy ? { busy: true } : undefined}
          style={styles.card}
        >
          {content}
        </PressableScale>
      ) : (
        <View
          accessible
          accessibilityLabel={label}
          accessibilityState={loading ? { busy: true } : undefined}
          style={styles.card}
        >
          {content}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.cardPadding,
    borderRadius: radii.lg,
    backgroundColor: colors.accentStrong,
    ...shadows.glowAccentLarge,
  },
  position: {
    minWidth: POSITION_WIDTH,
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  status: {
    marginTop: spacing.xs,
  },
});
