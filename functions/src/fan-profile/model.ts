import { dayKey } from '../day';
import { isReservedUsername, USERNAME_PATTERN } from '../profile';

// Perfil editável do fã (bloco 9), puro: nada aqui lê ou grava o Firestore ou
// o Storage. O @ escolhido pelo fã (as regras do gerador e o prazo de 30
// dias), o arquivo da foto (caminho, bytes, dimensões e idade), a varredura da
// pasta e a fila que acerta as cópias do nome e da foto nos comentários.
// Contrato em docs/arquitetura-api.md, seção 24.

export { USERNAME_PATTERN };

/** Prazo entre duas trocas do @ pelo fã. O "30 dias" do texto do app espelha este valor. */
export const USERNAME_CHANGE_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

/** O @ automático (`fa` com dígitos): só o gerador cria, e o fã não escolhe. */
export const AUTOMATIC_USERNAME = /^fa[0-9]+$/;

/** Maior `username` aceito no pedido, antes da normalização. */
export const USERNAME_INPUT_MAX = 64;

/** Teto do arquivo da foto (o mesmo do `storage.rules`). */
export const PHOTO_MAX_BYTES = 1024 * 1024;

/** Maior largura e altura aceitas (o app envia 512). */
export const PHOTO_MAX_SIDE = 1024;

/** O começo do arquivo lido para os bytes do JPEG e o marcador SOF. */
export const PHOTO_HEAD_BYTES = 64 * 1024;

/** Idade máxima do arquivo no `PUT /me/photo`. */
export const PHOTO_UPLOAD_MAX_AGE_MS = 10 * 60_000;

/** O padrão do teto do dia `photo_set` (editável no `config/points.actionCaps`). */
export const PHOTO_CHANGES_PER_DAY = 10;

/**
 * Idade a partir da qual um envio que não é a foto sai na varredura. A folga
 * de 5 min sobre o `PHOTO_UPLOAD_MAX_AGE_MS` cobre o pedido que ainda está na
 * transação: nada que a varredura apaga pode virar a foto depois.
 */
export const ABANDONED_UPLOAD_MS = 15 * 60_000;

/** Janela da fila `syncFanProfile`. */
export const FAN_PROFILE_SYNC_WINDOW_MS = 5 * 60_000;

/** Janelas de 5 min por fã e dia de São Paulo antes da janela de 1 h. */
export const FAN_PROFILE_SYNC_DAILY_WINDOWS = 12;

/** Janela da fila depois do orçamento do dia. */
export const FAN_PROFILE_SLOW_WINDOW_MS = 60 * 60_000;

/** A segunda limpeza da pasta depois da exclusão de conta. */
export const FAN_PHOTO_PURGE_DELAY_MS = 60 * 60_000;

/** Comentários por página (e por transação) na tarefa das cópias. */
export const PROFILE_SYNC_PAGE = 200;

/**
 * Arquivos apagados ao mesmo tempo na limpeza da pasta do fã (a varredura e a
 * exclusão de conta), um lote depois do outro: a regra não conta envios, e uma
 * pasta enchida por script abriria milhares de pedidos de uma vez (24.8).
 */
export const FAN_PHOTO_DELETE_BATCH = 100;

/** O nome do comentário de quem está sem nome (o mesmo `COMMENT_FALLBACK_NAME` dos posts). */
export const AUTHOR_FALLBACK_NAME = 'Fã';

/** Uid do Auth como as pastas do Storage e a tarefa aceitam. */
export const FAN_UID_PATTERN = /^[A-Za-z0-9]{1,128}$/;

/** Caminho da foto do fã no Storage: `fans/{uid}/photo-<id>.jpg`. */
export const FAN_PHOTO_PATH = /^fans\/([A-Za-z0-9]{1,128})\/(photo-[a-z0-9-]{8,40}\.jpg)$/;

/** A pasta da foto de um fã (com a barra do fim, para o prefixo não pegar outro uid). */
export const fanPhotoFolder = (uid: string): string => `fans/${uid}/`;

// --- @ ----------------------------------------------------------------------

/**
 * Normaliza só o óbvio: tira os espaços das pontas e um `@` do começo e passa
 * para minúsculas. Acento não vira letra ("camilaribeirõ" continua inválido):
 * o fã nunca recebe um @ diferente do que viu.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

export type UsernameRefusal = 'format' | 'automatic' | 'reserved';

/**
 * Por que o @ (já normalizado) não pode ser escolhido, ou null: fora do
 * formato do cadastro, no padrão do automático ou reservado (os mesmos
 * reservados do gerador, com os números no lugar de letras e o "rn", e os das
 * centrais, exatos). Quem tem dono é a reserva em `usernames/` que diz.
 */
export function usernameRefusal(username: string): UsernameRefusal | null {
  if (!USERNAME_PATTERN.test(username)) return 'format';
  if (AUTOMATIC_USERNAME.test(username)) return 'automatic';
  if (isReservedUsername(username)) return 'reserved';
  return null;
}

/** O @ é o automático do gerador (o app destaca e convida a trocar). */
export const isAutomaticUsername = (username: string): boolean => AUTOMATIC_USERNAME.test(username);

/** A troca do @ está liberada: sem prazo gravado ou a partir da hora exata do prazo. */
export function usernameChangeAllowed(changeableAt: number | null, now: number): boolean {
  return changeableAt === null || now >= changeableAt;
}

/** A partir de quando o fã troca o @ de novo, depois de uma troca agora. */
export const nextUsernameChange = (now: number): number => now + USERNAME_CHANGE_INTERVAL_MS;

// --- Foto ---------------------------------------------------------------------

/** O caminho da foto, separado; null fora do formato (outra pasta, subpasta, `..`, `.jpeg`). */
export function parseFanPhotoPath(path: unknown): { uid: string; fileName: string } | null {
  if (typeof path !== 'string') return null;
  const match = FAN_PHOTO_PATH.exec(path);
  return match ? { uid: match[1]!, fileName: match[2]! } : null;
}

// Marcadores SOF (o quadro do JPEG, com a altura e a largura): de FFC0 a FFCF,
// menos FFC4 (tabela de Huffman), FFC8 (reservado) e FFCC (aritmética).
const isSofMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

// Marcadores sem tamanho: TEM (01) e os de reinício (D0 a D7).
const isStandalone = (marker: number): boolean =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

/**
 * Largura e altura do JPEG, lidas no marcador SOF: anda pelos segmentos a
 * partir do SOI, pelo tamanho de cada um. Null se o começo não é JPEG, se o
 * SOF não está nos bytes dados (os primeiros 64 KiB) ou se um segmento vem
 * cortado. Sem decodificar a imagem (nenhuma dependência nova).
 */
export function jpegDimensions(head: Uint8Array): { width: number; height: number } | null {
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < head.length) {
    if (head[offset] !== 0xff) return null;
    const marker = head[offset + 1]!;
    // Bytes de preenchimento entre segmentos.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (isStandalone(marker)) {
      offset += 2;
      continue;
    }
    // Fim da imagem ou começo dos dados antes de qualquer SOF.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 3 >= head.length) return null;
    const length = (head[offset + 2]! << 8) | head[offset + 3]!;
    if (length < 2) return null;
    if (isSofMarker(marker)) {
      // Tamanho (2), precisão (1), altura (2), largura (2).
      if (offset + 8 >= head.length) return null;
      const height = (head[offset + 5]! << 8) | head[offset + 6]!;
      const width = (head[offset + 7]! << 8) | head[offset + 8]!;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

export type PhotoProblem = 'type' | 'size' | 'content' | 'dimensions';

/** O que a função lê do arquivo enviado (o `describe` do Storage). */
export type PhotoFileInfo = {
  contentType: string | null;
  size?: number;
  /** Quando o Storage gravou o arquivo, em ms. */
  timeCreated?: number;
};

/**
 * O problema do arquivo, ou null. Sem `head`, só os metadados (tipo e
 * tamanho), para não baixar o começo de um arquivo que já é recusado; com o
 * começo, também os bytes `FF D8 FF` e as dimensões do SOF (de 1 a 1024).
 */
export function photoProblem(file: PhotoFileInfo, head?: Uint8Array): PhotoProblem | null {
  if (file.contentType !== 'image/jpeg') return 'type';
  if (typeof file.size !== 'number' || file.size <= 0 || file.size > PHOTO_MAX_BYTES) {
    return 'size';
  }
  if (!head) return null;
  if (head.length < 3 || head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) {
    return 'content';
  }
  const dimensions = jpegDimensions(head);
  if (!dimensions) return 'content';
  const { width, height } = dimensions;
  if (width < 1 || height < 1 || width > PHOTO_MAX_SIDE || height > PHOTO_MAX_SIDE) {
    return 'dimensions';
  }
  return null;
}

/**
 * O arquivo não pode virar a foto: enviado há mais de 10 min, ou antes da
 * última troca de foto do perfil (`photoUpdatedAt`). Sem o carimbo do Storage,
 * também não. Anda junto com o `stalePhotoFiles`: o que esta recusa é o que a
 * varredura pode apagar sem correr com o `PUT` (24.1, decisões 6 e 8).
 */
export function photoTooOld(
  file: Pick<PhotoFileInfo, 'timeCreated'>,
  photoUpdatedAt: number | null,
  now: number,
): boolean {
  const created = file.timeCreated;
  if (typeof created !== 'number' || !Number.isFinite(created)) return true;
  if (now - created > PHOTO_UPLOAD_MAX_AGE_MS) return true;
  return photoUpdatedAt !== null && created < photoUpdatedAt;
}

/** Um arquivo da pasta do fã, com o carimbo do Storage (ms) ou null. */
export type FolderFile = { path: string; timeCreated: number | null };

/**
 * O que a varredura apaga da pasta: tudo que não é a foto de agora e foi
 * enviado antes do `photoUpdatedAt` dele ou há mais de 15 min. O envio que
 * ainda pode chegar ao `PUT` (depois da última troca, com menos de 15 min)
 * fica. Sem carimbo, sai (o `PUT` também o recusaria).
 */
export function stalePhotoFiles(
  files: readonly FolderFile[],
  profile: { photoPath: string | null; photoUpdatedAt: number | null },
  now: number,
): string[] {
  return files
    .filter(({ path, timeCreated }) => {
      if (path === profile.photoPath) return false;
      if (timeCreated === null) return true;
      if (profile.photoUpdatedAt !== null && timeCreated < profile.photoUpdatedAt) return true;
      return now - timeCreated > ABANDONED_UPLOAD_MS;
    })
    .map(({ path }) => path);
}

// --- Cópias nos comentários -------------------------------------------------------

/** O que a cópia do comentário guarda do perfil. */
export type AuthorCopies = { authorName: string; authorPhotoURL: string | null };

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** As cópias do autor a partir do perfil: sem nome, "Fã"; sem foto, null (como o `POST`). */
export function authorCopies(profile: { displayName?: unknown; photoURL?: unknown }): AuthorCopies {
  return {
    authorName: text(profile.displayName) ?? AUTHOR_FALLBACK_NAME,
    authorPhotoURL: text(profile.photoURL),
  };
}

/** O comentário está com a cópia de outro perfil. */
export function copiesDiffer(
  comment: { authorName?: unknown; authorPhotoURL?: unknown },
  copies: AuthorCopies,
): boolean {
  return (
    comment.authorName !== copies.authorName ||
    (text(comment.authorPhotoURL) ?? null) !== copies.authorPhotoURL
  );
}

/**
 * A mudança do perfil põe tarefa na fila: o nome, a foto ou o caminho dela
 * mudaram. A cidade, o @ e o `updatedAt` sozinhos não (nenhuma cópia os
 * guarda); o caminho sozinho põe, porque a varredura da tarefa leva o envio
 * que falhou antes da troca.
 */
export function profileSyncNeeded(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): boolean {
  if (!before || !after) return false;
  return (['displayName', 'photoURL', 'photoPath'] as const).some(
    (field) => (before[field] ?? null) !== (after[field] ?? null),
  );
}

/** `users/{uid}/profileSync/budget`: o dia de São Paulo, as janelas contadas e a última. */
export type ProfileSyncBudget = { day: string; windows: number; lastWindow: number | null };

export type ProfileSyncPlan = {
  /** Janela da tarefa: `fanprofile` (5 min) ou `fanprofileh` (1 h, passado o orçamento). */
  prefix: 'fanprofile' | 'fanprofileh';
  windowMs: number;
  /** O orçamento a gravar, ou null quando ele não muda. */
  write: ProfileSyncBudget | null;
};

/**
 * A janela da tarefa de uma mudança no instante `eventTime` e o orçamento do
 * dia: até 12 janelas de 5 min por dia de São Paulo; depois, janelas de 1 h,
 * sem gravar. A janela já contada (a mesma de antes, ou a entrega repetida do
 * mesmo evento) segue na de 5 min sem contar de novo, também a 12ª. O dia
 * novo zera a conta.
 */
export function profileSyncBudget(
  stored: ProfileSyncBudget | null,
  eventTime: number,
): ProfileSyncPlan {
  const day = dayKey(eventTime);
  const window = Math.floor(eventTime / FAN_PROFILE_SYNC_WINDOW_MS);
  const today: ProfileSyncBudget =
    stored && stored.day === day ? stored : { day, windows: 0, lastWindow: null };
  const fast = { prefix: 'fanprofile' as const, windowMs: FAN_PROFILE_SYNC_WINDOW_MS };
  if (today.lastWindow === window) return { ...fast, write: null };
  if (today.windows < FAN_PROFILE_SYNC_DAILY_WINDOWS) {
    return { ...fast, write: { day, windows: today.windows + 1, lastWindow: window } };
  }
  return { prefix: 'fanprofileh', windowMs: FAN_PROFILE_SLOW_WINDOW_MS, write: null };
}

/** O orçamento guardado, conferido; fora do formato vale como sem orçamento. */
export function parseProfileSyncBudget(
  data: Record<string, unknown> | undefined,
): ProfileSyncBudget | null {
  if (!data) return null;
  const { day, windows, lastWindow } = data;
  if (typeof day !== 'string' || typeof windows !== 'number' || !Number.isFinite(windows)) {
    return null;
  }
  return {
    day,
    windows,
    lastWindow: typeof lastWindow === 'number' && Number.isFinite(lastWindow) ? lastWindow : null,
  };
}

// --- Erros ------------------------------------------------------------------------

export type ProfileEditErrorReason =
  | 'username_invalid'
  | 'photo_invalid'
  | 'photo_not_found'
  | 'username_taken'
  | 'username_change_too_soon';

const PROFILE_EDIT_MESSAGES: Record<ProfileEditErrorReason, string> = {
  username_invalid: 'Este @ não vale.',
  photo_invalid: 'Foto fora do formato.',
  photo_not_found: 'Foto não encontrada.',
  username_taken: 'Este @ já tem dono.',
  username_change_too_soon: 'Troca do @ antes do prazo.',
};

/**
 * Recusa da edição do perfil. A API traduz para o código de mesmo nome, com
 * `details` (`reason` no `username_invalid` e no `photo_invalid`,
 * `changeableAt` no `username_change_too_soon`), como o `PostError`.
 */
export class ProfileEditError extends Error {
  readonly reason: ProfileEditErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: ProfileEditErrorReason, details?: Record<string, unknown>) {
    super(PROFILE_EDIT_MESSAGES[reason]);
    this.name = 'ProfileEditError';
    this.reason = reason;
    this.details = details;
  }
}

export type UsernameReleaseReason = 'not_found' | 'central' | 'mismatch';

const RELEASE_MESSAGES: Record<UsernameReleaseReason, string> = {
  not_found: 'Este @ não tem reserva.',
  central: 'Este @ é de uma central: nada a liberar.',
  mismatch: 'A reserva não é o @ de agora do fã.',
};

/** Recusa do `releaseUsername` (o script que libera o @ de um fã para uma central). */
export class UsernameReleaseError extends Error {
  readonly reason: UsernameReleaseReason;

  constructor(reason: UsernameReleaseReason) {
    super(RELEASE_MESSAGES[reason]);
    this.name = 'UsernameReleaseError';
    this.reason = reason;
  }
}
