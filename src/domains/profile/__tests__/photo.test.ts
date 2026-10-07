import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { centerSquare, pickPhoto, PHOTO_MAX_BYTES, PhotoPickError, preparePhoto } from '../photo';

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
