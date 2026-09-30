import { getDownloadURL, type Storage } from 'firebase-admin/storage';

/** Bucket do Cloud Storage, como o getStorage().bucket() do Admin SDK devolve. */
export type Bucket = ReturnType<Storage['bucket']>;

/** O que a função lê de um arquivo enviado pelo painel. */
export type StoredFile = {
  contentType: string | null;
  /** Metadado customizado do upload (o painel manda width e height). */
  customMetadata: Record<string, string>;
};

/** O que as funções de artistas usam do Storage (trocável nos testes). */
export type ArtistFiles = {
  /** Metadados do arquivo; null se ele não existe. */
  describe(path: string): Promise<StoredFile | null>;
  /** URL de download com token, a mesma que o getDownloadURL do cliente daria. */
  downloadUrl(path: string): Promise<string>;
  /** Apaga todos os arquivos com o prefixo. */
  deleteAll(prefix: string): Promise<void>;
};

/**
 * ArtistFiles sobre um bucket de verdade (ou o do emulador). O bucket só é
 * resolvido quando uma função mexe em arquivo: as que não mexem (conferir o
 * @, criar, publicar, ordenar) não dependem da configuração do Storage.
 */
export function bucketFiles(getBucket: () => Bucket): ArtistFiles {
  const file = (path: string) => getBucket().file(path);
  return {
    async describe(path) {
      try {
        const [metadata] = await file(path).getMetadata();
        const customMetadata: Record<string, string> = {};
        for (const [key, value] of Object.entries(metadata.metadata ?? {})) {
          if (value !== null) customMetadata[key] = String(value);
        }
        return { contentType: metadata.contentType ?? null, customMetadata };
      } catch (error) {
        if ((error as { code?: unknown }).code === 404) return null;
        throw error;
      }
    },
    downloadUrl: (path) => getDownloadURL(file(path)),
    deleteAll: (prefix) => getBucket().deleteFiles({ prefix }),
  };
}
