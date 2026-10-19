import { describe, expect, it } from 'vitest';

import { asc, hasSingleField, readIndexes, type SingleFieldShape } from '../../test/indexes';
import { FAN_DATA_SOURCES, type FanDataSource } from './sources';

// O emulador não exige índice nenhum (32.5 e 32.17): as consultas da
// exportação dos dados do fã (seção 32) viram formas, conferidas no
// firestore.indexes.json. Todas são uma igualdade num campo, com a ordem pelo
// id (ascendente, a de sempre do índice automático) ou a contagem: usam o
// índice automático do campo, sem índice composto e sem isenção nova; o grupo
// `postComments` por `authorUid` usa a isenção com o escopo COLLECTION_GROUP
// ascendente que já existe (24.10). As subcoleções do fã vão só pela ordem do
// id, e as temporadas pelos ids (`select()`) e um `getAll`: nenhum índice.

const file = readIndexes();

/** A forma de cada consulta que a exportação faz por um campo (as fontes do arquivo). */
function shapeOf(source: FanDataSource): SingleFieldShape | null {
  if (source.place.in === 'out') return null;
  const { read } = source;
  if (read.kind === 'equal' || read.kind === 'count') {
    return {
      name: source.id,
      collectionGroup: read.collection,
      queryScope: 'COLLECTION',
      field: asc(read.field),
    };
  }
  if (read.kind === 'group') {
    return {
      name: source.id,
      collectionGroup: read.group,
      queryScope: 'COLLECTION_GROUP',
      field: asc(read.field),
    };
  }
  return null;
}

const SHAPES = FAN_DATA_SOURCES.map(shapeOf).filter(
  (shape): shape is SingleFieldShape => shape !== null,
);

describe('os índices da exportação dos dados do fã (32.5)', () => {
  it('as consultas por um campo são as de 32.5', () => {
    expect(
      SHAPES.map(
        (shape) => `${shape.queryScope} ${shape.collectionGroup}.${shape.field.fieldPath}`,
      ),
    ).toEqual([
      'COLLECTION usernames.uid',
      'COLLECTION inviteCodes.uid',
      'COLLECTION referrals.inviterUid',
      'COLLECTION_GROUP postComments.authorUid',
      'COLLECTION commentReports.reporterUid',
      'COLLECTION profileReports.reporterUid',
      'COLLECTION redemptions.uid',
      'COLLECTION fanClubs.ownerUid',
      'COLLECTION fanClubPosts.authorUid',
      'COLLECTION fanClubReports.reporterUid',
    ]);
  });

  it.each(SHAPES.map((shape) => [shape.name, shape] as const))(
    '%s usa o índice automático do campo (ou a isenção do grupo)',
    (_name, shape) => {
      expect(hasSingleField(file, shape)).toBe(true);
    },
  );

  it('as partes das subcoleções e as temporadas não consultam campo nenhum', () => {
    const byIdOnly = FAN_DATA_SOURCES.filter(
      (source) =>
        source.place.in !== 'out' &&
        (source.read.kind === 'sub' || source.read.kind === 'standings'),
    ).map((source) => source.id);
    expect(byIdOnly).toEqual([
      'users.centrals',
      'users.postLikes',
      'users.eventRsvps',
      'wallets.ledger',
      'wallets.centralPoints',
      'fanInvites.inviteLinks',
      'standings',
    ]);
  });
});
