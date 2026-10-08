import { describe, expect, it } from 'vitest';

import {
  asc,
  contains,
  desc,
  hasComposite,
  hasSingleField,
  readIndexes,
  type CompositeShape,
  type SingleFieldShape,
} from '../../test/indexes';

// O emulador não exige índice nenhum. A tarefa das cópias do perfil (24.7) e
// a exclusão de conta (21.11) leem os comentários do fã pelo grupo
// `postComments` com `authorUid ==` (a tarefa, com a ordem pelo id): as duas
// dependem do escopo COLLECTION_GROUP ascendente na isenção de
// `postComments.authorUid` (24.10). Desde o bloco 11 (26.11 e 26.16), este
// arquivo confere também as consultas das seções Fãs e Moderação do painel:
// cada uma com o índice composto, ou com o índice automático do campo. As
// listas carregam de uma vez e pelo "Carregar mais" com a mesma forma (o
// cursor não muda o índice), sem escuta. A trilha do painel que mudar uma
// consulta muda a forma aqui.

const file = readIndexes();

describe('índice das cópias do perfil (24.10)', () => {
  it('a isenção de postComments.authorUid mantém o escopo COLLECTION_GROUP ascendente', () => {
    expect(
      hasSingleField(file, {
        name: 'comentários do fã pelo grupo',
        collectionGroup: 'postComments',
        queryScope: 'COLLECTION_GROUP',
        field: asc('authorUid'),
      }),
    ).toBe(true);
  });
});

const COMPOSITE: CompositeShape[] = [
  // Fãs: lista e ficha.
  {
    name: 'Fãs: os fãs de uma central, do mais novo nela',
    collectionGroup: 'centrals',
    queryScope: 'COLLECTION_GROUP',
    fields: [asc('artistId'), desc('joinedAt')],
  },
  {
    name: 'Fãs: as pessoas que um fã trouxe, da mais nova',
    collectionGroup: 'referrals',
    queryScope: 'COLLECTION',
    fields: [asc('inviterUid'), desc('claimedAt')],
  },
  {
    name: 'Fãs: as curtidas de um fã, das mais novas',
    collectionGroup: 'postLikes',
    queryScope: 'COLLECTION',
    fields: [asc('liked'), desc('updatedAt')],
  },
  {
    name: 'Fãs: as presenças de um fã, das mais novas',
    collectionGroup: 'eventRsvps',
    queryScope: 'COLLECTION',
    fields: [asc('going'), desc('updatedAt')],
  },
  {
    name: 'Fãs e Moderação: os comentários de um fã, do mais novo',
    collectionGroup: 'postComments',
    queryScope: 'COLLECTION_GROUP',
    fields: [asc('authorUid'), desc('createdAt')],
  },
  {
    name: 'Fãs: os resgates de um fã, do mais novo (índice de 25.10)',
    collectionGroup: 'redemptions',
    queryScope: 'COLLECTION',
    fields: [asc('uid'), desc('requestedAt')],
  },
  // Moderação: a fila e as ferramentas do fã.
  {
    name: 'Moderação: a fila aberta, da última denúncia, e o "Carregar mais" dela (índice de 21.11)',
    collectionGroup: 'moderationQueue',
    queryScope: 'COLLECTION',
    fields: [asc('status'), desc('lastReportedAt')],
  },
  {
    name: 'Moderação: os resolvidos, do mais novo',
    collectionGroup: 'moderationQueue',
    queryScope: 'COLLECTION',
    fields: [asc('status'), desc('resolvedAt')],
  },
  {
    name: 'Moderação: os itens de um fã na fila, da última denúncia',
    collectionGroup: 'moderationQueue',
    queryScope: 'COLLECTION',
    fields: [asc('authorUid'), desc('lastReportedAt')],
  },
  {
    name: 'Moderação: os comentários ocultos, do mais novo',
    collectionGroup: 'postComments',
    queryScope: 'COLLECTION_GROUP',
    fields: [asc('status'), desc('hiddenAt')],
  },
  {
    name: 'Moderação: os comentários visíveis de um fã (a contagem e o hideFanComments)',
    collectionGroup: 'postComments',
    queryScope: 'COLLECTION_GROUP',
    fields: [asc('authorUid'), asc('status')],
  },
];

const SINGLE: SingleFieldShape[] = [
  {
    name: 'Fãs: os mais novos',
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    field: desc('createdAt'),
  },
  {
    name: 'Fãs: a busca pelas chaves (array-contains, sem ordem)',
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    field: contains('searchKeys'),
  },
  {
    name: 'Fãs: a busca pelo começo do @',
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    field: asc('username'),
  },
  {
    name: 'Fãs e Moderação: os suspensos, do mais novo',
    collectionGroup: 'users',
    queryScope: 'COLLECTION',
    field: desc('suspendedAt'),
  },
  {
    name: 'Fãs: os de mais XP',
    collectionGroup: 'wallets',
    queryScope: 'COLLECTION',
    field: desc('xp'),
  },
  {
    name: 'Fãs: quem bateu a meta da temporada',
    collectionGroup: 'wallets',
    queryScope: 'COLLECTION',
    field: asc('goalReached.seasonId'),
  },
  {
    name: 'Fãs: o dono de um código de convite',
    collectionGroup: 'fanInvites',
    queryScope: 'COLLECTION',
    field: asc('code'),
  },
  {
    name: 'Fãs: o extrato de um fã, do mais novo',
    collectionGroup: 'ledger',
    queryScope: 'COLLECTION',
    field: desc('createdAt'),
  },
];

describe('índices das seções Fãs e Moderação do painel (26.11)', () => {
  it.each(COMPOSITE.map((shape) => [shape.name, shape] as const))(
    '%s tem o índice composto',
    (_name, shape) => {
      expect(hasComposite(file, shape)).toBe(true);
    },
  );

  it.each(SINGLE.map((shape) => [shape.name, shape] as const))(
    '%s usa o índice automático do campo',
    (_name, shape) => {
      expect(hasSingleField(file, shape)).toBe(true);
    },
  );
});
