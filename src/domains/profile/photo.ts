import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// Escolher, recortar e reduzir a foto do perfil (bloco 9), sem React: a
// galeria ou a câmera com o recorte quadrado do sistema, o recorte quadrado
// pelo centro (no iOS o do sistema já é quadrado; o `aspect` só vale no
// Android) e a redução para 512 × 512 em JPEG. Codificar de novo tira os
// metadados da foto, a localização inclusive. docs/arquitetura-api.md, 24.12.

/** Lado da foto enviada (o servidor aceita até 1024). */
export const PHOTO_SIDE = 512;

/** Teto do arquivo enviado (o mesmo do `storage.rules` e da função). */
export const PHOTO_MAX_BYTES = 1024 * 1024;

/** Qualidade do JPEG e a da segunda tentativa, quando a primeira passa do teto. */
export const PHOTO_QUALITY = 0.8;
export const PHOTO_RETRY_QUALITY = 0.6;

export type PhotoSource = 'library' | 'camera';

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

const PICK_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 1,
  exif: false,
};

/**
 * Abre a galeria (o seletor do sistema, sem pedir permissão) ou a câmera
 * (pede a permissão antes). Cancelado devolve `null`; câmera negada ou
 * indisponível (o simulador do iOS) é um `PhotoPickError` com o motivo.
 */
export async function pickPhoto(source: PhotoSource): Promise<PickedPhoto | null> {
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PhotoPickError('cameraDenied');
    try {
      result = await ImagePicker.launchCameraAsync(PICK_OPTIONS);
    } catch {
      throw new PhotoPickError('noCamera');
    }
  } else {
    result = await ImagePicker.launchImageLibraryAsync(PICK_OPTIONS);
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
