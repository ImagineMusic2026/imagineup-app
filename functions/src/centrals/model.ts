import { Timestamp } from 'firebase-admin/firestore';

import { isHandleFormat } from '../artists/model';
import type { Artist, ArtistDetails, FanCentral } from '../api/contract';
import { SYNC_WINDOW_MS, windowTask } from '../window-task';

// Centrais de verdade (bloco 4), puro: nada aqui lê ou grava o Firestore. O
// service.ts lê, chama daqui e grava. Contrato em docs/arquitetura-api.md,
// seção 19.

/** Centrais que um fã segue de uma vez na escolha de artistas (1l). */
export const FOLLOW_MAX = 50;

/** Teto das listas (`GET /artists` e `GET /me/centrals`): o painel ordena até 240. */
export const CENTRALS_MAX = 240;

/**
 * Shards do `fanCount` de cada central (`artistStats/{id}/fanShards/{n}`).
 * Quem soma lista a subcoleção e nunca supõe este número: dá para subir sem
 * migrar nada. Teto perto de 16 entradas por segundo na mesma central.
 */
export const FAN_SHARD_COUNT = 16;

/** Janela da fila `syncArtistFanCount`: no máximo uma cópia por central a cada 10 s. */
export const FAN_COUNT_WINDOW_MS = SYNC_WINDOW_MS;

/** De onde veio o vínculo: a 1l (`POST /me/artists`), a 1d (`PUT /me/centrals/:id`) ou o seed. */
export type JoinVia = 'onboarding' | 'page' | 'seed';

/**
 * Pedidos de um fã que criam vínculo, por dia de São Paulo (o `PUT` da 1d e o
 * `POST` da 1l contam um cada, com quantas centrais trouxerem). Passou disso,
 * a entrada é recusada até o dia seguinte; sair sempre pode. Segura um script
 * que entra e sai sem parar: cada troca grava o vínculo, os shards, a chave de
 * idempotência e soma `joined` e `left` no painel. Nenhum fã de verdade chega
 * perto (docs/arquitetura-api.md, 19.5).
 */
export const CENTRAL_ENTRIES_PER_DAY = 30;

export type CentralErrorReason = 'artist_not_found' | 'too_many_entries';

const CENTRAL_ERROR_MESSAGES: Record<CentralErrorReason, string> = {
  artist_not_found: 'Central não encontrada.',
  too_many_entries: 'Entradas demais em centrais hoje.',
};

/**
 * Recusa do núcleo das centrais. A API traduz `artist_not_found` para o 404
 * e `too_many_entries` para o 429 combinados com o app (`toApiHttpError`); o
 * seed usa o mesmo núcleo fora da API. `retryAfter` (em segundos) vai no
 * Retry-After do 429.
 */
export class CentralError extends Error {
  readonly reason: CentralErrorReason;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfter: number | undefined;

  constructor(reason: CentralErrorReason, details?: Record<string, unknown>, retryAfter?: number) {
    super(CENTRAL_ERROR_MESSAGES[reason]);
    this.name = 'CentralError';
    this.reason = reason;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

/**
 * A entrada passa do teto do dia? `entriesToday` é o `central_entry` do dia na
 * carteira lida, e `limit`, o teto da configuração (`actionCaps.central_entry`,
 * editável pelo painel desde o bloco 7; padrão, as 30 de sempre). Sem vínculo
 * novo, nada a recusar.
 */
export function exceedsEntryLimit(
  entriesToday: number,
  newMemberships: number,
  limit: number = CENTRAL_ENTRIES_PER_DAY,
): boolean {
  return newMemberships > 0 && entriesToday >= limit;
}

/** Segundos até o dia seguinte de São Paulo (o Retry-After do 429), pelo menos 1. */
export function secondsUntil(next: number, now: number): number {
  return Math.max(1, Math.ceil((next - now) / 1000));
}

/** Id de central: o @, no formato do HANDLE_PATTERN e fora dos ids `__.*__`. */
export function isArtistId(value: unknown): value is string {
  return isHandleFormat(value);
}

/** artists/{id} como a API usa: só o que ela lê, com as datas em ms. */
export type ArtistRecord = {
  id: string;
  name: string;
  shortName: string | null;
  /** `photo.url`, a foto 3:4 (1200×1600). */
  photoUrl: string | null;
  /** `thumb.url`, a miniatura (480×640). */
  thumbUrl: string | null;
  /** `cover.url`, a capa em paisagem, se o painel um dia gravar (decisão 5). */
  coverUrl: string | null;
  order: number;
  status: string | null;
  verified: boolean;
  managedByImagine: boolean;
  /** A cópia da soma dos shards; inteiro, nunca negativo. */
  fanCount: number;
  /** Instante da leitura dos shards copiada (`syncArtistFanCount`), em ms. */
  fanCountAt: number | null;
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** A URL de uma `ArtistImage` (`{ url, path, width, height }`), ou null. */
function imageUrl(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  return text((value as { url?: unknown }).url);
}

/** Contagem do servidor: inteiro e nunca negativo. Valor estranho vira 0, como o painel lê. */
export function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Instante em ms com a precisão do Firestore (microssegundos): a cópia do
 * fanCount compara leituras que podem cair no mesmo milissegundo.
 */
export function exactMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.seconds * 1000 + value.nanoseconds / 1_000_000 : null;
}

/** O documento de artists/{id} como a API usa. */
export function artistRecord(id: string, data: Record<string, unknown>): ArtistRecord {
  const order = data.order;
  return {
    id,
    name: typeof data.name === 'string' ? data.name : id,
    shortName: text(data.shortName),
    photoUrl: imageUrl(data.photo),
    thumbUrl: imageUrl(data.thumb),
    coverUrl: imageUrl(data.cover),
    order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
    status: text(data.status),
    verified: data.verified === true,
    managedByImagine: data.managedByImagine === true,
    fanCount: safeCount(data.fanCount),
    fanCountAt: exactMillis(data.fanCountAt),
  };
}

/** Só a central publicada aparece no app e aceita entrada (decisão 10). */
export function isPublished(artist: ArtistRecord | null | undefined): artist is ArtistRecord {
  return artist?.status === 'published';
}

/**
 * `fanCount` de quem é membro. A cópia em artists/{id} chega uns 10 a 20 s
 * depois de cada mudança: se ela é de antes da entrada do fã (`fanCountAt`
 * ausente ou anterior ao `joinedAt`), ainda não o contava, e soma 1; senão,
 * usa a cópia, nunca abaixo de 1 (o fã está nela). Limite aceito: quem sai e
 * entra de novo antes da cópia seguinte já estava na cópia de antes da saída,
 * e é contado duas vezes até ela (só para ele, uns 10 a 20 s; o vínculo
 * apagado não guarda a passagem anterior). docs/arquitetura-api.md, 19.2.
 */
export function memberFanCount(
  fanCount: number,
  fanCountAt: number | null,
  joinedAt: number | null,
): number {
  if (fanCountAt === null || (joinedAt !== null && fanCountAt < joinedAt)) return fanCount + 1;
  return Math.max(1, fanCount);
}

/** Uma central da lista `GET /artists` (1l, busca, chips do ranking). */
export function artistView(artist: ArtistRecord): Artist {
  return {
    id: artist.id,
    name: artist.name,
    photoURL: artist.thumbUrl,
    fanCount: artist.fanCount,
    order: artist.order,
  };
}

/**
 * Capa da 1d: a `cover` em paisagem, se um dia existir; senão a foto 3:4, que
 * a 1d recorta pelo topo (decisão 5); sem foto, o placeholder de marca.
 */
export function coverOf(artist: ArtistRecord): string | null {
  return artist.coverUrl ?? artist.photoUrl ?? null;
}

/**
 * A página da central (`GET /artists/:id`). `joinedAt` é o do vínculo, ou null
 * sem vínculo; `postCount` é o `count()` dos posts no ar da central (bloco 6).
 */
export function artistDetailsView(
  artist: ArtistRecord,
  member: { joinedAt: number | null } | null,
  centralPoints: number,
  postCount = 0,
): ArtistDetails {
  return {
    id: artist.id,
    name: artist.name,
    coverUrl: coverOf(artist),
    photoURL: artist.thumbUrl,
    verified: artist.verified,
    managedByImagine: artist.managedByImagine,
    fanCount: member
      ? memberFanCount(artist.fanCount, artist.fanCountAt, member.joinedAt)
      : artist.fanCount,
    postCount: safeCount(postCount),
    centralPoints: safeCount(centralPoints),
    isMember: member !== null,
  };
}

/** Os pontos do fã numa central (`centralPoints/{id}`), como a API lê. */
export type CentralPointsRecord = { seasonId: string | null; seasonPoints: number };

/**
 * Pontos da temporada da configuração na central. Pontos guardados de outra
 * temporada (o documento ainda não trocou) mostram 0, como o `/me/wallet`.
 */
export function visibleCentralSeasonPoints(
  central: CentralPointsRecord | null,
  seasonId: string | null,
): number {
  return central && seasonId !== null && central.seasonId === seasonId
    ? safeCount(central.seasonPoints)
    : 0;
}

/** Uma central de "Suas centrais" (`GET /me/centrals`). Posição só no bloco 8 (decisão 8). */
export function fanCentralView(
  artist: ArtistRecord,
  joinedAt: number | null,
  seasonPoints: number,
): FanCentral {
  return {
    artistId: artist.id,
    name: artist.name,
    shortName: artist.shortName,
    photoURL: artist.thumbUrl,
    fanCount: memberFanCount(artist.fanCount, artist.fanCountAt, joinedAt),
    fanRank: null,
    seasonPoints,
  };
}

/**
 * Ordem de "Suas centrais": quem entrou antes vem primeiro, depois a ordem do
 * painel, depois o id. Lista nova.
 */
export function sortFanCentrals<
  T extends { artistId: string; joinedAt: number | null; order: number },
>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (a.joinedAt ?? 0) - (b.joinedAt ?? 0) ||
      a.order - b.order ||
      (a.artistId < b.artistId ? -1 : a.artistId > b.artistId ? 1 : 0),
  );
}

/**
 * Corpo do `POST /me/artists`: `{ artistIds }`, de 1 a 50 textos, sem
 * repetir, cada um no formato do @. Fora disso, null (400 na rota).
 */
export function parseFollowArtistIds(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const ids = (body as { artistIds?: unknown }).artistIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > FOLLOW_MAX) return null;
  if (!ids.every(isArtistId)) return null;
  if (new Set(ids).size !== ids.length) return null;
  return [...ids];
}

/**
 * O shard do `fanCount` de uma transação: o mesmo sorteio do shard do painel
 * (`award.shard`, de novo a cada tentativa), reduzido aos 16 da central.
 */
export function fanShardOf(shard: number): number {
  return ((Math.trunc(shard) % FAN_SHARD_COUNT) + FAN_SHARD_COUNT) % FAN_SHARD_COUNT;
}

/** Soma dos `count` dos shards; o que não é número conta 0. Pode dar negativo (erro, vale 0). */
export function sumFanShards(counts: readonly unknown[]): number {
  return counts.reduce<number>(
    (sum, count) =>
      typeof count === 'number' && Number.isFinite(count) ? sum + Math.trunc(count) : sum,
    0,
  );
}

/**
 * A tarefa copia quando a leitura dos shards é mais nova que a última cópia
 * (`fanCountAt` ausente ou anterior). Copia mesmo com o número igual: o
 * `fanCountAt` precisa passar o `joinedAt` de quem entrou, senão o
 * `memberFanCount` somaria 1 a mais para esse fã.
 */
export function shouldCopyFanCount(shownAt: number | null, readTime: number): boolean {
  return shownAt === null || shownAt < readTime;
}

/**
 * A tarefa da janela de 10 s de uma gravação nos shards: o id
 * (`fancount-<artistId>-<janela>`, no formato que o Cloud Tasks aceita) e o
 * horário (1 s depois do fim da janela). O `eventTime` é o instante da
 * gravação (`event.time`), não o relógio da execução: a entrega repetida do
 * mesmo evento cai na mesma janela e no mesmo id.
 */
export function fanCountSyncTask(
  artistId: string,
  eventTime: number,
): { id: string; scheduleTime: Date } {
  return windowTask('fancount', artistId, eventTime);
}
