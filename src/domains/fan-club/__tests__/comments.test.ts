import { commentKey, mergeComments } from '@/domains/posts/comment-list';

import {
  commentActions,
  hiddenCounterDelta,
  isDelivered,
  mergeReplies,
  placeOwnHidden,
  replyTotal,
  withHiddenReplies,
} from '../comments';
import type { FanClubCommentLine } from '../types';

// As contas da lista de comentários da tela da publicação (seção 37, 37.9,
// itens 3 e 4): o "Ver N respostas", as respostas com as do fã no fim e os
// ajudantes do Mural, genéricos no tipo, com o comentário do fã-clube. Da
// etapa 7 de 37.13: onde entram os ocultos do fã (o `ownHidden`), as ações de
// moderação de cada linha e os contadores do ocultar e do reexibir (37.6).

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

/** Um instante de exemplo, em horas antes das 15h de 27/10/2026. */
const at = (hoursAgo: number): string =>
  new Date(Date.parse('2026-10-27T15:00:00.000Z') - hoursAgo * 3_600_000).toISOString();

const ids = (lines: readonly FanClubCommentLine[]) => lines.map((item) => item.id);

describe('os comentários do fã ocultos pelo gestor na lista (o ownHidden, 37.9, item 4)', () => {
  const top = [line('c3', { createdAt: at(1) }), line('c2', { createdAt: at(3) })];
  const hidden = (id: string, hoursAgo: number, replyToId: string | null = null) =>
    line(id, { createdAt: at(hoursAgo), replyToId, hidden: 'manager' });

  it('o de cima entra entre os de cima pela data, e o mais antigo que todos vai ao fim', () => {
    const placed = placeOwnHidden(top, [hidden('h1', 2), hidden('h0', 9)]);
    expect(ids(placed.top)).toEqual(['c3', 'h1', 'c2', 'h0']);
    expect(placed.replies.size).toBe(0);
  });

  it('a resposta fica embaixo do comentário de cima carregado, da mais antiga; sem ele, entre os de cima, sem recuo', () => {
    const placed = placeOwnHidden(top, [
      hidden('r2', 0.5, 'c2'),
      hidden('r1', 2.5, 'c2'),
      hidden('r9', 2, 'c-fora'),
    ]);
    expect(ids(placed.top)).toEqual(['c3', 'r9', 'c2']);
    expect(ids(placed.replies.get('c2') ?? [])).toEqual(['r1', 'r2']);
  });

  it('a resposta oculta embaixo de um de cima também oculto do fã fica embaixo dele', () => {
    const placed = placeOwnHidden(top, [hidden('h1', 2), hidden('r1', 1.5, 'h1')]);
    expect(ids(placed.top)).toEqual(['c3', 'h1', 'c2']);
    expect(ids(placed.replies.get('h1') ?? [])).toEqual(['r1']);
  });

  it('sem ownHidden (o gestor, a página seguinte), a lista fica como veio; o que já está nela não repete', () => {
    expect(ids(placeOwnHidden(top, undefined).top)).toEqual(['c3', 'c2']);
    expect(ids(placeOwnHidden(top, [line('c2', { createdAt: at(3) })]).top)).toEqual(['c3', 'c2']);
  });

  it('as respostas abertas recebem as ocultas do fã pela data, sem repetir a que voltou', () => {
    const server = [line('r1', { createdAt: at(5) }), line('r3', { createdAt: at(1) })];
    const merged = withHiddenReplies(server, [
      line('r2', { createdAt: at(3) }),
      line('r3', { createdAt: at(1) }),
      line('r4', { createdAt: at(0) }),
    ]);
    expect(ids(merged)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('as ações de moderação de cada linha (37.6 e 37.9, itens 4 e 10)', () => {
  const fan = { uid: 'uid-camila', isOwner: false, suspended: false };
  const owner = { uid: 'uid-camila', isOwner: true, suspended: false };
  const mine = (patch: Partial<FanClubCommentLine> = {}) =>
    line('c1', {
      author: { uid: 'uid-camila', name: 'Camila', username: 'camilarib', photoURL: null },
      ...patch,
    });

  it('o fã: opções nos comentários dos outros, à vista; nada no próprio', () => {
    expect(commentActions(line('c1'), fan)).toEqual({
      options: true,
      hide: false,
      unhide: false,
      review: false,
    });
    expect(commentActions(mine(), fan)).toEqual({
      options: false,
      hide: false,
      unhide: false,
      review: false,
    });
  });

  it('o gestor: oculta o dos outros e reexibe o que ocultou; nunca o próprio (decisão 21)', () => {
    expect(commentActions(line('c1'), owner)).toMatchObject({ options: true, hide: true });
    expect(commentActions(line('c1', { hidden: 'manager' }), owner)).toEqual({
      options: false,
      hide: false,
      unhide: true,
      review: false,
    });
    expect(commentActions(mine({ isManager: true }), owner)).toEqual({
      options: false,
      hide: false,
      unhide: false,
      review: false,
    });
  });

  it('o autor do oculto pelo gestor pede revisão uma vez; pedida, mantida ou suspenso, não', () => {
    expect(commentActions(mine({ hidden: 'manager' }), fan).review).toBe(true);
    expect(commentActions(mine({ hidden: 'manager', review: 'requested' }), fan).review).toBe(
      false,
    );
    expect(commentActions(mine({ hidden: 'manager', review: 'kept' }), fan).review).toBe(false);
    expect(commentActions(mine({ hidden: 'manager' }), { ...fan, suspended: true }).review).toBe(
      false,
    );
  });

  it('a linha local não tem ação nenhuma', () => {
    expect(commentActions(line('local-1', { status: 'failed' }), owner)).toEqual({
      options: false,
      hide: false,
      unhide: false,
      review: false,
    });
  });
});

describe('os contadores do ocultar e do reexibir (37.6)', () => {
  it('o de cima leva as respostas visíveis: 1 + replyCount sai do total, e o reexibir devolve', () => {
    const top = line('c1', { replyCount: 3 });
    expect(hiddenCounterDelta(top, undefined, true)).toEqual({
      commentCount: -4,
      replyCount: 0,
      hiddenReplyCount: 0,
    });
    expect(hiddenCounterDelta(top, undefined, false).commentCount).toBe(4);
  });

  it('a resposta: 1 do replyCount do de cima, que passa às ocultas, e 1 do total se ele está visível', () => {
    const reply = line('r1', { replyToId: 'c1' });
    expect(hiddenCounterDelta(reply, line('c1'), true)).toEqual({
      commentCount: -1,
      replyCount: -1,
      hiddenReplyCount: 1,
    });
    expect(hiddenCounterDelta(reply, line('c1', { hidden: 'manager' }), false)).toEqual({
      commentCount: 0,
      replyCount: 1,
      hiddenReplyCount: -1,
    });
  });
});
