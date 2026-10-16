import { initializeApp } from 'firebase-admin/app';
import { GeoPoint, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { FAN_DATA_SOURCES } from '../fan-data/sources';
import {
  accountSources,
  formatRestoreReport,
  isAccountUid,
  isRecoveryDatabase,
  parseRestoreArgs,
  parseRestorePath,
  RESTORE_USAGE,
  restoreKind,
  sameFirestoreValue,
  type RestoreReport,
} from './model';

// O roteiro de restauração (31.3): a linha de comando, os caminhos, as contas
// que a cópia conhece pela lista das fontes, a comparação e o resumo.

// Dois bancos só para montar referências: nada aqui fala com o Firestore.
const app = initializeApp({ projectId: 'demo-restauracao' }, 'restauracao-modelo');
const live = getFirestore(app);
const copy = getFirestore(app, 'recuperacao-20261015');

describe('o banco de recuperação', () => {
  it.each([
    ['recuperacao-20261015', true],
    ['recuperacao-20261015-b', true],
    ['recuperacao-a', true],
    ['(default)', false],
    ['recuperacao-', false],
    ['recuperacao-20261015-', false],
    ['recuperacao-2026_10_15', false],
    ['Recuperacao-20261015', false],
    ['copia-20261015', false],
    [`recuperacao-${'a'.repeat(51)}`, true],
    [`recuperacao-${'a'.repeat(52)}`, false],
  ])('%s: %s', (id, expected) => {
    expect(isRecoveryDatabase(id)).toBe(expected);
  });
});

describe('o caminho do --path', () => {
  it.each([
    ['rewards', 'rewards'],
    ['users/abc', 'users/abc'],
    ['users/abc/centrals', 'users/abc/centrals'],
    ['/rewards', null],
    ['rewards/', null],
    ['users//centrals', null],
    ['users/../staff', null],
    ['./rewards', null],
    ['__name__', null],
    ['users/__abc__', null],
    [' ', null],
    ['', null],
  ])('%s', (raw, expected) => {
    expect(parseRestorePath(raw)).toBe(expected);
  });
});

describe('a linha de comando', () => {
  const FROM = ['--from', 'recuperacao-20261015'];

  it('o --from, os --path, o --overwrite, o --dry-run e o --project, com espaço ou com =', () => {
    expect(
      parseRestoreArgs([
        '--from=recuperacao-20261015',
        '--path',
        'rewards',
        '--path=users/abc',
        '--overwrite',
        '--dry-run',
        '--project',
        'imagine-up-app',
      ]),
    ).toEqual({
      from: 'recuperacao-20261015',
      paths: ['rewards', 'users/abc'],
      overwrite: true,
      dryRun: true,
      project: 'imagine-up-app',
    });
  });

  it('sem --project, sem --overwrite e sem --dry-run; o caminho repetido entra uma vez', () => {
    expect(parseRestoreArgs([...FROM, '--path', 'rewards', '--path', 'rewards'])).toEqual({
      from: 'recuperacao-20261015',
      paths: ['rewards'],
      overwrite: false,
      dryRun: false,
    });
  });

  it.each([
    [[], 'Falta o --from.'],
    [['--path', 'rewards'], 'Falta o --from.'],
    [FROM, 'Falta ao menos um --path.'],
    [['--from', '(default)', '--path', 'rewards'], /nunca o \(default\)/],
    [['--from', 'outro-banco', '--path', 'rewards'], /banco de recuperação/],
    [['--from', '--path', 'rewards'], '--from sem o banco.'],
    [['--from=', '--path', 'rewards'], '--from sem o banco.'],
    [[...FROM, '--path'], '--path sem o caminho.'],
    [[...FROM, '--path', '/rewards'], 'Caminho fora do formato: /rewards'],
    [[...FROM, '--path', 'rewards', '--project'], '--project sem o id.'],
    [[...FROM, '--path', 'rewards', '--force'], 'Argumento desconhecido: --force'],
    [[...FROM, '--path', 'rewards', '--dry-run=sim'], 'Argumento desconhecido: --dry-run=sim'],
    [[...FROM, 'rewards'], 'Argumento desconhecido: rewards'],
    [[...FROM, '--path', 'staff'], /staff não volta pela coleção.*staff\/<id>/],
    [[...FROM, '--path', 'staffInvites'], /staffInvites não volta pela coleção/],
  ] as const)('%j: recusa', (args, error) => {
    const parsed = parseRestoreArgs(args);
    expect(parsed).toHaveProperty('error');
    expect((parsed as { error: string }).error).toMatch(error);
  });

  it('o staff e o staffInvites voltam por documento', () => {
    expect(
      parseRestoreArgs([...FROM, '--path', 'staff/abc', '--path', 'staffInvites/conv1']),
    ).toMatchObject({ paths: ['staff/abc', 'staffInvites/conv1'] });
  });

  it('o uso cita cada opção', () => {
    for (const option of ['--from', '--path', '--overwrite', '--dry-run', '--project']) {
      expect(RESTORE_USAGE).toContain(option);
    }
  });
});

describe('as contas que a cópia conhece', () => {
  it('toda fonte lida pelo uid entra; o Auth e o que não se acha pelo uid ficam de fora', () => {
    const sources = accountSources();
    const covered = (id: string) => {
      const { read } = FAN_DATA_SOURCES.find((source) => source.id === id)!;
      return sources.some((source) => {
        switch (read.kind) {
          case 'doc':
            return source.kind === 'ids' && source.collection === read.collection;
          case 'sub':
            return source.kind === 'ids' && source.collection === read.parent;
          case 'equal':
          case 'count':
            return (
              source.kind === 'field' &&
              !source.group &&
              source.collection === read.collection &&
              source.field === read.field
            );
          case 'group':
            return (
              source.kind === 'field' &&
              source.group &&
              source.collection === read.group &&
              source.field === read.field
            );
          case 'standings':
            return source.kind === 'standings';
          default:
            return false;
        }
      });
    };
    for (const source of FAN_DATA_SOURCES) {
      const outside = source.read.kind === 'auth' || source.read.kind === 'none';
      expect(covered(source.id), source.id).toBe(!outside);
    }
  });

  it('cada lugar entra uma vez, com as listas de bloqueio dos outros, que não são fonte da lista', () => {
    const keys = accountSources().map((source) => JSON.stringify(source));
    expect(new Set(keys).size).toBe(keys.length);
    expect(accountSources()).toContainEqual({ kind: 'ids', collection: 'users' });
    expect(accountSources()).toContainEqual({
      kind: 'field',
      collection: 'postComments',
      field: 'authorUid',
      group: true,
    });
    expect(accountSources().filter((source) => source.kind === 'list')).toEqual([
      { kind: 'list', collection: 'blockLists', field: 'blocked' },
    ]);
  });

  it.each([
    ['AbC123xyz', true],
    ['a'.repeat(128), true],
    ['a'.repeat(129), false],
    ['', false],
    ['seed-equipe', true],
    ['users/abc', false],
    [null, false],
    [42, false],
  ])('%j é uid de conta: %s', (value, expected) => {
    expect(isAccountUid(value)).toBe(expected);
  });
});

describe('a comparação dos valores do Firestore', () => {
  const at = Timestamp.fromMillis(1_760_000_000_000);

  it.each([
    ['textos iguais', 'a', 'a', true],
    ['textos diferentes', 'a', 'b', false],
    ['número e texto', 1, '1', false],
    ['NaN', Number.NaN, Number.NaN, true],
    ['null e ausente', null, undefined, false],
    ['Timestamp igual', at, Timestamp.fromMillis(1_760_000_000_000), true],
    ['Timestamp diferente', at, Timestamp.fromMillis(1_760_000_000_001), false],
    ['Timestamp e número', at, 1_760_000_000_000, false],
    ['GeoPoint igual', new GeoPoint(-12.2, -38.9), new GeoPoint(-12.2, -38.9), true],
    ['GeoPoint diferente', new GeoPoint(-12.2, -38.9), new GeoPoint(-12.2, -39), false],
    ['bytes iguais', Buffer.from([1, 2]), new Uint8Array([1, 2]), true],
    ['bytes diferentes', Buffer.from([1, 2]), Buffer.from([1, 3]), false],
    ['listas iguais', [1, 'a', [at]], [1, 'a', [at]], true],
    ['listas em outra ordem', [1, 2], [2, 1], false],
    ['lista e mapa', [1], { 0: 1 }, false],
    ['mapas iguais em outra ordem', { a: 1, b: { c: at } }, { b: { c: at }, a: 1 }, true],
    ['mapa com um campo a mais', { a: 1 }, { a: 1, b: null }, false],
    ['mapa com o campo trocado', { a: 1 }, { b: 1 }, false],
  ])('%s', (_name, a, b, expected) => {
    expect(sameFirestoreValue(a, b)).toBe(expected);
    expect(sameFirestoreValue(b, a)).toBe(expected);
  });

  it('a referência da cópia vale a do (default) com o mesmo caminho', () => {
    expect(sameFirestoreValue(copy.doc('artists/nenho'), live.doc('artists/nenho'))).toBe(true);
    expect(sameFirestoreValue(copy.doc('artists/nenho'), live.doc('artists/netto'))).toBe(false);
    expect(sameFirestoreValue(copy.doc('artists/nenho'), 'artists/nenho')).toBe(false);
  });
});

describe('o que acontece com cada documento', () => {
  const profile = { displayName: 'Bia', username: 'bia', photoPath: 'fans/abc/foto-1.jpg' };

  it.each([
    ['falta no (default)', 'rewards/a', { a: 1 }, undefined, false, 'create'],
    ['falta, com --overwrite', 'rewards/a', { a: 1 }, undefined, true, 'create'],
    ['igual', 'rewards/a', { a: 1 }, { a: 1 }, true, 'same'],
    ['diferente, sem --overwrite', 'rewards/a', { a: 1 }, { a: 2 }, false, 'differs'],
    ['diferente, com --overwrite', 'rewards/a', { a: 1 }, { a: 2 }, true, 'replace'],
    [
      'o perfil com outra foto, com --overwrite',
      'users/abc',
      profile,
      { ...profile, photoPath: 'fans/abc/foto-2.jpg' },
      true,
      'profile',
    ],
    [
      'o perfil sem foto na cópia e com foto agora',
      'users/abc',
      { ...profile, photoPath: null },
      profile,
      true,
      'profile',
    ],
    [
      'o perfil com foto na cópia e sem foto agora (o arquivo já saiu)',
      'users/abc',
      profile,
      { ...profile, photoPath: null },
      true,
      'profile',
    ],
    [
      'o perfil com outro @',
      'users/abc',
      profile,
      { ...profile, username: 'bia.santos' },
      true,
      'profile',
    ],
    [
      'o perfil com a mesma foto, o mesmo @ e outro nome',
      'users/abc',
      profile,
      { ...profile, displayName: 'Bia Santos' },
      true,
      'replace',
    ],
    [
      'o perfil sem foto dos dois lados (null e vazio valem igual)',
      'users/abc',
      { ...profile, photoPath: '', displayName: 'Bia S.' },
      { ...profile, photoPath: null },
      true,
      'replace',
    ],
    [
      'a foto diferente fora do perfil',
      'users/abc/uploads/x',
      profile,
      { ...profile, photoPath: 'fans/abc/foto-2.jpg' },
      true,
      'replace',
    ],
    [
      'o perfil com outra foto, sem --overwrite',
      'users/abc',
      profile,
      { ...profile, photoPath: 'fans/abc/foto-2.jpg' },
      false,
      'differs',
    ],
  ] as const)('%s', (_name, path, copyData, target, overwrite, expected) => {
    expect(restoreKind(path, copyData, target, overwrite)).toBe(expected);
  });
});

describe('o resumo da rodada', () => {
  const base: RestoreReport = {
    copy: 'recuperacao-20261015',
    paths: ['rewards', 'users/abc'],
    overwrite: false,
    dryRun: true,
    accounts: 3,
    reexcluded: ['sai1'],
    items: [
      { path: 'rewards/a', kind: 'create' },
      { path: 'rewards/b', kind: 'same' },
      { path: 'users/abc', kind: 'differs' },
    ],
    written: null,
    changed: [],
    late: [],
    error: null,
  };

  it('o --dry-run conta, lista o que mudaria e diz que nada foi gravado', () => {
    expect(formatRestoreReport(base)).toEqual([
      'Cópia: banco recuperacao-20261015. Destino: (default).',
      'Contas que a cópia conhece: 3.',
      'Sem conta no Auth hoje: 1, tiradas da cópia pelo deleteUserData antes de comparar (o (default) não muda): sai1.',
      'Caminhos: rewards, users/abc.',
      'Na cópia: 3 documentos. Criar: 1. Diferentes, mantidos (sem --overwrite): 1. Iguais: 1.',
      '  criar rewards/a',
      '  diferente users/abc',
      '--dry-run: nada gravado no (default).',
    ]);
  });

  it('a rodada de verdade, com --overwrite, o que a reexclusão criou, o que mudou no meio e a conta que saiu durante ela', () => {
    const lines = formatRestoreReport({
      ...base,
      overwrite: true,
      dryRun: false,
      reexcluded: [],
      items: [
        { path: 'artistStats/nenho/fanShards/7', kind: 'reexclusion' },
        { path: 'rewards/a', kind: 'create' },
        { path: 'rewards/c', kind: 'replace' },
        { path: 'users/abc', kind: 'profile' },
      ],
      written: { created: 1, replaced: 0 },
      changed: ['rewards/c'],
      late: ['abc'],
    });
    expect(lines).toEqual([
      'Cópia: banco recuperacao-20261015. Destino: (default).',
      'Contas que a cópia conhece: 3.',
      'Sem conta no Auth hoje: nenhuma.',
      'Caminhos: rewards, users/abc.',
      'Na cópia: 4 documentos. Criar: 1. Substituir: 1. Perfis mantidos (a foto ou o @ de agora): 1. Criados pela reexclusão, de fora: 1. Iguais: 0.',
      '  reexclusão artistStats/nenho/fanShards/7',
      '  criar rewards/a',
      '  substituir rewards/c',
      '  perfil users/abc',
      'Gravados no (default): 1 criados, 0 substituídos.',
      'Mudaram no (default) durante a rodada e ficaram como estavam: 1.',
      '  mudou rewards/c',
      'Atenção: saíram do Auth durante a rodada: abc. Os documentos delas podem ter voltado; confira antes de seguir (31.3).',
    ]);
  });

  it('a gravação que parou no meio diz o erro, depois do que foi gravado', () => {
    const lines = formatRestoreReport({
      ...base,
      dryRun: false,
      written: { created: 100, replaced: 0 },
      error: '10 ABORTED: Too much contention',
    });
    expect(lines.slice(-2)).toEqual([
      'Gravados no (default): 100 criados, 0 substituídos.',
      'A gravação parou no meio, com o erro abaixo; o que foi gravado antes ficou. Rodar de novo é seguro (o que já voltou sai como igual): 10 ABORTED: Too much contention',
    ]);
  });

  it('nenhum texto tem travessão nem meia-risca', () => {
    const lines = formatRestoreReport({
      ...base,
      dryRun: false,
      items: [...base.items, { path: 'a/b', kind: 'reexclusion' }],
      written: { created: 0, replaced: 0 },
      changed: ['a/b'],
      late: ['c'],
      error: 'x',
    });
    for (const text of [...lines, RESTORE_USAGE]) expect(text).not.toMatch(/[–—]/);
  });
});
