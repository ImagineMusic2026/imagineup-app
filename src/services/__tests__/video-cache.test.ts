import { setVideoCacheSizeAsync } from 'expo-video';

/**
 * O teto do cache de vídeo (seção 33 de docs/arquitetura-api.md, decisão 20).
 * O `jest.setup.js` troca o serviço por um falso para as outras suítes; aqui
 * vale o de verdade, sobre o `setVideoCacheSizeAsync` do expo-video falso.
 */

const { configureVideoCache, VIDEO_CACHE_BYTES } =
  jest.requireActual<typeof import('../video-cache')>('../video-cache');
const setCacheSize = jest.mocked(setVideoCacheSizeAsync);

beforeEach(() => setCacheSize.mockClear());

describe('configureVideoCache', () => {
  it('pede 200 MB ao expo-video, no lugar do 1 GB padrão', async () => {
    await configureVideoCache();
    expect(VIDEO_CACHE_BYTES).toBe(200 * 1024 * 1024);
    expect(setCacheSize).toHaveBeenCalledTimes(1);
    expect(setCacheSize).toHaveBeenCalledWith(VIDEO_CACHE_BYTES);
  });

  it('com um player vivo, a recusa do expo-video não escapa', async () => {
    setCacheSize.mockRejectedValueOnce(new Error('player vivo'));
    await expect(configureVideoCache()).resolves.toBeUndefined();
  });

  it('o erro síncrono do módulo nativo também não escapa', async () => {
    setCacheSize.mockImplementationOnce(() => {
      throw new Error('módulo nativo');
    });
    await expect(configureVideoCache()).resolves.toBeUndefined();
  });
});
