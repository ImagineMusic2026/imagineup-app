import { setVideoCacheSizeAsync } from 'expo-video';

/**
 * Teto do cache de vídeo no aparelho: 200 MB, no lugar do 1 GB padrão do
 * `expo-video` (seção 33 de docs/arquitetura-api.md, decisão 20). O valor
 * fica gravado no aparelho e vale para todo player com `useCaching`.
 */
export const VIDEO_CACHE_BYTES = 200 * 1024 * 1024;

/**
 * Ajusta o teto do cache. Chamar na abertura, antes de qualquer tela com
 * player: com um player vivo (como no Fast Refresh), o `expo-video` recusa, e
 * o cache segue com o teto de antes. O `try` com `await` pega a recusa e
 * também o erro síncrono do módulo nativo, que um `.catch` no retorno deixaria
 * escapar.
 */
export async function configureVideoCache(): Promise<void> {
  try {
    await setVideoCacheSizeAsync(VIDEO_CACHE_BYTES);
  } catch {
    // Sem o teto novo, o player funciona do mesmo jeito.
  }
}
