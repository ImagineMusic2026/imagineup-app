import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { Image, type ImageRef } from 'expo-image';
import { StyleSheet, type ViewStyle } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import type { ReactTestInstance } from 'react-test-renderer';

import { StaticPhotoFallback } from '@/components/remote-image';
import { motion, radii, spacing } from '@/theme';

import {
  PhotoWall,
  preloadPhotoWall,
  releasePhotoWall,
  type PhotoWallCard,
} from '../components/photo-wall';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

// A tela do desenho: as medidas da parede são as dele.
const FRAME = { width: 390, height: 844 };

// No frame de 390, a parede tem 582 de largura: três colunas com dois vãos de 12.
const COLUMN_WIDTH = (582 - 2 * 12) / 3;
// O cartão tem a proporção de 182 por 246.
const CARD_HEIGHT = (COLUMN_WIDTH * 246) / 182;

// As capas da lista do componente, na ordem dela.
const COVERS: number[] = [
  require('@/assets/images/entrada/parede-1.jpg'),
  require('@/assets/images/entrada/parede-2.jpg'),
  require('@/assets/images/entrada/parede-3.jpg'),
  require('@/assets/images/entrada/parede-4.jpg'),
  require('@/assets/images/entrada/parede-5.jpg'),
  require('@/assets/images/entrada/parede-6.jpg'),
  require('@/assets/images/entrada/parede-7.jpg'),
  require('@/assets/images/entrada/parede-8.jpg'),
  require('@/assets/images/entrada/parede-9.jpg'),
];

const flat = (node: ReactTestInstance): ViewStyle => StyleSheet.flatten(node.props.style) ?? {};

/** As caixas (em host) da parede que têm o estilo procurado. */
function boxes(match: (style: ViewStyle) => boolean, within: ReactTestInstance = screen.root) {
  return within.findAll((node) => typeof node.type === 'string' && match(flat(node)));
}

/** A caixa inclinada, com as três colunas dentro. */
function tilted(): ReactTestInstance {
  const [box, ...others] = boxes((style) => Array.isArray(style.transform));
  if (!box || others.length > 0) throw new Error('a parede devia ter uma caixa inclinada só');
  return box;
}

/** As colunas, da esquerda para a direita. */
const columns = () => boxes((style) => style.flex === 1 && style.marginTop !== undefined);

/** Os cartões, na ordem em que foram desenhados (coluna por coluna, de cima para baixo). */
const cards = (within?: ReactTestInstance) =>
  boxes((style) => style.borderRadius === radii.xl, within);

const photos = () => screen.UNSAFE_getAllByType(Image);

/** As sementes dos cartões sem imagem de cada coluna. */
const seedsByColumn = () =>
  columns().map((column) =>
    column.findAllByType(StaticPhotoFallback).map((fallback) => fallback.props.seed as string),
  );

const withoutImage = (...seeds: string[]): PhotoWallCard[] => seeds.map((seed) => ({ seed }));

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  mockReducedMotion = false;
  jest.restoreAllMocks();
});

describe('parede de fotos da abertura', () => {
  it('são três colunas de três cartões, com as nove capas da lista', () => {
    render(<PhotoWall {...FRAME} />);
    expect(columns()).toHaveLength(3);
    expect(columns().map((column) => column.findAllByType(Image).length)).toEqual([3, 3, 3]);
    expect(photos().map((photo) => photo.props.source as unknown)).toEqual(COVERS);
    // Nenhum cartão da lista de hoje fica no degradê.
    expect(screen.UNSAFE_queryAllByType(StaticPhotoFallback)).toHaveLength(0);
  });

  it('os cartões enchem as colunas na ordem da lista: da esquerda para a direita, de cima para baixo', () => {
    render(
      <PhotoWall {...FRAME} cards={withoutImage('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i')} />,
    );
    expect(seedsByColumn()).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
      ['g', 'h', 'i'],
    ]);
  });

  it('com mais fotos na lista, as colunas continuam três e ganham mais um cartão cada', () => {
    const seeds = Array.from({ length: 12 }, (_, index) => `foto-${index + 1}`);
    render(<PhotoWall {...FRAME} cards={withoutImage(...seeds)} />);
    expect(seedsByColumn()).toEqual([seeds.slice(0, 4), seeds.slice(4, 8), seeds.slice(8, 12)]);
  });

  it('no frame do desenho, a parede passa das bordas da tela e gira 12 graus para a esquerda', () => {
    render(<PhotoWall {...FRAME} />);
    expect(tilted()).toHaveStyle({
      position: 'absolute',
      left: -96,
      top: -168,
      width: 582,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      transform: [{ rotate: '-12deg' }],
    });
    // O que passa da tela fica recortado nela.
    expect(screen.root).toHaveStyle({ ...FRAME, overflow: 'hidden' });
  });

  it('as colunas descem cada uma um tanto, e os cartões não formam fileiras', () => {
    render(<PhotoWall {...FRAME} />);
    expect(columns().map((column) => flat(column).marginTop)).toEqual([54, 0, 104]);
    for (const column of columns()) expect(column).toHaveStyle({ flex: 1, gap: spacing.md });
  });

  it('cada cartão é em pé, na proporção de 182 por 246, com o canto redondo', () => {
    render(<PhotoWall {...FRAME} />);
    expect(cards()).toHaveLength(9);
    for (const card of cards()) {
      expect(card).toHaveStyle({ borderRadius: radii.xl, overflow: 'hidden' });
      expect(flat(card).height).toBeCloseTo(CARD_HEIGHT, 5);
      // A largura é a da coluna: o cartão não fixa a dele.
      expect(flat(card).width).toBeUndefined();
    }
    expect(CARD_HEIGHT / COLUMN_WIDTH).toBeCloseTo(246 / 182, 5);
  });

  it('a parede acompanha a largura da tela: no dobro dela, tudo dobra, menos o vão', () => {
    render(<PhotoWall width={780} height={1688} />);
    expect(tilted()).toHaveStyle({ left: -192, top: -336, width: 1164, gap: spacing.md });
    expect(columns().map((column) => flat(column).marginTop)).toEqual([108, 0, 208]);
    const columnWidth = (1164 - 2 * spacing.md) / 3;
    for (const card of cards()) {
      expect(flat(card).height).toBeCloseTo((columnWidth * 246) / 182, 5);
    }
  });

  it('é decorativa: fora do leitor de tela e do toque', () => {
    render(<PhotoWall {...FRAME} />);
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
    expect(screen.root.props).toMatchObject({
      pointerEvents: 'none',
      accessible: false,
      importantForAccessibility: 'no-hide-descendants',
      accessibilityElementsHidden: true,
    });
    expect(screen.queryAllByRole('image')).toHaveLength(0);
  });

  it('no Android, a parede parada é guardada numa textura, para não ser redesenhada a cada quadro', () => {
    render(<PhotoWall {...FRAME} />);
    expect(screen.root).toHaveProp('renderToHardwareTextureAndroid', true);
  });

  describe('cartão com capa', () => {
    it('a capa preenche o cartão, cortada para caber', () => {
      render(<PhotoWall {...FRAME} />);
      for (const photo of photos()) {
        expect(photo.props.contentFit).toBe('cover');
        expect(StyleSheet.flatten(photo.props.style)).toMatchObject(StyleSheet.absoluteFill);
      }
    });

    it('a capa que ainda não estava na memória nasce apagada e entra em fade quando chega, e não seca', () => {
      const timing = jest.spyOn(Reanimated, 'withTiming');
      render(<PhotoWall {...FRAME} />);
      for (const card of cards()) expect(card).toHaveStyle({ opacity: 0 });
      expect(timing).not.toHaveBeenCalled();

      const [first] = photos();
      fireEvent(first!, 'load', { source: { width: 540, height: 720 } });
      expect(timing).toHaveBeenCalledTimes(1);
      expect(timing).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ duration: motion.duration.base, easing: motion.easing.out }),
      );
    });

    it('o fade é por valor animado: a transição do expo-image, que não aparecia no Android, fica de fora', () => {
      render(<PhotoWall {...FRAME} />);
      for (const photo of photos()) expect(photo.props.transition).toBeUndefined();
    });

    it('com reduzir movimento, a capa aparece sem o fade', () => {
      mockReducedMotion = true;
      const timing = jest.spyOn(Reanimated, 'withTiming');
      render(<PhotoWall {...FRAME} />);
      for (const card of cards()) expect(card).toHaveStyle({ opacity: 1 });

      for (const photo of photos()) {
        fireEvent(photo, 'load', { source: { width: 540, height: 720 } });
      }
      expect(timing).not.toHaveBeenCalled();
    });
  });

  describe('cartão sem capa', () => {
    it('sai no degradê da marca que a semente dele escolhe, em SVG, na medida do cartão', () => {
      const cover = COVERS[0]!;
      render(
        <PhotoWall {...FRAME} cards={[{ seed: 'sem-capa' }, { seed: 'capa', image: cover }]} />,
      );
      const [first, second] = cards();

      const fallback = first!.findByType(StaticPhotoFallback);
      expect(fallback.props.seed).toBe('sem-capa');
      expect(fallback.props.width).toBeCloseTo(COLUMN_WIDTH, 5);
      expect(fallback.props.height).toBeCloseTo(CARD_HEIGHT, 5);
      // Sem o par fixo: quem decide a cor é a semente.
      expect(fallback.props.pair).toBeUndefined();
      expect(first!.findAllByType(Image)).toHaveLength(0);
      // O degradê não tem o que esperar: já nasce inteiro.
      expect(flat(first!).opacity).toBeUndefined();

      // O vizinho com capa continua sendo foto.
      expect(second!.findAllByType(StaticPhotoFallback)).toHaveLength(0);
      expect(second!.findByType(Image).props.source).toBe(cover);
    });

    it('vem sem as listras do placeholder: as da 1k vão por cima da parede inteira', () => {
      render(<PhotoWall {...FRAME} cards={withoutImage('sem-capa')} />);
      expect(screen.UNSAFE_getByType(StaticPhotoFallback).props.stripes).toBeNull();
    });

    it('tem o mesmo cartão em volta: em pé, com o canto redondo', () => {
      render(<PhotoWall {...FRAME} cards={withoutImage('sem-capa')} />);
      const [card] = cards();
      expect(card).toHaveStyle({ borderRadius: radii.xl, overflow: 'hidden' });
      expect(flat(card!).height).toBeCloseTo(CARD_HEIGHT, 5);
    });
  });
});

// A memória das capas é do módulo: estes testes vêm por último no arquivo, e
// nesta ordem (os dois primeiros contam com a primeira carga).
describe('preloadPhotoWall', () => {
  // A quinta capa falha na abertura do app (segunda coluna, cartão do meio).
  const FAILED = 5;

  it('carrega as nove capas uma vez; a parede que monta depois já as desenha inteiras, e a que falhou vem do arquivo, em fade', async () => {
    const refs: ImageRef[] = [];
    const load = jest.spyOn(Image, 'loadAsync').mockImplementation(() => {
      const ref = { capa: refs.length + 1 } as unknown as ImageRef;
      refs.push(ref);
      return refs.length === FAILED
        ? Promise.reject(new Error('sem a capa'))
        : Promise.resolve(ref);
    });

    preloadPhotoWall();
    // Chamado de novo (o efeito do `_layout` roda outra vez), não carrega em dobro.
    preloadPhotoWall();
    expect(load.mock.calls.map(([source]) => source as unknown)).toEqual(COVERS);
    await flush();

    const timing = jest.spyOn(Reanimated, 'withTiming');
    render(<PhotoWall {...FRAME} />);
    const sources = photos().map((photo) => photo.props.source as unknown);
    const opacities = cards().map((card) => flat(card).opacity);
    refs.forEach((ref, index) => {
      if (index + 1 === FAILED) {
        // O próprio cartão busca o arquivo, e a capa entra quando chegar.
        expect(sources[index]).toBe(COVERS[index]);
        expect(opacities[index]).toBe(0);
      } else {
        expect(sources[index]).toBe(ref);
        expect(opacities[index]).toBe(1);
      }
    });
    expect(timing).not.toHaveBeenCalled();
  });

  it('depois da abertura, não carrega as capas de novo', () => {
    const load = jest.spyOn(Image, 'loadAsync');
    preloadPhotoWall();
    expect(load).not.toHaveBeenCalled();
  });

  it('o fã entrou: as capas saem da memória, a parede que montar busca os arquivos e a próxima abertura carrega de novo', async () => {
    releasePhotoWall();
    render(<PhotoWall {...FRAME} />);
    expect(photos().map((photo) => photo.props.source as unknown)).toEqual(COVERS);
    expect(cards().map((card) => flat(card).opacity)).toEqual(COVERS.map(() => 0));

    // Depois do Sair, a abertura carrega as nove de novo.
    const load = jest
      .spyOn(Image, 'loadAsync')
      .mockImplementation(() => Promise.resolve({} as ImageRef));
    preloadPhotoWall();
    expect(load).toHaveBeenCalledTimes(COVERS.length);
    await flush();
  });

  it('a capa que chega depois de o fã entrar não volta para a memória', async () => {
    releasePhotoWall();
    const arrivals: ((ref: ImageRef) => void)[] = [];
    jest.spyOn(Image, 'loadAsync').mockImplementation(
      () =>
        new Promise<ImageRef>((resolve) => {
          arrivals.push(resolve);
        }),
    );
    preloadPhotoWall();
    // O fã entra com as capas ainda a caminho, e elas chegam depois.
    releasePhotoWall();
    arrivals.forEach((arrive, index) => arrive({ capa: index + 1 } as unknown as ImageRef));
    await flush();

    render(<PhotoWall {...FRAME} />);
    expect(photos().map((photo) => photo.props.source as unknown)).toEqual(COVERS);
  });
});
