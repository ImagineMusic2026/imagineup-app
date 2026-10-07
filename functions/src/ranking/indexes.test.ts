import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RANKING_QUERY_SHAPES } from './model';

// O emulador não exige índice nenhum: os testes de emulador provam que as
// consultas rodam e dão a ordem certa, mas não que o índice existe. Este
// confere que cada formato do ranking (a lista e as três contagens, nos dois
// recortes) tem o índice composto no firestore.indexes.json, com os mesmos
// campos e direções (23.12). Sem ele, em produção, a rota responde 500.

type Index = {
  collectionGroup: string;
  queryScope: string;
  fields: { fieldPath: string; order?: string; arrayConfig?: string }[];
};

const indexes = JSON.parse(
  readFileSync(resolve(__dirname, '../../../firestore.indexes.json'), 'utf8'),
) as { indexes: Index[]; fieldOverrides: { collectionGroup: string; fieldPath: string }[] };

describe('índices do ranking (23.12)', () => {
  it.each(RANKING_QUERY_SHAPES.map((shape) => [shape.name, shape] as const))(
    '%s tem o índice composto',
    (_name, shape) => {
      const found = indexes.indexes.some(
        (index) =>
          index.collectionGroup === shape.collectionGroup &&
          index.queryScope === shape.queryScope &&
          JSON.stringify(index.fields) === JSON.stringify(shape.fields),
      );
      expect(found).toBe(true);
    },
  );

  it('nenhuma consulta do ranking usa limitToLast (a consulta invertida pede outro índice)', () => {
    // O SDK manda o `limitToLast` com todas as direções invertidas, e o
    // Firestore não percorre índice composto ao contrário: a meta do card
    // "Você" com ele respondia 500 em produção do 2º ao 10º (23.19).
    const sources = readdirSync(__dirname).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    const offenders = sources.filter((file) =>
      /\.limitToLast\(/.test(readFileSync(resolve(__dirname, file), 'utf8')),
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('as isenções dos campos que ninguém consulta', () => {
    const exempt = indexes.fieldOverrides.map(
      (item) => `${item.collectionGroup}.${item.fieldPath}`,
    );
    expect(exempt).toEqual(
      expect.arrayContaining([
        'wallets.rankWeek',
        'wallets.stats',
        'centralPoints.rankWeek',
        'centralPoints.updatedAt',
        'centralPoints.seasonPointsAt',
        'seasons.centrals',
        'standings.displayName',
        'standings.photoURL',
        'standings.city',
      ]),
    );
  });
});
