// A janela das filas de cópia (o fanCount do bloco 4, as contagens dos posts
// do bloco 6 e as cópias do nome e da foto do fã do bloco 9): toda gravação
// põe na fila a tarefa da janela dela, com um id por janela, e a tarefa roda
// 1 s depois do fim da janela. Assim o documento copiado recebe no máximo uma
// gravação por janela (10 s nas contagens; 5 min ou 1 h nas cópias do perfil).
// docs/arquitetura-api.md, 19.6, 21.6 e 24.7.

/** Janela das filas de cópia: no máximo uma cópia por documento a cada 10 s. */
export const SYNC_WINDOW_MS = 10_000;

/** A tarefa da janela roda 1 s depois do fim dela. */
const SYNC_DELAY_MS = 1_000;

/**
 * A tarefa da janela de uma gravação: o id (`<prefixo>-<id>-<janela>`, no
 * formato que o Cloud Tasks aceita, `^[A-Za-z0-9_-]+$`) e o horário (1 s
 * depois do fim da janela). O `eventTime` é o instante da gravação
 * (`event.time` do gatilho), não o relógio da execução: a entrega repetida do
 * mesmo evento cai na mesma janela e no mesmo id. `windowMs` é o tamanho da
 * janela: 10 s nas contagens (o padrão), 5 min ou 1 h nas cópias do perfil
 * (bloco 9), com prefixos diferentes para os ids não se cruzarem.
 */
export function windowTask(
  prefix: string,
  id: string,
  eventTime: number,
  windowMs: number = SYNC_WINDOW_MS,
): { id: string; scheduleTime: Date } {
  const window = Math.floor(eventTime / windowMs);
  return {
    id: `${prefix}-${id}-${window}`,
    scheduleTime: new Date((window + 1) * windowMs + SYNC_DELAY_MS),
  };
}
