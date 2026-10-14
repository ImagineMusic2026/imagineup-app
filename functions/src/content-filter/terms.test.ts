import { hash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  ABBREVIATIONS,
  COMMON_WORDS,
  FAN_SLANG,
  FIRST_NAMES,
  FIXTURE_ARTISTS,
  HANDLE_SEPARATORS,
  ibgeMunicipalities,
  NAME_CONNECTORS,
  NUMBERS,
  PET_PHRASES,
  PORTUGUESE_NEAR_ENGLISH,
  SURNAMES,
  VIOLENT_IDIOMS,
} from '../../test/content-filter-corpus';
import { readLegibleList } from '../../test/content-filter-list';
import { SEED_CENTRALS } from '../centrals/seed';
import { SEED_FAN_DETAILS, SEED_FANS } from '../fan-profile/seed';
import { SEED_SPAM_COMMENTS, SEED_SPAM_FAN } from '../moderation/seed';
import { SEED_ENGAGEMENT } from '../posts/seed';
import { usernameBase } from '../profile';
import { RANKING_SEED } from '../ranking/seed';
import { isBlockedHandle, isBlockedSocial, isBlockedText } from '.';
import {
  createFilterFromKeys,
  entryKeysOf,
  FILTER_CATEGORIES,
  FILTER_LIMITS,
  sha256Key,
  type ContentFilter,
  type FilterCategory,
  type FilterTextField,
} from './match';
import { FILTER_NORMALIZATION_VERSION } from './normalize';
import {
  FILTER_ENTRIES,
  FILTER_EXCEPTIONS,
  FILTER_NORMALIZATION_VERSION as TERMS_NORMALIZATION_VERSION,
} from './terms';

// A lista de verdade (docs/arquitetura-api.md, 30.11). O repositório só tem as
// chaves (opção (a') da pergunta 1 do dono): a forma e o corpus de inocentes
// rodam no CI; as variantes de cada termo, só com a lista legível, fora de
// todo repositório. Nenhum termo é escrito aqui, e as mensagens de falha dizem
// só o texto inocente ou o índice da entrada.

type Field = FilterTextField | 'username' | 'socials';

const TEXT_FIELDS: readonly FilterTextField[] = ['comment', 'bio', 'displayName', 'city'];
const FIELDS: readonly Field[] = [...TEXT_FIELDS, 'username', 'socials'];

/** O filtro de produção, como os ganchos o chamam. */
const PRODUCTION: ContentFilter = { isBlockedText, isBlockedHandle, isBlockedSocial };

// O mesmo SHA-256 do `sha256Key` pela função de uma chamada só do Node: o
// corpus dos nomes faz milhões de resumos.
const fastKey = (piece: string): string => hash('sha256', piece);
const FAST = createFilterFromKeys(FILTER_ENTRIES, {
  exceptions: FILTER_EXCEPTIONS,
  key: fastKey,
  normalizationVersion: TERMS_NORMALIZATION_VERSION,
});

function blockedIn(filter: ContentFilter, text: string, field: Field): boolean {
  if (field === 'username') return filter.isBlockedHandle(text);
  if (field === 'socials') return filter.isBlockedSocial(text);
  return filter.isBlockedText(text, field);
}

/** Os textos barrados em algum dos campos, como "campo: texto" (a lista vazia é o esperado). */
function barred(
  texts: Iterable<string>,
  fields: readonly Field[] = FIELDS,
  filter: ContentFilter = PRODUCTION,
): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const field of fields) if (blockedIn(filter, text, field)) out.push(`${field}: ${text}`);
  }
  return out;
}

const HEX_KEY = /^[0-9a-f]{64}$/;

describe('a forma da lista (no CI)', () => {
  it('a versão da normalização do terms.ts é a do normalize.ts', () => {
    expect(TERMS_NORMALIZATION_VERSION).toBe(FILTER_NORMALIZATION_VERSION);
  });

  it('cada entrada tem categoria válida e cabe nos tetos de 30.4', () => {
    expect(FILTER_ENTRIES.length).toBeGreaterThan(0);
    expect(FILTER_ENTRIES.length).toBeLessThanOrEqual(FILTER_LIMITS.entries);
    const problems: number[] = [];
    FILTER_ENTRIES.forEach((entry, index) => {
      const fits =
        FILTER_CATEGORIES.includes(entry.category) &&
        entry.forms.length >= 1 &&
        entry.forms.length <= FILTER_LIMITS.forms + 1 &&
        entry.forms.every(
          (form) => form.length >= 1 && form.length <= FILTER_LIMITS.phrasePieces,
        ) &&
        entry.joined.length === entry.forms.length;
      if (!fits) problems.push(index);
    });
    expect(problems, 'entradas fora da forma').toEqual([]);
  });

  it('as chaves são SHA-256 em hexadecimal', () => {
    const problems = FILTER_ENTRIES.flatMap((entry, index) =>
      [...entry.forms.flat(), ...entry.joined].every((key) => HEX_KEY.test(key)) ? [] : [index],
    );
    expect(problems, 'entradas com chave fora do formato').toEqual([]);
  });

  it('nenhuma forma repetida, na mesma entrada ou em outra', () => {
    const seen = new Map<string, string>();
    const repeated: string[] = [];
    FILTER_ENTRIES.forEach((entry, index) => {
      entry.forms.forEach((form, formIndex) => {
        const signature = form.join(' ');
        const where = `entrada ${index}, forma ${formIndex}`;
        const before = seen.get(signature);
        if (before) repeated.push(`${where} repete ${before}`);
        else seen.set(signature, where);
      });
    });
    expect(repeated).toEqual([]);
  });

  it('nenhum termo vira número puro', () => {
    // Todo número de 1 a 5 algarismos: nenhum pedaço e nenhuma frase junta é um deles.
    const numbers = new Set<string>();
    for (let digits = 1; digits <= 5; digits++) {
      for (let value = 0; value < 10 ** digits; value++) {
        numbers.add(sha256Key(String(value).padStart(digits, '0')));
      }
    }
    const problems = FILTER_ENTRIES.flatMap((entry, index) =>
      [...entry.forms.flat(), ...entry.joined].some((key) => numbers.has(key)) ? [index] : [],
    );
    expect(problems, 'entradas com um número puro').toEqual([]);
  });

  it('o inHandle só com 5 letras ou mais, um tamanho por forma', () => {
    const problems = FILTER_ENTRIES.flatMap((entry, index) => {
      const lengths = entry.handleLengths;
      if (lengths === undefined) return [];
      const fits =
        lengths.length === entry.forms.length &&
        lengths.every(
          (length) =>
            Number.isInteger(length) &&
            length >= FILTER_LIMITS.handleMinLength &&
            length <= FILTER_LIMITS.maxLength,
        );
      return fits ? [] : [index];
    });
    expect(problems, 'entradas com o inHandle fora da forma').toEqual([]);
  });

  it('as exceções cabem no teto e compilam com a lista no filtro de produção', () => {
    expect(FILTER_EXCEPTIONS.length).toBeLessThanOrEqual(FILTER_LIMITS.exceptions);
    expect(() => isBlockedText('Bom dia', 'comment')).not.toThrow();
    expect(fastKey('teste')).toBe(sha256Key('teste'));
  });

  it('cada categoria tem ao menos uma entrada', () => {
    const categories = new Set<FilterCategory>(FILTER_ENTRIES.map((entry) => entry.category));
    expect([...categories].sort()).toEqual([...FILTER_CATEGORIES].sort());
  });
});

describe('o corpus de inocentes nunca é barrado (no CI)', () => {
  it('as palavras comuns com trechos curtos de termos, e as que ficaram fora da lista, em todo campo', () => {
    expect(barred(COMMON_WORDS)).toEqual([]);
  });

  it('as abreviações de duplo sentido e as do dia a dia, em todo campo', () => {
    expect(barred(ABBREVIATIONS)).toEqual([]);
  });

  it('os números com letra que a troca transforma, e os números puros, em todo campo', () => {
    expect(barred(NUMBERS)).toEqual([]);
  });

  it('as gírias e os elogios dos fãs de arrocha, pagode e piseiro, no comentário e na bio', () => {
    expect(barred(FAN_SLANG, ['comment', 'bio'])).toEqual([]);
  });

  it('as palavras do português perto da base em inglês, em todo campo', () => {
    expect(barred(PORTUGUESE_NEAR_ENGLISH)).toEqual([]);
  });

  it('as expressões do dia a dia com palavras de violência, no comentário e na bio', () => {
    expect(barred(VIOLENT_IDIOMS, ['comment', 'bio'])).toEqual([]);
  });

  it('o elogio ao bicho de estimação de alguém, no comentário e na bio', () => {
    expect(barred(PET_PHRASES, ['comment', 'bio'])).toEqual([]);
  });

  it('os artistas das fixtures e do seed, em todo campo', () => {
    const artists = [
      ...FIXTURE_ARTISTS,
      ...SEED_CENTRALS.flatMap((central) => [central.id, central.name, central.shortName ?? '']),
    ].filter((text) => text !== '');
    expect(barred(artists)).toEqual([]);
    expect(
      barred(
        artists.map((name) => `Fã do ${name}`),
        ['comment', 'bio', 'displayName'],
      ),
    ).toEqual([]);
  });

  it('os 5.571 municípios do IBGE, na cidade e num comentário', () => {
    const municipalities = ibgeMunicipalities();
    expect(municipalities).toHaveLength(5571);
    const cities = municipalities.flatMap(({ name, uf }) => [name, `${name}, ${uf}`]);
    expect(barred(cities, ['city'], FAST)).toEqual([]);
    expect(
      barred(
        municipalities.map(({ name }) => `show em ${name}`),
        ['comment'],
        FAST,
      ),
    ).toEqual([]);
  });

  it('os 200 prenomes e os 100 sobrenomes são os escritos à mão, sem repetir', () => {
    expect(new Set(FIRST_NAMES).size).toBe(200);
    expect(FIRST_NAMES).toHaveLength(200);
    expect(new Set(SURNAMES).size).toBe(100);
    expect(SURNAMES).toHaveLength(100);
  });

  it('cada prenome e cada sobrenome sozinhos, em todo campo', () => {
    expect(barred([...FIRST_NAMES, ...SURNAMES], FIELDS, FAST)).toEqual([]);
  });

  it('o @ automático e o nome inteiro de cada prenome com cada sobrenome', () => {
    const handles = new Set<string>();
    const names: string[] = [];
    for (const first of FIRST_NAMES) {
      for (const last of SURNAMES) {
        handles.add(usernameBase(`${first} ${last}`));
        names.push(`${first} ${last}`);
      }
    }
    expect(barred(handles, ['username'], FAST)).toEqual([]);
    expect(barred(names, ['displayName'], FAST)).toEqual([]);
  }, 60_000);

  /** O usuário de cada prenome com cada sobrenome nas redes, com e sem "do", "da", "dos", "das" e "de". */
  function barredSocials(separators: readonly string[], filter: ContentFilter): string[] {
    const problems: string[] = [];
    for (const first of FIRST_NAMES) {
      for (const last of SURNAMES) {
        for (const connector of NAME_CONNECTORS) {
          for (const separator of separators) {
            const handle = [first, connector, last]
              .filter((part) => part !== '')
              .join(separator)
              .toLowerCase();
            if (filter.isBlockedSocial(handle)) problems.push(handle);
          }
        }
      }
    }
    return problems;
  }

  it('cada prenome e cada sobrenome nas redes, separados por ".", "_" e "-", com e sem "do", "da", "dos", "das" e "de"', () => {
    // Separados, os pedaços são os nomes, que se repetem: as chaves curtas ficam guardadas.
    const memo = new Map<string, string>();
    const memoKey = (piece: string): string => {
      if (piece.length > 12) return fastKey(piece);
      let key = memo.get(piece);
      if (key === undefined) {
        key = fastKey(piece);
        memo.set(piece, key);
      }
      return key;
    };
    const filter = createFilterFromKeys(FILTER_ENTRIES, {
      exceptions: FILTER_EXCEPTIONS,
      key: memoKey,
      normalizationVersion: TERMS_NORMALIZATION_VERSION,
    });
    expect(barredSocials(HANDLE_SEPARATORS, filter)).toEqual([]);
  }, 120_000);

  it('cada prenome colado a cada sobrenome nas redes, sem separador, com e sem "do", "da", "dos", "das" e "de"', () => {
    // Um pedaço só: o trecho vale nele, e os nomes colados formam trechos novos.
    expect(barredSocials([''], FAST)).toEqual([]);
  }, 120_000);
});

describe('o seed passa no campo dele (no CI)', () => {
  it('os comentários do seed', () => {
    const comments = [
      ...SEED_ENGAGEMENT.comments.map((comment) => comment.text),
      ...SEED_SPAM_COMMENTS.map((comment) => comment.text),
    ];
    expect(barred(comments, ['comment'])).toEqual([]);
  });

  it('os nomes, as cidades e os @ dos fãs de teste e das contas do ranking', () => {
    const people = [
      ...SEED_FANS.map((fan) => ({ name: fan.displayName, city: fan.city })),
      ...RANKING_SEED.map((account) => ({ name: account.name, city: account.city })),
      { name: SEED_SPAM_FAN.displayName, city: null },
    ];
    expect(
      barred(
        people.map((person) => person.name),
        ['displayName'],
      ),
    ).toEqual([]);
    expect(
      barred(
        people.map((person) => usernameBase(person.name)),
        ['username'],
      ),
    ).toEqual([]);
    const cities = people.flatMap((person) => (person.city === null ? [] : [person.city]));
    expect(barred(cities, ['city'])).toEqual([]);
  });

  it('a bio, as redes, o nome e o @ dos detalhes do perfil', () => {
    expect(
      barred(
        SEED_FAN_DETAILS.map((fan) => fan.displayName),
        ['displayName'],
      ),
    ).toEqual([]);
    expect(
      barred(
        SEED_FAN_DETAILS.map((fan) => fan.username),
        ['username'],
      ),
    ).toEqual([]);
    const bios = SEED_FAN_DETAILS.flatMap((fan) => (fan.bio === null ? [] : [fan.bio]));
    expect(barred(bios, ['bio'])).toEqual([]);
    const socials = SEED_FAN_DETAILS.flatMap((fan) =>
      Object.values(fan.socials).filter((handle): handle is string => typeof handle === 'string'),
    );
    expect(barred(socials, ['socials'])).toEqual([]);
  });
});

// --- Só na máquina do dono: as variantes de cada termo ----------------------------

// A lista legível, fora de todo repositório (a variável CONTENT_FILTER_LIST ou
// `filtro-lista/termos.json`, na pasta que guarda este repositório), lida pelo
// mesmo helper dos testes de emulador, sem a nota de revisão.
const LEGIBLE = readLegibleList();
if (!LEGIBLE) {
  // Direto no stderr: o vitest esconde o console dos testes que passam.
  process.stderr.write(
    'Filtro de conteúdo: sem a lista legível (filtro-lista/termos.json), as variantes de cada ' +
      'termo foram puladas. É o esperado no CI: a lista fica fora de todo repositório.\n',
  );
}

const LEET: Readonly<Record<string, string>> = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };
const ACCENTED: Readonly<Record<string, string>> = { a: 'á', e: 'ê', i: 'í', o: 'ô', u: 'ú' };

const withoutAccents = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '');
const letterCount = (word: string): number =>
  [...word].filter((char) => /\p{L}/u.test(char)).length;
const spell = (word: string, separator: string): string => [...word].join(separator);

/** Números no lugar de letras, com a primeira letra de cada palavra mantida (o pedaço fica com letra). */
const leet = (word: string): string =>
  [...word].map((char, index) => (index === 0 ? char : (LEET[char] ?? char))).join('');

/** `@` e `$` no lugar do "a" e do "s" no meio da palavra. */
const symbols = (word: string): string =>
  [...word]
    .map((char, index, chars) => {
      if (index === 0 || index === chars.length - 1) return char;
      return char === 'a' ? '@' : char === 's' ? '$' : char;
    })
    .join('');

/** O 1 no lugar de todo "l", menos no começo da palavra (o pedaço fica com letra). */
const oneForL = (word: string): string =>
  [...word].map((char, index) => (index > 0 && char === 'l' ? '1' : char)).join('');

/**
 * As variantes de um termo ou de uma forma (30.11): maiúsculas, acento
 * trocado, letras repetidas, letras soltas só nas palavras de 3 letras ou mais
 * (uma de cada vez, com espaço, ponto, "|" e " | ") e a frase inteira
 * soletrada, números e símbolos no lugar de letras, o 1 no lugar do "l", e o
 * "!", o "!!1", o "1" e o "2024" no fim.
 */
function variants(text: string): string[] {
  const words = text.split(' ');
  const plain = withoutAccents(text);
  const out = new Set<string>([
    text,
    text.toUpperCase(),
    plain,
    plain.replace(/[aeiou]/g, (vowel) => ACCENTED[vowel] ?? vowel),
    text.replace(/\p{L}/gu, (letter) => letter + letter),
    words.map(leet).join(' '),
    words.map(symbols).join(' '),
    words.map(oneForL).join(' '),
    `${text}!`,
    `${text}!!!`,
    `${text}!!1`,
    `${text}1`,
    `${text}2024`,
  ]);
  words.forEach((word, index) => {
    if (letterCount(word) < 3) return;
    for (const separator of [' ', '.', '|', ' | ']) {
      out.add(words.map((other, at) => (at === index ? spell(other, separator) : other)).join(' '));
    }
  });
  if (letterCount(text) >= 3) out.add(spell(words.join(''), ' '));
  return [...out];
}

/**
 * Só no texto livre: a frase inteira soletrada ao lado de palavras de uma
 * letra ("é o", "e a"), que o grupo das letras soltas junta.
 */
function textVariants(text: string): string[] {
  if (letterCount(text) < 3) return [];
  const spelled = spell(text.replace(/ /g, ''), ' ');
  return [`ele é o ${spelled}`, `isso é a ${spelled}`, `${spelled} e o resto`];
}

describe.skipIf(!LEGIBLE)('as variantes de cada termo (só com a lista legível)', () => {
  const list = LEGIBLE!;

  it('o terms.ts está em dia com a lista legível', () => {
    const entries = list.terms.map((term, index) => entryKeysOf(term, sha256Key, index));
    expect(entries).toEqual(FILTER_ENTRIES);
    expect(list.exceptions).toEqual(FILTER_EXCEPTIONS);
  });

  it('cada termo, cada forma e as variantes de cada um são barrados em todo campo', () => {
    const misses: string[] = [];
    list.terms.forEach((term, index) => {
      [term.term, ...(term.forms ?? [])].forEach((form, formIndex) => {
        variants(form).forEach((variant, variantIndex) => {
          for (const field of FIELDS) {
            if (!blockedIn(PRODUCTION, variant, field)) {
              misses.push(
                `entrada ${index}, forma ${formIndex}, variante ${variantIndex}, ${field}`,
              );
            }
          }
        });
        textVariants(form).forEach((variant, variantIndex) => {
          for (const field of ['comment', 'bio'] as const) {
            if (!blockedIn(PRODUCTION, variant, field)) {
              misses.push(
                `entrada ${index}, forma ${formIndex}, variante do texto ${variantIndex}, ${field}`,
              );
            }
          }
        });
      });
    });
    expect(misses).toEqual([]);
  });

  it('a palavra em -ão tem o plural em -ões na lista (o corte do "es" não cobre o -ões)', () => {
    const misses: string[] = [];
    list.terms.forEach((term, index) => {
      [term.term, ...(term.forms ?? [])].forEach((form, formIndex) => {
        if (form.includes(' ') || !form.endsWith('ão')) return;
        const plural = `${form.slice(0, -2)}ões`;
        for (const field of FIELDS) {
          if (!blockedIn(PRODUCTION, plural, field)) {
            misses.push(`entrada ${index}, forma ${formIndex}, ${field}`);
          }
        }
      });
    });
    expect(misses).toEqual([]);
  });

  it('o termo inHandle colado no meio de outro texto é barrado nos campos de identidade', () => {
    const misses: string[] = [];
    list.terms.forEach((term, index) => {
      if (!term.inHandle) return;
      [term.term, ...(term.forms ?? [])].forEach((form, formIndex) => {
        const glued = `zz${withoutAccents(form).replace(/ /g, '')}99`;
        for (const field of ['displayName', 'city', 'username', 'socials'] as const) {
          if (!blockedIn(PRODUCTION, glued, field)) {
            misses.push(`entrada ${index}, forma ${formIndex}, ${field}`);
          }
        }
      });
    });
    expect(misses).toEqual([]);
  });
});
