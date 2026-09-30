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
  /** Caminhos de todos os arquivos com o prefixo (todas as páginas). */
  list(prefix: string): Promise<string[]>;
  /** Apaga um arquivo; se ele já não existe, tudo bem. */
  remove(path: string): Promise<void>;
};

/**
 * ArtistFiles sobre um bucket de verdade (ou o do emulador). O bucket só é
 * resolvido quando uma função mexe em arquivo: as que não mexem (conferir o
 * @, criar, publicar, ordenar) não dependem da configuração do Storage. O
 * getFiles pagina sozinho (autoPaginate), então a lista vem inteira.
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
    async list(prefix) {
      const [found] = await getBucket().getFiles({ prefix });
      return found.map((item) => item.name);
    },
    async remove(path) {
      await file(path).delete({ ignoreNotFound: true });
    },
  };
}

/** Arquivo que ficou no bucket depois de removeFiles, com o motivo. */
export type LeftoverFile = { path: string; error: string };

/**
 * Apaga todos os caminhos ao mesmo tempo, cada um por conta própria: a falha
 * de um (um 5xx passageiro) não impede os outros, e o que já não existe conta
 * como apagado. É o que a troca de foto e o apagar da central usam, no lugar
 * do deleteFiles do SDK, que para no primeiro erro e larga o resto da pasta.
 * Nunca lança: devolve os que ficaram, para o log.
 */
export async function removeFiles(
  files: Pick<ArtistFiles, 'remove'>,
  paths: readonly string[],
): Promise<LeftoverFile[]> {
  const results = await Promise.allSettled(paths.map((path) => files.remove(path)));
  return results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          {
            path: paths[index] as string,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          },
        ]
      : [],
  );
}
