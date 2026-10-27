import {
  checkedMentions,
  mentionDraftAt,
  mentionSegments,
  mentionSuggestionsFor,
  mentionTargets,
  replyPrefix,
  sameDraft,
} from '../mentions';
import type { FanClubMention, MentionSuggestion } from '../types';

// As contas das marcações no app (seção 37, 37.7 e 37.9, itens 2, 6 e 7): o
// trecho conferido antes de virar link, o @ que está sendo digitado e as
// sugestões, a conversa primeiro.

const fan = (handle: string, start: number, id = `fa-${handle}`): FanClubMention => ({
  handle,
  kind: 'fan',
  id,
  start,
  end: start + handle.length + 1,
});

const suggestion = (
  username: string,
  patch: Partial<MentionSuggestion> = {},
): MentionSuggestion => ({
  kind: 'fan',
  id: `fa-${username}`,
  username,
  name: null,
  photoURL: null,
  role: null,
  inConversation: false,
  ...patch,
});

describe('as marcações que viram link (37.7)', () => {
  it('liga o trecho que é o @ marcado, com as posições em UTF-16 depois de um emoji', () => {
    // O emoji conta 2 unidades: o @ começa na 3.
    const text = '🔥 @thalitasan vem!';
    const mention = fan('thalitasan', 3);
    expect(text.slice(mention.start, mention.end)).toBe('@thalitasan');
    expect(mentionSegments(text, [mention])).toEqual([
      { text: '🔥 ', mention: null },
      { text: '@thalitasan', mention },
      { text: ' vem!', mention: null },
    ]);
  });

  it('o trecho que não confere com o @ (o texto mudou, posição errada) fica texto puro', () => {
    const text = '@davilim e @thalitasan';
    const shifted = fan('thalitasan', 10);
    const other = { ...fan('nenho', 0), kind: 'artist' as const };
    expect(checkedMentions(text, [shifted, other])).toEqual([]);
    expect(mentionSegments(text, [shifted])).toEqual([{ text, mention: null }]);
  });

  it('sem diferença de maiúscula; fora de ordem vem em ordem; o que cruza o anterior e o que passa do fim ficam de fora', () => {
    const text = '@DaviLim e @thalitasan';
    const second = fan('thalitasan', 11);
    const first = fan('davilim', 0);
    const crossing = fan('davilim', 5);
    const beyond = { ...fan('thalitasan', 11), end: 40 };
    expect(checkedMentions(text, [second, first, crossing, beyond])).toEqual([first, second]);
    expect(checkedMentions(text, undefined)).toEqual([]);
  });

  it('as ações do corpo: um por fã ou central, na ordem do texto, sem repetir', () => {
    const text = '@davilim, @nenho e @davilim de novo';
    const artist: FanClubMention = {
      handle: 'nenho',
      kind: 'artist',
      id: 'nenho',
      start: 10,
      end: 16,
    };
    const targets = mentionTargets(text, [
      fan('davilim', 19, 'fa-2'),
      artist,
      fan('davilim', 0, 'fa-2'),
    ]);
    expect(targets.map((mention) => `${mention.kind}:${mention.id}`)).toEqual([
      'fan:fa-2',
      'artist:nenho',
    ]);
  });
});

describe('o @ que está sendo digitado (37.9, item 6)', () => {
  it.each([
    ['@', 1, { start: 0, end: 1, query: '' }],
    ['Oi @Tha', 7, { start: 3, end: 7, query: 'tha' }],
    ['(@nen', 5, { start: 1, end: 5, query: 'nen' }],
    ['@davi lim', 5, { start: 0, end: 5, query: 'davi' }],
  ])('"%s" com o cursor em %i', (text, cursor, draft) => {
    expect(mentionDraftAt(text, cursor)).toEqual(draft);
  });

  it('com o cursor no meio do @, a troca leva o @ inteiro', () => {
    expect(mentionDraftAt('Oi @thalita!', 6)).toEqual({ start: 3, end: 11, query: 'th' });
  });

  it.each([
    ['sem @', 'oi tudo bem', 5],
    ['depois de letra (um e-mail)', 'camila@ima', 10],
    ['depois de número', '2@ab', 4],
    ['o cursor antes do @', '@thalita', 0],
    ['depois de um espaço', '@thalita ', 9],
    ['mais de 30 letras', `@${'a'.repeat(31)}`, 32],
  ])('nenhum %s', (_case, text, cursor) => {
    expect(mentionDraftAt(text, cursor)).toBeNull();
  });

  it('até 30 letras ainda é o @', () => {
    expect(mentionDraftAt(`@${'a'.repeat(30)}`, 31)?.query).toHaveLength(30);
  });

  it('o mesmo rascunho não muda a barra', () => {
    const draft = { start: 0, end: 3, query: 'ne' };
    expect(sameDraft(draft, { ...draft })).toBe(true);
    expect(sameDraft(draft, { ...draft, query: 'nen' })).toBe(false);
    expect(sameDraft(null, null)).toBe(true);
    expect(sameDraft(draft, null)).toBe(false);
  });
});

describe('as sugestões (37.7, R5 e R6)', () => {
  const conversation = [
    suggestion('thalitasan', { role: 'manager', inConversation: true }),
    suggestion('nenho', { kind: 'artist', id: 'nenho', role: 'artist', inConversation: true }),
    suggestion('davilim', { inConversation: true }),
  ];

  it('a conversa na hora, filtrada pelo começo do @; com o @ sozinho, toda', () => {
    expect(mentionSuggestionsFor(conversation, [], '').map((item) => item.username)).toEqual([
      'thalitasan',
      'nenho',
      'davilim',
    ]);
    expect(mentionSuggestionsFor(conversation, [], 'n').map((item) => item.username)).toEqual([
      'nenho',
    ]);
  });

  it('a busca só a partir de 2 letras, depois da conversa, sem repetir e filtrada pelo começo de agora', () => {
    const search = [
      suggestion('nenho', { kind: 'artist', id: 'nenho' }),
      suggestion('nettobrito', { kind: 'artist', id: 'nettobrito' }),
    ];
    expect(mentionSuggestionsFor(conversation, search, 'n').map((item) => item.username)).toEqual([
      'nenho',
    ]);
    expect(mentionSuggestionsFor(conversation, search, 'ne').map((item) => item.username)).toEqual([
      'nenho',
      'nettobrito',
    ]);
    // A busca que chegou de um começo anterior não mostra o que não casa mais.
    expect(mentionSuggestionsFor(conversation, search, 'net').map((item) => item.username)).toEqual(
      ['nettobrito'],
    );
  });

  it('até 8', () => {
    const many = Array.from({ length: 12 }, (_, index) => suggestion(`fa${index}`));
    expect(mentionSuggestionsFor(many, [], 'fa')).toHaveLength(8);
  });

  it('o começo da resposta é o @ de quem foi respondido e um espaço (R7)', () => {
    expect(replyPrefix('thalitasan')).toBe('@thalitasan ');
  });
});
