import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { fanCountSyncTask, isArtistId } from './model';
import { syncFanCount, type FanCountSync } from './service';

// A cópia do fanCount (bloco 4): o gatilho nos shards põe na fila uma tarefa
// por central e por janela de 10 s, e a tarefa soma os shards e copia o total
// para artists/{id}. Assim o documento da central recebe no máximo uma
// gravação a cada 10 s, e as entradas que o leem não disputam com ela.
// docs/arquitetura-api.md, seção 19.6.

/**
 * A fila da tarefa `syncArtistFanCount`, com a região no nome: sem ela, o
 * firebase-admin procura a fila em us-central1.
 */
export const FAN_COUNT_QUEUE = 'locations/southamerica-east1/functions/syncArtistFanCount';

/** O que o gatilho usa da fila (`getFunctions().taskQueue(...)`); os testes trocam. */
export type FanCountQueue = {
  enqueue(
    data: { artistId: string },
    options?: { id?: string; scheduleTime?: Date },
  ): Promise<void>;
};

type Log = Pick<typeof logger, 'error'>;

/** Id de tarefa repetido: a da janela já está na fila ou já rodou depois desta gravação. */
const TASK_EXISTS = 'functions/task-already-exists';

/**
 * Gatilho `queueArtistFanCountSync`: põe na fila a tarefa da janela da
 * gravação, sem ler nada. Id repetido é ignorado; outro erro lança, e o
 * gatilho repete (`retry: true`). `artistId` fora do formato (erro de
 * programação): log de erro, sem lançar, para não repetir para sempre.
 *
 * No emulador (`FUNCTIONS_EMULATOR`), a fila ignora o horário e nunca libera
 * um id usado: lá a tarefa vai sem id e sem horário, uma por gravação, na hora.
 */
export async function queueFanCountSync(
  queue: FanCountQueue,
  artistId: string,
  eventTime: number,
  options: { emulator: boolean; log?: Log },
): Promise<'queued' | 'exists' | 'invalid'> {
  const log = options.log ?? logger;
  if (!isArtistId(artistId)) {
    log.error('centrals: gatilho do fanCount com artistId fora do formato', { artistId });
    return 'invalid';
  }
  if (options.emulator) {
    await queue.enqueue({ artistId });
    return 'queued';
  }
  const task = fanCountSyncTask(artistId, eventTime);
  try {
    await queue.enqueue({ artistId }, { id: task.id, scheduleTime: task.scheduleTime });
    return 'queued';
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === TASK_EXISTS) return 'exists';
    throw error;
  }
}

/** Tentativas da fila `syncArtistFanCount`. */
export const FAN_COUNT_MAX_ATTEMPTS = 5;

/**
 * Tarefa `syncArtistFanCount`: confere o `artistId` (fora do formato, log de
 * erro e termina sem erro, para a fila não tentar de novo) e copia a soma dos
 * shards. Erro passageiro lança, e a fila tenta de novo; na última tentativa,
 * fica um log de erro (a próxima mudança da central põe outra tarefa na fila).
 */
export async function runFanCountSync(
  db: Firestore,
  data: unknown,
  options: { retryCount?: number; log?: Log } = {},
): Promise<FanCountSync | null> {
  const log = options.log ?? logger;
  const artistId = (data as { artistId?: unknown } | null)?.artistId;
  if (!isArtistId(artistId)) {
    log.error('centrals: tarefa do fanCount com artistId fora do formato', { artistId });
    return null;
  }
  try {
    return await syncFanCount(db, artistId, log);
  } catch (error) {
    if ((options.retryCount ?? 0) + 1 >= FAN_COUNT_MAX_ATTEMPTS) {
      log.error('centrals: a cópia do fanCount falhou em todas as tentativas', {
        artistId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
