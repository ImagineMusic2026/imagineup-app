import { randomInt } from 'node:crypto';

import { isVisibleLine } from './visible-line';

/** Limite do nome no firestore.rules. */
export const DISPLAY_NAME_MAX = 60;

/** @ do fã: minúsculas e números, de 3 a 20. */
export const USERNAME_PATTERN = /^[a-z0-9]{3,20}$/;

// Prefixo do @ de quem não tem nome utilizável ("fa" de fã).
const FALLBACK_BASE = 'fa';
const BASE_MAX = 15;
// Nada de @ que se passe pela marca ou pela equipe.
const RESERVED =
  /imagine|admin|suporte|support|oficial|official|moderad|moderat|moderac|verific|verified|atendimento|staff|equipe/;
const LOOKALIKE_DIGITS: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
};

// Número no lugar de letra ("adm1n", "1magine") e "rn" no lugar de "m" não driblam a lista.
function looksReserved(base: string): boolean {
  const letters = base
    .replace(/rn/g, 'm')
    .replace(/[01345]/g, (digit) => LOOKALIKE_DIGITS[digit] ?? digit);
  return RESERVED.test(letters);
}

export type RandomDigits = (count: number) => string;

export const randomDigits: RandomDigits = (count) =>
  String(randomInt(0, 10 ** count)).padStart(count, '0');

/**
 * Nome do perfil a partir do nome que veio do cadastro. Quem se cadastra pela
 * API do Firebase manda o nome que quiser, então ele passa pela mesma regra do
 * celular. Nome longo (o da Apple costuma ser) perde as últimas palavras até
 * caber. Sem nome válido, fica null e o fã preenche depois.
 */
export function profileDisplayName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw.normalize('NFC').trim();
  const fitted = name.length <= DISPLAY_NAME_MAX ? name : dropWordsToFit(name);
  // length conta unidades de UTF-16, nunca menos que a contagem das regras.
  if (!fitted || fitted.length > DISPLAY_NAME_MAX) return null;
  return isVisibleLine(fitted) ? fitted : null;
}

function dropWordsToFit(name: string): string | null {
  let fitted = '';
  for (const word of name.split(/\s+/u)) {
    const next = fitted ? `${fitted} ${word}` : word;
    if (next.length > DISPLAY_NAME_MAX) break;
    fitted = next;
  }
  return fitted || null;
}

/**
 * Base do @: primeiro nome mais as 3 primeiras letras do último, sem acento
 * ("Camila Ribeiro" vira "camilarib", como no protótipo). Sem letras latinas,
 * curto demais ou parecido com a marca, a base é "fa".
 */
export function usernameBase(displayName: string | null): string {
  if (!displayName) return FALLBACK_BASE;
  const words = displayName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const [first, ...rest] = words;
  if (!first) return FALLBACK_BASE;
  const last = rest.at(-1);
  const base = (first + (last ? last.slice(0, 3) : '')).slice(0, BASE_MAX);
  return base.length >= 3 && !looksReserved(base) ? base : FALLBACK_BASE;
}

/**
 * @ a tentar, na ordem: a base pura, a base com 2 e com 4 dígitos, e por fim
 * "fa" com 8 dígitos. Para a base "fa", só números aleatórios.
 */
export function usernameCandidates(base: string, random: RandomDigits = randomDigits): string[] {
  const candidates =
    base === FALLBACK_BASE
      ? Array.from({ length: 5 }, () => FALLBACK_BASE + random(6))
      : [
          base,
          ...Array.from({ length: 3 }, () => base + random(2)),
          ...Array.from({ length: 2 }, () => base + random(4)),
        ];
  candidates.push(FALLBACK_BASE + random(8));
  return [...new Set(candidates)];
}
