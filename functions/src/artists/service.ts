import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { readFanCountForDelete } from '../centrals/service';
import { artistError } from './errors';
import { removeFiles, type ArtistFiles, type LeftoverFile } from './files';
import {
  artistPrefix,
  deleteProblem,
  handleProblem,
  imageSize,
  isImageContentType,
  nextOrder,
  parseArtistId,
  parseArtistIds,
  parseArtistName,
  parseBio,
  parseCity,
  parseContactEmail,
  parseContactPhone,
  parseFlag,
  parseGenre,
  parseHandle,
  parseManagerUid,
  parsePhotoPaths,
  parseShortName,
  parseTargetStatus,
  PHOTO_SIZE,
  publishProblems,
  reorderChanges,
  staleArtistFiles,
  THUMB_SIZE,
  type ArtistImage,
  type ArtistStatus,
  type Genre,
  type PhotoPaths,
} from './model';
import { isActiveAdmin, isActiveMember, requestFields, sectionAccess } from '../staff/model';
import { writeAudit, type AuditAction, type CallerAuth, type StaffMember } from '../staff/service';

/**
 * artists/{artistId}: a central que o app mostra. O id é o @. Só o servidor
 * grava. O fã logado lê o documento inteiro da publicada (as regras não
 * escondem campo), então o que é só da equipe fica em artistPrivate/{artistId}.
 */
export type Artist = {
  handle: string;
  name: string;
  shortName: string | null;
  genre: Genre | null;
  city: string | null;
  bio: string | null;
  verified: boolean;
  photo: ArtistImage | null;
  thumb: ArtistImage | null;
  order: number;
  status: ArtistStatus;
  /**
   * Membros da central no app: a cópia da soma dos shards
   * (artistStats/{id}/fanShards), gravada pela fila syncArtistFanCount uns 10
   * a 20 s depois de cada entrada ou saída (bloco 4). As callables não mexem.
   */
  fanCount: number;
  /** Instante da leitura dos shards da última cópia do fanCount (bloco 4). */
  fanCountAt?: Timestamp | null;
  /**
   * "Gestão oficial Imagine" na capa da 1d. Opcional, falso quando não existe:
   * o painel ainda não grava (pergunta para a cliente); o seed marca as 4 do protótipo.
   */
  managedByImagine?: boolean;
  publishedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

/**
 * artistPrivate/{artistId}: o que só a equipe com a seção artists vê (contato,
 * gestor, autorização de uso de imagem, quem criou e quem mexeu por último).
 * Nasce e some na mesma transação da central. updatedAt e updatedBy mudam a
 * cada mutação da central, inclusive as que só mexem em artists/.
 */
export type ArtistPrivate = {
  email: string | null;
  phone: string | null;
  managerUid: string | null;
  managerName: string | null;
  imageRightsConfirmed: boolean;
  createdBy: string;
  updatedBy: string;
  updatedAt: Timestamp;
};

/**
 * usernames/{@} de uma central. Sem uid: o deleteUserData apaga reservas por
 * uid e nunca toca nesta.
 */
export type ArtistHandleReservation = { artistId: string; createdAt: Timestamp };

export type ArtistDeps = {
  db: Firestore;
  files: ArtistFiles;
  /** Relógio em ms; os testes fixam o tempo. */
  now?: () => number;
};

export type HandleCheck = {
  available: boolean;
  reason: 'invalid' | 'taken' | 'reserved' | null;
};

type Actor = { uid: string; name: string };
type Need = 'view' | 'edit' | 'admin';
type Reader = (ref: DocumentReference) => Promise<DocumentSnapshot>;

const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();
const artistsOf = (db: Firestore) => db.collection('artists');
const artistRef = (db: Firestore, id: string) => artistsOf(db).doc(id);
const privateRef = (db: Firestore, id: string) => db.collection('artistPrivate').doc(id);
const usernameRef = (db: Firestore, handle: string) => db.collection('usernames').doc(handle);
const staffRef = (db: Firestore, uid: string) => db.collection('staff').doc(uid);
const direct: Reader = (ref) => ref.get();
const inTransaction =
  (tx: Transaction): Reader =>
  (ref) =>
    tx.get(ref);

/** Nome do membro para a auditoria e o gestor (o Firestore não aceita undefined). */
const nameOf = (member: StaffMember) =>
  typeof member.displayName === 'string' ? member.displayName : '';

/**
 * Quem chamou, lido de staff/{uid} a cada chamada, como na Equipe: fora da
 * equipe ativa (ou sessão de antes do authValidAfter) é not-staff; sem a seção
 * artists, ou só com leitura para uma mudança, é no-section; apagar é de admin.
 * Nas mudanças, é relido na transação: quem perde o acesso no meio não grava.
 */
async function readActor(
  read: Reader,
  db: Firestore,
  caller: CallerAuth | undefined,
  need: Need,
): Promise<Actor> {
  if (!caller) throw artistError('unauthenticated');
  const member = (await read(staffRef(db, caller.uid))).data() as StaffMember | undefined;
  const authTime = caller.token.auth_time;
  if (!member || !isActiveMember(member, authTime)) throw artistError('not-staff');
  if (need === 'admin') {
    if (!isActiveAdmin(member)) throw artistError('not-admin');
  } else {
    const access = sectionAccess(member, 'artists', authTime);
    if (access === 'none' || (need === 'edit' && access !== 'edit')) {
      throw artistError('no-section');
    }
  }
  return { uid: caller.uid, name: nameOf(member) };
}

/** Gestor escolhido: staff/{uid} existente e ativo. Devolve o nome para gravar junto. */
async function readManager(tx: Transaction, db: Firestore, uid: string): Promise<Actor> {
  const member = (await tx.get(staffRef(db, uid))).data() as StaffMember | undefined;
  if (!member || member.status !== 'active') throw artistError('invalid-manager');
  return { uid, name: nameOf(member) };
}

function audit(
  tx: Transaction,
  db: Firestore,
  action: AuditAction,
  actor: Actor,
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

/**
 * checkArtistHandle: quem vê a seção. Formato e reservados sem ir ao banco;
 * depois, @ de fã (usernames/) ou de outra central é "taken".
 */
export async function checkHandle(
  deps: ArtistDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<HandleCheck> {
  const { db } = deps;
  await readActor(direct, db, caller, 'view');
  const { handle } = requestFields(data);
  const problem = handleProblem(handle);
  if (problem) return { available: false, reason: problem };
  const [reservation, artist] = await db.getAll(
    usernameRef(db, handle as string),
    artistRef(db, handle as string),
  );
  if (reservation?.exists || artist?.exists) return { available: false, reason: 'taken' };
  return { available: true, reason: null };
}

/**
 * createArtist: rascunho novo, sem fotos, no fim da ordem, com fanCount 0. O @
 * é reservado em usernames/ na mesma transação: dois pedidos com o mesmo @, ou
 * o @ de uma fã gerado ao mesmo tempo, nunca ficam os dois com ele. A parte da
 * equipe (contato, gestor, autorização, autoria) vai para artistPrivate/ na
 * mesma transação.
 */
export async function addArtist(
  deps: ArtistDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ artistId: string }> {
  const { db } = deps;
  await readActor(direct, db, caller, 'edit');
  const input = requestFields(data);
  const handle = parseHandle(input.handle);
  const name = parseArtistName(input.name);
  const fields = {
    shortName: parseShortName(input.shortName),
    genre: parseGenre(input.genre),
    city: parseCity(input.city),
    bio: parseBio(input.bio),
    verified: parseFlag(input.verified),
  };
  const imageRightsConfirmed = parseFlag(input.imageRightsConfirmed);
  const managerUid = parseManagerUid(input.managerUid);
  const email = parseContactEmail(input.contactEmail);
  const phone = parseContactPhone(input.contactPhone);

  await db.runTransaction(async (tx) => {
    const actor = await readActor(inTransaction(tx), db, caller, 'edit');
    const [reservation, existing] = await tx.getAll(usernameRef(db, handle), artistRef(db, handle));
    const manager = managerUid ? await readManager(tx, db, managerUid) : null;
    const last = await tx.get(artistsOf(db).orderBy('order', 'desc').limit(1));
    if (reservation?.exists || existing?.exists) throw artistError('handle-taken');
    const now = Timestamp.fromMillis(clock(deps));
    const artist: Artist = {
      handle,
      name,
      ...fields,
      photo: null,
      thumb: null,
      order: nextOrder(last.docs.map((doc) => doc.get('order'))),
      status: 'draft',
      fanCount: 0,
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const internal: ArtistPrivate = {
      email,
      phone,
      managerUid: manager?.uid ?? null,
      managerName: manager?.name ?? null,
      imageRightsConfirmed,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      updatedAt: now,
    };
    const reserved: ArtistHandleReservation = { artistId: handle, createdAt: now };
    tx.create(usernameRef(db, handle), reserved);
    tx.create(artistRef(db, handle), artist);
    tx.set(privateRef(db, handle), internal);
    audit(tx, db, 'artist.created', actor, { artistId: handle, name }, now);
  });
  return { artistId: handle };
}

/** Foto enviada pelo painel: existe, é imagem, e ganha a URL de download. */
async function storedImage(
  files: ArtistFiles,
  path: string,
  fallback: { width: number; height: number },
): Promise<ArtistImage> {
  const file = await files.describe(path);
  if (!file) throw artistError('photo-not-found');
  if (!isImageContentType(file.contentType)) throw artistError('invalid-photo');
  const url = await files.downloadUrl(path);
  return { url, path, ...imageSize(file.customMetadata, fallback) };
}

async function storedImages(
  files: ArtistFiles,
  paths: PhotoPaths,
): Promise<{ photo: ArtistImage; thumb: ArtistImage }> {
  const [photo, thumb] = await Promise.all([
    storedImage(files, paths.photoPath, PHOTO_SIZE),
    storedImage(files, paths.thumbPath, THUMB_SIZE),
  ]);
  return { photo, thumb };
}

/** Campos simples do updateArtist que o app mostra (artists/), na ordem do formulário. */
const PUBLIC_FIELDS = ['name', 'shortName', 'genre', 'city', 'bio', 'verified'] as const;

type PublicField = (typeof PUBLIC_FIELDS)[number];

/** Pedido do updateArtist já validado: ausente não muda, null limpa. */
type ArtistPatch = Partial<Pick<Artist, PublicField>> & {
  imageRightsConfirmed?: boolean;
  managerUid?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  photo?: PhotoPaths | null;
};

function parsePatch(input: Record<string, unknown>, artistId: string): ArtistPatch {
  const patch: ArtistPatch = {};
  if (input.name !== undefined) patch.name = parseArtistName(input.name);
  if (input.shortName !== undefined) patch.shortName = parseShortName(input.shortName);
  if (input.genre !== undefined) patch.genre = parseGenre(input.genre);
  if (input.city !== undefined) patch.city = parseCity(input.city);
  if (input.bio !== undefined) patch.bio = parseBio(input.bio);
  if (input.verified !== undefined) patch.verified = parseFlag(input.verified);
  if (input.imageRightsConfirmed !== undefined) {
    patch.imageRightsConfirmed = parseFlag(input.imageRightsConfirmed);
  }
  if (input.managerUid !== undefined) patch.managerUid = parseManagerUid(input.managerUid);
  if (input.contactEmail !== undefined) patch.contactEmail = parseContactEmail(input.contactEmail);
  if (input.contactPhone !== undefined) patch.contactPhone = parseContactPhone(input.contactPhone);
  if (input.photo !== undefined) patch.photo = parsePhotoPaths(input.photo, artistId);
  return patch;
}

/** artistPrivate/{id} como está (central sem ele: tudo vazio e sem autorização). */
type StoredPrivate = Partial<ArtistPrivate> | undefined;

/**
 * Marca a mutação em artistPrivate/{id}: quem mexeu e quando, com as mudanças
 * da equipe que vierem junto. Com merge, para não apagar o resto do documento.
 */
function touchPrivate(
  tx: Transaction,
  db: Firestore,
  artistId: string,
  actor: Actor,
  now: Timestamp,
  changes: Partial<ArtistPrivate> = {},
): void {
  const next: Partial<ArtistPrivate> = { ...changes, updatedAt: now, updatedBy: actor.uid };
  tx.set(privateRef(db, artistId), next, { merge: true });
}

/** Log dos arquivos que o removeFiles não conseguiu apagar (nada, se saíram todos). */
function warnLeftovers(message: string, artistId: string, leftovers: LeftoverFile[]): void {
  const [first] = leftovers;
  if (!first) return;
  logger.warn(message, {
    artistId,
    paths: leftovers.map((leftover) => leftover.path),
    error: first.error,
  });
}

/**
 * Limpa a pasta da central depois que o updateArtist grava foto nova ou tira a
 * foto: saem as versões antigas e os envios abandonados. Ficam os caminhos de
 * `keep` (as fotos novas) e as fotos que a central usa na hora, relidas depois
 * de listar a pasta: a foto que outra pessoa gravou no meio não some. Roda
 * depois da transação e nunca derruba o pedido: a falha só vai para o log.
 */
async function pruneArtistFiles(
  deps: ArtistDeps,
  artistId: string,
  keep: readonly string[],
): Promise<void> {
  try {
    const paths = await deps.files.list(artistPrefix(artistId));
    const current = (await artistRef(deps.db, artistId).get()).data() as
      Partial<Artist> | undefined;
    const stale = staleArtistFiles(paths, artistId, [
      ...keep,
      current?.photo?.path,
      current?.thumb?.path,
    ]);
    warnLeftovers(
      'Arquivos antigos de uma central ficaram no Storage.',
      artistId,
      await removeFiles(deps.files, stale),
    );
  } catch (error) {
    logger.warn('A limpeza da pasta de uma central no Storage falhou.', {
      artistId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * updateArtist: campos ausentes não mudam e null limpa os opcionais. As fotos
 * são conferidas no bucket antes da transação (caminho da própria central,
 * arquivo existente, tipo de imagem). Central no ar não perde a foto nem a
 * autorização de imagem. Cada campo vai para o seu documento: textos, selo e
 * fotos em artists/ (com updatedAt), e contato, gestor e autorização em
 * artistPrivate/, que também guarda updatedAt e updatedBy de toda mudança.
 * Nada mudou: ok, sem gravar nem auditar. Pedido com `photo` que passou: depois
 * da transação, a pasta da central fica só com as fotos novas (ou vazia, com
 * `photo: null`), sem travar a resposta se a limpeza falhar.
 */
export async function editArtist(
  deps: ArtistDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await readActor(direct, db, caller, 'edit');
  const input = requestFields(data);
  const artistId = parseArtistId(input.artistId);
  const patch = parsePatch(input, artistId);
  const images = patch.photo ? await storedImages(deps.files, patch.photo) : patch.photo;

  await db.runTransaction(async (tx) => {
    const actor = await readActor(inTransaction(tx), db, caller, 'edit');
    const current = (await tx.get(artistRef(db, artistId))).data() as Artist | undefined;
    if (!current) throw artistError('artist-not-found');
    const internal = (await tx.get(privateRef(db, artistId))).data() as StoredPrivate;
    const managerChanged =
      patch.managerUid !== undefined && patch.managerUid !== (internal?.managerUid ?? null);
    const manager =
      managerChanged && patch.managerUid ? await readManager(tx, db, patch.managerUid) : null;

    const published = current.status === 'published';
    if (published && images === null) throw artistError('published-needs-photo');
    if (published && patch.imageRightsConfirmed === false) {
      throw artistError('published-needs-image-rights');
    }

    const publicChanges: Partial<Artist> = {};
    const privateChanges: Partial<ArtistPrivate> = {};
    const changed: string[] = [];
    for (const field of PUBLIC_FIELDS) {
      const value = patch[field];
      if (value !== undefined && value !== current[field]) {
        Object.assign(publicChanges, { [field]: value });
        changed.push(field);
      }
    }
    if (
      patch.imageRightsConfirmed !== undefined &&
      patch.imageRightsConfirmed !== (internal?.imageRightsConfirmed === true)
    ) {
      privateChanges.imageRightsConfirmed = patch.imageRightsConfirmed;
      changed.push('imageRightsConfirmed');
    }
    if (managerChanged) {
      privateChanges.managerUid = manager?.uid ?? null;
      privateChanges.managerName = manager?.name ?? null;
      changed.push('managerUid');
    }
    if (images === null && (current.photo || current.thumb)) {
      publicChanges.photo = null;
      publicChanges.thumb = null;
      changed.push('photo');
    } else if (
      images &&
      (current.photo?.path !== images.photo.path || current.thumb?.path !== images.thumb.path)
    ) {
      publicChanges.photo = images.photo;
      publicChanges.thumb = images.thumb;
      changed.push('photo');
    }
    if (patch.contactEmail !== undefined && patch.contactEmail !== (internal?.email ?? null)) {
      privateChanges.email = patch.contactEmail;
      changed.push('contactEmail');
    }
    if (patch.contactPhone !== undefined && patch.contactPhone !== (internal?.phone ?? null)) {
      privateChanges.phone = patch.contactPhone;
      changed.push('contactPhone');
    }
    if (changed.length === 0) return;

    const now = Timestamp.fromMillis(clock(deps));
    if (Object.keys(publicChanges).length > 0) {
      tx.update(artistRef(db, artistId), { ...publicChanges, updatedAt: now });
    }
    touchPrivate(tx, db, artistId, actor, now, privateChanges);
    // Só os nomes dos campos: o contato não vai para a auditoria, que outra
    // seção lê.
    audit(
      tx,
      db,
      'artist.updated',
      actor,
      { artistId, name: publicChanges.name ?? current.name, changed },
      now,
    );
  });

  if (images !== undefined) {
    await pruneArtistFiles(deps, artistId, images ? [images.photo.path, images.thumb.path] : []);
  }
  return { ok: true };
}

/**
 * setArtistStatus: publicar exige as duas fotos (artists/) e a autorização de
 * imagem (artistPrivate/, lida na mesma transação), e grava publishedAt na
 * primeira vez. Tirar do ar não apaga nada. O mesmo status, ou tirar do ar um
 * rascunho (que nunca esteve no ar), é ok sem gravar nem auditar.
 */
export async function changeArtistStatus(
  deps: ArtistDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await readActor(direct, db, caller, 'edit');
  const input = requestFields(data);
  const artistId = parseArtistId(input.artistId);
  const status = parseTargetStatus(input.status);

  await db.runTransaction(async (tx) => {
    const actor = await readActor(inTransaction(tx), db, caller, 'edit');
    const current = (await tx.get(artistRef(db, artistId))).data() as Artist | undefined;
    if (!current) throw artistError('artist-not-found');
    if (current.status === status) return;
    if (status === 'unpublished' && current.status === 'draft') return;
    if (status === 'published') {
      const internal = (await tx.get(privateRef(db, artistId))).data() as StoredPrivate;
      const [problem] = publishProblems({
        photo: current.photo,
        thumb: current.thumb,
        imageRightsConfirmed: internal?.imageRightsConfirmed,
      });
      if (problem) throw artistError(problem);
    }
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(artistRef(db, artistId), {
      status,
      ...(status === 'published' && !current.publishedAt ? { publishedAt: now } : {}),
      updatedAt: now,
    });
    touchPrivate(tx, db, artistId, actor, now);
    audit(
      tx,
      db,
      status === 'published' ? 'artist.published' : 'artist.unpublished',
      actor,
      { artistId, name: current.name, from: current.status },
      now,
    );
  });
  return { ok: true };
}

/**
 * reorderArtists: a lista completa na ordem nova; order = posição. Grava só as
 * centrais que mudaram de lugar (order em artists/, quem mexeu em
 * artistPrivate/), numa transação. Mesma ordem: ok sem gravar.
 */
export async function reorderArtistList(
  deps: ArtistDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await readActor(direct, db, caller, 'edit');
  const artistIds = parseArtistIds(requestFields(data).artistIds);

  await db.runTransaction(async (tx) => {
    const actor = await readActor(inTransaction(tx), db, caller, 'edit');
    const all = await tx.get(artistsOf(db));
    const changes = reorderChanges(
      all.docs.map((doc) => ({ id: doc.id, order: doc.get('order') })),
      artistIds,
    );
    if (changes.length === 0) return;
    const now = Timestamp.fromMillis(clock(deps));
    for (const { id, order } of changes) {
      tx.update(artistRef(db, id), { order, updatedAt: now });
      touchPrivate(tx, db, id, actor, now);
    }
    audit(
      tx,
      db,
      'artist.reordered',
      actor,
      { artistIds, moved: changes.map((change) => change.id) },
      now,
    );
  });
  return { ok: true };
}

/**
 * deleteArtist: só admin, em qualquer status (rascunho, no ar ou fora do ar),
 * menos central com fãs (has-fans: essa sai do ar em vez de sumir) ou com
 * post ou show, mesmo rascunho (has-content, bloco 6). Quem
 * decide é a soma dos shards do fanCount, lida na transação (o fanCount de
 * artists/ é uma cópia que pode estar atrasada); sem shard nenhum (central de
 * antes do bloco 4), o fanCount. Apaga a central, o artistPrivate/, os shards,
 * a reserva do @ (se ainda é desta central) e depois todos os arquivos de
 * artists/{id}/. A auditoria guarda o status na
 * hora e se ela já foi publicada. Os arquivos saem um por um (removeFiles):
 * o que falha não impede os outros e vai para o log com o caminho, porque a
 * central já saiu e ninguém mais lista essa pasta.
 */
export async function removeArtist(
  deps: ArtistDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await readActor(direct, db, caller, 'admin');
  const artistId = parseArtistId(requestFields(data).artistId);

  await db.runTransaction(async (tx) => {
    const actor = await readActor(inTransaction(tx), db, caller, 'admin');
    const current = (await tx.get(artistRef(db, artistId))).data() as Artist | undefined;
    if (!current) throw artistError('artist-not-found');
    const reservation = await tx.get(usernameRef(db, artistId));
    const { fans, shards } = await readFanCountForDelete(tx, db, artistId, current.fanCount);
    // Posts e shows (bloco 6, 21.1, decisão 23): também o rascunho, que a
    // equipe apaga antes (deletePost, deleteEvent). Sem isso, posts e shows
    // ficariam apontando para um @ que outra central pode tomar depois.
    const [posts, events] = await Promise.all([
      tx.get(db.collection('posts').where('artistId', '==', artistId).limit(1)),
      tx.get(db.collection('events').where('artistIds', 'array-contains', artistId).limit(1)),
    ]);
    const problem = deleteProblem({ fanCount: fans });
    if (problem) throw artistError(problem);
    if (!posts.empty || !events.empty) throw artistError('has-content');
    const now = Timestamp.fromMillis(clock(deps));
    tx.delete(artistRef(db, artistId));
    tx.delete(privateRef(db, artistId));
    for (const shard of shards) tx.delete(shard);
    if (reservation.get('artistId') === artistId) tx.delete(reservation.ref);
    audit(
      tx,
      db,
      'artist.deleted',
      actor,
      {
        artistId,
        name: current.name,
        status: current.status,
        wasPublished: current.publishedAt != null,
      },
      now,
    );
  });

  const message = 'As fotos de uma central apagada ficaram no Storage.';
  try {
    const paths = await deps.files.list(artistPrefix(artistId));
    warnLeftovers(message, artistId, await removeFiles(deps.files, paths));
  } catch (error) {
    logger.warn(message, {
      artistId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { ok: true };
}
