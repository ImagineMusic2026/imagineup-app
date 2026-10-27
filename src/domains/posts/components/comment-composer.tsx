import { ArrowUp, X } from 'lucide-react-native';
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  TextInput,
  StyleSheet,
  View,
  useWindowDimensions,
  type TextInputSelectionChangeEvent,
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
import { MAX_FONT_SCALE, Text, type TextInstance } from '@/components/text';
import { useFocusBorder } from '@/components/text-input';
import { SuspensionContact } from '@/domains/profile';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t, type TranslationKey } from '@/i18n';
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
  /**
   * "Comentar" do post: leva o foco (e o teclado) ao campo, e o do leitor de
   * tela junto. Com a conta suspensa, sem campo, o do leitor vai à frase dela.
   */
  focus: () => void;
  /**
   * O envio falhou: o texto volta ao campo se ele estiver vazio. `false`
   * quando o fã já começou outro comentário.
   */
  restore: (text: string) => boolean;
  /**
   * Troca um trecho do texto (de `start` até antes de `end`) e põe o cursor
   * logo depois do que entrou, com o foco no campo: a sugestão do @ troca o @
   * que está sendo digitado, e o "Responder" põe o @ de quem foi respondido no
   * começo (seção 37, 37.9). `false` quando o texto passaria do limite.
   */
  replaceRange: (start: number, end: number, replacement: string) => boolean;
  /** O texto de agora no campo, sem redesenhar quem pergunta. */
  getText: () => string;
}

/** O cursor no campo (`onSelectionChange`): o começo e o fim do trecho escolhido. */
export interface ComposerSelection {
  start: number;
  end: number;
}

/**
 * O modo resposta do campo (seção 37, 37.9, item 5): a linha "Respondendo a
 * @fulano" em cima do campo, com o "×" que sai dele.
 */
export interface ComposerReply {
  label: string;
  /** O rótulo do "×" para o leitor de tela. */
  cancelLabel: string;
  onCancel: () => void;
}

export interface CommentComposerProps {
  /** Texto já limpo e validado (`commentSchema`); o campo se limpa logo depois. */
  onSend: (text: string) => void;
  /** Um comentário está indo agora: com o campo vazio, a seta vira o carregando. */
  sending: boolean;
  /** O último ganho de pontos por comentar, para o "+N" que sobe do campo. */
  award: CommentAward | null;
  /** O teclado cobre o pé da tela (`useKeyboardVisible`, lido pela tela). */
  keyboardVisible: boolean;
  /**
   * A conta suspensa (o perfil diz): o campo dá lugar à frase, com o link
   * "Escrever para a equipe" (seção 29, frente E).
   */
  suspended?: boolean;
  /**
   * A recusa do último envio (o teto do dia, a conta suspensa que o perfil
   * ainda não mostrava, o texto fora dos Termos de uso), embaixo do campo;
   * anunciada pelo hook de comentar. Com o `contact`, o link "Escrever para a
   * equipe", com esse assunto.
   */
  refusal?: { text: string; contact: TranslationKey | null } | null;
  /**
   * O fã digitou com a recusa à vista: a tela apaga a de conteúdo (a do teto
   * e a do suspenso ficam até o próximo envio, seção 30).
   */
  onEditAfterRefusal?: () => void;
  /** O modo resposta, com a linha e o "×" em cima do campo (só o fã-clube usa). */
  reply?: ComposerReply | null;
  /**
   * O que fica em cima do campo, dentro do compositor (acima do teclado): a
   * barra das sugestões do @ do fã-clube.
   */
  accessory?: ReactNode;
  /**
   * O texto e o cursor a cada tecla e a cada toque que move o cursor, sem o
   * texto sair do campo: o fã-clube acha o @ que está sendo digitado.
   */
  onDraftChange?: (text: string, selection: ComposerSelection) => void;
  /** O campo ganhou o foco: o fã-clube busca a conversa da sugestão do @ uma vez. */
  onFieldFocus?: () => void;
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

const REPLY_CLOSE_ICON_SIZE = 16;

/**
 * "Respondendo a @fulano", em cima do campo, com o "×" que sai do modo
 * resposta (seção 37, 37.9, item 5). O texto é lido como está, e o "×" é um
 * botão irmão dele, num alvo de 44, com o rótulo que diz o que ele cancela.
 */
function ReplyLine({ reply }: { reply: ComposerReply }) {
  return (
    <View style={styles.reply} testID="comment-reply">
      <Text variant="caption" color={colors.textSecondary} style={styles.replyText}>
        {reply.label}
      </Text>
      <PressableScale
        onPress={reply.onCancel}
        accessibilityLabel={reply.cancelLabel}
        style={styles.replyClose}
        testID="comment-reply-cancel"
      >
        <Icon icon={X} size={REPLY_CLOSE_ICON_SIZE} color={colors.textMuted} />
      </PressableScale>
    </View>
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
 *
 * O texto é limpo e validado como o servidor (`commentSchema`): o que só tem
 * caracteres invisíveis, ou uma linha com eles, mostra o erro abaixo do campo
 * (anunciado) em vez de sumir; digitar de novo tira o erro. O texto limpo é o
 * que vai.
 *
 * Serve também ao fã-clube (seção 37, 37.9, itens 5 e 6), que o importa pelo
 * index: o modo resposta (`reply`), a barra das sugestões do @ em cima do
 * campo (`accessory`), o texto e o cursor a cada mudança (`onDraftChange`, do
 * `onSelectionChange`) e o `replaceRange` do handle. Sem eles, o compositor é
 * o do Mural, como era.
 */
export function CommentComposer({
  onSend,
  sending,
  award,
  keyboardVisible,
  suspended = false,
  refusal = null,
  onEditAfterRefusal,
  reply = null,
  accessory,
  onDraftChange,
  onFieldFocus,
  ref,
}: CommentComposerProps) {
  const [value, setValue] = useState('');
  const input = useRef<TextInput>(null);
  // O cursor fica fora do estado: mover o cursor não redesenha o compositor.
  const selection = useRef<ComposerSelection>({ start: 0, end: 0 });
  // Sem nenhum aviso do campo ainda (e nos testes, que só trocam o texto), o
  // cursor fica no fim do texto.
  const selectionSeen = useRef(false);
  // O cursor que o `replaceRange` pede, posto no campo depois de o texto novo chegar a ele.
  const pendingCursor = useRef<number | null>(null);
  // A frase da conta suspensa, no lugar do campo: o "focus" do handle a leva ao leitor.
  const suspensionText = useRef<TextInstance>(null);
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(0);
  const [error, setError] = useState<string | null>(null);
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
  // A frase embaixo do campo (o erro ou a recusa) vai também na dica dele: o
  // foco que a recusa de conteúdo leva ao campo corta o anúncio da frase, e o
  // leitor de tela lê a dica do campo focado (seção 30). O modo resposta vem
  // na frente: o "Responder" leva o foco ao campo, e o leitor ouve para quem
  // vai o texto.
  const fieldHint =
    [
      reply?.label,
      error ?? refusal?.text,
      showCounter
        ? t('post.composer.counterLabel', { count: length, max: COMMENT_MAX_LENGTH })
        : undefined,
    ]
      .filter((part): part is string => !!part)
      .join(' ') || undefined;

  // O mais novo, para quem chama depois de o fã digitar (o erro chega depois).
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);

  // O `maxLength` descarta em silêncio o que passa do limite: o leitor ouve uma vez.
  useAnnounceWhen(full, t('post.composer.limitReached', { max: COMMENT_MAX_LENGTH }));

  // O cursor que o `replaceRange` pediu vai ao campo depois de o texto novo chegar a ele.
  useEffect(() => {
    const cursor = pendingCursor.current;
    const node = input.current;
    if (cursor === null || !node) return;
    pendingCursor.current = null;
    // O campo de teste não tem o `setSelection`.
    if (typeof node.setSelection === 'function') node.setSelection(cursor, cursor);
  }, [value]);

  // O foco do teclado não leva o do leitor de tela, que ficaria no
  // "Comentar": o campo vem depois da lista inteira na ordem de leitura. O
  // aviso espera o teclado começar a abrir, como nas outras telas.
  const focusField = (): void => {
    input.current?.focus();
    setTimeout(() => {
      const node = input.current;
      if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
    }, motion.duration.fast);
  };

  /** Avisa quem escuta (a sugestão do @ do fã-clube) do texto e do cursor de agora. */
  const notifyDraft = (text: string): void => {
    onDraftChange?.(text, selection.current);
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      // Sem o campo (a conta suspensa), o foco do leitor vai à frase da suspensão.
      if (suspended) {
        setTimeout(() => {
          if (suspensionText.current) {
            AccessibilityInfo.sendAccessibilityEvent(suspensionText.current, 'focus');
          }
        }, motion.duration.fast);
        return;
      }
      focusField();
    },
    restore: (text) => {
      // Sem o campo (a conta suspensa), a linha fica "Não enviado" com o texto.
      if (suspended || latest.current.trim().length > 0) return false;
      latest.current = text;
      setValue(text);
      selection.current = { start: text.length, end: text.length };
      notifyDraft(text);
      return true;
    },
    replaceRange: (start, end, replacement) => {
      const current = latest.current;
      const from = Math.max(0, Math.min(start, current.length));
      const to = Math.max(from, Math.min(end, current.length));
      const next = `${current.slice(0, from)}${replacement}${current.slice(to)}`;
      if (next.length > COMMENT_MAX_LENGTH) return false;
      const cursor = from + replacement.length;
      latest.current = next;
      selection.current = { start: cursor, end: cursor };
      if (next === current) {
        // O texto não muda: o efeito do [value] não roda, então o cursor vai
        // direto, sem ficar guardado para a próxima tecla.
        pendingCursor.current = null;
        const node = input.current;
        if (node && typeof node.setSelection === 'function') node.setSelection(cursor, cursor);
      } else {
        pendingCursor.current = cursor;
        setValue(next);
      }
      if (error) setError(null);
      if (refusal) onEditAfterRefusal?.();
      focusField();
      notifyDraft(next);
      return true;
    },
    getText: () => latest.current,
  }));

  // O teclado fica aberto: o fã pode escrever o próximo em seguida.
  const send = (): void => {
    const parsed = commentSchema.safeParse({ text: value });
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? t('validation.commentInvisible');
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    latest.current = '';
    selection.current = { start: 0, end: 0 };
    setValue('');
    setError(null);
    onSend(parsed.data.text);
    notifyDraft('');
  };

  const change = (text: string): void => {
    // O fã digitou: o cursor que um `replaceRange` deixou pedido não vale mais.
    pendingCursor.current = null;
    const previous = latest.current;
    // O aviso do cursor pode vir antes ou depois do texto novo (muda com a
    // plataforma): com o cursor no fim do texto de antes, ele segue no fim; no
    // meio, o aviso que vem depois o acerta.
    if (!selectionSeen.current || selection.current.end >= previous.length) {
      selection.current = { start: text.length, end: text.length };
    }
    latest.current = text;
    setValue(text);
    if (error) setError(null);
    if (refusal) onEditAfterRefusal?.();
    notifyDraft(text);
  };

  const changeSelection = (event: TextInputSelectionChangeEvent): void => {
    selectionSeen.current = true;
    selection.current = event.nativeEvent.selection;
    notifyDraft(latest.current);
  };

  if (suspended) {
    return (
      <View style={styles.anchor}>
        <View
          style={[styles.container, styles.suspended, { paddingBottom }]}
          testID="comment-suspended"
        >
          {/* Sem o `accessible` no contêiner: o link "Escrever para a equipe" segue alcançável. */}
          <Text
            ref={suspensionText}
            variant="bodySmall"
            color={colors.textSecondary}
            style={styles.centered}
            testID="comment-suspended-text"
          >
            {t('suspension.comment')}
          </Text>
          <SuspensionContact align="center" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.anchor}>
      <View
        onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
        style={[styles.container, { paddingBottom }]}
      >
        {accessory}
        {reply ? <ReplyLine reply={reply} /> : null}
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
              onChangeText={change}
              multiline
              maxLength={COMMENT_MAX_LENGTH}
              placeholder={t('post.commentPlaceholder')}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.accent}
              cursorColor={colors.accent}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              accessibilityLabel={t('post.commentPlaceholder')}
              accessibilityHint={fieldHint}
              onSelectionChange={changeSelection}
              onFocus={() => {
                setFocused(true);
                onFieldFocus?.();
              }}
              onBlur={() => setFocused(false)}
              textAlignVertical="center"
              style={[styles.input, { maxHeight }]}
              testID="comment-input"
            />
          </View>
          <SendButton enabled={canSend} sending={sending} onPress={send} />
        </View>
        {error ? (
          // Anunciado no envio; aqui só se vê (e o leitor encontra ao navegar).
          <Text variant="caption" color={colors.danger} style={styles.error} testID="comment-error">
            {error}
          </Text>
        ) : refusal ? (
          // A recusa do servidor, anunciada pelo hook; o link é irmão do texto.
          <View>
            <Text
              variant="caption"
              color={colors.danger}
              style={styles.error}
              testID="comment-refusal"
            >
              {refusal.text}
            </Text>
            {refusal.contact ? (
              <SuspensionContact subject={refusal.contact} style={styles.contact} />
            ) : null}
          </View>
        ) : null}
      </View>
      {/* Depois do compositor, para ficar por cima dele; nasce na borda de cima. */}
      <PointsToast
        points={award?.points ?? 0}
        trigger={award?.id ?? null}
        announcement={
          award
            ? t('post.composer.sentWithPoints', {
                points: award.rewards ?? pointsToastAnnouncement(award.points),
              })
            : undefined
        }
        haptic={award?.haptic}
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
  error: {
    marginTop: spacing.xs,
    paddingHorizontal: INPUT_PADDING_HORIZONTAL,
  },
  contact: {
    paddingHorizontal: INPUT_PADDING_HORIZONTAL,
  },
  // A linha do modo resposta: o texto na altura do texto do campo, e o "×" no
  // alvo de 44 em cima do botão de enviar.
  reply: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: INPUT_PADDING_HORIZONTAL,
    marginTop: TARGET_OUTSET,
  },
  replyText: {
    flex: 1,
  },
  replyClose: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A frase da conta suspensa no lugar do campo, centrada, com o link embaixo.
  suspended: {
    paddingTop: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  centered: {
    textAlign: 'center',
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
