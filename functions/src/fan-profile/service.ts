import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { removeFiles, type LeftoverFile } from '../artists/files';
import { countDailyAction, enforceDailyCap } from '../moderation/caps';
import { planAwards, type AwardContext, type AwardPlan, type FanContext } from '../points/award';
import { randomDigits, usernameCandidates, type RandomDigits } from '../profile';
import { isMissingBucket, type FanPhotoFiles } from './files';
import {
  authorCopies,
  copiesDiffer,
  FAN_PHOTO_DELETE_BATCH,
  fanPhotoFolder,
  type FolderFile,
  nextUsernameChange,
  normalizeUsername,
  parseFanPhotoPath,
  PHOTO_HEAD_BYTES,
  photoProblem,
  photoTooOld,
  PROFILE_SYNC_PAGE,
  ProfileEditError,
  stalePhotoFiles,
  usernameChangeAllowed,
  usernameRefusal,
  UsernameReleaseError,
  USERNAME_PATTERN,
} from './model';

// O perfil editável do fã no Firestore e no Storage (bloco 9): a troca do @
// (as duas reservas e o perfil numa transação), a foto conferida e gravada
// pela API, a limpeza da foto trocada, a tarefa que acerta as cópias do nome e
// da foto nos comentários e varre a pasta, e a pasta que sai na exclusão de
// conta. docs/arquitetura-api.md, 24.4, 24.7 e 24.11.

type Log = Pick<typeof logger, 'info' | 'warn' | 'error'>;

/** Arquivos que sobraram listados no log (o resto vai só na contagem). */
const LEFTOVERS_LOGGED = 20;

export type UsernameStatus = 'available' | 'current' | 'taken' | 'invalid' | 'reserved';
export type UsernameAvailability = { username: string; status: UsernameStatus };
export type UsernameChange = {
  username: string;
  changedAt: string | null;
  changeableAt: string | null;
};
export type PhotoChange = { photoURL: string | null };

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const millis = (value: unknown): number | null =>
  value instanceof Timestamp ? value.toMillis() : null;

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

const profileRef = (db: Firestore, uid: string) => db.collection('users').doc(uid);
const usernameRef = (db: Firestore, username: string) => db.collection('usernames').doc(username);

/** A reserva é deste fã (a de uma central não tem `uid`). */
const reservedBy = (reservation: DocumentSnapshot, uid: string): boolean =>
  reservation.exists && reservation.get('uid') === uid;

// --- @ ----------------------------------------------------------------------

/**
 * `GET /me/username/availability`: o status do @ normalizado. Fora do formato,
 * sem leitura; senão uma leitura da reserva. É um retrato: o `PUT` confere
 * tudo de novo na transação. O @ de agora (também o automático) é `current`.
 */
export async function readUsernameAvailability(
  db: Firestore,
  uid: string,
  raw: string,
): Promise<UsernameAvailability> {
  const username = normalizeUsername(raw);
  if (!USERNAME_PATTERN.test(username)) return { username, status: 'invalid' };
  const reservation = await usernameRef(db, username).get();
  if (reservedBy(reservation, uid)) return { username, status: 'current' };
  if (usernameRefusal(username)) return { username, status: 'reserved' };
  return { username, status: reservation.exists ? 'taken' : 'available' };
}

/**
 * `PUT /me/username` (24.4), dentro do runIdempotent: o @ de agora e o prazo
 * saem do retrato do perfil que ele já leu. O @ igual ao de agora responde o
 * de agora, sem gravar e sem mexer no prazo. Senão: reservado ou automático
 * (400), antes do prazo (409), de outro fã ou de uma central (409); e grava a
 * reserva nova, apaga a antiga (só a deste fã) e o perfil, juntos.
 */
export async function changeUsername(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; profile: DocumentSnapshot; username: string },
): Promise<UsernameChange> {
  const { fan, award, profile, username } = options;
  const current = text(profile.get('username'));
  const changeableAt = millis(profile.get('usernameChangeableAt'));
  if (username === current) {
    return {
      username,
      changedAt: iso(millis(profile.get('usernameChangedAt'))),
      changeableAt: iso(changeableAt),
    };
  }
  const refusal = usernameRefusal(username);
  if (refusal) throw new ProfileEditError('username_invalid', { reason: refusal });
  if (!usernameChangeAllowed(changeableAt, award.now)) {
    throw new ProfileEditError('username_change_too_soon', { changeableAt: iso(changeableAt) });
  }

  const nextRef = usernameRef(db, username);
  const currentRef = current ? usernameRef(db, current) : null;
  const [next, old] = await tx.getAll(nextRef, ...(currentRef ? [currentRef] : []));
  // A reserva nova com o uid deste fã é sobra de uma falha antiga: segue sem criar.
  if (next!.exists && !reservedBy(next!, fan.uid)) throw new ProfileEditError('username_taken');

  const changeable = nextUsernameChange(award.now);
  if (!next!.exists) {
    tx.create(nextRef, { uid: fan.uid, createdAt: Timestamp.fromMillis(award.now) });
  }
  // Só a reserva deste fã sai: a de uma central nunca.
  if (currentRef && old && reservedBy(old, fan.uid)) tx.delete(currentRef);
  tx.update(profileRef(db, fan.uid), {
    username,
    usernameChangedAt: Timestamp.fromMillis(award.now),
    usernameChangeableAt: Timestamp.fromMillis(changeable),
  });
  return { username, changedAt: iso(award.now), changeableAt: iso(changeable) };
}

export type UsernameRelease = { uid: string; previous: string; username: string };

/**
 * O núcleo da liberação do @ de um fã, na transação de quem chama (o script
 * pelo `releaseUsername`, a callable `resetFanUsername` do painel, bloco 11):
 * troca o fã para um automático novo (o primeiro livre entre os candidatos do
 * gerador), sem prazo (`usernameChangeableAt: null`), e apaga a reserva
 * antiga, que fica livre na hora. Recusa sem gravar a reserva que não existe,
 * a de uma central, a que não é o @ de agora do perfil e, com `uid`, a de
 * outro fã. Não mexe no `usernameChangedAt`, que é das trocas do fã. Só lê
 * antes de gravar: quem chama lê o que precisa antes e grava depois.
 */
export async function releaseUsernameIn(
  tx: Transaction,
  db: Firestore,
  raw: string,
  options: { now: number; random?: RandomDigits; uid?: string },
): Promise<UsernameRelease> {
  const username = normalizeUsername(raw);
  const random = options.random ?? randomDigits;
  const reservationRef = usernameRef(db, username);
  const reservation = await tx.get(reservationRef);
  if (!reservation.exists) throw new UsernameReleaseError('not_found');
  const uid = reservation.get('uid');
  if (typeof uid !== 'string') throw new UsernameReleaseError('central');
  if (options.uid !== undefined && uid !== options.uid) throw new UsernameReleaseError('mismatch');
  const fanRef = profileRef(db, uid);
  const candidates = usernameCandidates('fa', random).map((name) => usernameRef(db, name));
  const [profile, ...taken] = await tx.getAll(fanRef, ...candidates);
  if (!profile!.exists || profile!.get('username') !== username) {
    throw new UsernameReleaseError('mismatch');
  }
  const free = taken.find((snapshot) => !snapshot.exists);
  // Só acontece com todos os sorteados tomados: rodar de novo sorteia outros.
  if (!free) throw new Error('Nenhum @ automático livre entre os candidatos.');
  tx.create(free.ref, { uid, createdAt: Timestamp.fromMillis(options.now) });
  tx.delete(reservationRef);
  tx.update(fanRef, { username: free.id, usernameChangeableAt: null });
  return { uid, previous: username, username: free.id };
}

/**
 * Libera o @ de um fã para uma central (decisão 17): o `releaseUsernameIn`
 * numa transação própria do Admin SDK. Quem chama é o
 * `scripts/release-fan-username.mjs`, que desde o bloco 11 fica para
 * emergência (não audita): a equipe usa o `resetFanUsername` do painel.
 */
export function releaseUsername(
  db: Firestore,
  raw: string,
  options: { now?: number; random?: RandomDigits } = {},
): Promise<UsernameRelease> {
  const now = options.now ?? Date.now();
  return db.runTransaction((tx) =>
    releaseUsernameIn(tx, db, raw, { now, ...(options.random ? { random: options.random } : {}) }),
  );
}

// --- Foto ---------------------------------------------------------------------

/**
 * `PUT /me/photo` (24.4), dentro do runIdempotent: o caminho tem de ser da
 * pasta de quem chama; o mesmo caminho da foto de agora responde a URL de
 * agora, sem gravar e sem contar no teto. Depois o teto do dia (antes de ler
 * o Storage), o arquivo (existe, recente, depois da última troca, JPEG pelos
 * bytes, até 1 MiB e até 1024 de lado) e a URL de download. Grava `photoURL`,
 * `photoPath` e `photoUpdatedAt`; a foto anterior sai pelo gatilho do perfil.
 * O plano sempre parte do `fan` de quem chama (o seed também passa por aqui).
 */
export async function setFanPhoto(
  tx: Transaction,
  db: Firestore,
  files: FanPhotoFiles,
  options: {
    fan: FanContext;
    award: AwardContext;
    profile: DocumentSnapshot;
    path: string;
    log?: Log;
  },
): Promise<{ body: PhotoChange; plan: AwardPlan }> {
  const { fan, award, profile, path } = options;
  const log = options.log ?? logger;
  const parsed = parseFanPhotoPath(path);
  if (!parsed || parsed.uid !== fan.uid) {
    throw new ProfileEditError('photo_invalid', { reason: 'path' });
  }
  if (text(profile.get('photoPath')) === path) {
    const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
    return { body: { photoURL: text(profile.get('photoURL')) }, plan };
  }
  enforceDailyCap(fan, award, 'photo');

  // As leituras do Storage vêm antes de qualquer gravação da transação, e a
  // repetição pela mesma chave nem chega aqui (devolve a resposta guardada).
  const file = await files.describe(path);
  if (!file || photoTooOld(file, millis(profile.get('photoUpdatedAt')), award.now)) {
    throw new ProfileEditError('photo_not_found');
  }
  const problem =
    photoProblem(file) ?? photoProblem(file, await files.readStart(path, PHOTO_HEAD_BYTES));
  if (problem) throw new ProfileEditError('photo_invalid', { reason: problem });
  let photoURL: string;
  try {
    photoURL = await files.downloadUrl(path);
  } catch (error) {
    // Arquivo sem token de download (subido por fora do SDK do cliente): 500.
    log.error('fan-profile: a foto não tem URL de download', {
      uid: fan.uid,
      path,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [] }], award);
  countDailyAction(plan, fan, award, 'photo');
  tx.update(profileRef(db, fan.uid), {
    photoURL,
    photoPath: path,
    photoUpdatedAt: Timestamp.fromMillis(award.now),
  });
  return { body: { photoURL }, plan };
}

/**
 * `DELETE /me/photo`: tira a foto do perfil (o arquivo sai pelo gatilho).
 * Sem foto, a mesma resposta, sem gravar. Nunca é recusado pelo teto.
 */
export function removeFanPhoto(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext; profile: DocumentSnapshot },
): PhotoChange {
  const { fan, award, profile } = options;
  if (!text(profile.get('photoURL')) && !text(profile.get('photoPath'))) return { photoURL: null };
  tx.update(profileRef(db, fan.uid), {
    photoURL: null,
    photoPath: null,
    photoUpdatedAt: Timestamp.fromMillis(award.now),
  });
  return { photoURL: null };
}

/**
 * O gatilho do perfil, com a foto trocada ou tirada: apaga o arquivo antigo se
 * ele não voltou a ser a foto (o perfil é relido). O caminho passa pelo
 * `parseFanPhotoPath` e precisa ser da pasta do próprio uid; fora disso, só o
 * log, e nada é apagado.
 */
export async function removeReplacedPhoto(
  db: Firestore,
  files: Pick<FanPhotoFiles, 'remove'>,
  uid: string,
  oldPath: string,
  log: Log = logger,
): Promise<'removed' | 'kept' | 'invalid'> {
  const parsed = parseFanPhotoPath(oldPath);
  if (!parsed || parsed.uid !== uid) {
    log.error('fan-profile: foto antiga fora da pasta do fã', { uid, path: oldPath });
    return 'invalid';
  }
  const profile = await profileRef(db, uid).get();
  if (profile.exists && profile.get('photoPath') === oldPath) return 'kept';
  await files.remove(oldPath);
  return 'removed';
}

/**
 * Apaga os caminhos em lotes de `FAN_PHOTO_DELETE_BATCH`, um lote depois do
 * outro (cada lote pelo `removeFiles`: a falha de um arquivo não impede os
 * outros). Nunca lança: devolve os que ficaram.
 */
export async function removeInBatches(
  files: Pick<FanPhotoFiles, 'remove'>,
  paths: readonly string[],
  size: number = FAN_PHOTO_DELETE_BATCH,
): Promise<LeftoverFile[]> {
  const leftovers: LeftoverFile[] = [];
  for (let start = 0; start < paths.length; start += size) {
    leftovers.push(...(await removeFiles(files, paths.slice(start, start + size))));
  }
  return leftovers;
}

const warnMissingBucket = (log: Log, uid: string): void => {
  log.warn('fan-profile: o Storage não está ligado; a pasta do fã conta como vazia', { uid });
};

/**
 * Esvazia a pasta `fans/{uid}/`, arquivo por arquivo, em lotes. Sobrou
 * arquivo: lança, para quem chama (a exclusão de conta, a tarefa) tentar de
 * novo. O Storage ainda não ligado no projeto (`isMissingBucket`: o bucket que
 * não existe ou sem nome na configuração) conta como pasta vazia, senão a
 * exclusão repetiria sem parar. Devolve quantos arquivos havia.
 */
export async function purgeFanPhotos(
  files: Pick<FanPhotoFiles, 'list' | 'remove'>,
  uid: string,
  log: Log = logger,
): Promise<number> {
  let paths: string[];
  try {
    paths = await files.list(fanPhotoFolder(uid));
  } catch (error) {
    if (!isMissingBucket(error)) throw error;
    warnMissingBucket(log, uid);
    return 0;
  }
  const leftovers = await removeInBatches(files, paths);
  if (leftovers.length > 0) {
    log.error('fan-profile: arquivos da pasta do fã ficaram', {
      uid,
      count: leftovers.length,
      leftovers: leftovers.slice(0, LEFTOVERS_LOGGED),
    });
    throw new Error(`Ficaram ${leftovers.length} arquivo(s) na pasta do fã.`);
  }
  return paths.length;
}

export type FanProfileSyncResult = {
  /** O perfil não existe: a pasta foi esvaziada e nada mais. */
  deleted: boolean;
  /** Comentários do fã lidos. */
  read: number;
  /** Comentários com a cópia regravada. */
  updated: number;
  /** Arquivos que saíram da pasta. */
  removed: number;
};

/**
 * As cópias do nome e da foto nos comentários do fã (24.7, passo 2), em
 * páginas de 200. Cada página é uma transação que lê o perfil e a própria
 * página (uma leitura por comentário, mais o perfil) e regrava só os que estão
 * com a cópia diferente da do perfil lido ali. O perfil apagado no meio
 * (exclusão de conta) para sem gravar.
 */
async function syncCommentCopies(
  db: Firestore,
  uid: string,
): Promise<{ read: number; updated: number }> {
  const fanRef = profileRef(db, uid);
  const query = db
    .collectionGroup('postComments')
    .where('authorUid', '==', uid)
    .orderBy(FieldPath.documentId())
    .limit(PROFILE_SYNC_PAGE);
  let read = 0;
  let updated = 0;
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    const cursor: QueryDocumentSnapshot | null = last;
    const outcome = await db.runTransaction(async (tx) => {
      const profile = await tx.get(fanRef);
      if (!profile.exists) return null;
      const page: QuerySnapshot = await tx.get(cursor ? query.startAfter(cursor) : query);
      const fresh = authorCopies(profile.data() as DocumentData);
      let count = 0;
      for (const comment of page.docs) {
        if (!copiesDiffer(comment.data(), fresh)) continue;
        tx.update(comment.ref, fresh);
        count += 1;
      }
      return { size: page.size, last: page.docs[page.docs.length - 1] ?? null, count };
    });
    if (outcome === null) break;
    read += outcome.size;
    updated += outcome.count;
    last = outcome.last;
    if (outcome.size < PROFILE_SYNC_PAGE) break;
  }
  return { read, updated };
}

/**
 * A varredura da pasta (24.7, passo 3): o que não é a foto de agora e é de
 * antes da última troca ou tem mais de 15 min sai, em lotes. O perfil é relido
 * depois da listagem, porque um PUT que gravou no meio faz do arquivo listado
 * a foto de agora; sem ele, a pasta inteira sai. Nunca lança por causa da
 * listagem: o Storage não ligado conta como pasta vazia, e outra falha volta
 * em `failure`, para a tarefa lançar no fim sem segurar as cópias.
 */
async function sweepFanFolder(
  db: Firestore,
  files: FanPhotoFiles,
  uid: string,
  now: number,
  log: Log,
): Promise<{ deleted: boolean; removed: number; failure: Error | null }> {
  let listed: FolderFile[];
  try {
    listed = await files.listWithTimes(fanPhotoFolder(uid));
  } catch (error) {
    if (!isMissingBucket(error)) {
      log.error('fan-profile: a pasta do fã não foi listada', {
        uid,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        deleted: false,
        removed: 0,
        failure: error instanceof Error ? error : new Error(String(error)),
      };
    }
    warnMissingBucket(log, uid);
    return { deleted: false, removed: 0, failure: null };
  }
  const current = await profileRef(db, uid).get();
  if (!current.exists) {
    return { deleted: true, removed: await purgeFanPhotos(files, uid, log), failure: null };
  }
  const stale = stalePhotoFiles(
    listed,
    {
      photoPath: text(current.get('photoPath')),
      photoUpdatedAt: millis(current.get('photoUpdatedAt')),
    },
    now,
  );
  const leftovers = await removeInBatches(files, stale);
  if (leftovers.length === 0) return { deleted: false, removed: stale.length, failure: null };
  log.error('fan-profile: envios antigos ficaram na pasta', {
    uid,
    count: leftovers.length,
    leftovers: leftovers.slice(0, LEFTOVERS_LOGGED),
  });
  return {
    deleted: false,
    removed: stale.length - leftovers.length,
    failure: new Error(`Ficaram ${leftovers.length} arquivo(s) na pasta do fã.`),
  };
}

/**
 * A tarefa `syncFanProfile` (24.7): sem perfil, esvazia a pasta e termina;
 * senão regrava as cópias do nome e da foto nos comentários do fã e só então
 * varre a pasta (a varredura depende do Storage, e uma falha nele não segura
 * as cópias, que só dependem do Firestore). A listagem que falhou ou o arquivo
 * que sobrou fazem a tarefa lançar no fim, e a fila tenta de novo (tudo é
 * seguro de repetir: a cópia igual não grava, e a varredura relê a pasta).
 */
export async function syncFanProfile(
  db: Firestore,
  files: FanPhotoFiles,
  uid: string,
  now: number,
  log: Log = logger,
): Promise<FanProfileSyncResult> {
  const first = await profileRef(db, uid).get();
  if (!first.exists) {
    const removed = await purgeFanPhotos(files, uid, log);
    return { deleted: true, read: 0, updated: 0, removed };
  }

  const { read, updated } = await syncCommentCopies(db, uid);
  const sweep = await sweepFanFolder(db, files, uid, now, log);
  if (sweep.deleted) return { deleted: true, read, updated, removed: sweep.removed };

  log.info('fan-profile: cópias do perfil acertadas', {
    uid,
    read,
    updated,
    removed: sweep.removed,
  });
  if (sweep.failure) throw sweep.failure;
  return { deleted: false, read, updated, removed: sweep.removed };
}
