import { describe, expect, it, vi } from 'vitest';

import { decideFanClub, parseDecision } from './panel';

// A entrada da callable decideFanClub (docs/arquitetura-api.md, 34.3), em
// tabela, sem Firestore: cada assunto, decisão, `expected` e campo; e as
// recusas que vêm antes de qualquer leitura (o login, o assunto, o id e a
// própria candidatura).

vi.mock('../content-filter', async (importOriginal) => {
  const { fakeContentFilter } = await import('../../test/content-filter-fake.js');
  return fakeContentFilter(await importOriginal());
});

// 12:00 de 19/10/2026 em São Paulo.
const NOW = Date.parse('2026-10-19T15:00:00.000Z');

/** Os `details` do erro que a chamada lança. */
function detailsOf(run: () => unknown): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    return (error as { details: Record<string, unknown> }).details;
  }
  throw new Error('Deveria ter falhado.');
}

const application = (fields: Record<string, unknown>) =>
  parseDecision('application', 'uidCamila', fields, NOW);

const club = (fields: Record<string, unknown>) => parseDecision('club', 'clube1', fields, NOW);

describe('a candidatura', () => {
  it('aprovar com o nome proposto ou ajustado; recusar com o motivo da lista', () => {
    expect(application({ decision: 'approve', expected: 1 })).toEqual({
      subject: 'application',
      id: 'uidCamila',
      decision: 'approve',
      expected: 1,
      name: null,
    });
    expect(
      application({ decision: 'approve', expected: 2, name: '  Netto de Coração ' }),
    ).toMatchObject({ name: 'Netto de Coração', expected: 2 });
    expect(application({ decision: 'reject', expected: 1, reason: 'not_fit' })).toEqual({
      subject: 'application',
      id: 'uidCamila',
      decision: 'reject',
      expected: 1,
      reason: 'not_fit',
    });
  });

  it.each([
    [{ decision: 'pause', expected: 1 }, { field: 'decision' }],
    [{ decision: 'approve' }, { field: 'expected' }],
    [{ decision: 'approve', expected: '1' }, { field: 'expected' }],
    [{ decision: 'approve', expected: 1.5 }, { field: 'expected' }],
    [{ decision: 'approve', expected: -1 }, { field: 'expected' }],
    [{ decision: 'approve', expected: 1, name: 7 }, { field: 'name' }],
    [
      { decision: 'approve', expected: 1, name: 'ab' },
      { field: 'name', problem: 'format' },
    ],
    [
      { decision: 'approve', expected: 1, name: 'Netto Oficial' },
      { field: 'name', problem: 'official' },
    ],
    [
      { decision: 'approve', expected: 1, name: 'Netto Pepino' },
      { field: 'name', problem: 'not_allowed' },
    ],
    [{ decision: 'reject', expected: 1 }, { field: 'reason' }],
    [{ decision: 'reject', expected: 1, reason: 'spam' }, { field: 'reason' }],
  ])('%j: invalid-request com %j', (fields, details) => {
    expect(detailsOf(() => application(fields))).toEqual({
      reason: 'invalid-request',
      ...details,
    });
  });
});

describe('o fã-clube', () => {
  it('pausar, reativar e tirar o destaque só com o status', () => {
    for (const decision of ['pause', 'resume', 'unfeature'] as const) {
      expect(club({ decision, expected: 'active' })).toEqual({
        subject: 'club',
        id: 'clube1',
        decision,
        expected: 'active',
      });
    }
  });

  it('encerrar: staff por padrão, ou owner_request', () => {
    expect(club({ decision: 'close', expected: 'paused' })).toMatchObject({
      decision: 'close',
      reason: 'staff',
    });
    expect(club({ decision: 'close', expected: 'active', reason: 'owner_request' })).toMatchObject({
      reason: 'owner_request',
    });
  });

  it('destacar com o fim de amanhã a 31 dias', () => {
    expect(
      club({ decision: 'feature', expected: 'active', featuredUntil: '2026-11-19' }),
    ).toMatchObject({ decision: 'feature', featuredUntil: '2026-11-19' });
  });

  it.each([
    [{ decision: 'approve', expected: 'active' }, 'decision'],
    [{ decision: 'reward', expected: 'active' }, 'decision'],
    [{ decision: 'pause' }, 'expected'],
    [{ decision: 'pause', expected: 'ativo' }, 'expected'],
    [{ decision: 'close', expected: 'active', reason: 'account_deleted' }, 'reason'],
    [{ decision: 'feature', expected: 'active' }, 'featuredUntil'],
    [{ decision: 'feature', expected: 'active', featuredUntil: '2026-10-19' }, 'featuredUntil'],
    [{ decision: 'feature', expected: 'active', featuredUntil: '2026-11-20' }, 'featuredUntil'],
  ])('%j: invalid-request com o campo %s', (fields, field) => {
    expect(detailsOf(() => club(fields))).toEqual({ reason: 'invalid-request', field });
  });
});

describe('antes de qualquer leitura', () => {
  const noReads = {
    collection: () => {
      throw new Error('leu o Firestore');
    },
  } as never;
  const caller = { uid: 'uidEquipe', token: { auth_time: 100 } };

  async function detailsOfCall(
    data: unknown,
    who: typeof caller | null = caller,
  ): Promise<Record<string, unknown>> {
    try {
      await decideFanClub({ db: noReads, now: () => NOW }, who ?? undefined, data);
    } catch (error) {
      return (error as { details: Record<string, unknown> }).details;
    }
    throw new Error('Deveria ter falhado.');
  }

  it('sem login, unauthenticated; o assunto e o id fora do formato; a própria candidatura, self', async () => {
    expect(await detailsOfCall({ subject: 'application', id: 'uidCamila' }, null)).toEqual({
      reason: 'unauthenticated',
    });
    for (const subject of [undefined, 'post', 'report', 'fã']) {
      expect(await detailsOfCall({ subject, id: 'x' })).toEqual({
        reason: 'invalid-request',
        field: 'subject',
      });
    }
    expect(await detailsOfCall({ subject: 'application', id: 'uid-com-hifen' })).toEqual({
      reason: 'invalid-request',
      field: 'id',
    });
    expect(await detailsOfCall({ subject: 'club', id: 'a/b' })).toEqual({
      reason: 'invalid-request',
      field: 'id',
    });
    expect(await detailsOfCall({ subject: 'application', id: 'uidEquipe' })).toEqual({
      reason: 'self',
    });
  });
});
