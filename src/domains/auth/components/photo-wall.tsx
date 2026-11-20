import { Image, type ImageRef } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { StaticPhotoFallback } from '@/components/remote-image';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { motion, radii, spacing } from '@/theme';

/** Um cartão da parede de fotos da abertura. */
export interface PhotoWallCard {
  /**
   * Identifica o cartão (uma por cartão) e escolhe o degradê da marca de quem
   * não tem imagem, como o id do dono da foto no `StaticPhotoFallback`.
   */
  seed: string;
  /** A capa, embutida no app (um `require`). Sem ela, o cartão sai no degradê da marca. */
  image?: number;
}

/**
 * Os cartões da parede, na ordem em que enchem as colunas: da esquerda para a
 * direita e, em cada uma, de cima para baixo. É a única coisa a mexer para
 * trocar a parede: outra `image` troca a capa, e o cartão sem `image` sai no
 * degradê da marca que a semente dele escolhe.
 *
 * As capas geradas para a abertura mostram músicos, dança e público em shows.
 * Novas capas seguem o formato 3:4, a partir de 540 x 720. Fotos de pessoas
 * reais precisam de autorização de uso de imagem para integrar o app.
 */
const WALL_CARDS: readonly PhotoWallCard[] = [
  { seed: 'parede-1', image: require('@/assets/images/entrada/parede-1.jpg') },
  { seed: 'parede-2', image: require('@/assets/images/entrada/parede-2.jpg') },
  { seed: 'parede-3', image: require('@/assets/images/entrada/parede-3.jpg') },
  { seed: 'parede-4', image: require('@/assets/images/entrada/parede-4.jpg') },
  { seed: 'parede-5', image: require('@/assets/images/entrada/parede-5.jpg') },
  { seed: 'parede-6', image: require('@/assets/images/entrada/parede-6.jpg') },
  { seed: 'parede-7', image: require('@/assets/images/entrada/parede-7.jpg') },
  { seed: 'parede-8', image: require('@/assets/images/entrada/parede-8.jpg') },
  { seed: 'parede-9', image: require('@/assets/images/entrada/parede-9.jpg') },
];

// Medidas da parede no desenho da abertura (frame de 390 de largura): onde ela
// fica, a largura e quanto cada coluna desce, da esquerda para a direita
// (desencontradas, os cartões não formam fileiras). Todas acompanham a largura
// da tela: num aparelho mais largo, a parede cresce junto.
const FRAME_WIDTH = 390;
const WALL_WIDTH = 582;
const WALL_LEFT = -96;
const WALL_TOP = -168;
const COLUMN_DROPS = [54, 0, 104] as const;
const COLUMN_COUNT = COLUMN_DROPS.length;
// Largura sobre altura do cartão: em pé, perto do 3:4 das capas.
const CARD_ASPECT = 182 / 246;
// Vão entre as colunas e entre os cartões de uma coluna, o mesmo em toda tela.
const GAP = spacing.md;
// A parede gira inteira, em torno do centro dela: as colunas sobem para a direita.
const TILT = '-12deg';

// As capas já decodificadas na abertura do app (`preloadPhotoWall`), pela semente do cartão.
const preloaded = new Map<string, ImageRef>();
let preloadStarted = false;
// Cada pré-carga é uma rodada: a capa que chega depois de a rodada ser solta
// (`releasePhotoWall`) não volta para a memória.
let round = 0;

/**
 * Carrega as capas da parede na memória na abertura do app (chamado no
 * `_layout` raiz, logo depois do `preloadLogo` e, como ele, só depois das
 * fontes), para elas já estarem lá quando a abertura aparece: a parede que
 * monta depois desenha cada capa pronta e assenta junto com o fade da pilha
 * `(auth)`, em vez de buscar e decodificar os arquivos com o assentar já
 * andando. Não segura a splash: a capa que não chegar a tempo entra em fade, e
 * a que falhar aqui é buscada pelo próprio cartão. O `_layout` não a chama
 * para quem abre o app já logado, e solta as capas quando o fã entra.
 */
export function preloadPhotoWall(): void {
  if (preloadStarted) return;
  preloadStarted = true;
  const current = round;
  for (const { seed, image } of WALL_CARDS) {
    if (image === undefined) continue;
    Image.loadAsync(image).then(
      (ref) => {
        if (round === current) preloaded.set(seed, ref);
      },
      () => undefined,
    );
  }
}

/**
 * Solta as capas pré-carregadas quando o fã entra na conta: a abertura não
 * aparece mais, e as nove capas decodificadas não ficam presas na memória a
 * sessão inteira. Os cartões ainda montados (a pilha `(auth)` saindo em fade)
 * seguem com a imagem que já têm; depois do Sair, a abertura carrega de novo.
 */
export function releasePhotoWall(): void {
  round += 1;
  preloadStarted = false;
  preloaded.clear();
}

interface WallPhotoProps {
  seed: string;
  image: number;
  height: number;
}

/**
 * Cartão com capa. Já carregada (`preloadPhotoWall`), sai inteira no primeiro
 * quadro. Se ainda não, o cartão fica apagado e entra em fade quando ela chega
 * (`onLoad`), por valor animado, como o `Logo`: a `transition` do expo-image
 * não aparecia no Android. Com reduzir movimento, aparece sem o fade.
 */
function WallPhoto({ seed, image, height }: WallPhotoProps) {
  const reducedMotion = usePrefersReducedMotion();
  // A fonte da montagem: trocar no meio recarregaria a imagem.
  const [ready] = useState(() => preloaded.get(seed) ?? null);
  const shown = useSharedValue(ready || reducedMotion ? 1 : 0);

  const onLoad = (): void => {
    shown.set(
      reducedMotion
        ? 1
        : withTiming(1, { duration: motion.duration.base, easing: motion.easing.out }),
    );
  };

  const fadeStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));

  return (
    <Animated.View style={[styles.card, { height }, fadeStyle]}>
      <Image
        source={ready ?? image}
        contentFit="cover"
        onLoad={onLoad}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

interface WallCardProps {
  card: PhotoWallCard;
  width: number;
  height: number;
}

function WallCard({ card, width, height }: WallCardProps) {
  if (card.image !== undefined) {
    return <WallPhoto seed={card.seed} image={card.image} height={height} />;
  }
  return (
    <View style={[styles.card, { height }]}>
      {/* Em SVG, que sai no primeiro quadro (o Skia chega atrasado no Android),
          e sem as listras do placeholder: as da 1k vão por cima da parede
          inteira, e dois jogos em ângulos diferentes fariam faixas. */}
      <StaticPhotoFallback seed={card.seed} stripes={null} width={width} height={height} />
    </View>
  );
}

export interface PhotoWallProps {
  /** A medida da tela: a parede é desenhada em proporção à largura e recortada nela. */
  width: number;
  height: number;
  /** Os cartões, na ordem das colunas. Por padrão, a lista do topo deste arquivo. */
  cards?: readonly PhotoWallCard[];
}

/**
 * A parede de fotos do fundo da abertura (1k): três colunas de cartões em pé,
 * desencontradas e inclinadas, que passam das bordas da tela e somem no véu
 * escuro antes do meio dela. Decorativa: fora do leitor de tela e do toque.
 *
 * Cada cartão sai da lista do topo do arquivo, com a capa ou, sem ela, com o
 * degradê da marca. Nada aqui é Skia, que no Android desenha atrasado e
 * apareceria seco depois do fade da pilha: as capas são imagens comuns e o
 * degradê é SVG.
 */
export function PhotoWall({ width, height, cards = WALL_CARDS }: PhotoWallProps) {
  const scale = width / FRAME_WIDTH;
  const wallWidth = WALL_WIDTH * scale;
  const columnWidth = (wallWidth - (COLUMN_COUNT - 1) * GAP) / COLUMN_COUNT;
  const cardHeight = columnWidth / CARD_ASPECT;
  const perColumn = Math.ceil(cards.length / COLUMN_COUNT);

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      // Depois de as capas chegarem, a parede é um desenho parado por baixo de
      // tudo o que se mexe nas telas de conta (o assentar, o fade da pilha, a
      // troca de pergunta). No Android, o canto redondo de um cartão inclinado
      // sai caro de redesenhar, e são nove: guardada numa textura, a parede é
      // desenhada uma vez, e só a textura acompanha o movimento.
      renderToHardwareTextureAndroid
      style={[styles.root, { width, height }]}
    >
      <View
        style={[styles.wall, { left: WALL_LEFT * scale, top: WALL_TOP * scale, width: wallWidth }]}
      >
        {COLUMN_DROPS.map((drop, column) => (
          <View key={column} style={[styles.column, { marginTop: drop * scale }]}>
            {cards.slice(column * perColumn, (column + 1) * perColumn).map((card) => (
              <WallCard key={card.seed} card={card} width={columnWidth} height={cardHeight} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A parede passa da tela dos lados e em cima: o que sobra fica recortado.
  root: {
    overflow: 'hidden',
  },
  wall: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GAP,
    transform: [{ rotate: TILT }],
  },
  column: {
    flex: 1,
    gap: GAP,
  },
  card: {
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
});
