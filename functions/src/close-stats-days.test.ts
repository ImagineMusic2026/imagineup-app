import type { ScheduledEvent } from 'firebase-functions/v2/scheduler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FAN_CLUB_COPY_BUDGET_MS, runFanClubCopyStep } from './fan-clubs';
import { closeStatsDays } from './index';
import { runStatsClose, type StatsCloseResult } from './points/close';

// O handler do `closeStatsDays` (26.3) com a cópia da noite do fã-clube
// (docs/arquitetura-api.md, seção 34, decisão 37 e 34.19): a cópia é um passo
// próprio, num `finally` depois do fechamento, porque o `runStatsClose` lança
// quando um dia falha. O fechamento e a cópia são falsos aqui; o export é o
// mesmo que vai ao deploy (o `run` chama o handler).

vi.mock('./points/close', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./points/close')>()),
  runStatsClose: vi.fn(),
}));
vi.mock('./fan-clubs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fan-clubs')>()),
  runFanClubCopyStep: vi.fn(),
}));

const T = Date.parse('2026-10-20T03:20:00.000Z');
const event = {} as ScheduledEvent;
const idle: StatsCloseResult = {
  status: 'idle',
  closed: [],
  skipped: [],
  synced: [],
  lastClosedDay: '2026-10-19',
};

describe('o closeStatsDays e a cópia da noite (decisão 37)', () => {
  beforeEach(() => {
    vi.mocked(runStatsClose).mockReset();
    vi.mocked(runFanClubCopyStep).mockReset().mockResolvedValue(null);
    vi.spyOn(Date, 'now').mockReturnValue(T);
  });

  it('a cópia roda depois do fechamento, com o prazo contado do começo do handler', async () => {
    vi.mocked(runStatsClose).mockResolvedValue(idle);
    await closeStatsDays.run(event);
    expect(runStatsClose).toHaveBeenCalledWith(expect.anything(), { now: T });
    expect(runFanClubCopyStep).toHaveBeenCalledWith(expect.anything(), {
      now: T,
      deadline: T + FAN_CLUB_COPY_BUDGET_MS,
    });
    expect(vi.mocked(runStatsClose).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(runFanClubCopyStep).mock.invocationCallOrder[0]!,
    );
  });

  it('o fechamento que falha não segura a cópia, e o erro dele sai igual (a nova tentativa)', async () => {
    const failure = new Error('um dia não fechou');
    vi.mocked(runStatsClose).mockRejectedValue(failure);
    await expect(closeStatsDays.run(event)).rejects.toBe(failure);
    expect(runFanClubCopyStep).toHaveBeenCalledTimes(1);
  });
});
