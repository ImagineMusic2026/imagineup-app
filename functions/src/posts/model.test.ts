import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';
import { describe, expect, it } from 'vitest';

import { artistRecord, fanCountSyncTask } from '../centrals/model';
import { decodePageCursor, encodePageCursor } from '../page-cursor';
import { windowTask } from '../window-task';
import {
  commentRecord,
  commentView,
  mergePostBlocks,
  parseCommentText,
  parsePostMediaPaths,
  parsePostText,
  POST_MEDIA_SIZES,
  postRecord,
  postShardOf,
  postView,
  PostError,
  shouldCopyCounts,
  staleFiles,
  sumShards,
  viewCounts,
  type PostRecord,
} from './model';

const NOW = Date.parse('2026-10-05T15:00:00.000Z');
const ts = (ms: number) => Timestamp.fromMillis(ms);

const NETTO = artistRecord('nettobrito', {
  name: 'Netto Brito',
  status: 'published',
  verified: true,
  thumb: { url: 'https://exemplo/netto-480.webp', path: 'artists/nettobrito/t.webp' },
});

function post(id: string, extra: Record<string, unknown> = {}): PostRecord {
  return postRecord(id, {
    artistId: 'nettobrito',
    kind: 'text',
    text: 'Oi',
    status: 'published',
    publishedAt: ts(NOW - 60_000),
    likeCount: 3,
    commentCount: 4,
    countsAt: ts(NOW - 30_000),
    ...extra,
  });
}

function reasonOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof PostError) return `${error.reason}:${String(error.details?.reason)}`;
    if (error instanceof HttpsError) return (error.details as { reason?: string }).reason;
    throw error;
  }
  return undefined;
}

describe('texto do comentário (parseCommentText)', () => {
  it.each([
    ['vazio', '', 'comment_invalid:empty'],
    ['só espaços e linhas', '  \n \r\n  ', 'comment_invalid:empty'],
    ['501 em UTF-16', 'a'.repeat(501), 'comment_invalid:too_long'],
    ['emoji conta 2 (UTF-16)', '😀'.repeat(251), 'comment_invalid:too_long'],
    ['invisível numa linha', 'oi\n​', 'comment_invalid:invisible'],
  ])('recusa %s', (_, text, reason) => {
    expect(reasonOf(() => parseCommentText({ text }))).toBe(reason);
  });

  it('500 em UTF-16 passa, e o texto sai limpo', () => {
    expect(parseCommentText({ text: 'a'.repeat(500) })).toHaveLength(500);
    expect(parseCommentText({ text: '  ⁦Irará⁩  \r\n\r\n\r\n  top ' })).toBe('Irará\n\ntop');
  });

  it('texto que não é texto: undefined (400 na rota)', () => {
    expect(parseCommentText({ text: 42 })).toBeUndefined();
    expect(parseCommentText(null)).toBeUndefined();
    expect(parseCommentText([])).toBeUndefined();
  });
});

describe('o Post do app (postView)', () => {
  const view = (record: PostRecord, extra: Partial<Parameters<typeof postView>[2]> = {}) =>
    postView(record, NETTO, { like: null, event: null, sharePointsPerVisit: 2, ...extra });

  it('texto e show saem com media: null; foto e vídeo sem mídia, com as URLs nulas e as medidas padrão', () => {
    expect(view(post('p-texto')).media).toBeNull();
    expect(view(post('p-show', { kind: 'event' })).media).toBeNull();
    expect(view(post('p-g1', { kind: 'photo' })).media).toEqual({
      url: null,
      thumbnailUrl: null,
      width: 1080,
      height: 1350,
    });
    expect(view(post('p-clipe', { kind: 'video' })).media).toEqual({
      url: null,
      thumbnailUrl: null,
      ...POST_MEDIA_SIZES.video.photo,
    });
  });

  it('foto com mídia: a foto e a miniatura; vídeo sem o mp4: url nula e a capa na miniatura', () => {
    const media = {
      photo: { url: 'https://f/p.webp', path: 'posts/p/p.webp', width: 1440, height: 1800 },
      thumb: { url: 'https://f/t.webp', path: 'posts/p/t.webp', width: 480, height: 600 },
      video: null,
    };
    expect(view(post('p1', { kind: 'photo', media })).media).toEqual({
      url: 'https://f/p.webp',
      thumbnailUrl: 'https://f/t.webp',
      width: 1440,
      height: 1800,
    });
    expect(view(post('p2', { kind: 'video', media })).media).toMatchObject({
      url: null,
      thumbnailUrl: 'https://f/t.webp',
    });
    expect(
      view(
        post('p3', {
          kind: 'video',
          media: { ...media, video: { url: 'https://f/v.mp4', path: 'posts/p/v.mp4', size: 9 } },
        }),
      ).media?.url,
    ).toBe('https://f/v.mp4');
  });

  it('a central, o "há N" pela primeira publicação, likedByMe e o compartilhar', () => {
    const result = view(post('p-texto'), {
      like: { liked: false, countedAt: NOW },
      sharePointsPerVisit: 0,
    });
    expect(result).toMatchObject({
      artist: {
        id: 'nettobrito',
        name: 'Netto Brito',
        verified: true,
        photoURL: 'https://exemplo/netto-480.webp',
      },
      createdAt: new Date(NOW - 60_000).toISOString(),
      likedByMe: false,
      sharePointsPerVisit: null,
    });
  });

  it('o show só no post de show, como veio (já conferido)', () => {
    const event = { id: 'arrocha-na-praia', title: 'Arrocha', startsAt: 'x', city: 'Aracaju, SE' };
    expect(view(post('p-show', { kind: 'event' }), { event }).event).toEqual(event);
    expect(view(post('p-texto'), { event }).event).toBeNull();
  });
});

describe('correção das contagens para quem chama (viewCounts)', () => {
  const base = post('p1');

  it.each([
    ['sem cópia, a curtida ativa soma', { countsAt: null }, { liked: true, countedAt: NOW }, 4],
    ['curtida depois da cópia soma', {}, { liked: true, countedAt: NOW }, 4],
    ['curtida antes da cópia não soma', {}, { liked: true, countedAt: NOW - 40_000 }, 3],
    [
      'curtida no mesmo instante da leitura não soma (a cópia já a tem)',
      {},
      { liked: true, countedAt: NOW - 30_000 },
      3,
    ],
    ['curtida desfeita não soma', {}, { liked: false, countedAt: NOW }, 3],
    ['sem curtida', {}, null, 3],
  ])('%s', (_, extra, like, expected) => {
    const record = { ...base, ...(extra as Partial<PostRecord>) };
    expect(viewCounts(record, like, null).likeCount).toBe(expected);
  });

  it('comentários do fã depois da cópia somam só no detalhe (as listas passam null)', () => {
    expect(viewCounts(base, null, [NOW, NOW - 10_000, NOW - 40_000]).commentCount).toBe(6);
    expect(viewCounts(base, null, null).commentCount).toBe(4);
    expect(viewCounts({ ...base, countsAt: null }, null, [NOW - 99_000]).commentCount).toBe(5);
  });
});

describe('cursores', () => {
  it('ida e volta', () => {
    const cursor = { at: NOW, id: 'seed-c-clipe-bia' };
    expect(decodePageCursor(encodePageCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['não é base64url', 'não é cursor'],
    ['não é lista', Buffer.from('{"a":1}').toString('base64url')],
    ['id fora do formato', Buffer.from('[1,"a/b"]').toString('base64url')],
    ['id reservado', Buffer.from('[1,"__x__"]').toString('base64url')],
    [
      'instante acima do maior Timestamp',
      Buffer.from('[253402300800000,"p1"]').toString('base64url'),
    ],
    ['instante negativo', Buffer.from('[-1,"p1"]').toString('base64url')],
  ])('%s: null', (_, value) => {
    expect(decodePageCursor(value)).toBeNull();
  });
});

describe('junção dos blocos do mural (mergePostBlocks)', () => {
  const at = (id: string, minutesAgo: number) =>
    post(id, { publishedAt: ts(NOW - minutesAgo * 60_000) });

  it('ordem por publicação decrescente, depois o id decrescente, e o hasMore', () => {
    const blocks = [[at('a', 1), at('c', 5), at('d', 9)], [at('b', 1), at('e', 3)], []];
    const merged = mergePostBlocks(blocks, 3);
    expect(merged.items.map((item) => item.id)).toEqual(['b', 'a', 'e']);
    expect(merged.hasMore).toBe(true);
    expect(mergePostBlocks(blocks, 5)).toMatchObject({ hasMore: false });
    expect(mergePostBlocks(blocks, 5).items.map((item) => item.id)).toEqual([
      'b',
      'a',
      'e',
      'c',
      'd',
    ]);
  });

  it('o mesmo post em dois blocos entra uma vez', () => {
    expect(mergePostBlocks([[at('a', 1)], [at('a', 1)]], 5).items).toHaveLength(1);
  });
});

describe('comentário (commentRecord e commentView)', () => {
  it('sem nome vira "Fã"; o autor, a foto e a data', () => {
    const record = commentRecord('c1', {
      postId: 'p1',
      authorUid: 'uidBia',
      authorName: '',
      authorPhotoURL: null,
      text: 'Oi',
      status: 'visible',
      createdAt: ts(NOW),
    });
    expect(commentView(record)).toEqual({
      id: 'c1',
      postId: 'p1',
      authorId: 'uidBia',
      authorName: 'Fã',
      authorAvatarUrl: null,
      authorIsArtist: false,
      text: 'Oi',
      createdAt: new Date(NOW).toISOString(),
    });
  });
});

describe('contagens em shards', () => {
  it('o shard do post é o sorteio do painel reduzido aos 16', () => {
    expect([0, 15, 16, 63].map(postShardOf)).toEqual([0, 15, 0, 15]);
  });

  it('a soma ignora o que não é número e pode dar negativo', () => {
    expect(sumShards([1, -2, 'x', undefined, 3])).toBe(2);
    expect(sumShards([-3])).toBe(-3);
  });

  it('copia quando a leitura é mais nova, mesmo com os números iguais', () => {
    expect(shouldCopyCounts(null, 10)).toBe(true);
    expect(shouldCopyCounts(9.5, 10)).toBe(true);
    expect(shouldCopyCounts(10, 10)).toBe(false);
    expect(shouldCopyCounts(11, 10)).toBe(false);
  });

  it('a janela das filas é comum: o fanCount de antes e as contagens dos posts', () => {
    const at = Date.parse('2026-10-05T15:00:03.250Z');
    expect(fanCountSyncTask('nenho', at)).toEqual(windowTask('fancount', 'nenho', at));
    expect(windowTask('postcounts', 'p-clipe', at)).toEqual({
      id: `postcounts-p-clipe-${Math.floor(at / 10_000)}`,
      scheduleTime: new Date((Math.floor(at / 10_000) + 1) * 10_000 + 1_000),
    });
    expect(windowTask('postcounts', 'p-clipe', at).id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('callables de posts: validação', () => {
  it('texto de 1 a 2.000 no texto e no show; de 0 a 2.000 na foto e no vídeo', () => {
    expect(reasonOf(() => parsePostText('text', ''))).toBe('invalid-text');
    expect(reasonOf(() => parsePostText('event', '  '))).toBe('invalid-text');
    expect(parsePostText('photo', '')).toBe('');
    expect(parsePostText('video', undefined)).toBe('');
    expect(parsePostText('text', 'a'.repeat(2_000))).toHaveLength(2_000);
    expect(reasonOf(() => parsePostText('photo', 'a'.repeat(2_001)))).toBe('invalid-text');
    expect(reasonOf(() => parsePostText('photo', 'oi\n​'))).toBe('invalid-text');
    expect(reasonOf(() => parsePostText('photo', 42))).toBe('invalid-text');
  });

  it('a mídia só em foto e vídeo, com caminhos da pasta do post, diferentes entre si', () => {
    const ok = { photoPath: 'posts/p1/photo-1.webp', thumbPath: 'posts/p1/thumb-1.webp' };
    expect(parsePostMediaPaths('photo', ok, 'p1')).toEqual({ ...ok, videoPath: null });
    expect(
      parsePostMediaPaths('video', { ...ok, videoPath: 'posts/p1/video-1.mp4' }, 'p1'),
    ).toEqual({ ...ok, videoPath: 'posts/p1/video-1.mp4' });
    expect(parsePostMediaPaths('photo', null, 'p1')).toBeNull();
    expect(reasonOf(() => parsePostMediaPaths('text', ok, 'p1'))).toBe('media-not-allowed');
    expect(reasonOf(() => parsePostMediaPaths('photo', ok, 'p2'))).toBe('invalid-media');
    expect(
      reasonOf(() => parsePostMediaPaths('photo', { ...ok, thumbPath: ok.photoPath }, 'p1')),
    ).toBe('invalid-media');
    expect(
      reasonOf(() => parsePostMediaPaths('photo', { ...ok, videoPath: 'posts/p1/v.mp4' }, 'p1')),
    ).toBe('invalid-media');
    expect(
      reasonOf(() =>
        parsePostMediaPaths('photo', { ...ok, photoPath: 'posts/p1/sub/photo.webp' }, 'p1'),
      ),
    ).toBe('invalid-media');
  });

  it('a limpeza da pasta fica com o que está em keep e nunca toca outra pasta', () => {
    expect(
      staleFiles(['posts/p1/a.webp', 'posts/p1/b.webp', 'posts/p2/c.webp'], 'posts/p1/', [
        'posts/p1/b.webp',
        null,
      ]),
    ).toEqual(['posts/p1/a.webp']);
  });
});
