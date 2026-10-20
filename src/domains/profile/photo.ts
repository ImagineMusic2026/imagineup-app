import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// Escolher, recortar e reduzir a foto do perfil (bloco 9), sem React: a
// galeria ou a câmera com o recorte quadrado do sistema, o recorte quadrado
// pelo centro (no iOS o do sistema já é quadrado; o `aspect` só vale no
// Android) e a redução para 512 × 512 em JPEG. Codificar de novo tira os
// metadados da foto, a localização inclusive. docs/arquitetura-api.md, 24.12.
// E a foto da publicação do fã-clube (seção 34, decisão 15): a galeria sem o
// recorte do sistema, o recorte 4:5 pelo centro e as duas saídas (a foto e a
// miniatura), no fim do arquivo.

/** Lado da foto enviada (o servidor aceita até 1024). */
export const PHOTO_SIDE = 512;

/** Teto do arquivo enviado (o mesmo do `storage.rules` e da função). */
export const PHOTO_MAX_BYTES = 1024 * 1024;

/** Qualidade do JPEG e a da segunda tentativa, quando a primeira passa do teto. */
export const PHOTO_QUALITY = 0.8;
export const PHOTO_RETRY_QUALITY = 0.6;

export type PhotoSource = 'library' | 'camera';

/**
 * O recorte do seletor do sistema: o quadrado da foto do perfil, ou nenhum
 * (a foto do fã-clube, que o app recorta em 4:5: o recorte do sistema é
 * sempre quadrado no iOS).
 */
export type PickCrop = 'square' | 'none';

/** O que a tela usa da foto escolhida. */
export type PickedPhoto = { uri: string; width: number; height: number };

/** A foto pronta para enviar: o arquivo local e o tamanho em bytes. */
export type PreparedPhoto = { uri: string; size: number };

export type PhotoPickErrorReason = 'cameraDenied' | 'noCamera' | 'tooBig';

/** Recusa antes do envio: câmera sem permissão, aparelho sem câmera ou foto grande demais. */
export class PhotoPickError extends Error {
  readonly reason: PhotoPickErrorReason;

  constructor(reason: PhotoPickErrorReason) {
    super(reason);
    this.name = 'PhotoPickError';
    this.reason = reason;
  }
}

const PICK_OPTIONS: Record<PickCrop, ImagePicker.ImagePickerOptions> = {
  square: {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    exif: false,
  },
  none: { mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false },
};

/**
 * Abre a galeria (o seletor do sistema, sem pedir permissão) ou a câmera
 * (pede a permissão antes), com o recorte quadrado do sistema ou sem ele
 * (`crop: 'none'`). Cancelado devolve `null`; câmera negada ou indisponível
 * (o simulador do iOS) é um `PhotoPickError` com o motivo.
 */
export async function pickPhoto(
  source: PhotoSource,
  crop: PickCrop = 'square',
): Promise<PickedPhoto | null> {
  const options = PICK_OPTIONS[crop];
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PhotoPickError('cameraDenied');
    try {
      result = await ImagePicker.launchCameraAsync(options);
    } catch {
      throw new PhotoPickError('noCamera');
    }
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options);
  }
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? { uri: asset.uri, width: asset.width, height: asset.height } : null;
}

/** O maior quadrado no centro da imagem. */
export function centerSquare(width: number, height: number) {
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: side,
    height: side,
  };
}

/**
 * Tamanho em bytes de um arquivo local: o blob do `XMLHttpRequest`, o mesmo
 * caminho do envio (no React Native, o `fetch` de um `file://` não serve).
 */
export function localFileSize(uri: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.onload = () => {
      const blob = request.response as Blob & { close?: () => void };
      const { size } = blob;
      blob.close?.();
      resolve(size);
    };
    request.onerror = () => reject(new TypeError('Não deu para ler a foto preparada.'));
    request.responseType = 'blob';
    request.open('GET', uri, true);
    request.send(null);
  });
}

/**
 * Recorta o quadrado do centro, reduz para 512 quando o lado passa disso e
 * salva em JPEG de qualidade 0,8 (a API nova da SDK 57; o `manipulateAsync`
 * está obsoleto). Acima de 1 MiB, mais uma vez com 0,6; ainda acima, "Foto
 * grande demais". Sem as medidas do sistema (o Android às vezes dá 0), mede
 * a imagem antes.
 */
export async function preparePhoto(
  photo: PickedPhoto,
  measure: (uri: string) => Promise<number> = localFileSize,
): Promise<PreparedPhoto> {
  let { width, height } = photo;
  if (!width || !height) {
    const probe = await ImageManipulator.manipulate(photo.uri).renderAsync();
    ({ width, height } = probe);
  }
  const context = ImageManipulator.manipulate(photo.uri);
  const square = centerSquare(width, height);
  if (width !== height) context.crop(square);
  if (square.width > PHOTO_SIDE) context.resize({ width: PHOTO_SIDE, height: PHOTO_SIDE });
  const image = await context.renderAsync();

  let saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
  let size = await measure(saved.uri);
  if (size > PHOTO_MAX_BYTES) {
    saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_RETRY_QUALITY });
    size = await measure(saved.uri);
  }
  if (size > PHOTO_MAX_BYTES) throw new PhotoPickError('tooBig');
  return { uri: saved.uri, size };
}

// --- A foto da publicação do fã-clube (seção 34, decisão 15) --------------------------

/** A foto do fã-clube, em 4:5: 1080 × 1350 (o servidor aceita até 1350 de lado). */
export const CLUB_PHOTO_SIZE = { width: 1080, height: 1350 } as const;

/** A miniatura dos cartões, na mesma proporção: 480 × 600 (o servidor aceita até 600). */
export const CLUB_THUMB_SIZE = { width: 480, height: 600 } as const;

/**
 * Os tetos de cada arquivo: a foto até 2 MiB (o `storage.rules` e a função) e
 * a miniatura até 300 KiB (só a função; o `storage.rules` aceita até 2 MiB).
 */
export const CLUB_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const CLUB_THUMB_MAX_BYTES = 300 * 1024;

/** Um arquivo pronto, com as medidas que vão ao servidor. */
export type PreparedImage = PreparedPhoto & { width: number; height: number };

/** As duas saídas da mesma escolha: a foto e a miniatura, enviadas separadas. */
export type PreparedFanClubPhoto = { photo: PreparedImage; thumb: PreparedImage };

/**
 * O maior retângulo em pé de 4:5 no centro da imagem. A altura sai da largura
 * (5/4), para a foto e a miniatura terem a mesma proporção, que o servidor
 * confere com 2% de folga (`sameProportion`).
 */
export function centerPortrait(width: number, height: number) {
  const cropWidth = Math.max(1, Math.min(width, Math.floor((height * 4) / 5)));
  const cropHeight = Math.max(1, Math.min(height, Math.floor((cropWidth * 5) / 4)));
  return {
    originX: Math.floor((width - cropWidth) / 2),
    originY: Math.floor((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

/**
 * Prepara a foto escolhida para a publicação do fã-clube: recorta o 4:5 do
 * centro e salva duas vezes, a foto (reduzida para 1080 × 1350 quando passa
 * disso) e a miniatura (480 × 600), em JPEG 0,8, que tira o EXIF. Acima do
 * teto de cada uma, mais uma vez com 0,6; ainda acima, "Foto grande demais".
 * As medidas são as da imagem carregada, e não as do seletor: a orientação já
 * vem aplicada, e as do sistema podem vir 0 (o Android) ou de lado, o que o
 * quadrado não sente e o 4:5 sente.
 */
export async function prepareFanClubPhoto(
  photo: Pick<PickedPhoto, 'uri'>,
  measure: (uri: string) => Promise<number> = localFileSize,
): Promise<PreparedFanClubPhoto> {
  const source = await ImageManipulator.manipulate(photo.uri).renderAsync();
  const crop = centerPortrait(source.width, source.height);
  const cropped = crop.width !== source.width || crop.height !== source.height;

  const output = async (
    size: { width: number; height: number },
    maxBytes: number,
  ): Promise<PreparedImage> => {
    const context = ImageManipulator.manipulate(source);
    if (cropped) context.crop(crop);
    if (crop.width > size.width) context.resize(size);
    const image = await context.renderAsync();
    let saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_QUALITY });
    let bytes = await measure(saved.uri);
    if (bytes > maxBytes) {
      saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_RETRY_QUALITY });
      bytes = await measure(saved.uri);
    }
    if (bytes > maxBytes) throw new PhotoPickError('tooBig');
    return { uri: saved.uri, size: bytes, width: saved.width, height: saved.height };
  };

  const full = await output(CLUB_PHOTO_SIZE, CLUB_PHOTO_MAX_BYTES);
  const thumb = await output(CLUB_THUMB_SIZE, CLUB_THUMB_MAX_BYTES);
  return { photo: full, thumb };
}
