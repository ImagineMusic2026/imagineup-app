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
// campo; desde a Fase 2 (seção 37, 37.4), os 3 dos comentários e, desde a
// etapa 3 de 37.13, os 3 da fila da equipe e do registro do ocultar. O emulador
// não cobra índice nenhum (e os de grupo só aparecem em produção): este teste
// é a rede. A trilha que mudar uma consulta muda a forma aqui.

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
  // A cópia da noite (etapa 4): o `in` no status e a ordem crescente da cópia.
  shape('a cópia da noite (in em active e paused)', 'fanClubs', [asc('status'), asc('counts.at')]),
  // A Início (etapa 4) usa a mesma forma com o `in` no `clubId` (até 30 por bloco).
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
  // A contagem dos novos em 30 dias (o `followersQuery` com o `since`, na
  // página, nos números e na cópia) leva o `orderBy('followedAt', 'desc')` de
  // propósito, para usar esta forma: sem ele, a faixa ordenaria pelo
  // `followedAt` crescente, que pede outro índice. As três da cópia somam uma
  // igualdade ao `clubId` do `followersQuery`.
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
  // A Fase 2 (seção 37, 37.4). Os comentários de cima filtram o `replyToId`
  // nulo, que o índice cobre (todo comentário nasce com o campo gravado), e o
  // id desempata na mesma direção da data, como os comentários do Mural.
  shape('os comentários de cima de uma publicação', 'fanClubComments', [
    asc('postId'),
    asc('replyToId'),
    asc('status'),
    desc('createdAt'),
    desc('__name__'),
  ]),
  shape('as respostas de um comentário, da mais antiga', 'fanClubComments', [
    asc('replyToId'),
    asc('status'),
    asc('createdAt'),
    asc('__name__'),
  ]),
  // A lista do painel (a etapa 8) e a conversa da sugestão do @ (a etapa 2).
  shape('os comentários de uma publicação em todos os status', 'fanClubComments', [
    asc('postId'),
    desc('createdAt'),
  ]),
  // A fila da equipe e o registro do ocultar do gestor (a etapa 3 de 37.13):
  // a aba Comentários do painel, pela última atividade (a denúncia ou o
  // pedido) e pela resolução, e a seção "Ocultos pelo gestor" da ficha.
  shape('os comentários abertos na fila, pela última atividade', 'fanClubCommentQueue', [
    asc('status'),
    desc('lastActivityAt'),
  ]),
  shape('os comentários resolvidos na fila', 'fanClubCommentQueue', [
    asc('status'),
    desc('resolvedAt'),
  ]),
  shape('o registro do ocultar do gestor na ficha', 'fanClubHideLog', [asc('clubId'), desc('at')]),
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
  // Os seguidos do fã, do mais novo: "Fã-clubes que sigo" e os 20 da Início
  // (etapa 4). A suspensão e o count() do follow_limit leem a subcoleção sem
  // filtro nem ordem, sem índice.
  single('fanClubFollows.followedAt (decrescente)', 'fanClubFollows', desc('followedAt')),
  // O count() de todos os seguidores (a página, os números e a cópia) e dos
  // trazidos que ficaram (a cópia), no grupo.
  single('grupo fanClubFollows.clubId', 'fanClubFollows', asc('clubId'), 'COLLECTION_GROUP'),
  single('grupo centrals.fanClubId', 'centrals', asc('fanClubId'), 'COLLECTION_GROUP'),
  // O pedido de prêmio de uma concessão, na repetição do Recompensar (etapa 5):
  // só a igualdade, e o painel com `rewards` acha o pedido do mesmo jeito.
  single('redemptions.grantId', 'redemptions', asc('grantId')),
  // O histórico de `prizes` da ficha, pela data (34.10, item 5): o automático.
  single('prizes.at (decrescente)', 'prizes', desc('at')),
  // A moderação dos comentários (seção 37, 37.4; a etapa 3 de 37.13), só
  // igualdades, pela junção dos índices de um campo: o ocultar em lote (o
  // `authorUid` com o `in` do status), os próprios ocultos de quem lê
  // (`postId`, `authorUid` e `status`, o `ownHidden`) e as contagens da fila
  // por status e tipo (o "Aguardando a equipe" do painel).
  single('fanClubComments.authorUid', 'fanClubComments', asc('authorUid')),
  single('fanClubComments.status', 'fanClubComments', asc('status')),
  single('fanClubComments.postId', 'fanClubComments', asc('postId')),
  single('fanClubCommentQueue.status', 'fanClubCommentQueue', asc('status')),
  single('fanClubCommentQueue.kind', 'fanClubCommentQueue', asc('kind')),
  single('fanClubCommentReports.reporterUid', 'fanClubCommentReports', asc('reporterUid')),
];

describe('os índices do fã-clube (34.6)', () => {
  it('são 27 compostos do fã-clube (21 da seção 34 e 6 da 37), 71 no total', () => {
    expect(COMPOSITE).toHaveLength(27);
    expect(file.indexes).toHaveLength(71);
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
      // A Fase 2 (seção 37, 37.4): o texto e as marcações do comentário, as
      // marcações da publicação e o mapa dos dias da taxa nos shards, que
      // ganha uma chave por dia e ninguém consulta.
      ['fanClubComments', 'text'],
      ['fanClubComments', 'mentions'],
      ['fanClubPosts', 'mentions'],
      ['fanClubShards', 'days'],
      // A etapa 3: a contagem por motivo da fila dos comentários.
      ['fanClubCommentQueue', 'reasons'],
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
