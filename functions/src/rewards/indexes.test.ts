import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// O emulador não exige índice nenhum: os testes de emulador provam que as
// consultas rodam e dão a ordem certa, mas não que o índice existe. Este
// confere que cada consulta da loja (a loja do fã e as listas do painel, 25.8
// e 25.10) tem o índice composto no firestore.indexes.json, com os mesmos
// campos e direções. Sem ele, em produção, a rota responde 500 (código 9).

type Field = { fieldPath: string; order: 'ASCENDING' | 'DESCENDING' };
type Index = { collectionGroup: string; queryScope: string; fields: Field[] };

const indexes = JSON.parse(
  readFileSync(resolve(__dirname, '../../../firestore.indexes.json'), 'utf8'),
) as {
  indexes: Index[];
  fieldOverrides: { collectionGroup: string; fieldPath: string; indexes: unknown[] }[];
};

const asc = (fieldPath: string): Field => ({ fieldPath, order: 'ASCENDING' });
const desc = (fieldPath: string): Field => ({ fieldPath, order: 'DESCENDING' });

/** As consultas que pedem índice composto (as igualdades primeiro, depois a ordem). */
const SHAPES: { name: string; collectionGroup: string; fields: Field[] }[] = [
  {
    name: 'a loja: as no ar na ordem do painel, com o id desempatando',
    collectionGroup: 'rewards',
    fields: [asc('status'), asc('order'), asc('__name__')],
  },
  {
    name: 'a loja: os pedidos do fã, do mais novo',
    collectionGroup: 'redemptions',
    fields: [asc('uid'), desc('requestedAt')],
  },
  {
    name: 'o painel: todos os pedidos de uma recompensa, do mais novo',
    collectionGroup: 'redemptions',
    fields: [asc('rewardId'), desc('requestedAt')],
  },
  {
    name: 'o painel: os fechados de uma recompensa, do mais novo',
    collectionGroup: 'redemptions',
    fields: [asc('rewardId'), asc('status'), desc('requestedAt')],
  },
  {
    name: 'o painel: a fila dos abertos de uma recompensa, do mais antigo',
    collectionGroup: 'redemptions',
    fields: [asc('rewardId'), asc('status'), asc('requestedAt')],
  },
  {
    name: 'o painel: os fechados de todas as recompensas, do mais novo',
    collectionGroup: 'redemptions',
    fields: [asc('status'), desc('requestedAt')],
  },
  {
    name: 'o painel: a fila dos abertos de todas as recompensas, do mais antigo',
    collectionGroup: 'redemptions',
    fields: [asc('status'), asc('requestedAt')],
  },
];

describe('índices da loja (25.10)', () => {
  it.each(SHAPES.map((shape) => [shape.name, shape] as const))(
    '%s tem o índice composto',
    (_name, shape) => {
      const found = indexes.indexes.some(
        (index) =>
          index.collectionGroup === shape.collectionGroup &&
          index.queryScope === 'COLLECTION' &&
          JSON.stringify(index.fields) === JSON.stringify(shape.fields),
      );
      expect(found).toBe(true);
    },
  );

  it('a consulta da loja no código é a do índice (status, order, id)', () => {
    const service = readFileSync(resolve(__dirname, 'service.ts'), 'utf8');
    expect(service).toMatch(
      /\.where\('status', '==', 'published'\)\s*\.orderBy\('order'\)\s*\.orderBy\(FieldPath\.documentId\(\)\)/,
    );
    expect(service).toMatch(/\.where\('uid', '==', uid\)\s*\.orderBy\('requestedAt', 'desc'\)/);
  });

  it('a consulta do limite por fã só tem igualdades (junção dos índices simples, sem composto)', () => {
    const compact = readFileSync(resolve(__dirname, 'service.ts'), 'utf8').replace(/\s+/g, '');
    const query = "redemptionsRef(db).where('uid','==',fan.uid).where('rewardId','==',rewardId)";
    const at = compact.indexOf(query);
    expect(at).toBeGreaterThan(-1);
    // Até o fim do ternário (`: Promise.resolve(null)`), nada de orderBy.
    const rest = compact.slice(at + query.length, compact.indexOf(':', at + query.length));
    expect(rest).not.toContain('orderBy');
    expect(
      indexes.indexes.some(
        (index) =>
          index.collectionGroup === 'redemptions' &&
          index.fields.map((field) => field.fieldPath).join() === 'uid,rewardId',
      ),
    ).toBe(false);
  });

  it('os textos, a foto e o mapa por recompensa ficam sem índice', () => {
    const exempt = (collectionGroup: string, fieldPath: string) =>
      indexes.fieldOverrides.some(
        (item) =>
          item.collectionGroup === collectionGroup &&
          item.fieldPath === fieldPath &&
          Array.isArray(item.indexes) &&
          item.indexes.length === 0,
      );
    for (const [group, field] of [
      ['rewards', 'description'],
      ['rewards', 'instructions'],
      ['rewards', 'photo'],
      ['redemptions', 'instructions'],
      ['redemptions', 'refusalReason'],
      ['statsShards', 'byReward'],
    ] as const) {
      expect(exempt(group, field)).toBe(true);
    }
  });
});
