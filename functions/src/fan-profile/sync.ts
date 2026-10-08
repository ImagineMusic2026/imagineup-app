import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { windowTask } from '../window-task';
import type { FanPhotoFiles } from './files';
import {
  FAN_PHOTO_PURGE_DELAY_MS,
  FAN_UID_PATTERN,
  parseProfileSyncBudget,
  profileSyncBudget,
  profileSyncNeeded,
  type ProfileSyncPlan,
} from './model';
import { sameSearchKeys, searchKeysOf } from './search';
import { removeReplacedPhoto, syncFanProfile, type FanProfileSyncResult } from './service';

// A fila das cópias do perfil (bloco 9, 24.7): o gatilho de users/{uid} apaga
// a foto trocada e, quando o nome ou a foto mudam, põe na fila uma tarefa por
// fã e janela (5 min; passado o orçamento do dia, 1 h). A tarefa regrava as
// cópias do nome e da foto nos comentários do fã e varre a pasta da foto. A
// exclusão de conta põe na mesma fila a segunda limpeza da pasta, 1 h depois.
// No molde das filas do fanCount (19.6) e das contagens dos posts (21.6).

/** A fila da tarefa `syncFanProfile`, com a região no nome (sem ela, us-central1). */
export const FAN_PROFILE_QUEUE = 'locations/southamerica-east1/functions/syncFanProfile';

/** Tentativas da fila `syncFanProfile`. */
export const FAN_PROFILE_MAX_ATTEMPTS = 5;

/** O que o gatilho e a exclusão usam da fila (`getFunctions().taskQueue(...)`); os testes trocam. */
export type FanProfileQueue = {
  enqueue(data: { uid: string }, options?: { id?: string; scheduleTime?: Date }): Promise<void>;
};

type Log = Pick<typeof logger, 'info' | 'warn' | 'error'>;

/** Id de tarefa repetido: a da janela já está na fila ou já rodou. */
const TASK_EXISTS = 'functions/task-already-exists';

const isTaskExists = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === TASK_EXISTS;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** O orçamento da fila do fã (só do servidor; sai com o recursiveDelete do perfil). */
export const profileSyncBudgetRef = (db: Firestore, uid: string) =>
  db.collection('users').doc(uid).collection('profileSync').doc('budget');

export type QueueFanProfileSyncResult = {
  photo: 'removed' | 'kept' | 'invalid' | null;
  task: 'queued' | 'exists' | 'unchanged' | 'no-profile' | 'invalid';
  /** O `searchKeys` (bloco 11): gravado, já certo ou perfil que sumiu; ausente sem mudança de nome ou @. */
  searchKeys?: 'written' | 'unchanged' | 'no-profile';
};

/** O nome ou o @ do evento mudaram: as chaves da busca podem ter mudado. */
function searchFieldsChanged(
  before: DocumentData | undefined,
  after: DocumentData | undefined,
): boolean {
  if (!before || !after) return false;
  return (['displayName', 'username'] as const).some(
    (field) => (before[field] ?? null) !== (after[field] ?? null),
  );
}

/**
 * As chaves da busca de fãs do painel (bloco 11, 26.7) a partir do perfil de
 * agora, relido numa transação, e nunca do `event.data.after`: a entrega é
 * pelo menos uma vez e sem ordem, e um evento velho gravaria as chaves de um
 * nome velho por cima das novas. Grava só quando mudou, sem `updatedAt` (o
 * carimbo de edição do fã, que trava a edição por 10 s). A gravação dispara o
 * gatilho de novo, que não vê nome nem @ mudados e não abre a transação.
 */
export function syncFanSearchKeys(
  db: Firestore,
  uid: string,
): Promise<'written' | 'unchanged' | 'no-profile'> {
  return db.runTransaction(async (tx) => {
    const profile = await tx.get(db.collection('users').doc(uid));
    if (!profile.exists) return 'no-profile';
    const keys = searchKeysOf(profile);
    if (sameSearchKeys(profile.get('searchKeys'), keys)) return 'unchanged';
    tx.update(profile.ref, { searchKeys: keys });
    return 'written';
  });
}

/**
 * Gatilho `queueFanProfileSync` (`onDocumentUpdated` em users/{uid}):
 * 1. foto trocada ou tirada: apaga o arquivo antigo (`removeReplacedPhoto`);
 *    nome ou @ trocados: o `searchKeys` do perfil de agora (bloco 11,
 *    `syncFanSearchKeys`); mudar só o `searchKeys` não põe tarefa na fila;
 * 2. sem mudança no nome, na foto ou no caminho dela: termina;
 * 3. o orçamento do dia, numa transação que exige o perfil (o gatilho
 *    atrasado de uma conta excluída não o recria);
 * 4. a tarefa da janela (5 min ou 1 h). Id repetido é ignorado; outro erro
 *    lança, e o gatilho repete (o orçamento gravado não conta de novo: é a
 *    mesma janela).
 * No emulador, a tarefa vai sem id e sem horário, uma por gravação, na hora.
 */
export async function queueFanProfileSync(
  db: Firestore,
  queue: FanProfileQueue,
  files: Pick<FanPhotoFiles, 'remove'>,
  input: {
    uid: string;
    before: DocumentData | undefined;
    after: DocumentData | undefined;
    eventTime: number;
  },
  options: { emulator: boolean; log?: Log },
): Promise<QueueFanProfileSyncResult> {
  const log = options.log ?? logger;
  const { uid, before, after, eventTime } = input;
  if (!FAN_UID_PATTERN.test(uid)) {
    log.error('fan-profile: gatilho do perfil com uid fora do formato', { uid });
    return { photo: null, task: 'invalid' };
  }

  let photo: QueueFanProfileSyncResult['photo'] = null;
  const oldPath = text(before?.photoPath);
  if (oldPath && oldPath !== text(after?.photoPath)) {
    photo = await removeReplacedPhoto(db, files, uid, oldPath, log);
  }
  const searchKeys = searchFieldsChanged(before, after)
    ? await syncFanSearchKeys(db, uid)
    : undefined;
  if (!profileSyncNeeded(before, after)) return { photo, task: 'unchanged', searchKeys };

  const plan = await db.runTransaction(async (tx): Promise<ProfileSyncPlan | null> => {
    const budgetRef = profileSyncBudgetRef(db, uid);
    const [profile, budget] = await tx.getAll(db.collection('users').doc(uid), budgetRef);
    if (!profile!.exists) return null;
    const next = profileSyncBudget(parseProfileSyncBudget(budget!.data()), eventTime);
    if (next.write) tx.set(budgetRef, next.write);
    return next;
  });
  if (!plan) return { photo, task: 'no-profile', searchKeys };

  if (options.emulator) {
    await queue.enqueue({ uid });
    return { photo, task: 'queued', searchKeys };
  }
  const task = windowTask(plan.prefix, uid, eventTime, plan.windowMs);
  try {
    await queue.enqueue({ uid }, { id: task.id, scheduleTime: task.scheduleTime });
    return { photo, task: 'queued', searchKeys };
  } catch (error) {
    if (isTaskExists(error)) return { photo, task: 'exists', searchKeys };
    throw error;
  }
}

/**
 * Tarefa `syncFanProfile`: confere o uid (fora do formato, log de erro e
 * termina sem erro, para a fila não repetir) e roda as cópias e a varredura.
 * Erro lança, e a fila tenta de novo; na última tentativa, fica o log de erro
 * (a próxima mudança do perfil põe outra tarefa).
 */
export async function runFanProfileSync(
  db: Firestore,
  files: FanPhotoFiles,
  data: unknown,
  options: { now?: () => number; retryCount?: number; log?: Log } = {},
): Promise<FanProfileSyncResult | null> {
  const log = options.log ?? logger;
  const uid = (data as { uid?: unknown } | null)?.uid;
  if (typeof uid !== 'string' || !FAN_UID_PATTERN.test(uid)) {
    log.error('fan-profile: tarefa do perfil com uid fora do formato', { uid });
    return null;
  }
  try {
    return await syncFanProfile(db, files, uid, (options.now ?? Date.now)(), log);
  } catch (error) {
    if ((options.retryCount ?? 0) + 1 >= FAN_PROFILE_MAX_ATTEMPTS) {
      log.error('fan-profile: a tarefa do perfil falhou em todas as tentativas', {
        uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

/**
 * A segunda limpeza da pasta depois da exclusão de conta (24.11): a tarefa
 * `{ uid }` com o id `fanprofile-<uid>-deleted`, 1 h depois; ela acha o perfil
 * apagado e esvazia a pasta (o envio lento que a regra liberou antes da
 * exclusão). Id repetido (a exclusão que rodou de novo): ignora. Outro erro só
 * vai para o log: a exclusão já terminou, e repeti-la inteira não ajudaria.
 * No emulador, sem id e sem horário (roda na hora).
 */
export async function queueFanPhotoPurge(
  queue: FanProfileQueue,
  uid: string,
  options: { now: number; emulator: boolean; log?: Log },
): Promise<'queued' | 'exists' | 'failed'> {
  const log = options.log ?? logger;
  try {
    if (options.emulator) await queue.enqueue({ uid });
    else {
      await queue.enqueue(
        { uid },
        {
          id: `fanprofile-${uid}-deleted`,
          scheduleTime: new Date(options.now + FAN_PHOTO_PURGE_DELAY_MS),
        },
      );
    }
    return 'queued';
  } catch (error) {
    if (isTaskExists(error)) return 'exists';
    log.error('fan-profile: a segunda limpeza da pasta não entrou na fila', {
      uid,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}
