import { Timestamp } from 'firebase-admin/firestore';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { fanSearchKeys } from '../src/fan-profile/search';
import { useEmulators } from './support';

/**
 * As cargas do bloco 11 nos emuladores (docs/arquitetura-api.md, 26.9), pelos
 * scripts de verdade, como em produção: primeiro com --dry-run (conta sem
 * gravar), depois gravando, e de novo sem mudar nada. A carga dos cadastros
 * com o fechamento está em stats-close.emulator.test.ts.
 */
const env = useEmulators('cargas', ['queueFanProfileSync']);
const { db } = env;

const runScript = promisify(execFile);
const script = (name: string) => resolve(__dirname, `../../scripts/${name}`);
const run = (name: string, args: string[] = []) =>
  runScript(process.execPath, [script(name), ...args], { env: process.env });

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

describe('scripts/seed-game-config.mjs', () => {
  it('--dry-run só conta; depois grava a versão 1 dos dois; de novo, nada', async () => {
    const dry = await run('seed-game-config.mjs', ['--dry-run']);
    expect(dry.stdout).toContain('Faltam: config/points e config/achievements.');
    expect(dry.stdout).toContain('--dry-run: nada gravado.');
    expect(await exists('config/points')).toBe(false);

    const first = await run('seed-game-config.mjs');
    expect(first.stdout).toContain('Versão 1 gravada: config/points e config/achievements');
    expect((await read('config/points'))?.version).toBe(1);
    expect((await read('config/achievements'))?.version).toBe(1);

    const again = await run('seed-game-config.mjs');
    expect(again.stdout).toContain('já existem: nada a gravar.');
    expect(
      (await db.collection('staffAudit').where('action', '==', 'config.seeded').get()).size,
    ).toBe(2);
  });
});

describe('scripts/backfill-fan-search.mjs', () => {
  it('grava o searchKeys onde falta ou difere, sem updatedAt; de novo, nada', async () => {
    const createdAt = Timestamp.fromMillis(Date.parse('2026-10-01T15:00:00.000Z'));
    const updatedAt = Timestamp.fromMillis(Date.parse('2026-10-02T15:00:00.000Z'));
    await db.doc('users/sem-chaves').set({
      displayName: 'Camila Ribeiro',
      username: 'camilarib',
      createdAt,
      updatedAt,
    });
    await db.doc('users/velhas').set({
      displayName: 'Bia Santos',
      username: 'biasan',
      createdAt,
      searchKeys: ['velha'],
    });
    await db.doc('users/em-dia').set({
      displayName: 'Duda',
      username: 'duda12',
      createdAt,
      searchKeys: fanSearchKeys('Duda', 'duda12'),
    });

    const dry = await run('backfill-fan-search.mjs', ['--dry-run']);
    expect(dry.stdout).toContain('Perfis: 3. Sem o searchKeys de agora: 2.');
    expect((await read('users/sem-chaves'))?.searchKeys).toBeUndefined();

    const first = await run('backfill-fan-search.mjs');
    expect(first.stdout).toContain('searchKeys gravado em 2 perfis.');
    expect((await read('users/sem-chaves'))?.searchKeys).toEqual(
      fanSearchKeys('Camila Ribeiro', 'camilarib'),
    );
    expect((await read('users/sem-chaves'))?.updatedAt).toEqual(updatedAt);
    expect((await read('users/velhas'))?.searchKeys).toEqual(fanSearchKeys('Bia Santos', 'biasan'));
    expect((await read('users/velhas'))?.updatedAt).toBeUndefined();

    const again = await run('backfill-fan-search.mjs');
    expect(again.stdout).toContain('searchKeys gravado em 0 perfis.');
  });
});

describe('scripts/backfill-audit-index.mjs', () => {
  it('grava a seção e os alvos só nas entradas sem os dois; de novo, nada', async () => {
    const createdAt = Timestamp.fromMillis(Date.parse('2026-09-30T15:00:00.000Z'));
    const base = { actorUid: 'uid-admin', actorName: 'Admin', targetEmail: '', createdAt };
    await db.doc('staffAudit/a1').set({
      ...base,
      action: 'artist.created',
      targetUid: null,
      details: { artistId: 'nenho', name: 'Nenho' },
    });
    await db.doc('staffAudit/a2').set({
      ...base,
      action: 'member.updated',
      targetEmail: 'pessoa@imagine.music',
      targetUid: 'uid-pessoa',
      details: { from: { role: 'viewer' }, to: { role: 'editor' } },
    });
    await db.doc('staffAudit/a3').set({
      ...base,
      action: 'reward.created',
      targetUid: null,
      details: { rewardId: 'r1' },
      section: 'rewards',
      targets: ['reward:r1'],
    });

    const dry = await run('backfill-audit-index.mjs', ['--dry-run']);
    expect(dry.stdout).toContain('Entradas: 3. Sem a seção ou os alvos: 2');
    expect(dry.stdout).toContain('artists: 1');
    expect(dry.stdout).toContain('team: 1');
    expect((await read('staffAudit/a1'))?.section).toBeUndefined();

    const first = await run('backfill-audit-index.mjs');
    expect(first.stdout).toContain('Seção e alvos gravados em 2 entradas.');
    expect(await read('staffAudit/a1')).toMatchObject({
      section: 'artists',
      targets: ['artist:nenho'],
      details: { artistId: 'nenho', name: 'Nenho' },
    });
    expect(await read('staffAudit/a2')).toMatchObject({
      section: 'team',
      targets: ['staff:uid-pessoa'],
    });

    const again = await run('backfill-audit-index.mjs');
    expect(again.stdout).toContain('Seção e alvos gravados em 0 entradas.');
  });
});

describe('as três cargas recusam sem o emulador e sem --project', () => {
  it.each(['seed-game-config.mjs', 'backfill-fan-search.mjs', 'backfill-audit-index.mjs'])(
    '%s',
    async (name) => {
      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      delete childEnv.FIRESTORE_EMULATOR_HOST;
      const refused = await runScript(process.execPath, [script(name)], { env: childEnv }).then(
        () => ({ code: 0, stderr: '' }),
        (error: { code: number; stderr: string }) => error,
      );
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain('--project');
    },
  );
});
