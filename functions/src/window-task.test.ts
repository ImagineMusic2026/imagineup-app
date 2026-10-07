import { describe, expect, it } from 'vitest';

import { SYNC_WINDOW_MS, windowTask } from './window-task';

// A janela das filas (19.6, 21.6 e 24.7): o padrão de 10 s das contagens não
// muda com o parâmetro novo, e a fila do perfil (bloco 9) usa 5 min ou 1 h.

const AT = Date.parse('2026-10-07T15:04:03.250Z');
const FIVE_MIN = 5 * 60_000;
const HOUR = 60 * 60_000;

describe('windowTask', () => {
  it('sem windowMs, a janela de 10 s das filas do bloco 4 e do bloco 6, com o id e o horário de sempre', () => {
    const window = Math.floor(AT / 10_000);
    expect(SYNC_WINDOW_MS).toBe(10_000);
    expect(windowTask('fancount', 'nenho', AT)).toEqual({
      id: `fancount-nenho-${window}`,
      scheduleTime: new Date((window + 1) * 10_000 + 1_000),
    });
    expect(windowTask('postcounts', 'p-clipe', AT)).toEqual(
      windowTask('postcounts', 'p-clipe', AT, SYNC_WINDOW_MS),
    );
  });

  it('a janela de 5 min: o mesmo id para as gravações da mesma janela, 1 s depois do fim', () => {
    const task = windowTask('fanprofile', 'uidCamila', AT, FIVE_MIN);
    const window = Math.floor(AT / FIVE_MIN);
    expect(task).toEqual({
      id: `fanprofile-uidCamila-${window}`,
      // 15:04:03 cai na janela de 15:00 a 15:05; a tarefa roda às 15:05:01.
      scheduleTime: new Date('2026-10-07T15:05:01.000Z'),
    });
    expect(windowTask('fanprofile', 'uidCamila', AT + 50_000, FIVE_MIN).id).toBe(task.id);
    expect(windowTask('fanprofile', 'uidCamila', AT + 60_000, FIVE_MIN).id).not.toBe(task.id);
    expect(task.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('a janela de 1 h, depois do orçamento do dia', () => {
    expect(windowTask('fanprofileh', 'uidCamila', AT, HOUR)).toEqual({
      id: `fanprofileh-uidCamila-${Math.floor(AT / HOUR)}`,
      scheduleTime: new Date('2026-10-07T16:00:01.000Z'),
    });
  });
});
