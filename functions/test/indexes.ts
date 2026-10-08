import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * O que os testes de índice dividem (bloco 11, docs/arquitetura-api.md,
 * 26.11): o emulador não exige índice nenhum, e a falta só aparece em
 * produção (o código 9). Cada consulta vira uma forma, conferida no
 * firestore.indexes.json: a composta precisa do índice com os mesmos campos e
 * direções, na mesma ordem (as igualdades primeiro, depois a ordem); a de um
 * campo só usa o índice automático, que não pode ter sido tirado por uma
 * isenção (e no grupo de coleção precisa da isenção que o liga).
 */
export type IndexField = {
  fieldPath: string;
  order?: 'ASCENDING' | 'DESCENDING';
  arrayConfig?: 'CONTAINS';
};

export type QueryScope = 'COLLECTION' | 'COLLECTION_GROUP';

/** Uma consulta que pede índice composto. */
export type CompositeShape = {
  name: string;
  collectionGroup: string;
  queryScope: QueryScope;
  fields: IndexField[];
};

/** Uma consulta que usa o índice automático de um campo. */
export type SingleFieldShape = {
  name: string;
  collectionGroup: string;
  queryScope: QueryScope;
  field: IndexField;
};

type IndexesFile = {
  indexes: { collectionGroup: string; queryScope: string; fields: IndexField[] }[];
  fieldOverrides: {
    collectionGroup: string;
    fieldPath: string;
    ttl?: boolean;
    indexes: (Omit<IndexField, 'fieldPath'> & { queryScope: string })[];
  }[];
};

export const asc = (fieldPath: string): IndexField => ({ fieldPath, order: 'ASCENDING' });
export const desc = (fieldPath: string): IndexField => ({ fieldPath, order: 'DESCENDING' });
export const contains = (fieldPath: string): IndexField => ({ fieldPath, arrayConfig: 'CONTAINS' });

export function readIndexes(): IndexesFile {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../firestore.indexes.json'), 'utf8'),
  ) as IndexesFile;
}

/** O índice composto da forma existe, com os mesmos campos e direções, na mesma ordem. */
export function hasComposite(file: IndexesFile, shape: CompositeShape): boolean {
  return file.indexes.some(
    (index) =>
      index.collectionGroup === shape.collectionGroup &&
      index.queryScope === shape.queryScope &&
      JSON.stringify(index.fields) === JSON.stringify(shape.fields),
  );
}

/**
 * O índice de um campo existe: sem isenção, o automático vale no escopo da
 * coleção; com isenção, ela precisa listar o índice; no grupo de coleção, só
 * a isenção liga o índice.
 */
export function hasSingleField(file: IndexesFile, shape: SingleFieldShape): boolean {
  const override = file.fieldOverrides.find(
    (item) =>
      item.collectionGroup === shape.collectionGroup && item.fieldPath === shape.field.fieldPath,
  );
  if (!override) return shape.queryScope === 'COLLECTION';
  return override.indexes.some(
    (index) =>
      index.queryScope === shape.queryScope &&
      index.order === shape.field.order &&
      index.arrayConfig === shape.field.arrayConfig,
  );
}

/** As isenções (`<grupo>.<campo>`) do arquivo. */
export function exemptions(file: IndexesFile): string[] {
  return file.fieldOverrides.map((item) => `${item.collectionGroup}.${item.fieldPath}`);
}
