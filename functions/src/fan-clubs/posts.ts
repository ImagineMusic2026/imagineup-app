import { randomUUID } from 'node:crypto';

import {
  FieldPath,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import type {
  FanClubPost,
  FanClubPostDetails,
  FanClubPostImage,
  FanClubUploadSlot,
  OwnFanClubPost,
  Page,
} from '../api/contract';
import { artistRecord, isPublished, type ArtistRecord } from '../centrals/model';
import { artistRef, membershipRef } from '../centrals/service';
import { runStorageWork, type FanPhotoFiles, type StorageWork } from '../fan-profile/files';
import {
  jpegDimensions,
  PHOTO_HEAD_BYTES,
  photoProblem,
  type PhotoLimits,
  type PhotoProblem,
} from '../fan-profile/model';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import { blockedOf } from '../moderation/model';
import { blockListRef } from '../moderation/store';
import { encodePageCursor, isContentId, type PageCursor } from '../page-cursor';
import {
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import {
  applicationRecord,
  CLUB_PHOTO_LIMITS,
  CLUB_THUMB_LIMITS,
  emptyReactionCounts,
  FAN_CLUB_PENDING_MAX,
  FAN_CLUB_RULES_VERSION,
  FAN_CLUB_UPLOAD_SLOT_MS,
  fanClubBoxes,
  fanClubInvalid,
  fanClubMediaFolder,
  FanClubError,
  fanClubNotFound,
  fanClubPostNotFound,
  fanClubPostRecord,
  fanClubReactionOf,
  fanClubRecord,
  fanClubRefused,
  findMentionTokens,
  isBlockedWithMentions,
  mentionHandles,
  millisOf,
  postMediaPaths,
  resolvedMentions,
  sameProportion,
  slotFileNames,
  slotNamesOf,
  type FanClubPostRecord,
  type FanClubPostStatus,
  type FanClubReactionKey,
  type FanClubRecord,
  type PostImage,
  type PostInput,
  type PostMedia,
} from './model';
import {
  applicationRef,
  artistPrivateRef,
  fanClubCommentQueueRef,
  fanClubCommentsOf,
  fanClubFollowRef,
  fanClubPostRef,
  fanClubPostsOf,
  fanClubPostsOfAuthor,
  fanClubReactionRef,
  fanClubReactionsOf,
  fanClubRef,
  fanClubReportQueueRef,
  fanClubUploadSlotRef,
  ownerCopiesOf,
  readMentionTargets,
  readReactionsOf,
} from './store';

// As publicações do fã-clube (docs/arquitetura-api.md, seção 34, 34.3 e 34.5;
// etapa 2 de 34.14): a vaga de envio da foto, publicar (sempre em análise),
// "Minhas publicações", retirar e tirar do ar, as publicações no ar da página
// e o passo da exclusão de conta. Desde a Fase 2 (seção 37, 37.3), a
// publicação no ar pelo id (`GET /fan-club-posts/:postId`), os contadores e a
// reação de quem pede nas vistas e o que reagir e comentar pedem da
// publicação (`readActionPost`); desde a etapa 2 de 37.13, as marcações do
// texto do gestor, resolvidas no envio (37.7); desde a etapa 4, os comentários
// e as reações de cada publicação saindo antes dela na exclusão do gestor
// (37.8). O que mexe em arquivo do
// Storage fora da leitura (apagar e trocar o token) fica para depois da
// transação, no `FanClubFileWork` que a rota e a callable rodam depois de
// gravar.

const tsOf = (ms: number) => Timestamp.fromMillis(ms);

const iso = (ms: number): string => new Date(ms).toISOString();

// --- Os arquivos depois da transação ------------------------------------------------

/**
 * O que fica para depois da transação: os arquivos a apagar (a publicação
 * retirada ou recusada), os tokens de download a trocar (a oculta e a tirada
 * do ar, porque a URL com token passa por cima da regra do Storage, 34.19) e
 * as publicações cujas URLs são relidas depois da troca (`refresh`): a
 * reexibida, e a oculta que alguém reexibiu antes da troca terminar.
 */
export type FanClubFileWork = StorageWork & { refresh: string[] };

export const NO_FILE_WORK: FanClubFileWork = { remove: [], rotate: [], refresh: [] };

type Log = Pick<typeof logger, 'warn' | 'error'>;

/**
 * As URLs da publicação no ar acertadas com o token de agora, numa transação
 * curta que relê a publicação: só a que está no ar, com a mesma mídia (os
 * mesmos caminhos) e uma URL diferente da de agora. Fecha a corrida entre o
 * ocultar, que troca o token depois da transação, e o reexibir de outra
 * pessoa, que leu o token antes da troca: quem termina por último acerta.
 */
export async function refreshPostMedia(
  db: Firestore,
  files: Pick<FanPhotoFiles, 'downloadUrl'>,
  postId: string,
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(fanClubPostRef(db, postId));
    if (!snap.exists) return false;
    const post = fanClubPostRecord(snap.id, snap.data() ?? {});
    if (post.status !== 'published' || post.media === null) return false;
    const [photo, thumb] = await Promise.all([
      files.downloadUrl(post.media.photo.path),
      files.downloadUrl(post.media.thumb.path),
    ]);
    if (photo === post.media.photo.url && thumb === post.media.thumb.url) return false;
    tx.update(snap.ref, {
      media: {
        photo: { ...post.media.photo, url: photo },
        thumb: { ...post.media.thumb, url: thumb },
      },
    });
    return true;
  });
}

/**
 * Apaga, troca os tokens (o `runStorageWork`) e, depois, relê as URLs das
 * publicações do `refresh`. Nunca lança: a gravação já valeu, e o que falhou
 * vai ao log com os caminhos ou o id (nunca o texto do fã).
 */
export async function runFanClubFileWork(
  db: Firestore,
  files: Pick<FanPhotoFiles, 'remove' | 'rotateDownloadToken' | 'downloadUrl'>,
  work: FanClubFileWork,
  log: Log = logger,
): Promise<void> {
  await runStorageWork(files, work, log);
  for (const postId of work.refresh) {
    try {
      await refreshPostMedia(db, files, postId);
    } catch (error) {
      log.error('fan-clubs: as URLs de uma publicação não foram relidas', {
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// --- As vistas ------------------------------------------------------------------------

const imageView = (image: PostImage): FanClubPostImage => ({
  url: image.url,
  width: image.width,
  height: image.height,
});

/** A foto só aparece em análise e no ar (a recusada e a retirada perderam os arquivos; a oculta e a tirada do ar, o token). */
const showsMedia = (status: FanClubPostStatus) => status === 'pending' || status === 'published';

/**
 * A publicação como o gestor vê em "Minhas publicações", com os totais de
 * reações e de comentários e as marcações (seção 37, 37.3).
 */
export function ownPostView(post: FanClubPostRecord): OwnFanClubPost {
  const media = showsMedia(post.status) ? post.media : null;
  return {
    id: post.id,
    clubId: post.clubId,
    artistId: post.artistId,
    kind: post.kind,
    text: post.text,
    photo: media ? imageView(media.photo) : null,
    thumb: media ? imageView(media.thumb) : null,
    status: post.status,
    rejectReason: post.status === 'rejected' ? post.rejectReason : null,
    submittedAt: iso(post.submittedAt),
    publishedAt: post.publishedAt === null ? null : iso(post.publishedAt),
    reviewedAt: post.reviewedAt === null ? null : iso(post.reviewedAt),
    reactionCount: post.reactionCount,
    reactionCounts: post.reactionCounts,
    commentCount: post.commentCount,
    mentions: post.mentions,
  };
}

/**
 * A publicação no ar, como os fãs veem, com o nome do fã-clube e o selo de
 * oficial; desde a Fase 2 (seção 37, 37.3), com os contadores, a reação de
 * quem pede e as marcações.
 */
export function publicPostView(
  post: FanClubPostRecord,
  club: FanClubRecord,
  myReaction: FanClubReactionKey | null,
): FanClubPost {
  return {
    id: post.id,
    clubId: post.clubId,
    clubName: club.name ?? '',
    clubOfficial: club.official,
    artistId: post.artistId,
    author: {
      uid: post.authorUid,
      name: post.authorName,
      username: post.authorUsername,
      photoURL: post.authorPhotoURL,
    },
    kind: post.kind,
    text: post.text,
    photo: post.media ? imageView(post.media.photo) : null,
    thumb: post.media ? imageView(post.media.thumb) : null,
    publishedAt: iso(post.publishedAt ?? post.submittedAt),
    reactionCount: post.reactionCount,
    reactionCounts: post.reactionCounts,
    commentCount: post.commentCount,
    myReaction,
    mentions: post.mentions,
  };
}

// --- O fã-clube como os fãs veem ---------------------------------------------------------

const artistOf = (snap: DocumentSnapshot | undefined): ArtistRecord | null =>
  snap?.exists ? artistRecord(snap.id, (snap.data() ?? {}) as Record<string, unknown>) : null;

export type VisibleClub = {
  club: FanClubRecord;
  artist: ArtistRecord;
  /** Os fãs que quem pede bloqueou, da lista lida junto do fã-clube. */
  blocked: string[];
  /** O que quem chama pediu a mais, lido junto do artista. */
  extra: DocumentSnapshot[];
};

/**
 * O fã-clube como os fãs o veem (34.3): ativo, de artista no ar e com o
 * fã-clube aberto para ele (a caixa "Aceita fã-clubes"), e de gestor que quem
 * pede não bloqueou (decisão 19). Senão, 404 `fan_club_not_found`, o mesmo
 * nos quatro casos. Duas rodadas de leitura: o fã-clube e a lista de
 * bloqueios de quem pede; o artista, o `artistPrivate` e o `extra` de quem
 * chama (montado com o fã-clube lido).
 */
export async function readVisibleClub(
  db: Firestore,
  uid: string,
  clubId: string,
  extra: (club: FanClubRecord) => DocumentReference[] = () => [],
): Promise<VisibleClub> {
  const [clubSnap, blockList] = await db.getAll(fanClubRef(db, clubId), blockListRef(db, uid));
  if (!clubSnap!.exists) throw fanClubNotFound();
  const club = fanClubRecord(clubSnap!.id, clubSnap!.data() ?? {});
  if (club.status !== 'active' || club.ownerUid === null || club.name === null) {
    throw fanClubNotFound();
  }
  const blocked = blockedOf(blockList!.get('blocked'));
  if (blocked.includes(club.ownerUid)) throw fanClubNotFound();
  const [artistSnap, privateDoc, ...rest] = await db.getAll(
    artistRef(db, club.artistId),
    artistPrivateRef(db, club.artistId),
    ...extra(club),
  );
  const artist = artistOf(artistSnap);
  if (!isPublished(artist) || !fanClubBoxes(privateDoc!.data()).enabled) throw fanClubNotFound();
  return { club, artist, blocked, extra: rest };
}

/**
 * A publicação no ar e o fã-clube dela como quem pede os vê (seção 37,
 * 37.3), fora de transação: a publicação e, com o fã-clube dela, o
 * `readVisibleClub` com o `extra` de quem chama. A que não existe, fora do ar
 * ou de fã-clube que quem pede não vê é 404 `fan_club_post_not_found`, o mesmo
 * nos três casos.
 */
export async function readVisiblePost(
  db: Firestore,
  uid: string,
  postId: string,
  extra: (club: FanClubRecord) => DocumentReference[] = () => [],
): Promise<VisibleClub & { post: FanClubPostRecord }> {
  const snap = await fanClubPostRef(db, postId).get();
  const post = snap.exists ? fanClubPostRecord(snap.id, snap.data() ?? {}) : null;
  if (post === null || post.status !== 'published' || !isContentId(post.clubId)) {
    throw fanClubPostNotFound();
  }
  try {
    return { post, ...(await readVisibleClub(db, uid, post.clubId, extra)) };
  } catch (error) {
    if (error instanceof FanClubError && error.reason === 'fan_club_not_found') {
      throw fanClubPostNotFound();
    }
    throw error;
  }
}

/**
 * `GET /fan-club-posts/:postId` (seção 37, 37.3): a publicação no ar com as
 * condições da página (`readVisiblePost`), com o vínculo de quem pede com a
 * central (`isMember`) e com o fã-clube (`isFollowing`) e a reação dele, lidos
 * junto do artista; os contadores, as marcações, o `isOwner` e o nome do
 * artista. Fora do ar, de fã-clube que quem pede não vê ou que não existe:
 * 404 `fan_club_post_not_found`.
 */
export async function readFanClubPost(
  db: Firestore,
  uid: string,
  postId: string,
): Promise<FanClubPostDetails> {
  const { post, club, artist, extra } = await readVisiblePost(db, uid, postId, (visible) => [
    membershipRef(db, uid, visible.artistId),
    fanClubFollowRef(db, uid, visible.id),
    fanClubReactionRef(db, uid, postId),
  ]);
  const [membership, follow, reaction] = extra;
  return {
    ...publicPostView(
      post,
      club,
      reaction?.exists ? fanClubReactionOf(reaction.get('reaction')) : null,
    ),
    isOwner: club.ownerUid === uid,
    isFollowing: follow?.exists === true,
    isMember: membership?.exists === true,
    artistName: artist.name,
  };
}

/** A publicação de uma ação (a reação e o comentário), lida na transação. */
export type ActionPost = {
  post: FanClubPostRecord;
  club: FanClubRecord & { ownerUid: string };
  /** Quem age é o gestor do fã-clube (o `ownerUid`; o gestor não segue o próprio, 37.12). */
  isOwner: boolean;
  /** Os fãs que quem age bloqueou. */
  blocked: string[];
  /** O que quem chama pediu junto da publicação, na mesma ordem. */
  extra: DocumentSnapshot[];
};

/**
 * O que reagir e comentar pedem (seção 37, 37.3 e 37.6), na transação do
 * runIdempotent, nesta ordem: a publicação no ar e o fã-clube visível para
 * quem age (ativo, de artista no ar e com o fã-clube aberto, de gestor que ele
 * não bloqueou; senão, 404 `fan_club_post_not_found`, o mesmo do `GET`); e
 * seguir o fã-clube ou ser o gestor dele (senão, 409 `not_following`, decisão
 * 10 de 36.1). Três rodadas de leitura: a publicação com o `extra` de quem
 * chama; o fã-clube, a lista de bloqueios e o vínculo de seguir; o artista e o
 * `artistPrivate`. Só leituras (quem chama grava depois de ler tudo). Com o
 * `follow: false` (a denúncia de comentário, que é de quem vê, 37.6), o
 * vínculo não é lido nem exigido.
 */
export async function readActionPost(
  tx: Transaction,
  db: Firestore,
  uid: string,
  postId: string,
  extra: DocumentReference[] = [],
  options: { follow: boolean } = { follow: true },
): Promise<ActionPost> {
  const [postSnap, ...rest] = await tx.getAll(fanClubPostRef(db, postId), ...extra);
  const post = postSnap!.exists ? fanClubPostRecord(postSnap!.id, postSnap!.data() ?? {}) : null;
  if (post === null || post.status !== 'published' || !isContentId(post.clubId)) {
    throw fanClubPostNotFound();
  }
  const [clubSnap, blockList, follow] = await tx.getAll(
    fanClubRef(db, post.clubId),
    blockListRef(db, uid),
    ...(options.follow ? [fanClubFollowRef(db, uid, post.clubId)] : []),
  );
  const club = clubSnap!.exists ? fanClubRecord(clubSnap!.id, clubSnap!.data() ?? {}) : null;
  if (
    club === null ||
    club.status !== 'active' ||
    club.ownerUid === null ||
    club.name === null ||
    club.artistId === ''
  ) {
    throw fanClubPostNotFound();
  }
  const owned = club as FanClubRecord & { ownerUid: string };
  const blocked = blockedOf(blockList!.get('blocked'));
  if (blocked.includes(owned.ownerUid)) throw fanClubPostNotFound();
  const [artistSnap, privateDoc] = await tx.getAll(
    artistRef(db, owned.artistId),
    artistPrivateRef(db, owned.artistId),
  );
  if (!isPublished(artistOf(artistSnap)) || !fanClubBoxes(privateDoc!.data()).enabled) {
    throw fanClubPostNotFound();
  }
  const isOwner = owned.ownerUid === uid;
  if (options.follow && !isOwner && !follow!.exists) throw fanClubRefused('not_following');
  return { post, club: owned, isOwner, blocked, extra: rest };
}

export type PostsQuery = { limit: number; cursor: PageCursor | null };

/**
 * `GET /fan-clubs/:clubId/posts`: as publicações no ar do fã-clube que quem
 * pede pode ver (`readVisibleClub`), da mais nova para a mais antiga, pelo
 * `publishedAt` e o id (o índice `clubId`, `status`, `publishedAt`), com a
 * reação de quem pede em cada uma, num `getAll` a mais (seção 37, 37.3).
 */
export async function readFanClubPosts(
  db: Firestore,
  uid: string,
  clubId: string,
  query: PostsQuery,
): Promise<Page<FanClubPost>> {
  const { club } = await readVisibleClub(db, uid, clubId);
  let list = fanClubPostsOf(db)
    .where('clubId', '==', clubId)
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');
  if (query.cursor) list = list.startAfter(tsOf(query.cursor.at), query.cursor.id);
  const snap = await list.limit(query.limit + 1).get();
  const posts = snap.docs.slice(0, query.limit).map((doc) => fanClubPostRecord(doc.id, doc.data()));
  const reactions = await readReactionsOf(
    db,
    uid,
    posts.map((post) => post.id),
  );
  const last = posts.at(-1);
  return {
    items: posts.map((post) => publicPostView(post, club, reactions.get(post.id) ?? null)),
    nextCursor:
      snap.size > query.limit && last
        ? encodePageCursor({ at: last.publishedAt ?? last.submittedAt, id: last.id })
        : null,
  };
}

/**
 * `GET /me/fan-club/posts`: as publicações de quem pede, em todos os status,
 * da mais nova para a mais antiga, pelo `submittedAt` e o id (o índice
 * `authorUid`, `submittedAt`). Sem o perfil exigido: quem nunca publicou
 * recebe a página vazia.
 */
export async function readMyFanClubPosts(
  db: Firestore,
  uid: string,
  query: PostsQuery,
): Promise<Page<OwnFanClubPost>> {
  let list = fanClubPostsOfAuthor(db, uid)
    .orderBy('submittedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');
  if (query.cursor) list = list.startAfter(tsOf(query.cursor.at), query.cursor.id);
  const snap = await list.limit(query.limit + 1).get();
  const posts = snap.docs.slice(0, query.limit).map((doc) => fanClubPostRecord(doc.id, doc.data()));
  const last = posts.at(-1);
  return {
    items: posts.map(ownPostView),
    nextCursor:
      snap.size > query.limit && last
        ? encodePageCursor({ at: last.submittedAt, id: last.id })
        : null,
  };
}

// --- Publicar ---------------------------------------------------------------------------

type PublishContext = {
  club: FanClubRecord;
  clubRef: DocumentReference;
};

/**
 * O que publicar pede (34.5), na transação, nesta ordem: a candidatura
 * aprovada e o fã-clube dela, ativo e do fã (`club_not_active`); o vínculo com
 * a central (`not_member`); o artista no ar e com o fã-clube aberto
 * (`artist_closed`); com foto, o `photosAllowed` (`photos_not_allowed`); a
 * versão do regulamento aceita (`rules_outdated`); e menos de 3 em análise
 * (`too_many_pending`). Duas rodadas de leitura: a candidatura; o fã-clube, o
 * vínculo, o artista e o `artistPrivate`. A vaga de envio pede o mesmo, com
 * foto: abrir uma vaga para uma publicação que seria recusada só gastaria o
 * teto do dia.
 */
async function readPublishContext(
  tx: Transaction,
  db: Firestore,
  uid: string,
  photo: boolean,
): Promise<PublishContext> {
  const application = await tx.get(applicationRef(db, uid));
  const record = application.exists ? applicationRecord(uid, application.data() ?? {}) : null;
  if (record?.status !== 'approved' || record.clubId === null) {
    throw fanClubRefused('club_not_active');
  }
  const clubRef = fanClubRef(db, record.clubId);
  const [clubSnap, membership, artistSnap, privateDoc] = await tx.getAll(
    clubRef,
    membershipRef(db, uid, record.artistId),
    artistRef(db, record.artistId),
    artistPrivateRef(db, record.artistId),
  );
  const club = clubSnap!.exists ? fanClubRecord(clubSnap!.id, clubSnap!.data() ?? {}) : null;
  if (
    club === null ||
    club.ownerUid !== uid ||
    club.status !== 'active' ||
    club.artistId !== record.artistId
  ) {
    throw fanClubRefused('club_not_active');
  }
  if (!membership!.exists) throw fanClubRefused('not_member');
  const boxes = fanClubBoxes(privateDoc!.data());
  if (!isPublished(artistOf(artistSnap)) || !boxes.enabled) throw fanClubRefused('artist_closed');
  if (photo && !boxes.photosAllowed) throw fanClubRefused('photos_not_allowed');
  if (record.rulesVersion !== FAN_CLUB_RULES_VERSION) throw fanClubRefused('rules_outdated');
  if (club.pendingPosts >= FAN_CLUB_PENDING_MAX) throw fanClubRefused('too_many_pending');
  return { club, clubRef };
}

/**
 * `POST /me/fan-club/upload` (34.3), na transação do runIdempotent: o que
 * publicar com foto pede (`readPublishContext`); o teto `fanclub_upload`; e a
 * vaga nova em `users/{uid}/uploads/fanClubPost`, com os dois nomes de um id
 * sorteado (`club-photo-<id>.jpg` e `club-thumb-<id>.jpg`) e o prazo de 10
 * minutos, no molde do `POST /me/photo/upload` (27.4). Uma vaga por fã: a nova
 * troca a de antes, e os arquivos da de antes, que não viraram publicação (a
 * publicação apaga a vaga), saem depois da transação (`stale`).
 */
export async function openFanClubUpload(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext },
): Promise<{ body: FanClubUploadSlot; plan: AwardPlan; stale: string[] }> {
  const { fan, award } = options;
  await readPublishContext(tx, db, fan.uid, true);
  const slotRef = fanClubUploadSlotRef(db, fan.uid);
  const slot = await tx.get(slotRef);
  enforceDailyCap(fan, award, 'club_upload');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  countDailyAction(plan, fan, award, 'club_upload');
  const names = slotFileNames(randomUUID());
  const folder = fanClubMediaFolder(fan.uid);
  const expiresAt = award.now + FAN_CLUB_UPLOAD_SLOT_MS;
  tx.set(slotRef, {
    fileNames: [names.photo, names.thumb],
    expiresAt: tsOf(expiresAt),
    createdAt: tsOf(award.now),
    schemaVersion: 1,
  });
  const previous = slot.exists ? slotNamesOf(slot.get('fileNames')) : null;
  return {
    body: {
      photoPath: folder + names.photo,
      thumbPath: folder + names.thumb,
      expiresAt: iso(expiresAt),
    },
    plan,
    stale: previous ? [folder + previous.photo, folder + previous.thumb] : [],
  };
}

/** A foto ou a miniatura fora do teto: 400 `fan_club_invalid`, com o problema dos bytes. */
const imageInvalid = (field: 'photo' | 'thumb', problem: PhotoProblem) =>
  new FanClubError('fan_club_invalid', { field, reason: 'format', problem });

/**
 * A foto e a miniatura da vaga, conferidas no Storage como a foto do perfil
 * (24.4), nesta ordem, a foto antes da miniatura: as duas existem
 * (`upload_missing`); os metadados (o tipo e o tamanho); os bytes do começo
 * (o JPEG pelo `FF D8 FF` e o lado pelo SOF), com os tetos da decisão 15; a
 * miniatura com a proporção da foto (`dimensions`: a dupla que não é da mesma
 * imagem, a equipe revisa as duas); e a URL de download com token.
 */
async function readPostMedia(
  files: FanPhotoFiles,
  photoPath: string,
  thumbPath: string,
): Promise<PostMedia> {
  const paths = { photo: photoPath, thumb: thumbPath };
  const limits: Record<'photo' | 'thumb', PhotoLimits> = {
    photo: CLUB_PHOTO_LIMITS,
    thumb: CLUB_THUMB_LIMITS,
  };
  const fields = ['photo', 'thumb'] as const;
  const described = await Promise.all(fields.map((field) => files.describe(paths[field])));
  if (described.some((file) => file === null)) throw fanClubRefused('upload_missing');
  fields.forEach((field, index) => {
    const problem = photoProblem(described[index]!, undefined, limits[field]);
    if (problem) throw imageInvalid(field, problem);
  });
  const heads = await Promise.all(
    fields.map((field) => files.readStart(paths[field], PHOTO_HEAD_BYTES)),
  );
  fields.forEach((field, index) => {
    const problem = photoProblem(described[index]!, heads[index], limits[field]);
    if (problem) throw imageInvalid(field, problem);
  });
  if (!sameProportion(jpegDimensions(heads[0]!)!, jpegDimensions(heads[1]!)!)) {
    throw imageInvalid('thumb', 'dimensions');
  }
  const urls = await Promise.all(fields.map((field) => files.downloadUrl(paths[field])));
  const image = (index: number): PostImage => {
    const size = jpegDimensions(heads[index]!)!;
    return { url: urls[index]!, path: paths[fields[index]!], ...size };
  };
  return { photo: image(0), thumb: image(1) };
}

/**
 * `POST /me/fan-club/posts` (34.5), na transação do runIdempotent, com o corpo
 * já conferido (`parsePost`): o que publicar pede (`readPublishContext`); as
 * marcações do texto (seção 37, 37.7), com as reservas dos @ e as centrais
 * delas, e o filtro `fanClubPost` de novo, com o "@" tirado só dos resolvidos
 * (barrado: 400 `fan_club_invalid` com `not_allowed`, sem gravar nada); o
 * teto `fanclub_post`; com foto, a vaga (`upload_missing` sem ela ou vencida)
 * e os dois arquivos (`readPostMedia`), lidos antes de qualquer gravação, como
 * no `PUT /me/photo`; o `planAwards` sem entradas; e grava a publicação em
 * análise, com as cópias do perfil, as marcações (as `mentions` e os
 * `mentionUids`), o `pendingPosts` mais 1 e, com foto, apaga a vaga. Toda
 * publicação nasce em análise (decisão 16).
 */
export async function createFanClubPost(
  tx: Transaction,
  db: Firestore,
  files: FanPhotoFiles,
  options: { fan: FanContext; award: AwardContext; profile: DocumentSnapshot; input: PostInput },
): Promise<{ body: OwnFanClubPost; plan: AwardPlan }> {
  const { fan, award, profile, input } = options;
  const context = await readPublishContext(tx, db, fan.uid, input.photo);
  // As marcações do texto (seção 37, 37.7), resolvidas no envio; a revisão
  // da equipe vê o texto e os marcados. O filtro de novo, com o "@" tirado só
  // dos resolvidos.
  const tokens = findMentionTokens(input.text);
  const targets = await readMentionTargets(tx, db, mentionHandles(tokens));
  if (isBlockedWithMentions(input.text, tokens, targets, 'fanClubPost')) {
    throw fanClubInvalid('text', 'not_allowed');
  }
  const { mentions, mentionUids } = resolvedMentions(tokens, targets);
  enforceDailyCap(fan, award, 'club_post');
  const slotRef = fanClubUploadSlotRef(db, fan.uid);
  let media: PostMedia | null = null;
  if (input.photo) {
    const slot = await tx.get(slotRef);
    const names = slot.exists ? slotNamesOf(slot.get('fileNames')) : null;
    const expiresAt = slot.exists ? millisOf(slot.get('expiresAt')) : null;
    if (names === null || expiresAt === null || award.now > expiresAt) {
      throw fanClubRefused('upload_missing');
    }
    const folder = fanClubMediaFolder(fan.uid);
    media = await readPostMedia(files, folder + names.photo, folder + names.thumb);
  }
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  countDailyAction(plan, fan, award, 'club_post');

  const at = tsOf(award.now);
  const copies = ownerCopiesOf(profile.data() ?? {});
  const ref = fanClubPostsOf(db).doc();
  const record: FanClubPostRecord = {
    id: ref.id,
    clubId: context.club.id,
    artistId: context.club.artistId,
    authorUid: fan.uid,
    authorName: copies.name,
    authorUsername: copies.username,
    authorPhotoURL: copies.photoURL,
    kind: media ? 'photo' : 'text',
    text: input.text,
    media,
    status: 'pending',
    rejectReason: null,
    submittedAt: award.now,
    publishedAt: null,
    reviewedAt: null,
    reactionCount: 0,
    reactionCounts: emptyReactionCounts(),
    commentCount: 0,
    mentions,
  };
  tx.create(ref, {
    clubId: record.clubId,
    artistId: record.artistId,
    authorUid: record.authorUid,
    authorName: record.authorName,
    authorUsername: record.authorUsername,
    authorPhotoURL: record.authorPhotoURL,
    kind: record.kind,
    text: record.text,
    mentions,
    mentionUids,
    media,
    status: 'pending',
    rejectReason: null,
    submittedAt: at,
    publishedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    schemaVersion: 1,
  });
  tx.update(context.clubRef, { pendingPosts: context.club.pendingPosts + 1, updatedAt: at });
  if (media) tx.delete(slotRef);
  return { body: ownPostView(record), plan };
}

/**
 * `DELETE /me/fan-club/posts/:postId` (34.5, desfazer: o suspenso também
 * retira), na transação do runIdempotent: a publicação e o item dela na fila
 * de denúncias num `getAll`; a que não existe, de outro autor ou em outro
 * status é 404 `fan_club_post_not_found`. A em análise vira `withdrawn`, com
 * o `pendingPosts` menos 1 e os arquivos apagados depois da transação; a no
 * ar vira `removed`, com o `postCount` menos 1 e os tokens trocados depois da
 * transação (os arquivos ficam com a equipe, decisão 20). O item aberto da
 * fila vai a `resolved` com `withdrawn`. O registro não é apagado nem editado.
 */
export async function removeFanClubPost(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; postId: string },
): Promise<{ body: OwnFanClubPost; plan: AwardPlan; work: StorageWork }> {
  const { fan, award, postId } = options;
  const postRef = fanClubPostRef(db, postId);
  const [postSnap, item] = await tx.getAll(postRef, fanClubReportQueueRef(db, postId));
  if (!postSnap!.exists) throw fanClubPostNotFound();
  const post = fanClubPostRecord(postSnap!.id, postSnap!.data() ?? {});
  if (post.authorUid !== fan.uid || (post.status !== 'pending' && post.status !== 'published')) {
    throw fanClubPostNotFound();
  }
  const clubSnap = await tx.get(fanClubRef(db, post.clubId));
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  const at = tsOf(award.now);
  const club = clubSnap.exists ? fanClubRecord(clubSnap.id, clubSnap.data() ?? {}) : null;
  const pending = post.status === 'pending';
  const next: FanClubPostStatus = pending ? 'withdrawn' : 'removed';
  if (club) {
    tx.update(
      clubSnap.ref,
      pending
        ? { pendingPosts: Math.max(0, club.pendingPosts - 1), updatedAt: at }
        : { postCount: Math.max(0, club.postCount - 1), updatedAt: at },
    );
  }
  tx.update(postRef, { status: next });
  if (item!.exists && item!.get('status') === 'open') {
    tx.update(item!.ref, {
      status: 'resolved',
      resolution: 'withdrawn',
      resolvedAt: at,
      resolvedBy: null,
    });
  }
  const paths = postMediaPaths(post);
  return {
    body: ownPostView({ ...post, status: next }),
    plan,
    work: pending ? { remove: paths, rotate: [] } : { remove: [], rotate: paths },
  };
}

/** Publicar fora da API (o seed dos emuladores), com o ator dado (o de sistema não conta no teto). */
export function runCreateFanClubPost(
  db: Firestore,
  files: FanPhotoFiles,
  uid: string,
  input: PostInput,
  options: RunOptions,
): Promise<{ body: OwnFanClubPost; plan: AwardPlan }> {
  return runAsFan(db, uid, options, (tx, fan, award, profile) =>
    createFanClubPost(tx, db, files, { fan, award, profile, input }),
  );
}

/** Abrir a vaga fora da API (o seed dos emuladores), com o ator dado. */
export function runOpenFanClubUpload(
  db: Firestore,
  uid: string,
  options: RunOptions,
): Promise<{ body: FanClubUploadSlot; plan: AwardPlan; stale: string[] }> {
  return runAsFan(db, uid, options, (tx, fan, award) => openFanClubUpload(tx, db, { fan, award }));
}

// --- A exclusão de conta (34.7) ---------------------------------------------------------

/** Publicações por página (e por transação) na exclusão de conta. */
export const POSTS_DELETE_PAGE = 100;

/**
 * Os comentários e as reações de uma publicação do gestor que sai na exclusão
 * de conta (seção 37, 37.8, passo 5), antes dela: por `postId`, pela ordem do
 * id, em páginas de 100, cada uma numa transação que relê. O comentário sai, e
 * o item aberto da fila dele vai a `resolved` com `removed` (o de um
 * comentário do próprio gestor, que o passo dos comentários dele já costuma
 * ter levado, com `author_deleted`); a reação sai. Sem contadores: a
 * publicação sai logo depois, e o fã-clube dela já é lápide (nenhum
 * comentário nem reação novos chegam). Apagar a publicação antes deixaria os
 * dois sem nada que os achasse na nova tentativa do gatilho.
 */
async function removePostEngagement(
  db: Firestore,
  postId: string,
  uid: string,
  now: number,
): Promise<void> {
  const at = tsOf(now);
  const comments = fanClubCommentsOf(db)
    .where('postId', '==', postId)
    .orderBy(FieldPath.documentId())
    .limit(POSTS_DELETE_PAGE);
  for (;;) {
    const snap = await comments.get();
    if (snap.empty) break;
    const refs = snap.docs.map((doc) => doc.ref);
    const count = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(
        ...refs,
        ...refs.map((ref) => fanClubCommentQueueRef(db, ref.id)),
      );
      let deleted = 0;
      refs.forEach((ref, index) => {
        const comment = snaps[index]!;
        if (!comment.exists) return;
        tx.delete(ref);
        deleted += 1;
        const item = snaps[refs.length + index]!;
        if (item.exists && item.get('status') === 'open') {
          tx.update(item.ref, {
            status: 'resolved',
            resolution: comment.get('authorUid') === uid ? 'author_deleted' : 'removed',
            resolvedAt: at,
            resolvedBy: null,
          });
        }
      });
      return deleted;
    });
    if (count === 0 && snap.size < POSTS_DELETE_PAGE) break;
  }
  const reactions = fanClubReactionsOf(db)
    .where('postId', '==', postId)
    .orderBy(FieldPath.documentId())
    .limit(POSTS_DELETE_PAGE);
  for (;;) {
    const snap = await reactions.get();
    if (snap.empty) break;
    const count = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...snap.docs.map((doc) => doc.ref));
      let deleted = 0;
      for (const reaction of snaps) {
        if (!reaction.exists) continue;
        tx.delete(reaction.ref);
        deleted += 1;
      }
      return deleted;
    });
    if (count === 0 && snap.size < POSTS_DELETE_PAGE) break;
  }
}

/**
 * As publicações do fã na exclusão de conta (34.7, passo 3), em páginas de
 * 100, cada uma numa transação que relê cada publicação e o item dela na fila
 * de denúncias: a publicação sai, e o item aberto vai a `resolved` com
 * `author_deleted` (as denúncias contra ela ficam: são de quem denunciou). Os
 * arquivos saem com a pasta, no `purgeFanPhotos` do fim. Desde a Fase 2
 * (seção 37, 37.8, passo 5), antes de cada página sair, os comentários e as
 * reações de cada publicação dela (`removePostEngagement`): a publicação só
 * sai quando eles já saíram. Devolve quantas saíram.
 */
export async function removeFanClubPostsOf(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await fanClubPostsOfAuthor(db, uid).limit(POSTS_DELETE_PAGE).get();
    if (snap.empty) return removed;
    const refs = snap.docs.map((doc) => doc.ref);
    for (const ref of refs) await removePostEngagement(db, ref.id, uid, now);
    const count = await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(
        ...refs,
        ...refs.map((ref) => fanClubReportQueueRef(db, ref.id)),
      );
      let deleted = 0;
      refs.forEach((ref, index) => {
        if (!snaps[index]!.exists) return;
        tx.delete(ref);
        deleted += 1;
        const item = snaps[refs.length + index]!;
        if (item.exists && item.get('status') === 'open') {
          tx.update(item.ref, {
            status: 'resolved',
            resolution: 'author_deleted',
            resolvedAt: tsOf(now),
            resolvedBy: null,
          });
        }
      });
      return deleted;
    });
    removed += count;
    // Nada saiu (outra entrega da exclusão levou tudo no meio): a seguinte vê vazio.
    if (count === 0 && snap.size < POSTS_DELETE_PAGE) return removed;
  }
}
