import { FAN_CLUB_REACTIONS, type FanClubReaction } from '../consts';
import {
  emptyReactionCounts,
  reactActionName,
  reactionOfAction,
  topReactions,
  withReaction,
} from '../reactions';
import type { FanClubPost, FanClubReactionCounts } from '../types';

// As contas das reações no app (seção 37, R1 e 37.9): a troca otimista do
// card, os mais usados ao lado do total e as ações do leitor de tela.

const counts = (patch: Partial<FanClubReactionCounts>): FanClubReactionCounts => ({
  ...emptyReactionCounts(),
  ...patch,
});

const post = (patch: Partial<FanClubPost> = {}): FanClubPost => ({
  id: 'p1',
  clubId: 'fc-1',
  clubName: 'Nenho Sempre',
  clubOfficial: false,
  artistId: 'nenho',
  author: { uid: 'fa-thalita', name: 'Thalita Santos', username: 'thalitasan', photoURL: null },
  kind: 'text',
  text: 'Quem vai no show?',
  photo: null,
  thumb: null,
  publishedAt: '2026-10-19T15:00:00.000Z',
  reactionCount: 5,
  reactionCounts: counts({ heart: 3, fire: 2 }),
  commentCount: 1,
  myReaction: null,
  ...patch,
});

describe('withReaction: a troca otimista, com os números junto', () => {
  it.each<
    [string, FanClubReaction | null, FanClubReaction | null, number, Partial<FanClubReactionCounts>]
  >([
    ['sem reação, o coração sobe o total e o coração', null, 'heart', 6, { heart: 4, fire: 2 }],
    ['a troca de emoji não muda o total', 'heart', 'fire', 5, { heart: 2, fire: 3 }],
    ['tirar desce o total e o emoji de antes', 'fire', null, 4, { heart: 3, fire: 1 }],
  ])('%s', (_name, before, next, total, perEmoji) => {
    const changed = withReaction(post({ myReaction: before }), next);
    expect(changed.myReaction).toBe(next);
    expect(changed.reactionCount).toBe(total);
    expect(changed.reactionCounts).toEqual(counts(perEmoji));
  });

  it('a mesma reação devolve a publicação como estava', () => {
    const same = post({ myReaction: 'fire' });
    expect(withReaction(same, 'fire')).toBe(same);
  });

  it('nunca abaixo de zero, e sem os números (o servidor de antes) parte do zero', () => {
    expect(
      withReaction(post({ myReaction: 'wow', reactionCount: 0, reactionCounts: counts({}) }), null),
    ).toMatchObject({ reactionCount: 0, reactionCounts: counts({}) });
    const bare = post({
      reactionCount: undefined,
      reactionCounts: undefined,
      myReaction: undefined,
    });
    expect(withReaction(bare, 'clap')).toMatchObject({
      myReaction: 'clap',
      reactionCount: 1,
      reactionCounts: counts({ clap: 1 }),
    });
  });

  it('guarda o resto da publicação (vale para a da tela dela)', () => {
    const details = {
      ...post(),
      isOwner: false,
      isFollowing: true,
      isMember: true,
      artistName: 'Nenho',
    };
    expect(withReaction(details, 'laugh')).toMatchObject({
      isFollowing: true,
      artistName: 'Nenho',
      commentCount: 1,
    });
  });
});

describe('topReactions: até 3, os mais usados', () => {
  it.each<[string, FanClubReactionCounts | undefined, FanClubReaction[]]>([
    ['sem números, nenhum', undefined, []],
    ['zerado, nenhum', counts({}), []],
    ['do mais usado ao menos', counts({ heart: 1, fire: 5, clap: 3 }), ['fire', 'clap', 'heart']],
    [
      'no empate, a ordem da fileira',
      counts({ clap: 2, laugh: 2, wow: 2 }),
      ['laugh', 'wow', 'clap'],
    ],
    [
      'no máximo 3',
      counts({ heart: 4, fire: 3, laugh: 2, wow: 1, clap: 1 }),
      ['heart', 'fire', 'laugh'],
    ],
  ])('%s', (_name, value, expected) => {
    expect(topReactions(value)).toEqual(expected);
  });
});

describe('as ações do leitor de tela', () => {
  it('cada emoji tem a ação dele, e o nome volta ao emoji', () => {
    for (const reaction of FAN_CLUB_REACTIONS) {
      expect(reactionOfAction(reactActionName(reaction))).toBe(reaction);
    }
  });

  it.each(['longpress', 'clear', 'react-', 'react-star', 'activate'])(
    '"%s" não é uma reação',
    (name) => {
      expect(reactionOfAction(name)).toBeNull();
    },
  );
});
