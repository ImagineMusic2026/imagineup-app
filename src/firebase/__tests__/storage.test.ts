import { getMetadata, ref, uploadBytes } from 'firebase/storage';

import { storageFileExists, uploadLocalFile } from '../storage';

// A única suíte com o SDK do Storage mockado: o resto do app mocka o
// @/firebase inteiro (docs/arquitetura-api.md, 24.12).
jest.mock('firebase/storage', () => ({
  connectStorageEmulator: jest.fn(),
  getMetadata: jest.fn(),
  getStorage: jest.fn(() => ({ app: 'storage' })),
  ref: jest.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytes: jest.fn(),
}));
jest.mock('../config', () => ({ getFirebaseApp: () => ({}) }));
jest.mock('@/config/env', () => ({ firebaseEmulatorHost: undefined }));

/** O blob do arquivo local, como o React Native devolve (com o `close`). */
const blob = { size: 4_096, close: jest.fn() };

/** `XMLHttpRequest` que devolve o blob do arquivo local, ou falha. */
function fakeXhr(fail = false) {
  return class {
    response: unknown = null;
    responseType = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    opened: string | null = null;
    open(_method: string, uri: string) {
      this.opened = uri;
    }
    send() {
      if (fail) {
        this.onerror?.();
        return;
      }
      this.response = blob;
      this.onload?.();
    }
  };
}

const realXhr = globalThis.XMLHttpRequest;

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.XMLHttpRequest = fakeXhr() as unknown as typeof XMLHttpRequest;
});

afterAll(() => {
  globalThis.XMLHttpRequest = realXhr;
});

describe('uploadLocalFile', () => {
  it('envia o blob do arquivo local com o tipo dado e solta o blob no fim', async () => {
    jest.mocked(uploadBytes).mockResolvedValue({} as never);
    await uploadLocalFile('fans/uid/photo-abcdefgh.jpg', 'file:///foto.jpg', 'image/jpeg');
    expect(ref).toHaveBeenCalledWith({ app: 'storage' }, 'fans/uid/photo-abcdefgh.jpg');
    expect(uploadBytes).toHaveBeenCalledWith({ path: 'fans/uid/photo-abcdefgh.jpg' }, blob, {
      contentType: 'image/jpeg',
    });
    expect(blob.close).toHaveBeenCalledTimes(1);
  });

  it('o envio que falha também solta o blob, e o erro sobe', async () => {
    const failure = Object.assign(new Error('rede'), { code: 'storage/retry-limit-exceeded' });
    jest.mocked(uploadBytes).mockRejectedValue(failure);
    await expect(
      uploadLocalFile('fans/uid/photo-abcdefgh.jpg', 'file:///foto.jpg', 'image/jpeg'),
    ).rejects.toBe(failure);
    expect(blob.close).toHaveBeenCalledTimes(1);
  });

  it('o arquivo local que não abre falha antes do envio', async () => {
    globalThis.XMLHttpRequest = fakeXhr(true) as unknown as typeof XMLHttpRequest;
    await expect(
      uploadLocalFile('fans/uid/photo-abcdefgh.jpg', 'file:///sumiu.jpg', 'image/jpeg'),
    ).rejects.toThrow(TypeError);
    expect(uploadBytes).not.toHaveBeenCalled();
  });
});

describe('storageFileExists', () => {
  it('com os metadados, existe; storage/object-not-found é false', async () => {
    jest.mocked(getMetadata).mockResolvedValueOnce({} as never);
    await expect(storageFileExists('fans/uid/photo-abcdefgh.jpg')).resolves.toBe(true);
    jest
      .mocked(getMetadata)
      .mockRejectedValueOnce(
        Object.assign(new Error('não existe'), { code: 'storage/object-not-found' }),
      );
    await expect(storageFileExists('fans/uid/photo-abcdefgh.jpg')).resolves.toBe(false);
  });

  it('outro erro lança (sessão trocada, regra, rede): nunca vira "já subiu"', async () => {
    const failure = Object.assign(new Error('negado'), { code: 'storage/unauthorized' });
    jest.mocked(getMetadata).mockRejectedValueOnce(failure);
    await expect(storageFileExists('fans/uid/photo-abcdefgh.jpg')).rejects.toBe(failure);
  });
});
