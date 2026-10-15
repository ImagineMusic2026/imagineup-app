import { useEventListener } from 'expo';
import { useIsFocused } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Play } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { mediaUrl } from '@/config/server';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, motion, radii, spacing } from '@/theme';

import type { Post } from '../types';

// O botão de tocar no meio da capa: o alvo inteiro é o círculo, acima dos 44.
const PLAY_BUTTON_SIZE = 64;
const PLAY_ICON_SIZE = 26;

const COVER_FADE = { duration: motion.duration.base, easing: motion.easing.out } as const;

/**
 * Parado (a capa e o botão de tocar), tocando (o player, com a capa por cima
 * até o primeiro quadro) ou com erro (a capa, a frase e "Tentar de novo"). A
 * URL que toca fica guardada no toque: o post buscado de novo no meio (a
 * curtida que volta 404, o erro do vídeo) não troca o vídeo que está tocando.
 */
type VideoState =
  { kind: 'idle' } | { kind: 'playing'; uri: string; firstFrame: boolean } | { kind: 'error' };

/** A capa some em fade com o primeiro quadro (na hora com reduzir movimento) e volta na hora. */
function useCoverStyle(visible: boolean) {
  const reducedMotion = usePrefersReducedMotion();
  return useAnimatedStyle(() => {
    if (visible) return { opacity: 1 };
    return { opacity: reducedMotion ? 0 : withTiming(0, COVER_FADE) };
  });
}

interface PostVideoPlayerProps {
  uri: string;
  /** Fora de foco, ou com mais da metade do vídeo fora da tela, na rolagem dos comentários. */
  paused: boolean;
  onFirstFrame: () => void;
  onError: () => void;
}

/**
 * O player só existe depois do toque: abrir o post não baixa nada do vídeo. Ele
 * nasce tocando, com os controles nativos e a tela cheia do sistema (no iPhone,
 * em retrato, limite da 1.0) e sem imagem dentro da imagem (o app não tem o
 * plugin do `expo-video`). Pausa fora de foco (o perfil de um fã empilhado por
 * cima, o voltar) e com mais da metade fora da tela, e não volta a tocar
 * sozinho: o fã toca de novo pelos controles. Em segundo plano, o próprio
 * `expo-video` pausa (o `staysActiveInBackground` fica falso).
 */
function PostVideoPlayer({ uri, paused, onFirstFrame, onError }: PostVideoPlayerProps) {
  const player = useVideoPlayer({ uri, useCaching: true }, (created) => created.play());

  useEffect(() => {
    if (paused) player.pause();
  }, [paused, player]);

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'error') onError();
  });

  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
      allowsPictureInPicture={false}
      onFirstFrameRender={onFirstFrame}
      style={StyleSheet.absoluteFill}
      testID="post-video-player"
    />
  );
}

export interface PostVideoProps {
  post: Pick<Post, 'id' | 'artist'>;
  /** O mp4 (a `url` da mídia). O vídeo sem arquivo fica com a capa e a marca, sem este componente. */
  videoUrl: string;
  /** A capa parada: a grande (`posterUrl`) ou, sem ela, a miniatura. */
  coverUrl: string | null;
  offscreen: boolean;
  /** O vídeo não tocou: quem chama busca o post de novo (o mp4 trocado no painel some na hora). */
  onError?: () => void;
}

/**
 * O vídeo do post no detalhe (seção 33 de docs/arquitetura-api.md, decisões 17
 * a 25), em camadas dentro da caixa da mídia: o player embaixo, a capa por
 * cima e o botão ou o erro no meio. Antes do toque, o botão é o único foco: a
 * capa vai sem rótulo, fora do leitor de tela (com rótulo, a `RemoteImage`
 * vira uma imagem focável, e seriam dois focos). A camada da capa não recebe
 * toque, senão cobriria os controles nativos até o primeiro quadro.
 *
 * Fora de foco (o perfil de um fã empilhado por cima), o player pausado segue
 * montado e ainda pode falhar (a rede que cai no buffer, o mp4 trocado no
 * painel): o erro fica na tela, sem o toque de erro, e a frase é anunciada
 * quando o fã volta ao post, e não por cima da tela de cima.
 */
export function PostVideo({ post, videoUrl, coverUrl, offscreen, onError }: PostVideoProps) {
  const [state, setState] = useState<VideoState>({ kind: 'idle' });
  const focused = useIsFocused();
  const coverStyle = useCoverStyle(state.kind !== 'playing' || !state.firstFrame);
  useAnnounceWhen(focused && state.kind === 'error', t('post.details.videoError'));

  // O "Tentar de novo" também passa por aqui, com a URL que o post buscado trouxe.
  const play = (): void => {
    setState({ kind: 'playing', uri: mediaUrl(videoUrl), firstFrame: false });
  };

  const showFirstFrame = (): void => {
    setState((current) =>
      current.kind === 'playing' && !current.firstFrame
        ? { ...current, firstFrame: true }
        : current,
    );
  };

  const fail = (): void => {
    if (focused) haptics.trigger('error');
    setState({ kind: 'error' });
    onError?.();
  };

  return (
    <>
      {state.kind === 'playing' ? (
        <PostVideoPlayer
          uri={state.uri}
          paused={offscreen || !focused}
          onFirstFrame={showFirstFrame}
          onError={fail}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, coverStyle]}
        testID="post-video-cover-layer"
      >
        <RemoteImage
          uri={coverUrl}
          fallback={{ kind: 'brand', seed: post.id }}
          style={StyleSheet.absoluteFill}
          testID="post-video-cover"
        />
      </Animated.View>
      {state.kind === 'idle' ? (
        <View pointerEvents="box-none" style={styles.center}>
          <PressableScale
            onPress={play}
            accessibilityLabel={t('post.details.playVideo', { artist: post.artist.name })}
            accessibilityHint={t('post.details.playVideoHint')}
            style={styles.playButton}
          >
            <Icon icon={Play} size={PLAY_ICON_SIZE} color={colors.text} filled />
          </PressableScale>
        </View>
      ) : null}
      {state.kind === 'error' ? (
        <View pointerEvents="box-none" style={styles.center}>
          <View style={styles.errorPanel}>
            <EmptyState
              tone="error"
              message={t('post.details.videoError')}
              onAction={play}
              style={styles.errorContent}
            />
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.gutter,
  },
  playButton: {
    width: PLAY_BUTTON_SIZE,
    height: PLAY_BUTTON_SIZE,
    borderRadius: PLAY_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    // O triângulo parece deslocado para a esquerda no meio exato do círculo.
    paddingLeft: spacing.xs,
    backgroundColor: colors.glassDarkStrong,
  },
  // Texto sobre foto: o vidro escuro forte (.9), pelo contraste.
  errorPanel: {
    maxWidth: '100%',
    borderRadius: radii.md,
    backgroundColor: colors.glassDarkStrong,
  },
  errorContent: {
    padding: spacing.lg,
  },
});
