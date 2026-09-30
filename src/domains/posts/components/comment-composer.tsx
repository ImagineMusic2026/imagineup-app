import { ArrowUp } from 'lucide-react-native';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  TextInput,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PointsToast, pointsToastAnnouncement } from '@/components/points-toast';
import { PressableScale } from '@/components/pressable-scale';
import { MAX_FONT_SCALE, Text } from '@/components/text';
import { useFocusBorder } from '@/components/text-input';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { borderWidths, colors, layout, motion, radii, spacing, typography } from '@/theme';

import type { CommentAward } from '../queries';
import { COMMENT_MAX_LENGTH, commentSchema } from '../schemas';

/** O contador aparece quando faltam 50 caracteres. */
export const COMMENT_COUNTER_FROM = 450;

const SEND_SIZE = layout.composerMinHeight;
const SEND_ICON_SIZE = 18;
const SEND_ICON_STROKE = 2.2;
// A seta apagada do botão desligado: branco a .5, o `textMuted`.
const SEND_ICON_REST_OPACITY = 0.5;
// Da borda do compositor ao campo, e do campo ao teclado aberto.
const FIELD_PADDING_VERTICAL = spacing.listGap;
const FIELD_MAX_LINES = 4;
// O campo e o enviar desenham 40, dentro de alvos de 44: os 4 que sobram ficam
// em cima deles (os dois se alinham pela base) e saem do padding de cima do
// compositor e do vão entre os dois, para o desenho seguir o da proposta.
const TARGET_OUTSET = layout.minTouchTarget - layout.composerMinHeight;
const ROW_GAP = spacing.listGap - TARGET_OUTSET;
// Do contorno do campo até a linha do texto, em cima e embaixo.
const FIELD_TEXT_INSET = (layout.composerMinHeight - typography.inputCompact.lineHeight) / 2;
// Da beira do alvo até o texto: o padding de 14 da proposta mais a borda de 1.
const INPUT_PADDING_HORIZONTAL = spacing.cardPadding + borderWidths.default;
// O "+N" nasce um pouco acima da borda do compositor e sobe mais 12.
const TOAST_GAP = spacing.xs;

/** O que a tela faz com o compositor sem guardar o texto (digitar não redesenha a lista). */
export interface CommentComposerHandle {
  /** "Comentar" do post: leva o foco (e o teclado) ao campo, e o do leitor de tela junto. */
  focus: () => void;
  /**
   * O envio falhou: o texto volta ao campo se ele estiver vazio. `false`
   * quando o fã já começou outro comentário.
   */
  restore: (text: string) => boolean;
}

export interface CommentComposerProps {
  /** Texto já validado e sem espaço nas pontas; o campo se limpa logo depois. */
  onSend: (text: string) => void;
  /** Um comentário está indo agora: com o campo vazio, a seta vira o carregando. */
  sending: boolean;
  /** O último ganho de pontos por comentar, para o "+N" que sobe do campo. */
  award: CommentAward | null;
  /** O teclado cobre o pé da tela (`useKeyboardVisible`, lido pela tela). */
  keyboardVisible: boolean;
  ref?: Ref<CommentComposerHandle>;
}

/**
 * Enviar: círculo de 40 dentro do alvo de 44 (colado embaixo e à direita, na
 * linha do campo e no gutter). Com texto, o fundo vai do escuro ao rosa
 * fechado (HSV, 150 ms) e a seta acende; vazio ou só espaço, fica desligado. O
 * rosa é o `accentStrong`: branco sobre o #FF2D6F reprova o contraste.
 */
function SendButton({
  enabled,
  sending,
  onPress,
}: {
  enabled: boolean;
  sending: boolean;
  onPress: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const progress = useSharedValue(enabled ? 1 : 0);

  useEffect(() => {
    const target = enabled ? 1 : 0;
    progress.set(
      reducedMotion
        ? target
        : withTiming(target, { duration: motion.duration.fast, easing: motion.easing.out }),
    );
  }, [enabled, reducedMotion, progress]);

  const surfaceStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      backgroundColor: interpolateColor(
        p,
        [0, 1],
        [colors.surfaceRaised, colors.accentStrong],
        'HSV',
      ),
      // A borda sai do branco translúcido: em RGB, como a do foco do campo.
      borderColor: interpolateColor(p, [0, 1], [colors.borderStrong, colors.accentStrong]),
    };
  });
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [SEND_ICON_REST_OPACITY, 1]),
  }));

  const busy = sending && !enabled;

  return (
    <PressableScale
      onPress={onPress}
      disabled={!enabled}
      accessibilityLabel={t('post.composer.send')}
      accessibilityState={{ busy }}
      style={styles.sendTarget}
      testID="comment-send"
    >
      <Animated.View style={[styles.sendCircle, surfaceStyle]}>
        {busy ? (
          <ActivityIndicator color={colors.onAccent} size="small" />
        ) : (
          <Animated.View style={iconStyle}>
            <Icon
              icon={ArrowUp}
              size={SEND_ICON_SIZE}
              strokeWidth={SEND_ICON_STROKE}
              color={colors.onAccent}
            />
          </Animated.View>
        )}
      </Animated.View>
    </PressableScale>
  );
}

/**
 * Compositor preso ao pé da tela do post, fora da lista. O campo não tem
 * rótulo visível: o placeholder "Escreva um comentário" é também o rótulo do
 * leitor de tela, e o limite (500) vai na dica quando o contador aparece
 * (a partir de 450; em 500 fica laranja, e o leitor ouve que chegou ao
 * limite). Cresce até 4 linhas e depois rola. Embaixo, a área segura do
 * aparelho; com o teclado aberto, que cobre essa área, uma margem pequena. O
 * "+N" dos pontos sobe de cima do compositor.
 *
 * O campo desenha 40, mas o toque vale nos 44 do alvo: o `TextInput` ocupa o
 * alvo inteiro, e o contorno (com a borda do foco) é um fundo desenhado atrás
 * dele, sem toque e sem acessibilidade.
 */
export function CommentComposer({
  onSend,
  sending,
  award,
  keyboardVisible,
  ref,
}: CommentComposerProps) {
  const [value, setValue] = useState('');
  const input = useRef<TextInput>(null);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(0);
  const borderStyle = useFocusBorder(focused, colors.border, colors.accent);

  const length = value.length;
  const canSend = value.trim().length > 0;
  const showCounter = length >= COMMENT_COUNTER_FROM;
  const full = length >= COMMENT_MAX_LENGTH;
  const lineHeight = typography.inputCompact.lineHeight * Math.min(fontScale, MAX_FONT_SCALE);
  const maxHeight = lineHeight * FIELD_MAX_LINES + FIELD_TEXT_INSET * 2 + TARGET_OUTSET;
  const paddingBottom = keyboardVisible
    ? FIELD_PADDING_VERTICAL
    : Math.max(insets.bottom, spacing.md);

  // O mais novo, para quem chama depois de o fã digitar (o erro chega depois).
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // O `maxLength` descarta em silêncio o que passa do limite: o leitor ouve uma vez.
  useAnnounceWhen(full, t('post.composer.limitReached', { max: COMMENT_MAX_LENGTH }));

  useImperativeHandle(ref, () => ({
    // O foco do teclado não leva o do leitor de tela, que ficaria no
    // "Comentar": o campo vem depois da lista inteira na ordem de leitura. O
    // aviso espera o teclado começar a abrir, como nas outras telas.
    focus: () => {
      input.current?.focus();
      setTimeout(() => {
        const node = input.current;
        if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
      }, motion.duration.fast);
    },
    restore: (text) => {
      if (latest.current.trim().length > 0) return false;
      latest.current = text;
      setValue(text);
      return true;
    },
  }));

  // O teclado fica aberto: o fã pode escrever o próximo em seguida.
  const send = (): void => {
    const parsed = commentSchema.safeParse({ text: value });
    if (!parsed.success) return;
    latest.current = '';
    setValue('');
    onSend(parsed.data.text);
  };

  return (
    <View style={styles.anchor}>
      <View
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={[styles.container, { paddingBottom }]}
      >
        {showCounter ? (
          // Lido pela dica do campo, junto com o limite.
          <Text
            variant="caption"
            color={full ? colors.danger : colors.textMuted}
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.counter}
          >
            {t('post.composer.counter', { count: length, max: COMMENT_MAX_LENGTH })}
          </Text>
        ) : null}
        <View style={styles.row}>
          <View style={styles.field}>
            <Animated.View pointerEvents="none" style={[styles.fieldSurface, borderStyle]} />
            <TextInput
              ref={input}
              value={value}
              onChangeText={setValue}
              multiline
              maxLength={COMMENT_MAX_LENGTH}
              placeholder={t('post.commentPlaceholder')}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              accessibilityLabel={t('post.commentPlaceholder')}
              accessibilityHint={
                showCounter
                  ? t('post.composer.counterLabel', { count: length, max: COMMENT_MAX_LENGTH })
                  : undefined
              }
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              textAlignVertical="center"
              style={[styles.input, { maxHeight }]}
              testID="comment-input"
            />
          </View>
          <SendButton enabled={canSend} sending={sending} onPress={send} />
        </View>
      </View>
      {/* Depois do compositor, para ficar por cima dele; nasce na borda de cima. */}
      <PointsToast
        points={award?.points ?? 0}
        trigger={award?.id ?? null}
        announcement={
          award
            ? t('post.composer.sentWithPoints', { points: pointsToastAnnouncement(award.points) })
            : undefined
        }
        style={{ bottom: height + TOAST_GAP }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Por cima da lista: o "+N" sobe para fora do compositor, sobre os comentários.
  anchor: {
    zIndex: 1,
  },
  // Os 4 de cima dos alvos de 44 saem daqui: o campo fica a 10 da borda.
  container: {
    paddingHorizontal: spacing.gutter,
    paddingTop: FIELD_PADDING_VERTICAL - TARGET_OUTSET,
    backgroundColor: colors.background,
    borderTopWidth: borderWidths.default,
    borderTopColor: colors.divider,
  },
  counter: {
    alignSelf: 'flex-end',
    marginTop: TARGET_OUTSET,
    marginBottom: spacing.xs,
    // Em cima do campo, sem passar por cima do botão de enviar.
    marginRight: layout.minTouchTarget + ROW_GAP,
  },
  // Com o vão de 6, o campo e o círculo ficam a 10 um do outro.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: ROW_GAP,
  },
  // O alvo do campo: 44 de altura, com o contorno de 40 embaixo.
  field: {
    flex: 1,
    minHeight: layout.minTouchTarget,
  },
  fieldSurface: {
    position: 'absolute',
    top: TARGET_OUTSET,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radii.xxl,
    borderWidth: borderWidths.default,
    backgroundColor: colors.surface,
  },
  // O texto fica onde ficava dentro do contorno: a 11 dele em cima e embaixo.
  input: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: INPUT_PADDING_HORIZONTAL,
    paddingTop: TARGET_OUTSET + FIELD_TEXT_INSET,
    paddingBottom: FIELD_TEXT_INSET,
    color: colors.text,
    fontFamily: typography.inputCompact.fontFamily,
    fontSize: typography.inputCompact.fontSize,
    lineHeight: typography.inputCompact.lineHeight,
  },
  // O alvo cresce para cima e para a esquerda: o círculo fica colado embaixo,
  // na linha do campo, e à direita, no gutter.
  sendTarget: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  sendCircle: {
    width: SEND_SIZE,
    height: SEND_SIZE,
    borderRadius: SEND_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borderWidths.default,
  },
});
