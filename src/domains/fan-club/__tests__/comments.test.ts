import { commentKey, mergeComments } from '@/domains/posts/comment-list';

import { isDelivered, mergeReplies, replyTotal } from '../comments';
import type { FanClubCommentLine } from '../types';

// As contas da lista de comentários da tela da publicação (seção 37, 37.9,
// itens 3 e 4): o "Ver N respostas", as respostas com as do fã no fim e os
// ajudantes do Mural, genéricos no tipo, com o comentário do fã-clube.

const line = (id: string, patch: Partial<FanClubCommentLine> = {}): FanClubCommentLine => ({
  id,
  postId: 'p1',
  clubId: 'fc-1',
  author: { uid: 'fa-davi', name: 'Davi Lima', username: 'davilim', photoURL: null },
  isManager: false,
  text: id,
  mentions: [],
  replyToId: null,
  replyCount: 0,
  createdAt: '2026-10-27T15:00:00.000Z',
  hidden: null,
  review: null,
  ...patch,
});

describe('o "Ver N respostas" (37.9, item 3)', () => {
  it('as visíveis; para o gestor, também as que ele ocultou', () => {
    const comment = line('c1', { replyCount: 2, hiddenReplyCount: 1 });
    expect(replyTotal(comment, false)).toBe(2);
    expect(replyTotal(comment, true)).toBe(3);
    expect(replyTotal(line('c2', { replyCount: 1 }), true)).toBe(1);
  });
});

describe('as respostas da conversa', () => {
  it('as carregadas, da mais antiga, e as do fã que ainda vão no fim', () => {
    const local = line('local-1', { status: 'pending', replyToId: 'c1' });
    expect(mergeReplies([line('r1'), line('r2')], [local]).map((item) => item.id)).toEqual([
      'r1',
      'r2',
      'local-1',
    ]);
  });

  it('a gravada (com o id local da linha) esconde a linha local, e a repetida da página seguinte aparece uma vez', () => {
    const saved = line('r9', { localId: 'local-1' });
    const local = line('local-1', { status: 'pending' });
    expect(mergeReplies([line('r1'), saved, line('r9')], [local]).map((item) => item.id)).toEqual([
      'r1',
      'r9',
    ]);
  });

  it('a gravada, posta no fim das carregadas, cede à do servidor na página seguinte, na ordem dele', () => {
    const saved = line('r9', { localId: 'local-1' });
    const local = line('local-1', { status: 'pending' });
    expect(
      mergeReplies([line('r1'), saved, line('r2'), line('r9')], [local]).map((item) => item.id),
    ).toEqual(['r1', 'r2', 'r9']);
  });

  it('a linha local não é entregue', () => {
    expect(isDelivered(line('c1'))).toBe(true);
    expect(isDelivered(line('local-1', { status: 'failed' }))).toBe(false);
  });
});

describe('os ajudantes do Mural, genéricos no tipo', () => {
  it('os do fã em cima, e o gravado não aparece duas vezes', () => {
    const pending = line('local-2', { status: 'pending' });
    const saved = line('c9', { localId: 'local-2' });
    const merged = mergeComments<FanClubCommentLine>([pending], [saved, line('c1')]);
    expect(merged.map((item) => item.id)).toEqual(['local-2', 'c1']);
    expect(commentKey(saved)).toBe('local-2');
  });
});
