import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  centerPortrait,
  centerSquare,
  CLUB_PHOTO_MAX_BYTES,
  CLUB_THUMB_MAX_BYTES,
  pickPhoto,
  PHOTO_MAX_BYTES,
  PhotoPickError,
  prepareFanClubPhoto,
  preparePhoto,
} from '../photo';

// Os módulos nativos mockados: o que importa é o recorte, a redução, as
// compressões e as recusas (docs/arquitetura-api.md, 24.12).

type Context = {
  crop: jest.Mock;
  resize: jest.Mock;
  renderAsync: jest.Mock;
};

const saveAsync = jest.fn();
const contexts: Context[] = [];

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  ImageManipulator: { manipulate: jest.fn() },
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

/** O contexto do manipulador, com a imagem renderizada nas medidas dadas. */
function mockContext(rendered: { width: number; height: number }): Context {
  const context: Context = {
    crop: jest.fn(() => context),
    resize: jest.fn(() => context),
    renderAsync: jest.fn(async () => ({ ...rendered, saveAsync })),
  };
  contexts.push(context);
  return context;
}

beforeEach(() => {
  jest.clearAllMocks();
  contexts.length = 0;
  jest
    .mocked(ImageManipulator.manipulate)
    .mockImplementation(() => mockContext({ width: 512, height: 512 }) as never);
  saveAsync.mockImplementation(async (options: { compress: number }) => ({
    uri: `file:///pronta-${options.compress}.jpg`,
    width: 512,
    height: 512,
  }));
});

describe('recorte quadrado pelo centro', () => {
  it.each([
    ['retrato', 900, 1600, { originX: 0, originY: 350, width: 900, height: 900 }],
    ['paisagem', 1600, 900, { originX: 350, originY: 0, width: 900, height: 900 }],
    ['quadrado', 800, 800, { originX: 0, originY: 0, width: 800, height: 800 }],
  ])('%s', (_name, width, height, square) => {
    expect(centerSquare(width, height)).toEqual(square);
  });
});

describe('preparePhoto', () => {
  const small = async () => 40_000;

  it('retrato grande: recorta o centro, reduz para 512 e salva em JPEG 0,8', async () => {
    const prepared = await preparePhoto(
      { uri: 'file:///retrato.jpg', width: 900, height: 1600 },
      small,
    );
    expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file:///retrato.jpg');
    const [context] = contexts;
    expect(context!.crop).toHaveBeenCalledWith({
      originX: 0,
      originY: 350,
      width: 900,
      height: 900,
    });
    expect(context!.resize).toHaveBeenCalledWith({ width: 512, height: 512 });
    expect(saveAsync).toHaveBeenCalledWith({ format: SaveFormat.JPEG, compress: 0.8 });
    expect(prepared).toEqual({ uri: 'file:///pronta-0.8.jpg', size: 40_000 });
  });

  it('quadrado não recorta; até 512 não reduz', async () => {
    await preparePhoto({ uri: 'file:///q.jpg', width: 400, height: 400 }, small);
    expect(contexts[0]!.crop).not.toHaveBeenCalled();
    expect(contexts[0]!.resize).not.toHaveBeenCalled();
    await preparePhoto({ uri: 'file:///p.jpg', width: 512, height: 700 }, small);
    expect(contexts[1]!.crop).toHaveBeenCalled();
    expect(contexts[1]!.resize).not.toHaveBeenCalled();
  });

  it('sem as medidas do sistema (0), mede a imagem antes', async () => {
    jest
      .mocked(ImageManipulator.manipulate)
      .mockImplementationOnce(() => mockContext({ width: 1200, height: 800 }) as never);
    await preparePhoto({ uri: 'file:///sem-medida.jpg', width: 0, height: 0 }, small);
    expect(contexts[1]!.crop).toHaveBeenCalledWith({
      originX: 200,
      originY: 0,
      width: 800,
      height: 800,
    });
  });

  it('acima de 1 MiB, salva de novo com 0,6; ainda acima, "Foto grande demais"', async () => {
    const sizes = [PHOTO_MAX_BYTES + 1, 300_000];
    const prepared = await preparePhoto(
      { uri: 'file:///pesada.jpg', width: 512, height: 512 },
      async () => sizes.shift()!,
    );
    expect(saveAsync).toHaveBeenNthCalledWith(2, { format: SaveFormat.JPEG, compress: 0.6 });
    expect(prepared).toEqual({ uri: 'file:///pronta-0.6.jpg', size: 300_000 });

    await expect(
      preparePhoto(
        { uri: 'file:///enorme.jpg', width: 512, height: 512 },
        async () => PHOTO_MAX_BYTES + 1,
      ),
    ).rejects.toMatchObject({ reason: 'tooBig' });
  });
});

describe('pickPhoto', () => {
  const asset = { uri: 'file:///galeria.jpg', width: 1200, height: 900 };

  it('a galeria abre o seletor do sistema com o recorte quadrado, sem pedir permissão', async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue({ canceled: false, assets: [asset] } as never);
    await expect(pickPhoto('library')).resolves.toEqual(asset);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      exif: false,
    });
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  it('cancelado devolve null', async () => {
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue({ canceled: true, assets: null } as never);
    await expect(pickPhoto('library')).resolves.toBeNull();
  });

  it('a câmera pede a permissão antes; negada é cameraDenied, sem abrir', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValue({ granted: false } as never);
    await expect(pickPhoto('camera')).rejects.toBeInstanceOf(PhotoPickError);
    await expect(pickPhoto('camera')).rejects.toMatchObject({ reason: 'cameraDenied' });
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('com a permissão, abre a câmera; aparelho sem câmera é noCamera', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValue({ granted: true } as never);
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockResolvedValueOnce({ canceled: false, assets: [asset] } as never);
    await expect(pickPhoto('camera')).resolves.toEqual(asset);
    jest
      .mocked(ImagePicker.launchCameraAsync)
      .mockRejectedValueOnce(new Error('Camera not available'));
    await expect(pickPhoto('camera')).rejects.toMatchObject({ reason: 'noCamera' });
  });
});

describe('pickPhoto sem o recorte do sistema (a foto do fã-clube, seção 34)', () => {
  it('a galeria abre sem o recorte, e o app recorta em 4:5 depois', async () => {
    const asset = { uri: 'file:///inteira.jpg', width: 3000, height: 4000 };
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValue({ canceled: false, assets: [asset] } as never);
    await expect(pickPhoto('library', 'none')).resolves.toEqual(asset);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
      exif: false,
    });
  });
});

describe('recorte 4:5 em pé pelo centro', () => {
  it.each([
    ['retrato', 3000, 4000, { originX: 0, originY: 125, width: 3000, height: 3750 }],
    ['paisagem', 4000, 3000, { originX: 800, originY: 0, width: 2400, height: 3000 }],
    ['já em 4:5', 1080, 1350, { originX: 0, originY: 0, width: 1080, height: 1350 }],
    ['quadrado pequeno', 500, 500, { originX: 50, originY: 0, width: 400, height: 500 }],
  ])('%s', (_name, width, height, rect) => {
    expect(centerPortrait(width, height)).toEqual(rect);
  });

  it('a altura sai da largura: a proporção fica no 4:5 que o servidor confere', () => {
    for (const [width, height] of [
      [1001, 3333],
      [4032, 3024],
      [719, 1280],
    ] as const) {
      const rect = centerPortrait(width, height);
      expect(Math.abs(rect.width / rect.height - 0.8)).toBeLessThan(0.01);
      expect(rect.width).toBeLessThanOrEqual(width);
      expect(rect.height).toBeLessThanOrEqual(height);
    }
  });
});

describe('prepareFanClubPhoto', () => {
  const small = async () => 40_000;

  /** O `saveAsync` devolve as medidas da imagem renderizada de cada contexto. */
  function mockOutputs(...sizes: { width: number; height: number }[]) {
    const queue = [...sizes];
    jest.mocked(ImageManipulator.manipulate).mockImplementation(() => {
      const rendered = queue.shift() ?? { width: 1, height: 1 };
      const context: Context = {
        crop: jest.fn(() => context),
        resize: jest.fn(() => context),
        renderAsync: jest.fn(async () => ({
          ...rendered,
          saveAsync: jest.fn(async (options: { compress: number }) => {
            saveAsync(options);
            return { uri: `file:///${rendered.width}-${options.compress}.jpg`, ...rendered };
          }),
        })),
      };
      contexts.push(context);
      return context as never;
    });
  }

  it('foto grande: mede pela imagem carregada, recorta o 4:5 e gera 1080 × 1350 e 480 × 600', async () => {
    mockOutputs(
      { width: 3000, height: 4000 },
      { width: 1080, height: 1350 },
      { width: 480, height: 600 },
    );
    // As medidas do seletor vêm de lado (o Android): o recorte usa as da imagem carregada.
    const picked = { uri: 'file:///galeria.jpg', width: 4000, height: 3000 };
    const prepared = await prepareFanClubPhoto(picked, small);
    expect(ImageManipulator.manipulate).toHaveBeenNthCalledWith(1, 'file:///galeria.jpg');
    const [, photo, thumb] = contexts;
    const rect = { originX: 0, originY: 125, width: 3000, height: 3750 };
    expect(photo!.crop).toHaveBeenCalledWith(rect);
    expect(photo!.resize).toHaveBeenCalledWith({ width: 1080, height: 1350 });
    expect(thumb!.crop).toHaveBeenCalledWith(rect);
    expect(thumb!.resize).toHaveBeenCalledWith({ width: 480, height: 600 });
    expect(saveAsync).toHaveBeenCalledWith({ format: SaveFormat.JPEG, compress: 0.8 });
    expect(prepared).toEqual({
      photo: { uri: 'file:///1080-0.8.jpg', size: 40_000, width: 1080, height: 1350 },
      thumb: { uri: 'file:///480-0.8.jpg', size: 40_000, width: 480, height: 600 },
    });
  });

  it('já em 4:5 e pequena: sem recorte; só a miniatura reduz quando passa de 480', async () => {
    mockOutputs(
      { width: 800, height: 1000 },
      { width: 800, height: 1000 },
      { width: 480, height: 600 },
    );
    await prepareFanClubPhoto({ uri: 'file:///media.jpg' }, small);
    const [, photo, thumb] = contexts;
    expect(photo!.crop).not.toHaveBeenCalled();
    expect(photo!.resize).not.toHaveBeenCalled();
    expect(thumb!.crop).not.toHaveBeenCalled();
    expect(thumb!.resize).toHaveBeenCalledWith({ width: 480, height: 600 });
  });

  it('acima do teto de cada uma, salva de novo com 0,6; ainda acima, "Foto grande demais"', async () => {
    mockOutputs(
      { width: 1080, height: 1350 },
      { width: 1080, height: 1350 },
      { width: 480, height: 600 },
    );
    const sizes = [CLUB_PHOTO_MAX_BYTES + 1, 900_000, CLUB_THUMB_MAX_BYTES + 1, 90_000];
    const prepared = await prepareFanClubPhoto({ uri: 'file:///pesada.jpg' }, async () =>
      sizes.shift()!,
    );
    expect(prepared.photo).toMatchObject({ uri: 'file:///1080-0.6.jpg', size: 900_000 });
    expect(prepared.thumb).toMatchObject({ uri: 'file:///480-0.6.jpg', size: 90_000 });

    mockOutputs({ width: 1080, height: 1350 }, { width: 1080, height: 1350 });
    await expect(
      prepareFanClubPhoto({ uri: 'file:///enorme.jpg' }, async () => CLUB_PHOTO_MAX_BYTES + 1),
    ).rejects.toMatchObject({ reason: 'tooBig' });
  });
});
