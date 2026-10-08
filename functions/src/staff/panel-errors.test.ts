import type { DocumentReference, DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { panelOrigins } from './config';
import { readPanelActor } from './panel-actor';
import {
  aboveLimitError,
  dailyLimitError,
  formatPoints,
  negativeCounterError,
  panelError,
  targetFanUid,
} from './panel-errors';

// O que as callables do bloco 11 dividem (26.4 e 26.5): o fã alvo e a recusa
// da própria conta, as mensagens com o número em pt-BR, o papel no PanelActor
// e as portas do painel local no emulador.

const caller = { uid: 'uidEquipe', token: { auth_time: 100 } };

const errorOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error as { code: string; message: string; details: Record<string, unknown> };
  }
  throw new Error('Deveria ter falhado.');
};

describe('o fã alvo', () => {
  it('sem login, unauthenticated; uid fora do formato, invalid-request; o próprio, self', () => {
    expect(errorOf(() => targetFanUid(undefined, 'uidCamila')).details).toEqual({
      reason: 'unauthenticated',
    });
    for (const uid of [undefined, '', 'uid-com-hifen', 'a/b', 42]) {
      expect(errorOf(() => targetFanUid(caller, uid)).details).toEqual({
        reason: 'invalid-request',
        field: 'uid',
      });
    }
    const self = errorOf(() => targetFanUid(caller, 'uidEquipe'));
    expect(self).toMatchObject({
      code: 'permission-denied',
      message: 'Você não pode mudar a sua própria conta de fã pelo painel.',
      details: { reason: 'self' },
    });
    expect(targetFanUid(caller, 'uidCamila')).toBe('uidCamila');
  });
});

describe('as mensagens', () => {
  it('o número com o ponto dos milhares', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(999)).toBe('999');
    expect(formatPoints(50_000)).toBe('50.000');
    expect(formatPoints(1_000_000)).toBe('1.000.000');
    expect(formatPoints(-12_345)).toBe('-12.345');
  });

  it('o teto, o orçamento e o contador negativo dizem o contador e o número', () => {
    expect(aboveLimitError(50_000)).toMatchObject({
      message: 'O ajuste passa do limite de 50.000 pontos por contador. Fale com um admin.',
      details: { reason: 'adjust-above-limit', max: 50_000 },
    });
    expect(dailyLimitError('xp', 12_500)).toMatchObject({
      code: 'resource-exhausted',
      message: 'Hoje você ainda pode ajustar 12.500 pontos no XP. Fale com um admin.',
      details: { reason: 'adjust-daily-limit', counter: 'xp', remaining: 12_500 },
    });
    expect(negativeCounterError('centralTotal')).toMatchObject({
      message: 'O ajuste deixaria os pontos da central negativos.',
      details: { reason: 'negative-counter', counter: 'centralTotal' },
    });
    expect(panelError('lookup-daily-limit', { max: 50 }).message).toBe(
      'Você chegou ao limite de 50 buscas por e-mail hoje.',
    );
    expect(panelError('username-of-central').message).toBe(
      'Este @ é de uma central, não de um fã.',
    );
  });
});

describe('o papel de quem chama', () => {
  const reader =
    (data: Record<string, unknown> | undefined) =>
    async (_ref: DocumentReference): Promise<DocumentSnapshot> =>
      ({ data: () => data }) as unknown as DocumentSnapshot;
  const db = {
    collection: () => ({ doc: (id: string) => ({ id }) }),
  } as unknown as Firestore;
  const member = (role: unknown) => ({
    status: 'active',
    role,
    sections: ['fans'],
    displayName: 'Editora',
  });

  it('o PanelActor traz o papel do staff/{uid}', async () => {
    await expect(
      readPanelActor(reader(member('editor')), db, caller, 'fans', 'edit'),
    ).resolves.toEqual({ uid: 'uidEquipe', name: 'Editora', role: 'editor' });
    await expect(
      readPanelActor(reader(member('admin')), db, caller, 'fans', 'edit'),
    ).resolves.toMatchObject({ role: 'admin' });
    await expect(
      readPanelActor(reader(member('viewer')), db, caller, 'fans', 'view'),
    ).resolves.toMatchObject({ role: 'viewer' });
  });

  it('as seções novas têm nome na mensagem de acesso', async () => {
    for (const [section, label] of [
      ['overview', 'Visão geral'],
      ['growth', 'Crescimento'],
      ['audit', 'Logs e auditoria'],
    ] as const) {
      await expect(
        readPanelActor(reader(member('editor')), db, caller, section, 'view'),
      ).rejects.toMatchObject({
        message: `Seu acesso ao painel não permite fazer isso em ${label}.`,
      });
    }
  });
});

describe('as origens do painel', () => {
  it('em produção, a Vercel e o localhost:3000', () => {
    expect(panelOrigins({})).toEqual([
      'https://imagineup-admin.vercel.app',
      'http://localhost:3000',
    ]);
    expect(panelOrigins({ FUNCTIONS_EMULATOR: 'false' })).toHaveLength(2);
  });

  it('no emulador, também as portas 3001 a 3009', () => {
    const origins = panelOrigins({ FUNCTIONS_EMULATOR: 'true' });
    expect(origins).toHaveLength(11);
    expect(origins).toContain('http://localhost:3001');
    expect(origins).toContain('http://localhost:3009');
    expect(origins).not.toContain('http://localhost:3010');
  });
});
