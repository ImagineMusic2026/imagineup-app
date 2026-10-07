import { Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import {
  artistDetailsView,
  artistRecord,
  artistView,
  CENTRAL_ENTRIES_PER_DAY,
  CentralError,
  exceedsEntryLimit,
  FAN_SHARD_COUNT,
  fanCentralView,
  fanCountSyncTask,
  fanShardOf,
  FOLLOW_MAX,
  isArtistId,
  isPublished,
  memberFanCount,
  parseFollowArtistIds,
  safeCount,
  secondsUntil,
  shouldCopyFanCount,
  sortFanCentrals,
  sumFanShards,
  visibleCentralSeasonPoints,
} from './model';

const NOW = Date.parse('2026-10-05T15:00:00.000Z');

const image = (name: string) => ({
  url: `https://storage.exemplo/${name}.webp`,
  path: `artists/nettobrito/${name}.webp`,
  width: 1200,
  height: 1600,
});

/** artists/{id} como o painel grava. */
function panelDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    handle: 'nettobrito',
    name: 'Netto Brito',
    shortName: null,
    genre: 'Arrocha',
    city: 'Salvador, BA',
    bio: null,
    verified: true,
    photo: image('photo-1-1200'),
    thumb: image('thumb-1-480'),
    order: 0,
    status: 'published',
    fanCount: 3,
    publishedAt: Timestamp.fromMillis(NOW),
    createdAt: Timestamp.fromMillis(NOW),
    updatedAt: Timestamp.fromMillis(NOW),
    ...extra,
  };
}

describe('respostas a partir do documento do painel', () => {
  it('a lista usa a miniatura, o fanCount e a ordem', () => {
    expect(artistView(artistRecord('nettobrito', panelDoc()))).toEqual({
      id: 'nettobrito',
      name: 'Netto Brito',
      photoURL: 'https://storage.exemplo/thumb-1-480.webp',
      fanCount: 3,
      order: 0,
    });
  });

  it('a página: capa é a foto 3:4, a miniatura no photoURL, postCount 0 e a soma dos pontos', () => {
    const record = artistRecord('nettobrito', panelDoc());
    expect(artistDetailsView(record, null, 4_120)).toEqual({
      id: 'nettobrito',
      name: 'Netto Brito',
      coverUrl: 'https://storage.exemplo/photo-1-1200.webp',
      photoURL: 'https://storage.exemplo/thumb-1-480.webp',
      verified: true,
      managedByImagine: false,
      fanCount: 3,
      postCount: 0,
      centralPoints: 4_120,
      isMember: false,
    });
  });

  it('uma capa em paisagem do painel vem antes da foto', () => {
    const record = artistRecord('nettobrito', panelDoc({ cover: image('cover-1-1600') }));
    expect(artistDetailsView(record, null, 0).coverUrl).toBe(
      'https://storage.exemplo/cover-1-1600.webp',
    );
  });

  it('sem imagem: capa e foto null (o app mostra o placeholder pelo id)', () => {
    const record = artistRecord('nettobrito', panelDoc({ photo: null, thumb: null }));
    expect(artistView(record).photoURL).toBeNull();
    expect(artistDetailsView(record, null, 0)).toMatchObject({ coverUrl: null, photoURL: null });
  });

  it.each([
    [-1, 0],
    [Number.NaN, 0],
    ['12', 0],
    [undefined, 0],
    [7.8, 7],
    [Number.POSITIVE_INFINITY, 0],
  ])('fanCount %s vira %s', (value, expected) => {
    expect(artistRecord('nettobrito', panelDoc({ fanCount: value })).fanCount).toBe(expected);
    expect(safeCount(value)).toBe(expected);
  });

  it('verified e managedByImagine só com true', () => {
    const base = artistRecord('nettobrito', panelDoc({ verified: 'sim' }));
    expect(base).toMatchObject({ verified: false, managedByImagine: false });
    const managed = artistRecord('nettobrito', panelDoc({ managedByImagine: true }));
    expect(artistDetailsView(managed, null, 0).managedByImagine).toBe(true);
    expect(artistRecord('nettobrito', panelDoc({ managedByImagine: 1 })).managedByImagine).toBe(
      false,
    );
  });

  it('só a publicada vale: rascunho e fora do ar não', () => {
    expect(isPublished(artistRecord('a1', panelDoc()))).toBe(true);
    expect(isPublished(artistRecord('a1', panelDoc({ status: 'draft' })))).toBe(false);
    expect(isPublished(artistRecord('a1', panelDoc({ status: 'unpublished' })))).toBe(false);
    expect(isPublished(null)).toBe(false);
  });

  it('pontos negativos ou estranhos na soma viram 0', () => {
    const record = artistRecord('nettobrito', panelDoc());
    expect(artistDetailsView(record, null, -5).centralPoints).toBe(0);
  });
});

describe('fanCount de quem é membro (memberFanCount)', () => {
  const joinedAt = NOW;

  it('sem fanCountAt, a cópia ainda não contava o fã: soma 1', () => {
    expect(memberFanCount(0, null, joinedAt)).toBe(1);
    expect(memberFanCount(4, null, joinedAt)).toBe(5);
  });

  it('fanCountAt antes do joinedAt: soma 1', () => {
    expect(memberFanCount(4, joinedAt - 1, joinedAt)).toBe(5);
  });

  it('fanCountAt igual ou depois do joinedAt: usa a cópia', () => {
    expect(memberFanCount(4, joinedAt, joinedAt)).toBe(4);
    expect(memberFanCount(4, joinedAt + 10_000, joinedAt)).toBe(4);
  });

  it('cópia 0 de quem é membro vira 1 (nunca "0 fãs" com "Na central")', () => {
    expect(memberFanCount(0, joinedAt + 1, joinedAt)).toBe(1);
  });

  it('limite aceito: quem sai e entra de novo antes da cópia seguinte é contado duas vezes até ela', () => {
    // A cópia de T0 já contava a fã; ela saiu e voltou antes de a fila copiar
    // de novo. Sem guardar a saída, a rota não sabe disso (19.2 e 19.17).
    const copiedAt = joinedAt - 8_000;
    expect(memberFanCount(5, copiedAt, joinedAt)).toBe(6);
    // A cópia seguinte, de depois da volta, acerta.
    expect(memberFanCount(5, joinedAt + 3_000, joinedAt)).toBe(5);
  });

  it('a página e "Suas centrais" usam a correção para o membro', () => {
    const record = artistRecord(
      'nenho',
      panelDoc({ fanCount: 0, fanCountAt: Timestamp.fromMillis(joinedAt - 5_000) }),
    );
    expect(artistDetailsView(record, { joinedAt }, 0)).toMatchObject({
      fanCount: 1,
      isMember: true,
    });
    expect(fanCentralView(record, joinedAt, 0).fanCount).toBe(1);
    // Quem não é membro vê a cópia como está.
    expect(artistDetailsView(record, null, 0).fanCount).toBe(0);
  });
});

describe('teto de entradas por dia', () => {
  it('recusa quando o fã já fez o teto hoje e o pedido cria vínculo', () => {
    expect(exceedsEntryLimit(CENTRAL_ENTRIES_PER_DAY - 1, 1)).toBe(false);
    expect(exceedsEntryLimit(CENTRAL_ENTRIES_PER_DAY, 1)).toBe(true);
    expect(exceedsEntryLimit(CENTRAL_ENTRIES_PER_DAY + 4, 3)).toBe(true);
  });

  it('o teto da configuração (actionCaps.central_entry, bloco 7) vale no lugar do padrão', () => {
    expect(exceedsEntryLimit(5, 1, 5)).toBe(true);
    expect(exceedsEntryLimit(4, 1, 5)).toBe(false);
  });

  it('pedido que não cria vínculo (o fã já está em todas) nunca é recusado', () => {
    expect(exceedsEntryLimit(CENTRAL_ENTRIES_PER_DAY + 10, 0)).toBe(false);
  });

  it('o Retry-After é em segundos inteiros, para cima, e nunca 0', () => {
    expect(secondsUntil(NOW + 3_600_000, NOW)).toBe(3600);
    expect(secondsUntil(NOW + 1_500, NOW)).toBe(2);
    expect(secondsUntil(NOW, NOW)).toBe(1);
  });

  it('a recusa leva o motivo, a mensagem e o Retry-After', () => {
    const error = new CentralError('too_many_entries', { limit: 30 }, 120);
    expect(error).toMatchObject({
      reason: 'too_many_entries',
      message: 'Entradas demais em centrais hoje.',
      details: { limit: 30 },
      retryAfter: 120,
    });
    expect(new CentralError('artist_not_found').message).toBe('Central não encontrada.');
  });
});

describe('"Suas centrais"', () => {
  it('a central do fã sem posição até o bloco 8, com o nome curto do painel', () => {
    const record = artistRecord('juninhomoraes', panelDoc({ shortName: 'Juninho M.' }));
    expect(fanCentralView(record, NOW, 0)).toEqual({
      artistId: 'juninhomoraes',
      name: 'Netto Brito',
      shortName: 'Juninho M.',
      photoURL: 'https://storage.exemplo/thumb-1-480.webp',
      fanCount: 4,
      fanRank: null,
      seasonPoints: 0,
    });
  });

  it('ordem: joinedAt, depois a ordem do painel, depois o id', () => {
    const items = [
      { artistId: 'b', joinedAt: 20, order: 0 },
      { artistId: 'z', joinedAt: 10, order: 5 },
      { artistId: 'c', joinedAt: 10, order: 1 },
      { artistId: 'a', joinedAt: 10, order: 1 },
    ];
    expect(sortFanCentrals(items).map((item) => item.artistId)).toEqual(['a', 'c', 'z', 'b']);
  });

  it('pontos da temporada só com a temporada da configuração', () => {
    const points = { seasonId: 'temporada-sao-joao', seasonPoints: 4_120 };
    expect(visibleCentralSeasonPoints(points, 'temporada-sao-joao')).toBe(4_120);
    expect(visibleCentralSeasonPoints(points, 'outra')).toBe(0);
    expect(visibleCentralSeasonPoints(points, null)).toBe(0);
    expect(visibleCentralSeasonPoints(null, 'temporada-sao-joao')).toBe(0);
  });
});

describe('corpo do POST /me/artists', () => {
  it('aceita de 1 a 50 ids no formato do @', () => {
    expect(parseFollowArtistIds({ artistIds: ['nettobrito', 'nenho', 'juninhomoraes'] })).toEqual([
      'nettobrito',
      'nenho',
      'juninhomoraes',
    ]);
    const fifty = Array.from({ length: FOLLOW_MAX }, (_, index) => `artista${index + 1}`);
    expect(parseFollowArtistIds({ artistIds: fifty })).toHaveLength(50);
  });

  it.each([
    ['vazio', { artistIds: [] }],
    ['51 ids', { artistIds: Array.from({ length: 51 }, (_, i) => `artista${i + 1}`) }],
    ['repetido', { artistIds: ['nenho', 'nenho'] }],
    ['fora do formato', { artistIds: ['netto-brito'] }],
    ['maiúscula', { artistIds: ['Nenho'] }],
    ['id reservado do Firestore', { artistIds: ['__x__'] }],
    ['não é texto', { artistIds: [3] }],
    ['sem a lista', {}],
    ['corpo nulo', null],
    ['lista no lugar do corpo', ['nenho']],
  ])('recusa %s', (_name, body) => {
    expect(parseFollowArtistIds(body)).toBeNull();
  });

  it('o id de central é o @ (sem __x__)', () => {
    expect(isArtistId('nettobrito')).toBe(true);
    expect(isArtistId('trio_bem')).toBe(true);
    expect(isArtistId('__trio__')).toBe(false);
    expect(isArtistId('ab')).toBe(false);
  });
});

describe('a cópia do fanCount', () => {
  it('sem fanCountAt, copia', () => {
    expect(shouldCopyFanCount(null, NOW)).toBe(true);
  });

  it('leitura mais nova copia, mesmo com o número igual', () => {
    expect(shouldCopyFanCount(NOW - 1, NOW)).toBe(true);
    expect(shouldCopyFanCount(NOW, NOW + 0.001)).toBe(true);
  });

  it('leitura igual ou mais velha que a cópia gravada não copia', () => {
    expect(shouldCopyFanCount(NOW, NOW)).toBe(false);
    expect(shouldCopyFanCount(NOW, NOW - 1)).toBe(false);
  });

  it('a soma dos shards pode dar negativa (a tarefa grava 0) e ignora o que não é número', () => {
    expect(sumFanShards([1, 1, -1, 'x', undefined, 2])).toBe(3);
    expect(sumFanShards([-1, -1, 1])).toBe(-1);
    expect(sumFanShards([])).toBe(0);
  });

  it('o shard do fanCount é o sorteio do painel reduzido aos 16 da central', () => {
    expect(FAN_SHARD_COUNT).toBe(16);
    expect(fanShardOf(0)).toBe(0);
    expect(fanShardOf(15)).toBe(15);
    expect(fanShardOf(16)).toBe(0);
    expect(fanShardOf(63)).toBe(15);
  });
});

describe('a tarefa da janela (fanCountSyncTask)', () => {
  const windowStart = Date.parse('2026-10-05T15:00:00.000Z');

  it('dois instantes da mesma janela de 10 s dão o mesmo id; a seguinte, outro', () => {
    const first = fanCountSyncTask('nenho', windowStart + 100);
    const same = fanCountSyncTask('nenho', windowStart + 9_999);
    const next = fanCountSyncTask('nenho', windowStart + 10_000);
    expect(first.id).toBe(same.id);
    expect(next.id).not.toBe(first.id);
    expect(first.id).toBe(`fancount-nenho-${windowStart / 10_000}`);
  });

  it('roda 1 s depois do fim da janela', () => {
    expect(fanCountSyncTask('nenho', windowStart + 4_321).scheduleTime.toISOString()).toBe(
      '2026-10-05T15:00:11.000Z',
    );
  });

  it('o id fica no formato que o Cloud Tasks aceita, também com o @ que tem _', () => {
    expect(fanCountSyncTask('trio_bem', windowStart).id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
