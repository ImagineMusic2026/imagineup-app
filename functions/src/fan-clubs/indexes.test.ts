import { describe, expect, it } from 'vitest';

import {
  asc,
  desc,
  exemptions,
  hasComposite,
  hasSingleField,
  readIndexes,
  type CompositeShape,
  type IndexField,
  type QueryScope,
  type SingleFieldShape,
} from '../../test/indexes';

// As consultas do fã-clube gerido pelo fã (docs/arquitetura-api.md, 34.6),
// as do servidor e as do painel, com os 21 índices compostos e os de um
// campo. O emulador não cobra índice nenhum (e os de grupo só aparecem em
// produção): este teste é a rede. A trilha que mudar uma consulta muda a
// forma aqui.

const file = readIndexes();

const shape = (
  name: string,
  collectionGroup: string,
  fields: IndexField[],
  queryScope: QueryScope = 'COLLECTION',
): CompositeShape => ({ name, collectionGroup, queryScope, fields });

const COMPOSITE: CompositeShape[] = [
  shape('as candidaturas pendentes, da mais antiga', 'fanClubApplications', [
    asc('status'),
    asc('submittedAt'),
  ]),
  shape('as candidaturas por artista e as centrais que a pessoa cuida', 'fanClubApplications', [
    asc('artistId'),
    asc('status'),
    asc('submittedAt'),
  ]),
  shape('as candidaturas resolvidas', 'fanClubApplications', [asc('status'), desc('decidedAt')]),
  shape('a lista por seguidores', 'fanClubs', [asc('status'), desc('counts.followers')]),
  shape('a lista por novos em 30 dias', 'fanClubs', [asc('status'), desc('counts.followers30d')]),
  shape('a lista pela aprovação', 'fanClubs', [asc('status'), desc('approvedAt')]),
  shape('por artista, por seguidores (e o GET /artists/:artistId/fan-clubs)', 'fanClubs', [
    asc('artistId'),
    asc('status'),
    desc('counts.followers'),
  ]),
  shape('por artista, por novos em 30 dias', 'fanClubs', [
    asc('artistId'),
    asc('status'),
    desc('counts.followers30d'),
  ]),
  shape('por artista, pela aprovação', 'fanClubs', [
    asc('artistId'),
    asc('status'),
    desc('approvedAt'),
  ]),
  shape('o filtro Destaque', 'fanClubs', [asc('featured'), asc('featuredUntil')]),
  shape('a cópia da noite (in em active e paused)', 'fanClubs', [asc('status'), asc('counts.at')]),
  shape('a página do fã-clube e a Início', 'fanClubPosts', [
    asc('clubId'),
    asc('status'),
    desc('publishedAt'),
  ]),
  shape('a fila de revisão', 'fanClubPosts', [asc('status'), asc('submittedAt')]),
  shape('as publicações do gestor', 'fanClubPosts', [asc('authorUid'), desc('submittedAt')]),
  shape('a ficha do fã-clube, em todos os status', 'fanClubPosts', [
    asc('clubId'),
    desc('submittedAt'),
  ]),
  shape('as denúncias abertas', 'fanClubReportQueue', [asc('status'), desc('lastReportedAt')]),
  shape('as denúncias resolvidas', 'fanClubReportQueue', [asc('status'), desc('resolvedAt')]),
  shape(
    'os seguidores recentes e os novos em 30 dias',
    'fanClubFollows',
    [asc('clubId'), desc('followedAt')],
    'COLLECTION_GROUP',
  ),
  shape(
    'a cópia: as contas novas',
    'fanClubFollows',
    [asc('clubId'), asc('newAccount')],
    'COLLECTION_GROUP',
  ),
  shape(
    'a cópia: o @ automático',
    'fanClubFollows',
    [asc('clubId'), asc('chosenUsername')],
    'COLLECTION_GROUP',
  ),
  shape(
    'a cópia: os trazidos pelo gestor',
    'fanClubFollows',
    [asc('clubId'), asc('byOwnerCode')],
    'COLLECTION_GROUP',
  ),
];

const single = (
  name: string,
  collectionGroup: string,
  field: IndexField,
  queryScope: QueryScope = 'COLLECTION',
): SingleFieldShape => ({ name, collectionGroup, queryScope, field });

const SINGLE: SingleFieldShape[] = [
  // O has-content do removeArtist e os destacados de um artista: só igualdades
  // (e o `in`), pela junção dos índices de um campo.
  single('fanClubs.artistId', 'fanClubs', asc('artistId')),
  single('fanClubs.status', 'fanClubs', asc('status')),
  single('fanClubs.featured', 'fanClubs', asc('featured')),
  // Os fã-clubes do gestor: as cópias do perfil, a exclusão e a exportação.
  single('fanClubs.ownerUid', 'fanClubs', asc('ownerUid')),
  // As publicações e as denúncias de um fã, na exclusão (etapa 2).
  single('fanClubPosts.authorUid', 'fanClubPosts', asc('authorUid')),
  single('fanClubReports.reporterUid', 'fanClubReports', asc('reporterUid')),
  // Os seguimentos de um artista no leaveCentral (etapa 4).
  single('fanClubFollows.artistId', 'fanClubFollows', asc('artistId')),
  // O count() de todos os seguidores e dos trazidos que ficaram, no grupo.
  single('grupo fanClubFollows.clubId', 'fanClubFollows', asc('clubId'), 'COLLECTION_GROUP'),
  single('grupo centrals.fanClubId', 'centrals', asc('fanClubId'), 'COLLECTION_GROUP'),
];

describe('os índices do fã-clube (34.6)', () => {
  it('são 21 compostos novos, 65 no total', () => {
    expect(COMPOSITE).toHaveLength(21);
    expect(file.indexes).toHaveLength(65);
  });

  it.each(COMPOSITE.map((item) => [item.name, item] as const))(
    '%s tem o índice composto',
    (_name, item) => {
      expect(hasComposite(file, item)).toBe(true);
    },
  );

  it.each(SINGLE.map((item) => [item.name, item] as const))(
    '%s usa o índice de um campo',
    (_name, item) => {
      expect(hasSingleField(file, item)).toBe(true);
    },
  );

  it('os textos que ninguém consulta ficam sem índice', () => {
    const exempt = [
      ['fanClubPosts', 'text'],
      ['fanClubApplicationPrivate', 'pitch'],
      ['fanClubReportQueue', 'reasons'],
      ['prizes', 'note'],
      ['redemptions', 'coupon'],
      ['redemptions', 'message'],
    ] as const;
    expect(exemptions(file)).toEqual(
      expect.arrayContaining(exempt.map(([group, field]) => `${group}.${field}`)),
    );
    for (const [group, field] of exempt) {
      const item = file.fieldOverrides.find(
        (override) => override.collectionGroup === group && override.fieldPath === field,
      );
      expect(item?.indexes, `${group}.${field}`).toEqual([]);
    }
  });
});
