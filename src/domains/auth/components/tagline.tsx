import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { MAX_FONT_SCALE, Text } from '@/components/text';
import type { StackEntrance } from '@/hooks/use-stack-fade';
import { t } from '@/i18n';
import { colors, motion, typography } from '@/theme';

export interface TaglineProps {
  /** A entrada da pilha `(auth)`: a frase começa com ela, como o resto da 1k. */
  entrance: StackEntrance;
  /** Lugar da primeira parte na sequência de entrada da tela (`RiseIn`). */
  firstOrder: number;
  /**
   * A abertura está à vista. Coberta por uma pergunta, a frase para na parte
   * em que está e volta a rodar quando a abertura volta.
   */
  active?: boolean;
}

/** O que cada parte está fazendo: esperando a vez (apagada, embaixo), à vista, ou saindo para cima. */
export type TaglinePartState = 'waiting' | 'shown' | 'leaving';

// Onde está cada parte: abaixo e apagada, no lugar, ou acima e apagada.
const BELOW = 1;
const SHOWN = 0;
const ABOVE = -1;

// As partes, na ordem em que aparecem: "Siga", "Comente" e "Ganhe pontos".
const PARTS = 3;

// Quanto cada parte fica parada antes de dar a vez à seguinte.
const HOLD = 1200;

// A primeira parte sobe e assenta, como os outros blocos da 1k. Nas trocas, a
// que sai e a que entra andam juntas, no mesmo compasso, como um rolo. As duas
// animam também com reduzir movimento, a segunda exceção do app (decisão do
// dono de 17/11/2026, depois de ver a frase parada no APK de um aparelho com a
// animação de transição desligada; a outra é a volta do deslize entre as
// abas). O resto da 1k segue o ajuste.
const FIRST = {
  duration: motion.duration.slow,
  easing: motion.easing.out,
  reduceMotion: ReduceMotion.Never,
};
const ROLL = {
  duration: motion.duration.slow,
  easing: motion.easing.inOut,
  reduceMotion: ReduceMotion.Never,
};

// De uma troca à seguinte: a troca e o tempo parada.
const TURN = ROLL.duration + HOLD;

// "Ganhe pontos", a parte mais larga, na fonte padrão (Sora ExtraBold 27, com
// o aperto entre letras): a frase cresce com a fonte só até ela caber numa
// linha, como o nome da 1k, com a mesma folga para a diferença de desenho da
// fonte entre os sistemas.
const WIDEST_PART_WIDTH = 188;
const FIT_MARGIN = 0.94;

interface PartProps {
  state: TaglinePartState;
  /**
   * Só na primeira parte: a primeira subida dela começa no fade da pilha, na
   * mesma chamada que os outros blocos da 1k, e não depois de um render.
   */
  entrance?: StackEntrance;
  /** Espera da primeira subida: a vez da primeira parte na sequência da 1k. */
  delay?: number;
  travel: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Uma parte da frase: apagada fora do lugar, e tanto mais quanto mais longe
 * dele. Na vez dela, sobe de baixo; na vez da seguinte, sobe sumindo; esperando
 * a vez, fica embaixo, apagada. A ida para a espera não anima: a parte já
 * chegou lá em cima, apagada, e a troca não se vê.
 */
export function TaglinePart({
  state,
  entrance,
  delay = 0,
  travel,
  onLayout,
  style,
  children,
}: PartProps) {
  const position = useSharedValue(state === 'shown' ? SHOWN : BELOW);
  const previous = useRef(state);
  // A subida que o fade da pilha já começou: a vinda à vista que chega em
  // seguida (o estado da frase) não sobe de novo.
  const rising = useRef(false);
  // A primeira subida acontece uma vez só, também se o efeito rodar de novo.
  const risen = useRef(false);

  // A primeira subida, no fade da pilha (a que já entrou chama na hora).
  useEffect(() => {
    if (!entrance) return undefined;
    return entrance.onEnter(() => {
      if (risen.current) return;
      risen.current = true;
      rising.current = true;
      position.set(withDelay(delay, withTiming(SHOWN, FIRST), ReduceMotion.Never));
    });
  }, [entrance, delay, position]);

  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    if (state === 'shown') {
      if (rising.current) {
        rising.current = false;
        return;
      }
      // Sempre de baixo, de onde quer que a parte esteja.
      position.set(BELOW);
      position.set(withTiming(SHOWN, ROLL));
    } else if (state === 'leaving') {
      position.set(withTiming(ABOVE, ROLL));
    } else {
      position.set(BELOW);
    }
  }, [state, position]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.abs(position.get()),
    transform: [{ translateY: position.get() * travel }],
  }));
  return (
    <Animated.View onLayout={onLayout} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

/** A parte à vista e a que acabou de sair (ainda subindo). Antes da entrada, nenhuma. */
interface Turn {
  shown: number | null;
  left: number | null;
}

const BEFORE_ENTRANCE: Turn = { shown: null, left: null };

/**
 * A frase da abertura (1k), uma parte por vez, no mesmo lugar e em laço:
 * "Siga", "Comente" e "Ganhe pontos", sem ponto final, com o "pontos" em lima, a
 * cor de pontos. A partir do fade da pilha, "Siga" sobe na vez dela; a cada
 * troca, a parte à vista sobe sumindo enquanto a seguinte sobe de baixo, e
 * depois de "Ganhe pontos" volta "Siga".
 *
 * Sem pausa e animando também com reduzir movimento, por decisão do dono
 * (17/11/2026): primeiro saiu o botão ao lado, depois o toque na própria
 * frase e, por fim, a frase parada para quem pede menos movimento no
 * aparelho, ciente de que a WCAG 2.2.2 pede um jeito de pausar a animação que
 * começa sozinha e passa de 5 s, e de que assim nada a para. O laço só para
 * quando a abertura fica coberta (`active`).
 *
 * Para o leitor de tela, a frase é um foco só, com ela inteira ("Siga.
 * Comente. Ganhe pontos."): ele ouve tudo de uma vez, e as partes, que trocam
 * na tela, ficam fora dele.
 *
 * A frase fica numa linha: cresce com a fonte só até "Ganhe pontos", a parte
 * mais larga, caber na largura da tela. "Ganhe pontos" dá a altura do bloco,
 * e as outras duas ficam no meio dela. Cada parte anda a altura do bloco,
 * medida na tela (no Android 14 em diante a fonte cresce por uma curva, e não
 * na proporção da escala): no meio da troca, a que sai e a que entra ficam uma
 * em cima da outra, sem se sobrepor.
 */
export function Tagline({ entrance, firstOrder, active = true }: TaglineProps) {
  const { fontScale } = useWindowDimensions();
  // A largura da fileira, medida: dela sai até onde a frase cresce.
  const [room, setRoom] = useState<number | null>(null);
  const maxScale =
    room === null
      ? MAX_FONT_SCALE
      : Math.min(MAX_FONT_SCALE, Math.max(1, (room * FIT_MARGIN) / WIDEST_PART_WIDTH));
  // A altura do bloco, medida em "Ganhe pontos"; antes da medida, a da linha do tema.
  const [measured, setMeasured] = useState<number | null>(null);
  const block = measured ?? typography.titleOnboarding.lineHeight * Math.min(fontScale, maxScale);
  const [turn, setTurn] = useState<Turn>(BEFORE_ENTRANCE);
  // O laço já rodou alguma vez: quem volta (a abertura de novo à vista) espera
  // só o tempo parada.
  const started = useRef(false);

  // A primeira parte entra com o fade da pilha (a subida dela é da própria parte).
  useEffect(
    () =>
      entrance.onEnter(() => {
        setTurn((current) => (current.shown === null ? { shown: 0, left: null } : current));
      }),
    [entrance],
  );

  // O laço: a cada troca, a parte à vista sai e a seguinte entra.
  const running = turn.shown !== null && active;
  useEffect(() => {
    if (!running) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const next = (wait: number): void => {
      timer = setTimeout(() => {
        setTurn((current) => ({
          shown: ((current.shown ?? 0) + 1) % PARTS,
          left: current.shown,
        }));
        next(TURN);
      }, wait);
    };
    // A primeira troca espera "Siga" subir e assentar; quem volta de uma
    // parada (a abertura coberta) espera só o tempo parada.
    next(started.current ? HOLD : firstOrder * motion.stagger.step + FIRST.duration + HOLD);
    return () => {
      clearTimeout(timer);
      started.current = true;
    };
  }, [running, firstOrder]);

  const stateOf = (index: number): TaglinePartState =>
    index === turn.shown ? 'shown' : index === turn.left ? 'leaving' : 'waiting';

  const parts = (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <TaglinePart
        state={stateOf(2)}
        travel={block}
        onLayout={(event) => setMeasured(event.nativeEvent.layout.height)}
      >
        <Text variant="titleOnboarding" maxFontSizeMultiplier={maxScale} style={styles.part}>
          {t('auth.welcome.tagline.earn')}{' '}
          <Text variant="titleOnboarding" color={colors.points} maxFontSizeMultiplier={maxScale}>
            {t('auth.welcome.tagline.points')}
          </Text>
        </Text>
      </TaglinePart>
      <TaglinePart
        state={stateOf(0)}
        entrance={entrance}
        delay={firstOrder * motion.stagger.step}
        travel={block}
        style={[StyleSheet.absoluteFill, styles.over]}
      >
        <Text variant="titleOnboarding" maxFontSizeMultiplier={maxScale} style={styles.part}>
          {t('auth.welcome.tagline.follow')}
        </Text>
      </TaglinePart>
      <TaglinePart state={stateOf(1)} travel={block} style={[StyleSheet.absoluteFill, styles.over]}>
        <Text variant="titleOnboarding" maxFontSizeMultiplier={maxScale} style={styles.part}>
          {t('auth.welcome.tagline.comment')}
        </Text>
      </TaglinePart>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel={t('auth.welcome.tagline.label')}
      // A largura da fileira: dela sai até onde a frase cresce.
      onLayout={(event) => setRoom(event.nativeEvent.layout.width)}
    >
      {parts}
    </View>
  );
}

const styles = StyleSheet.create({
  // Cada linha no centro.
  part: {
    textAlign: 'center',
  },
  // "Siga" e "Comente" por cima de "Ganhe pontos", no meio da altura dela.
  over: {
    justifyContent: 'center',
  },
});
