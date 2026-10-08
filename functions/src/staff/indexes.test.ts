import { describe, expect, it } from 'vitest';

import {
  asc,
  contains,
  desc,
  exemptions,
  hasComposite,
  hasSingleField,
  readIndexes,
  type CompositeShape,
  type SingleFieldShape,
} from '../../test/indexes';

// As consultas dos Logs do painel (bloco 11, 26.11 e 26.16): staffAudit do
// mais novo, 50 por vez, com o período como faixa no `createdAt` e um filtro
// por vez entre pessoa, seção, pessoa com seção, ação e alvo. O filtro de
// ação manda só `action ==` (a ação já diz a seção): seção com ação pediria
// outro índice. A trilha do painel que mudar uma consulta muda a forma aqui.

const file = readIndexes();

const COMPOSITE: CompositeShape[] = [
  {
    name: 'por pessoa',
    collectionGroup: 'staffAudit',
    queryScope: 'COLLECTION',
    fields: [asc('actorUid'), desc('createdAt')],
  },
  {
    name: 'por seção',
    collectionGroup: 'staffAudit',
    queryScope: 'COLLECTION',
    fields: [asc('section'), desc('createdAt')],
  },
  {
    name: 'por pessoa e seção',
    collectionGroup: 'staffAudit',
    queryScope: 'COLLECTION',
    fields: [asc('actorUid'), asc('section'), desc('createdAt')],
  },
  {
    name: 'por ação (só action ==)',
    collectionGroup: 'staffAudit',
    queryScope: 'COLLECTION',
    fields: [asc('action'), desc('createdAt')],
  },
  {
    name: 'por alvo',
    collectionGroup: 'staffAudit',
    queryScope: 'COLLECTION',
    fields: [contains('targets'), desc('createdAt')],
  },
];

const SINGLE: SingleFieldShape[] = [
  {
    name: 'sem filtro, do mais novo, com o período',
    collectionGroup: 'staffAudit',
    queryScope: 'COLLECTION',
    field: desc('createdAt'),
  },
];

describe('índices dos Logs (26.11)', () => {
  it.each(COMPOSITE.map((shape) => [shape.name, shape] as const))(
    '%s tem o índice composto',
    (_name, shape) => {
      expect(hasComposite(file, shape)).toBe(true);
    },
  );

  it.each(SINGLE.map((shape) => [shape.name, shape] as const))(
    '%s usa o índice automático',
    (_name, shape) => {
      expect(hasSingleField(file, shape)).toBe(true);
    },
  );

  it('a seção com a ação não tem índice: o filtro de ação vai sozinho', () => {
    expect(
      hasComposite(file, {
        name: 'seção e ação',
        collectionGroup: 'staffAudit',
        queryScope: 'COLLECTION',
        fields: [asc('action'), asc('section'), desc('createdAt')],
      }),
    ).toBe(false);
  });

  it('o details da auditoria e o orçamento do dia ficam sem índice; o orçamento sai pelo TTL', () => {
    expect(exemptions(file)).toEqual(
      expect.arrayContaining(['staffAudit.details', 'staffLimits.expiresAt']),
    );
    const ttl = file.fieldOverrides.find(
      (item) => item.collectionGroup === 'staffLimits' && item.fieldPath === 'expiresAt',
    );
    expect(ttl).toMatchObject({ ttl: true, indexes: [] });
  });
});
