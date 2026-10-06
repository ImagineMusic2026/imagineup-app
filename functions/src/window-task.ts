// A janela das filas de cópia (o fanCount do bloco 4 e as contagens dos posts
// do bloco 6): toda gravação de um contador em shards põe na fila a tarefa da
// janela de 10 s dela, com um id por janela, e a tarefa roda 1 s depois do fim
// da janela. Assim o documento copiado recebe no máximo uma gravação a cada
// 10 s. docs/arquitetura-api.md, 19.6 e 21.6.

/** Janela das filas de cópia: no máximo uma cópia por documento a cada 10 s. */
export const SYNC_WINDOW_MS = 10_000;

/** A tarefa da janela roda 1 s depois do fim dela. */
const SYNC_DELAY_MS = 1_000;

/**
 * A tarefa da janela de uma gravação: o id (`<prefixo>-<id>-<janela>`, no
 * formato que o Cloud Tasks aceita, `^[A-Za-z0-9_-]+$`) e o horário (1 s
 * depois do fim da janela). O `eventTime` é o instante da gravação
 * (`event.time` do gatilho), não o relógio da execução: a entrega repetida do
 * mesmo evento cai na mesma janela e no mesmo id.
 */
export function windowTask(
  prefix: string,
  id: string,
  eventTime: number,
): { id: string; scheduleTime: Date } {
  const window = Math.floor(eventTime / SYNC_WINDOW_MS);
  return {
    id: `${prefix}-${id}-${window}`,
    scheduleTime: new Date((window + 1) * SYNC_WINDOW_MS + SYNC_DELAY_MS),
  };
}
