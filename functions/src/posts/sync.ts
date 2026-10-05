import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { isContentId } from '../page-cursor';
import { windowTask } from '../window-task';
import { syncPostCounts, type PostCountsSync } from './service';

// A cópia das contagens dos posts (bloco 6): o gatilho nos shards põe na fila
// uma tarefa por post e por janela de 10 s, e a tarefa soma os shards e copia
// `likeCount` e `commentCount` para posts/{postId}. Assim o post popular
// recebe no máximo uma gravação a cada 10 s, e as curtidas que o leem não
// disputam com ela. No molde do fanCount (19.6). docs/arquitetura-api.md, 21.6.

/** A fila da tarefa `syncPostCounts`, com a região no nome (sem ela, us-central1). */
export const POST_COUNTS_QUEUE = 'locations/southamerica-east1/functions/syncPostCounts';

/** Tentativas da fila `syncPostCounts`. */
export const POST_COUNTS_MAX_ATTEMPTS = 5;

/** O que o gatilho usa da fila (`getFunctions().taskQueue(...)`); os testes trocam. */
export type PostCountsQueue = {
  enqueue(data: { postId: string }, options?: { id?: string; scheduleTime?: Date }): Promise<void>;
};

type Log = Pick<typeof logger, 'error'>;

/** Id de tarefa repetido: a da janela já está na fila ou já rodou depois desta gravação. */
const TASK_EXISTS = 'functions/task-already-exists';

/** A tarefa da janela de 10 s de uma gravação nos shards de um post. */
export function postCountsSyncTask(postId: string, eventTime: number) {
  return windowTask('postcounts', postId, eventTime);
}

/**
 * Gatilho `queuePostCountSync`: põe na fila a tarefa da janela da gravação,
 * sem ler nada. Id repetido é ignorado; outro erro lança, e o gatilho repete.
 * `postId` fora do formato: log de erro, sem lançar. No emulador, sem id e
 * sem horário, uma tarefa por gravação (ele ignora o horário e nunca libera
 * um id usado).
 */
export async function queuePostCountSync(
  queue: PostCountsQueue,
  postId: string,
  eventTime: number,
  options: { emulator: boolean; log?: Log },
): Promise<'queued' | 'exists' | 'invalid'> {
  const log = options.log ?? logger;
  if (!isContentId(postId)) {
    log.error('posts: gatilho das contagens com postId fora do formato', { postId });
    return 'invalid';
  }
  if (options.emulator) {
    await queue.enqueue({ postId });
    return 'queued';
  }
  const task = postCountsSyncTask(postId, eventTime);
  try {
    await queue.enqueue({ postId }, { id: task.id, scheduleTime: task.scheduleTime });
    return 'queued';
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === TASK_EXISTS) return 'exists';
    throw error;
  }
}

/**
 * Tarefa `syncPostCounts`: confere o `postId` (fora do formato, log de erro e
 * termina sem erro) e copia a soma dos shards. Erro passageiro lança, e a fila
 * tenta de novo; na última tentativa, fica um log de erro.
 */
export async function runPostCountSync(
  db: Firestore,
  data: unknown,
  options: { retryCount?: number; log?: Log } = {},
): Promise<PostCountsSync | null> {
  const log = options.log ?? logger;
  const postId = (data as { postId?: unknown } | null)?.postId;
  if (!isContentId(postId)) {
    log.error('posts: tarefa das contagens com postId fora do formato', { postId });
    return null;
  }
  try {
    return await syncPostCounts(db, postId, log);
  } catch (error) {
    if ((options.retryCount ?? 0) + 1 >= POST_COUNTS_MAX_ATTEMPTS) {
      log.error('posts: a cópia das contagens falhou em todas as tentativas', {
        postId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
