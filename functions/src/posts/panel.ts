import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { eventOf, eventRef } from '../agenda/store';
import { isHandleFormat, isImageContentType, imageSize } from '../artists/model';
import { removeFiles, type ArtistFiles } from '../artists/files';
import { artistRef } from '../centrals/service';
import { isContentId } from '../page-cursor';
import { requestFields, type SectionId } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import { postPanelError } from './errors';
import {
  parseContentId,
  parseContentStatus,
  parsePostKind,
  parsePostMediaPaths,
  parsePostText,
  POST_MEDIA_SIZES,
  postPrefix,
  staleFiles,
  type ImageFile,
  type PostKind,
  type PostMediaPaths,
  type VideoFile,
} from './model';
import { postOf, postRef, postsRef } from './store';

// Callables do painel para o mural (bloco 6, docs/arquitetura-api.md, 21.9):
// admin, ou editor com a seção artists (o conteúdo é da central; provisório
// até a UP-9), cria, edita, publica, tira do ar e apaga o rascunho que nunca
// foi ao ar. A mídia sobe do navegador para posts/{postId}/ (storage.rules) e
// a função confere o arquivo antes de gravar, como as fotos das centrais. As
// telas são do bloco 11 (imagineup-admin).

/**
 * A seção que publica no mural e na agenda. Trocar por uma seção própria pede
 * trocar também o firestore.rules (a leitura de posts, events e postComments)
 * e o storage.rules (o envio da mídia), 21.1, decisão 1.
 */
export const PANEL_CONTENT_SECTION: SectionId = 'artists';

export type ContentDeps = {
  db: Firestore;
  files: ArtistFiles;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
};

const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();

function audit(
  tx: Transaction,
  db: Firestore,
  action: AuditAction,
  actor: PanelActor,
  details: Record<string, unknown>,
  now: Timestamp,
): void {
  writeAudit(
    tx,
    db,
    {
      action,
      actorUid: actor.uid,
      actorName: actor.name,
      targetEmail: '',
      targetUid: null,
      details,
    },
    now,
  );
}

const editor = (deps: ContentDeps, caller: CallerAuth | undefined) =>
  readPanelActor(directRead, deps.db, caller, PANEL_CONTENT_SECTION, 'edit');

const editorIn = (tx: Transaction, deps: ContentDeps, caller: CallerAuth | undefined) =>
  readPanelActor(transactionRead(tx), deps.db, caller, PANEL_CONTENT_SECTION, 'edit');

/** O show de um post de show: existe e tem a central do post entre os artistas. */
async function readEventFor(
  tx: Transaction,
  db: Firestore,
  eventId: string,
  artistId: string,
): Promise<{ published: boolean }> {
  const event = eventOf(await tx.get(eventRef(db, eventId)));
  if (!event) throw postPanelError('event-not-found');
  if (!event.artistIds.includes(artistId)) throw postPanelError('event-artist-mismatch');
  return { published: event.status === 'published' };
}

/** `eventId` do pedido: só no post de show, obrigatório nele. */
function parseEventIdFor(kind: PostKind, value: unknown): string | null {
  if (kind !== 'event') {
    if (value !== undefined && value !== null) throw postPanelError('invalid-request');
    return null;
  }
  if (!isContentId(value)) throw postPanelError('event-not-found');
  return value;
}

/**
 * createPost: o rascunho, com as contagens em 0 e sem `publishedAt`. A
 * central precisa existir (em qualquer status); o tipo não muda depois; o
 * post de show aponta para um show que tem a central do post.
 */
export async function addPost(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ postId: string }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  if (!isHandleFormat(input.artistId)) throw postPanelError('artist-not-found');
  const artistId = input.artistId;
  const kind = parsePostKind(input.kind);
  const text = parsePostText(kind, input.text);
  const eventId = parseEventIdFor(kind, input.eventId);

  return db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const artist = await tx.get(artistRef(db, artistId));
    if (!artist.exists) throw postPanelError('artist-not-found');
    if (eventId) await readEventFor(tx, db, eventId, artistId);
    const ref = postsRef(db).doc();
    const now = Timestamp.fromMillis(clock(deps));
    tx.create(ref, {
      artistId,
      kind,
      text,
      media: null,
      eventId,
      status: 'draft',
      publishedAt: null,
      likeCount: 0,
      commentCount: 0,
      countsAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      schemaVersion: 1,
    });
    audit(tx, db, 'post.created', actor, { postId: ref.id, artistId, kind }, now);
    return { postId: ref.id };
  });
}

/** Imagem enviada pelo painel: existe, é imagem e ganha a URL de download. */
async function storedImage(
  files: ArtistFiles,
  path: string,
  fallback: { width: number; height: number },
): Promise<ImageFile> {
  const file = await files.describe(path);
  if (!file) throw postPanelError('media-not-found');
  if (!isImageContentType(file.contentType)) throw postPanelError('invalid-media');
  const url = await files.downloadUrl(path);
  return { url, path, ...imageSize(file.customMetadata, fallback) };
}

/** O mp4 do post de vídeo: existe e é `video/mp4`. */
async function storedVideo(files: ArtistFiles, path: string): Promise<VideoFile> {
  const file = await files.describe(path);
  if (!file) throw postPanelError('media-not-found');
  if (file.contentType !== 'video/mp4') throw postPanelError('invalid-media');
  const url = await files.downloadUrl(path);
  return { url, path, size: file.size ?? 0 };
}

type StoredMedia = { photo: ImageFile; thumb: ImageFile; video: VideoFile | null };

async function storedMedia(
  files: ArtistFiles,
  kind: 'photo' | 'video',
  paths: PostMediaPaths,
): Promise<StoredMedia> {
  const sizes = POST_MEDIA_SIZES[kind];
  const [photo, thumb, video] = await Promise.all([
    storedImage(files, paths.photoPath, sizes.photo),
    storedImage(files, paths.thumbPath, sizes.thumb),
    paths.videoPath ? storedVideo(files, paths.videoPath) : Promise.resolve(null),
  ]);
  return { photo, thumb, video };
}

/** Os caminhos da mídia gravada num post (para a limpeza da pasta). */
function mediaPaths(media: unknown): string[] {
  if (typeof media !== 'object' || media === null) return [];
  return ['photo', 'thumb', 'video'].flatMap((key) => {
    const path = ((media as Record<string, unknown>)[key] as { path?: unknown } | null)?.path;
    return typeof path === 'string' ? [path] : [];
  });
}

/**
 * Limpa a pasta do post depois de gravar mídia nova ou tirar a mídia: saem as
 * versões antigas e os envios abandonados; ficam `keep` e a mídia que o post
 * usa na hora (relida depois de listar). Nunca derruba o pedido: a falha só
 * vai para o log.
 */
async function prunePostFiles(deps: ContentDeps, postId: string, keep: string[]): Promise<void> {
  try {
    const prefix = postPrefix(postId);
    const paths = await deps.files.list(prefix);
    const current = await postRef(deps.db, postId).get();
    const stale = staleFiles(paths, prefix, [...keep, ...mediaPaths(current.get('media'))]);
    const leftovers = await removeFiles(deps.files, stale);
    if (leftovers.length > 0) {
      logger.warn('Arquivos antigos de um post ficaram no Storage.', {
        postId,
        paths: leftovers.map((leftover) => leftover.path),
        error: leftovers[0]!.error,
      });
    }
  } catch (error) {
    logger.warn('A limpeza da pasta de um post no Storage falhou.', {
      postId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * updatePost: ausente não muda. `media` só em foto e vídeo (conferida no
 * bucket antes da transação); null tira, só fora do ar. Trocar o show de um
 * post no ar exige o show novo no ar. Nada mudou: ok, sem gravar nem auditar.
 * Com `media`, depois da transação, a pasta fica só com a mídia nova.
 */
export async function editPost(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const postId = parseContentId(input.postId);
  // O tipo nunca muda: lido antes, para conferir o texto e a mídia.
  const before = postOf(await postRef(db, postId).get());
  if (!before) throw postPanelError('post-not-found');
  const text = input.text === undefined ? undefined : parsePostText(before.kind, input.text);
  const eventId =
    input.eventId === undefined ? undefined : parseEventIdFor(before.kind, input.eventId);
  const paths =
    input.media === undefined ? undefined : parsePostMediaPaths(before.kind, input.media, postId);
  const media =
    paths === undefined || paths === null
      ? paths
      : await storedMedia(deps.files, before.kind as 'photo' | 'video', paths);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(postRef(db, postId));
    const current = postOf(snap);
    if (!current) throw postPanelError('post-not-found');
    const published = current.status === 'published';
    if (eventId && eventId !== current.eventId) {
      const event = await readEventFor(tx, db, eventId, current.artistId);
      if (published && !event.published) throw postPanelError('event-not-published');
    }
    if (published && media === null) throw postPanelError('published-needs-media');

    const changes: Record<string, unknown> = {};
    const changed: string[] = [];
    if (text !== undefined && text !== current.text) {
      changes.text = text;
      changed.push('text');
    }
    if (eventId !== undefined && eventId !== current.eventId) {
      changes.eventId = eventId;
      changed.push('eventId');
    }
    if (media === null && current.photo) {
      changes.media = null;
      changed.push('media');
    } else if (
      media &&
      (current.photo?.path !== media.photo.path ||
        current.thumb?.path !== media.thumb.path ||
        (current.video?.path ?? null) !== (media.video?.path ?? null))
    ) {
      changes.media = media;
      changed.push('media');
    }
    if (changed.length === 0) return;
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(snap.ref, { ...changes, updatedAt: now, updatedBy: actor.uid });
    audit(
      tx,
      db,
      'post.updated',
      actor,
      { postId, artistId: current.artistId, kind: current.kind, changed },
      now,
    );
  });

  if (media !== undefined) {
    await prunePostFiles(
      deps,
      postId,
      media ? [media.photo.path, media.thumb.path, ...(media.video ? [media.video.path] : [])] : [],
    );
  }
  return { ok: true };
}

/**
 * setPostStatus: publicar exige a mídia na foto e no vídeo e o show no ar no
 * post de show; a central pode estar fora do ar (o post aparece quando ela for
 * publicada). A primeira publicação grava `publishedAt`, e republicar mantém a
 * primeira (o lugar no mural). Tirar do ar não mexe em curtida, comentário nem
 * contagem. O mesmo status, ou tirar do ar um rascunho, é ok sem gravar.
 */
export async function changePostStatus(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const postId = parseContentId(input.postId);
  const status = parseContentStatus(input.status);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(postRef(db, postId));
    const current = postOf(snap);
    if (!current) throw postPanelError('post-not-found');
    if (current.status === status) return;
    if (status === 'unpublished' && current.status === 'draft') return;
    if (status === 'published') {
      if (
        (current.kind === 'photo' || current.kind === 'video') &&
        (!current.photo || !current.thumb)
      ) {
        throw postPanelError('missing-media');
      }
      if (current.kind === 'event') {
        if (!current.eventId) throw postPanelError('event-not-found');
        const event = await readEventFor(tx, db, current.eventId, current.artistId);
        if (!event.published) throw postPanelError('event-not-published');
      }
    }
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(snap.ref, {
      status,
      ...(status === 'published' && current.publishedAt === null ? { publishedAt: now } : {}),
      updatedAt: now,
      updatedBy: actor.uid,
    });
    audit(
      tx,
      db,
      status === 'published' ? 'post.published' : 'post.unpublished',
      actor,
      { postId, artistId: current.artistId, from: current.status },
      now,
    );
  });
  return { ok: true };
}

/**
 * deletePost: só o post que nunca foi ao ar (`publishedAt` nulo, lido na
 * transação; senão `was-published`, e a equipe tira do ar). Nenhuma rota
 * aceita ação em post que não está no ar, então ele só tem o documento e os
 * arquivos. É o que solta a central de um rascunho criado por engano.
 */
export async function removePost(
  deps: ContentDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const postId = parseContentId(requestFields(data).postId);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(postRef(db, postId));
    const current = postOf(snap);
    if (!current) throw postPanelError('post-not-found');
    if (current.publishedAt !== null) throw postPanelError('was-published');
    const now = Timestamp.fromMillis(clock(deps));
    tx.delete(snap.ref);
    tx.delete(db.collection('postStats').doc(postId));
    audit(
      tx,
      db,
      'post.deleted',
      actor,
      { postId, artistId: current.artistId, kind: current.kind },
      now,
    );
  });

  try {
    const paths = await deps.files.list(postPrefix(postId));
    const leftovers = await removeFiles(deps.files, paths);
    if (leftovers.length > 0) {
      logger.warn('Arquivos de um post apagado ficaram no Storage.', {
        postId,
        paths: leftovers.map((leftover) => leftover.path),
      });
    }
  } catch (error) {
    logger.warn('A limpeza da pasta de um post apagado falhou.', {
      postId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { ok: true };
}
