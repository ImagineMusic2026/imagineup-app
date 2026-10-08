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

// As consultas do Mural e da Agenda de Artistas e da escolha do alvo de uma
// missão no painel (bloco 11, 26.11 e 26.16): cada uma com o índice composto,
// ou com o índice automático do campo. O emulador não exige índice, e a falta
// só aparece em produção (o código 9). A trilha do painel que mudar uma
// consulta muda a forma aqui.

const file = readIndexes();

const COMPOSITE: CompositeShape[] = [
  // Mural.
  {
    name: 'Mural: os posts de uma central, do mais novo (índice do bloco 6)',
    collectionGroup: 'posts',
    queryScope: 'COLLECTION',
    fields: [asc('artistId'), desc('createdAt')],
  },
  {
    name: 'Mural: os posts numa situação, do mais novo',
    collectionGroup: 'posts',
    queryScope: 'COLLECTION',
    fields: [asc('status'), desc('createdAt')],
  },
  {
    name: 'Mural: os posts de uma central numa situação, do mais novo',
    collectionGroup: 'posts',
    queryScope: 'COLLECTION',
    fields: [asc('artistId'), asc('status'), desc('createdAt')],
  },
  // Agenda.
  {
    name: 'Agenda: os próximos numa situação (índice do bloco 6)',
    collectionGroup: 'events',
    queryScope: 'COLLECTION',
    fields: [asc('status'), asc('startsAt'), asc('__name__')],
  },
  {
    name: 'Agenda e alvo de missão: os próximos de uma central',
    collectionGroup: 'events',
    queryScope: 'COLLECTION',
    fields: [contains('artistIds'), asc('startsAt')],
  },
  {
    name: 'Agenda: os passados de uma central, do mais novo',
    collectionGroup: 'events',
    queryScope: 'COLLECTION',
    fields: [contains('artistIds'), desc('startsAt')],
  },
  {
    name: 'Agenda: os próximos de uma central numa situação (índice de 21.11)',
    collectionGroup: 'events',
    queryScope: 'COLLECTION',
    fields: [contains('artistIds'), asc('status'), asc('startsAt'), asc('__name__')],
  },
  {
    name: 'Agenda: os confirmados de um show (grupo eventRsvps, índice do bloco 6)',
    collectionGroup: 'eventRsvps',
    queryScope: 'COLLECTION_GROUP',
    fields: [asc('eventId'), asc('going')],
  },
  // Alvo de missão.
  {
    name: 'Alvo de missão: os posts no ar de uma central, do mais novo (o índice da grade da 1d)',
    collectionGroup: 'posts',
    queryScope: 'COLLECTION',
    fields: [asc('artistId'), asc('status'), desc('publishedAt'), desc('__name__')],
  },
];

const SINGLE: SingleFieldShape[] = [
  {
    name: 'Mural: todos os posts, do mais novo',
    collectionGroup: 'posts',
    queryScope: 'COLLECTION',
    field: desc('createdAt'),
  },
  {
    name: 'Mural: os comentários de um post, do mais novo',
    collectionGroup: 'postComments',
    queryScope: 'COLLECTION',
    field: desc('createdAt'),
  },
  {
    name: 'Agenda: os próximos de todas as centrais',
    collectionGroup: 'events',
    queryScope: 'COLLECTION',
    field: asc('startsAt'),
  },
  {
    name: 'Agenda: os passados de todas as centrais, do mais novo',
    collectionGroup: 'events',
    queryScope: 'COLLECTION',
    field: desc('startsAt'),
  },
  {
    name: 'Agenda: os posts ligados a um show',
    collectionGroup: 'posts',
    queryScope: 'COLLECTION',
    field: asc('eventId'),
  },
  {
    name: 'Agenda: as recompensas ligadas a um show',
    collectionGroup: 'rewards',
    queryScope: 'COLLECTION',
    field: asc('eventId'),
  },
];

describe('índices do Mural, da Agenda e do alvo de missão (26.11)', () => {
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

describe('isenções do dia fechado (26.11)', () => {
  it('os mapas do statsDaily ficam sem índice: o documento fechado não vira milhares de entradas', () => {
    const exempt = file.fieldOverrides
      .filter((item) => item.collectionGroup === 'statsDaily')
      .map((item) => item.fieldPath)
      .sort();
    expect(exempt).toEqual(
      [
        'totals',
        'bySource',
        'byArtist',
        'actives',
        'cohorts',
        'signups',
        'invites',
        'byOrigin',
        'byMission',
        'byAchievement',
        'byReward',
        'snapshot',
      ].sort(),
    );
  });
});
