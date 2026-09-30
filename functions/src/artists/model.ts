import { artistError } from './errors';
import { parseEmail, parseUid } from '../staff/model';
import { isVisibleLine } from '../visible-line';

/**
 * @ da central, que também é o id de artists/{id} e o link no app
 * (/artista/{id}). Nunca muda depois de criado.
 */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

const HANDLE_MAX = 30;

// O Firestore reserva os ids no formato __.*__ (como ____ ou __trio__): um @
// assim cabe no HANDLE_PATTERN, mas nunca vira documento.
const RESERVED_DOC_ID = /^__.*__$/;

/** @ no formato do HANDLE_PATTERN e fora dos ids que o Firestore reserva. */
function isHandleFormat(value: unknown): value is string {
  return typeof value === 'string' && HANDLE_PATTERN.test(value) && !RESERVED_DOC_ID.test(value);
}

/** @ que nunca ficam disponíveis: a marca, a equipe e o atendimento. */
export const RESERVED_HANDLES: readonly string[] = [
  'admin',
  'imagine',
  'imagineup',
  'imaginemusic',
  'equipe',
  'suporte',
  'staff',
  'oficial',
  'ajuda',
  'contato',
];

/** Gêneros da lista do painel. */
export const GENRES = [
  'Arrocha',
  'Piseiro',
  'Forró',
  'Forró pé de serra',
  'Axé',
  'Pagode',
  'Sertanejo',
  'Brega',
  'Funk',
  'Samba',
  'Reggae',
  'Rap',
  'Pop',
  'Gospel',
  'MPB',
  'Outro',
] as const;

export type Genre = (typeof GENRES)[number];

export type ArtistStatus = 'draft' | 'published' | 'unpublished';

/** Foto guardada no Storage, com a URL de download e o caminho (para apagar). */
export type ArtistImage = { url: string; path: string; width: number; height: number };

/** Limites dos textos, em unidades de UTF-16 (como o nome do fã). */
export const NAME_MAX = 60;
export const SHORT_NAME_MAX = 20;
export const CITY_MAX = 60;
export const BIO_MAX = 500;

/** Foto da capa e da página (3:4) e a menor, dos cartões e listas. */
export const PHOTO_SIZE = { width: 1200, height: 1600 } as const;
export const THUMB_SIZE = { width: 480, height: 640 } as const;

/** Tipos de imagem que o storage.rules aceita. */
const IMAGE_CONTENT_TYPE = /^image\/(webp|jpeg|png)$/;
// Nome do arquivo dentro de artists/{id}/, como o painel gera (photo-{ts}-1200.webp).
const FILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const IMAGE_SIDE_MAX = 10_000;
const PHONE_PATTERN = /^\+?\d{10,15}$/;
// Espaços, parênteses e traços que a pessoa digita no celular.
const PHONE_SEPARATORS = /[\s()\-\u2010-\u2015\u2212]/g;

/**
 * Teto de centrais numa reordenação: cabe numa transação (500 gravações). Cada
 * central que muda de lugar grava duas vezes (order em artists/ e quem mexeu em
 * artistPrivate/), mais a auditoria.
 */
export const REORDER_MAX = 240;

/**
 * Sugestão de @ a partir do nome: sem acento, minúsculo, só letras e números,
 * até 30 ("Trio Bem Bahia" vira triobembahia). Pode sair curto ou vazio: o
 * painel mostra e a pessoa ajusta.
 */
export function suggestHandle(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, HANDLE_MAX);
}

/** Por que o @ não pode ser usado, sem olhar o banco: formato ou reservado. */
export function handleProblem(value: unknown): 'invalid' | 'reserved' | null {
  if (!isHandleFormat(value)) return 'invalid';
  return RESERVED_HANDLES.includes(value) ? 'reserved' : null;
}

/** @ de uma central nova: no formato e fora da lista de reservados. */
export function parseHandle(value: unknown): string {
  const problem = handleProblem(value);
  if (problem === 'invalid') throw artistError('invalid-handle');
  if (problem === 'reserved') throw artistError('handle-reserved');
  return value as string;
}

/** Id de uma central existente. Fora do formato do @, ela não existe. */
export function parseArtistId(value: unknown): string {
  if (!isHandleFormat(value)) throw artistError('artist-not-found');
  return value;
}

/** Texto de uma linha: NFC, sem espaço nas pontas, 1 a `max` e visível. */
function visibleText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.normalize('NFC').trim();
  if (text.length < 1 || text.length > max || !isVisibleLine(text)) return undefined;
  return text;
}

/**
 * Opcional vazio: ausente, null e texto só de espaços viram null. No
 * updateArtist, o campo ausente nem chega aqui (não muda).
 */
function isBlank(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/** Nome artístico: obrigatório, 1 a 60, numa linha visível. */
export function parseArtistName(value: unknown): string {
  const name = visibleText(value, NAME_MAX);
  if (name === undefined) throw artistError('invalid-name');
  return name;
}

/** Nome curto dos cartões ("Juninho M."): opcional, até 20. */
export function parseShortName(value: unknown): string | null {
  if (isBlank(value)) return null;
  const name = visibleText(value, SHORT_NAME_MAX);
  if (name === undefined) throw artistError('invalid-short-name');
  return name;
}

/** Cidade base ("Salvador, BA"): opcional, até 60. */
export function parseCity(value: unknown): string | null {
  if (isBlank(value)) return null;
  const city = visibleText(value, CITY_MAX);
  if (city === undefined) throw artistError('invalid-city');
  return city;
}

/** Gênero: opcional, um de GENRES, escrito igual. */
export function parseGenre(value: unknown): Genre | null {
  if (isBlank(value)) return null;
  if (typeof value !== 'string' || !(GENRES as readonly string[]).includes(value)) {
    throw artistError('invalid-genre');
  }
  return value as Genre;
}

/**
 * Bio: opcional, até 500, com quebras de linha. Cada linha perde os espaços
 * das pontas e precisa ser visível (sem controle nem invisíveis); linhas
 * vazias seguidas viram uma só, e as das pontas saem.
 */
export function parseBio(value: unknown): string | null {
  if (isBlank(value)) return null;
  if (typeof value !== 'string') throw artistError('invalid-bio');
  const lines: string[] = [];
  for (const raw of value.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '' && (lines.length === 0 || lines.at(-1) === '')) continue;
    lines.push(line);
  }
  while (lines.at(-1) === '') lines.pop();
  const bio = lines.join('\n');
  if (
    bio.length < 1 ||
    bio.length > BIO_MAX ||
    lines.some((line) => line !== '' && !isVisibleLine(line))
  ) {
    throw artistError('invalid-bio');
  }
  return bio;
}

/** E-mail de contato: opcional, minúsculo, no formato de e-mail. */
export function parseContactEmail(value: unknown): string | null {
  if (isBlank(value)) return null;
  try {
    return parseEmail(value);
  } catch {
    throw artistError('invalid-email');
  }
}

/**
 * Celular de contato: opcional. Saem espaços, parênteses e traços; fica o
 * resto como digitado: + opcional no começo e 10 a 15 dígitos.
 */
export function parseContactPhone(value: unknown): string | null {
  if (isBlank(value)) return null;
  if (typeof value !== 'string') throw artistError('invalid-phone');
  const phone = value.replace(PHONE_SEPARATORS, '');
  if (!PHONE_PATTERN.test(phone)) throw artistError('invalid-phone');
  return phone;
}

/** Gestor responsável: opcional, o uid de alguém da equipe (conferido no banco). */
export function parseManagerUid(value: unknown): string | null {
  if (isBlank(value)) return null;
  try {
    return parseUid(value);
  } catch {
    throw artistError('invalid-manager');
  }
}

/** Marca obrigatória (selo verificado, autorização de imagem). */
export function parseFlag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw artistError('invalid-request');
  return value;
}

/** Caminhos das duas fotos que o painel subiu para artists/{id}/. */
export type PhotoPaths = { photoPath: string; thumbPath: string };

/** true se o caminho é um arquivo direto em artists/{artistId}/. */
export function isArtistFilePath(path: unknown, artistId: string): path is string {
  const prefix = artistPrefix(artistId);
  if (typeof path !== 'string' || !path.startsWith(prefix)) return false;
  const name = path.slice(prefix.length);
  return FILE_NAME_PATTERN.test(name) && name !== '.' && name !== '..';
}

/** Pasta das fotos de uma central no bucket. */
export function artistPrefix(artistId: string): string {
  return `artists/${artistId}/`;
}

/**
 * Arquivos da pasta da central que saem depois de trocar ou tirar a foto: tudo
 * em artists/{artistId}/ que não está em `keep` (as fotos novas e as que a
 * central usa na hora da limpeza). Caminho de outra pasta nunca entra.
 */
export function staleArtistFiles(
  paths: readonly string[],
  artistId: string,
  keep: readonly (string | null | undefined)[],
): string[] {
  const prefix = artistPrefix(artistId);
  const kept = new Set(keep.filter((path): path is string => typeof path === 'string'));
  return [...new Set(paths)].filter((path) => path.startsWith(prefix) && !kept.has(path));
}

/** `photo` do updateArtist: null tira as fotos; senão os dois caminhos desta central. */
export function parsePhotoPaths(value: unknown, artistId: string): PhotoPaths | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw artistError('invalid-photo');
  const { photoPath, thumbPath } = value as Record<string, unknown>;
  if (
    !isArtistFilePath(photoPath, artistId) ||
    !isArtistFilePath(thumbPath, artistId) ||
    photoPath === thumbPath
  ) {
    throw artistError('invalid-photo');
  }
  return { photoPath, thumbPath };
}

/** true para os tipos de imagem que o storage.rules deixa subir. */
export function isImageContentType(contentType: unknown): boolean {
  return typeof contentType === 'string' && IMAGE_CONTENT_TYPE.test(contentType);
}

function imageSide(value: unknown): number | undefined {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,5}$/.test(text)) return undefined;
  const side = Number(text);
  return side >= 1 && side <= IMAGE_SIDE_MAX ? side : undefined;
}

/**
 * Largura e altura do metadado customizado que o painel manda no upload
 * (`width`, `height`). Faltou ou veio estranho: o tamanho padrão da versão.
 */
export function imageSize(
  customMetadata: Record<string, unknown> | undefined,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const width = imageSide(customMetadata?.width);
  const height = imageSide(customMetadata?.height);
  if (width === undefined || height === undefined) return { ...fallback };
  return { width, height };
}

export type PublishProblem = 'missing-photo' | 'missing-image-rights';

/**
 * O que falta para publicar: as duas fotos (de artists/) e a autorização de uso
 * de imagem (de artistPrivate/).
 */
export function publishProblems(artist: {
  photo: unknown;
  thumb: unknown;
  imageRightsConfirmed: unknown;
}): PublishProblem[] {
  const problems: PublishProblem[] = [];
  if (!artist.photo || !artist.thumb) problems.push('missing-photo');
  if (artist.imageRightsConfirmed !== true) problems.push('missing-image-rights');
  return problems;
}

/**
 * Por que a central não pode ser apagada: com fãs (fanCount > 0), sai do ar em
 * vez de sumir. Em qualquer status, sem fãs, pode.
 */
export function deleteProblem(artist: { fanCount: unknown }): 'has-fans' | null {
  return typeof artist.fanCount === 'number' && artist.fanCount > 0 ? 'has-fans' : null;
}

/** Status pedido no setArtistStatus. */
export function parseTargetStatus(value: unknown): 'published' | 'unpublished' {
  if (value !== 'published' && value !== 'unpublished') throw artistError('invalid-request');
  return value;
}

/** Ordem de uma central nova: depois da última. */
export function nextOrder(orders: readonly unknown[]): number {
  const numbers = orders.filter((order): order is number => typeof order === 'number');
  return numbers.length === 0 ? 0 : Math.max(...numbers) + 1;
}

/** Lista do reorderArtists: sem repetir e dentro do teto. */
export function parseArtistIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > REORDER_MAX) {
    throw artistError('invalid-request');
  }
  if (value.some((id) => typeof id !== 'string')) throw artistError('invalid-request');
  if (new Set(value).size !== value.length) throw artistError('invalid-request');
  if (value.some((id) => !isHandleFormat(id))) throw artistError('unknown-artist');
  return value as string[];
}

/**
 * Ordem nova a partir da lista completa: `order` = posição. Devolve só as
 * centrais que mudaram de posição. Id que não existe é unknown-artist; faltar
 * alguma (outra pessoa criou uma central no meio) é incomplete-list.
 */
export function reorderChanges(
  current: readonly { id: string; order: unknown }[],
  requested: readonly string[],
): { id: string; order: number }[] {
  const orders = new Map(current.map((artist) => [artist.id, artist.order]));
  if (requested.some((id) => !orders.has(id))) throw artistError('unknown-artist');
  if (requested.length !== orders.size) throw artistError('incomplete-list');
  return requested
    .map((id, order) => ({ id, order }))
    .filter(({ id, order }) => orders.get(id) !== order);
}
