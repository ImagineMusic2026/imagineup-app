import { FAN_CLUB_MENTION_SUGGESTIONS_MAX } from './consts';
import type { FanClubMention, MentionSuggestion } from './types';

// As contas das marcações no app (seção 37, 37.7 e 37.9, itens 2, 6 e 7),
// puras: os trechos do texto que viram link, conferidos antes de ligar; o @
// que está sendo digitado antes do cursor; e as sugestões, a conversa
// primeiro. Quem resolve o @ é o servidor, no envio.

/** O @ tem de 3 a 30 de `a-z`, `0-9` e `_`; o que está sendo digitado, até 30 (37.7). */
export const MENTION_HANDLE_MAX = 30;

/** A busca do @ começa com 2 letras (37.3, o `q`). */
export const MENTION_SEARCH_MIN = 2;

/** A espera entre as teclas antes da busca (o `useDebouncedValue`, 37.7). */
export const MENTION_SEARCH_DEBOUNCE_MS = 400;

/** Letra, número ou "_": antes do "@", o @ não marca (um e-mail, por exemplo). */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Um caractere de @ (`a-z`, `0-9` e `_`, também em maiúsculas, que o servidor lê em minúsculas). */
const HANDLE_CHAR = /^[A-Za-z0-9_]$/;

const isHandleChar = (char: string | undefined): boolean => !!char && HANDLE_CHAR.test(char);

/** Um trecho do texto: puro, ou a marcação que vira link. */
export interface MentionSegment {
  text: string;
  mention: FanClubMention | null;
}

/**
 * As marcações que o app liga: dentro do texto, em ordem, sem se cruzar, e
 * com o texto naquelas posições (unidades UTF-16, um emoji conta 2) igual ao
 * @ marcado, sem diferença de maiúscula. A que não confere fica texto puro
 * (37.7 e 37.16).
 */
export function checkedMentions(
  text: string,
  mentions: readonly FanClubMention[] | undefined,
): FanClubMention[] {
  const sorted = [...(mentions ?? [])].sort((a, b) => a.start - b.start);
  const checked: FanClubMention[] = [];
  let last = 0;
  for (const mention of sorted) {
    const { start, end } = mention;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < last || end <= start || end > text.length) continue;
    if (text.slice(start, end).toLowerCase() !== `@${mention.handle}`.toLowerCase()) continue;
    checked.push(mention);
    last = end;
  }
  return checked;
}

/** O texto em trechos, com as marcações conferidas como links e o resto puro. */
export function mentionSegments(
  text: string,
  mentions: readonly FanClubMention[] | undefined,
): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const mention of checkedMentions(text, mentions)) {
    if (mention.start > cursor) {
      segments.push({ text: text.slice(cursor, mention.start), mention: null });
    }
    segments.push({ text: text.slice(mention.start, mention.end), mention });
    cursor = mention.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mention: null });
  return segments;
}

/**
 * Os marcados de um texto, um por fã ou central, na ordem em que aparecem:
 * as ações do corpo do card para o leitor de tela (37.9, item 2).
 */
export function mentionTargets(
  text: string,
  mentions: readonly FanClubMention[] | undefined,
): FanClubMention[] {
  const seen = new Set<string>();
  return checkedMentions(text, mentions).filter((mention) => {
    const key = `${mention.kind}:${mention.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** O @ que está sendo digitado: de onde até onde trocar e o começo dele, em minúsculas. */
export interface MentionDraft {
  /** A posição do "@". */
  start: number;
  /** O fim do @ (as letras dele depois do cursor também saem na troca). */
  end: number;
  /** O que veio depois do "@" até o cursor, sem o "@" e em minúsculas. */
  query: string;
}

/**
 * O @ que está sendo digitado antes do cursor (37.9, item 6): um "@" no
 * começo do texto ou depois de um caractere que não é letra, número nem "_",
 * seguido de até 30 letras do @ até o cursor. Sem ele, null.
 */
export function mentionDraftAt(text: string, cursor: number): MentionDraft | null {
  const end = Math.max(0, Math.min(cursor, text.length));
  let first = end;
  while (first > 0 && end - first < MENTION_HANDLE_MAX && isHandleChar(text[first - 1])) {
    first -= 1;
  }
  const at = first - 1;
  if (at < 0 || text[at] !== '@') return null;
  if (at > 0 && WORD_CHAR.test(text[at - 1] ?? '')) return null;
  let tokenEnd = end;
  while (
    tokenEnd < text.length &&
    tokenEnd - first < MENTION_HANDLE_MAX &&
    isHandleChar(text[tokenEnd])
  ) {
    tokenEnd += 1;
  }
  return { start: at, end: tokenEnd, query: text.slice(first, end).toLowerCase() };
}

/** Os mesmos dois rascunhos: a barra não redesenha quando o cursor anda sem mudar o @. */
export function sameDraft(a: MentionDraft | null, b: MentionDraft | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end && a.query === b.query;
}

/**
 * As sugestões que a barra mostra (37.7): a conversa na hora, filtrada pelo
 * começo do @, e, a partir de 2 letras, a busca, também filtrada (a resposta
 * pode ser de um começo anterior, enquanto a seguinte não chega), sem repetir
 * e até 8.
 */
export function mentionSuggestionsFor(
  conversation: readonly MentionSuggestion[],
  search: readonly MentionSuggestion[],
  query: string,
): MentionSuggestion[] {
  const items: MentionSuggestion[] = [];
  const seen = new Set<string>();
  const add = (item: MentionSuggestion): void => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key) || items.length >= FAN_CLUB_MENTION_SUGGESTIONS_MAX) return;
    if (!item.username.toLowerCase().startsWith(query)) return;
    seen.add(key);
    items.push(item);
  };
  conversation.forEach(add);
  if (query.length >= MENTION_SEARCH_MIN) search.forEach(add);
  return items;
}

/** O começo do texto da resposta: o @ de quem foi respondido e um espaço (R7). */
export const replyPrefix = (username: string): string => `@${username} `;
