import { bucketFiles, type ArtistFiles, type Bucket } from '../artists/files';
import type { FolderFile } from './model';

/**
 * O que as rotas da foto, o gatilho, a tarefa e a exclusão usam do Storage
 * (trocável nos testes): o `ArtistFiles` das fotos das centrais, com o começo
 * do arquivo (os bytes do JPEG e o marcador SOF) e a listagem com o carimbo de
 * cada arquivo (a varredura da pasta). docs/arquitetura-api.md, 24.2.
 */
export type FanPhotoFiles = ArtistFiles & {
  /** Os primeiros `bytes` do arquivo (menos, se ele for menor). */
  readStart(path: string, bytes: number): Promise<Uint8Array>;
  /** Os arquivos com o prefixo e o `timeCreated` de cada um (todas as páginas). */
  listWithTimes(prefix: string): Promise<FolderFile[]>;
};

/**
 * `FanPhotoFiles` sobre um bucket de verdade (ou o do emulador), resolvido só
 * quando alguém mexe em arquivo. O `getFiles` já traz os metadados de cada
 * arquivo na listagem: o carimbo não custa um pedido por arquivo.
 */
export function fanPhotoFiles(getBucket: () => Bucket): FanPhotoFiles {
  const base = bucketFiles(getBucket);
  return {
    ...base,
    async downloadUrl(path) {
      const bucket = getBucket();
      const emulator = storageEmulatorOrigin();
      if (!emulator) return base.downloadUrl(path);
      return emulatorDownloadUrl(emulator, bucket.name, path);
    },
    async readStart(path, bytes) {
      const [contents] = await getBucket()
        .file(path)
        .download({ start: 0, end: bytes - 1 });
      // Quem não respeita o intervalo (um emulador antigo) devolve o arquivo inteiro.
      const head = contents.byteLength > bytes ? contents.subarray(0, bytes) : contents;
      return new Uint8Array(head.buffer, head.byteOffset, head.byteLength);
    },
    async listWithTimes(prefix) {
      const [found] = await getBucket().getFiles({ prefix });
      return found.map((item) => {
        const created = Date.parse(String(item.metadata?.timeCreated ?? ''));
        return { path: item.name, timeCreated: Number.isFinite(created) ? created : null };
      });
    },
  };
}

/**
 * O emulador do Storage, quando ele está ligado (o firebase-admin passa o
 * `FIREBASE_STORAGE_EMULATOR_HOST` para o `STORAGE_EMULATOR_HOST` ao criar o
 * Storage). Em produção, nenhum dos dois existe.
 */
function storageEmulatorOrigin(): string | null {
  if (process.env.STORAGE_EMULATOR_HOST)
    return process.env.STORAGE_EMULATOR_HOST.replace(/\/$/, '');
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  return host ? `http://${host}` : null;
}

/**
 * A URL de download com token no emulador. O `getDownloadURL` do
 * firebase-admin manda ao emulador o pedido dos metadados do Firebase sem
 * credencial, e o emulador aplica as regras: a foto do fã só o dono lê, e a
 * função recebia "No READ permission". Lá, o token `owner` faz o papel da
 * conta de serviço de produção, que passa por cima das regras. Como o
 * `getDownloadURL`, só lê o token (o emulador cria um na primeira leitura).
 */
async function emulatorDownloadUrl(origin: string, bucket: string, path: string): Promise<string> {
  const endpoint = `${origin}/v0/b/${bucket}/o/${encodeURIComponent(path)}`;
  const response = await fetch(endpoint, { headers: { Authorization: 'Bearer owner' } });
  if (!response.ok) {
    throw new Error(`O emulador do Storage respondeu ${response.status} aos metadados da foto.`);
  }
  const { downloadTokens } = (await response.json()) as { downloadTokens?: string };
  const token = downloadTokens?.split(',')[0];
  if (!token) throw new Error('A foto não tem token de download (no-download-token).');
  return `${endpoint}?alt=media&token=${token}`;
}

/**
 * O Storage ainda não ligado no projeto: o bucket que não existe (404 na
 * listagem) ou o que nem tem nome na configuração das funções (o
 * `getStorage().bucket()` sem `storageBucket` lança `storage/invalid-argument`
 * antes de qualquer pedido). Quem limpa a pasta do fã trata os dois como pasta
 * vazia, senão a exclusão de conta e a tarefa das cópias repetiriam sem parar.
 */
export function isMissingBucket(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 404 || code === 'storage/invalid-argument';
}

/**
 * Sem o Storage nas dependências da API (os testes que não mexem em foto): só
 * as rotas da foto falham (500), como o segredo do convite.
 */
export const MISSING_FAN_PHOTO_FILES: FanPhotoFiles = (() => {
  const missing = (): never => {
    throw new Error('Falta o Storage (files) nas dependências da API.');
  };
  return {
    describe: async () => missing(),
    downloadUrl: async () => missing(),
    list: async () => missing(),
    remove: async () => missing(),
    readStart: async () => missing(),
    listWithTimes: async () => missing(),
  };
})();
