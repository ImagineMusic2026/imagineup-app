import type {
  EditableProfile,
  FanPublicProfile,
  FanSocials,
  Gender,
  ProfileChanges,
  SocialNetwork,
} from '../api/contract';
import { DISPLAY_NAME_MAX } from '../profile';
import { cleanLine, cleanMultiline, isVisibleLine, isVisibleMultiline } from '../visible-line';
import { normalizeUsername, ProfileEditError, USERNAME_INPUT_MAX, USERNAME_PATTERN } from './model';

// Os campos novos do perfil do fã (seção 28 de docs/arquitetura-api.md), puro:
// nada aqui lê ou grava o Firestore. A bio, o gênero, a conta privada e as
// redes sociais; o corpo do `PUT /me/profile` conferido e limpo; a diferença
// contra o perfil guardado; e as duas respostas, o perfil editável (do
// próprio fã) e o perfil público (dos outros fãs), montadas campo a campo,
// nunca espalhando o documento. As redes têm espelho no app
// (src/domains/profile/details.ts): mudou um, mude o outro e as tabelas dos
// dois testes.

export type { FanSocials, Gender, ProfileChanges, SocialNetwork };

/** Teto da bio, em unidades de UTF-16 (como o nome). */
export const BIO_MAX = 200;

/** Teto de linhas da bio, contadas no texto limpo. */
export const BIO_MAX_LINES = 6;

/**
 * Teto da cidade do fã, em unidades de UTF-16. O nome evita o `CITY_MAX` (60)
 * que `artists/model.ts` já exporta para a cidade da central.
 */
export const FAN_CITY_MAX = 80;

/** Maior texto cru aceito numa rede (o link colado inteiro). */
export const SOCIAL_INPUT_MAX = 300;

/** Os gêneros, na ordem da tela. O ausente (ou null) é "Não informado". */
export const GENDERS = [
  'woman',
  'man',
  'nonbinary',
  'undisclosed',
] as const satisfies readonly Gender[];

/** As redes, na ordem da tela, das respostas e do mapa gravado. */
export const SOCIAL_NETWORKS = [
  'instagram',
  'tiktok',
  'linkedin',
  'x',
] as const satisfies readonly SocialNetwork[];

/**
 * O usuário guardado de cada rede, já em minúsculas e NFC. O LinkedIn aceita
 * as letras latinas acentuadas, e só elas (Latim-1 sem o `÷` e Latim
 * Estendido A, em faixas explícitas): o `\p{L}` deixaria passar letras
 * invisíveis (os preenchedores Hangul) e as da direita para a esquerda.
 */
export const SOCIAL_PATTERNS: Readonly<Record<SocialNetwork, RegExp>> = {
  instagram: /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/,
  tiktok: /^(?!.*\.$)[a-z0-9._]{2,24}$/,
  linkedin: /^[a-z0-9ß-öø-ÿĀ-ſ-]{3,100}$/u,
  x: /^[a-z0-9_]{1,15}$/,
};

/** Os domínios de cada rede no link colado. */
const NETWORK_DOMAINS: Readonly<Record<SocialNetwork, readonly string[]>> = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  linkedin: ['linkedin.com'],
  x: ['x.com', 'twitter.com'],
};

/** O que pode vir antes do domínio (o `www.`, o celular ou as duas letras do país no LinkedIn). */
const NETWORK_SUBDOMAINS: Readonly<Record<SocialNetwork, RegExp>> = {
  instagram: /^(?:www|m)$/,
  tiktok: /^(?:www|m)$/,
  linkedin: /^(?:www|[a-z]{2})$/,
  x: /^(?:www|mobile)$/,
};

/** O caminho do perfil no link de cada rede (já sem a busca, o `#` e a barra do fim). */
const PROFILE_PATHS: Readonly<Record<SocialNetwork, RegExp>> = {
  instagram: /^\/([^/]+)$/,
  tiktok: /^\/@([^/]+)$/,
  linkedin: /^\/in\/([^/]+)$/i,
  x: /^\/([^/]+)$/,
};

/**
 * As páginas da própria rede que cabem no padrão de um usuário (`x.com/home`,
 * `instagram.com/explore/`, coladas da barra de endereço): o link montado com
 * elas abriria a página da rede, e nunca um perfil, então são `format`,
 * digitadas ou coladas. No TikTok e no LinkedIn, o perfil tem o `@` ou o
 * `/in/` no caminho, e nenhuma página da rede passa por ele.
 */
const RESERVED_PATHS: Readonly<Record<SocialNetwork, ReadonlySet<string>>> = {
  instagram: new Set([
    'about',
    'accounts',
    'direct',
    'explore',
    'legal',
    'p',
    'reel',
    'reels',
    'stories',
    'tv',
    'web',
  ]),
  tiktok: new Set(),
  linkedin: new Set(),
  x: new Set([
    'compose',
    'explore',
    'home',
    'i',
    'login',
    'logout',
    'messages',
    'notifications',
    'privacy',
    'search',
    'settings',
    'signup',
    'tos',
  ]),
};

/** O usuário cabe no padrão da rede e não é uma página dela. */
const fitsNetwork = (network: SocialNetwork, handle: string): boolean =>
  SOCIAL_PATTERNS[network].test(handle) && !RESERVED_PATHS[network].has(handle);

const ALL_DOMAINS = SOCIAL_NETWORKS.flatMap((network) => NETWORK_DOMAINS[network]);

/** O link colado: o esquema opcional, o domínio e o caminho até a busca ou o `#`. */
const LINK = /^(?:https?:\/\/)?([^/?#]*)([^?#]*)/i;

const ownsDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

export type SocialProblem = 'format' | 'host';

/** O usuário normalizado (null para a rede vazia), ou o problema. */
export type SocialHandleResult =
  { ok: true; handle: string | null } | { ok: false; reason: SocialProblem };

const problem = (reason: SocialProblem): SocialHandleResult => ({ ok: false, reason });

/**
 * O usuário de uma rede a partir do que o fã digitou ou colou, nesta ordem:
 * corta as pontas; vazio vira null; acima de 300 caracteres é `format`; texto
 * com `/` ou com o domínio de uma rede é link (com ou sem `https://`), lido
 * por expressão regular e nunca por `new URL` (o app não usa `URL`): domínio
 * de outra rede ou de fora é `host`, o domínio da rede com outro prefixo ou o
 * caminho fora do formato do perfil (o `/company/` do LinkedIn, o TikTok sem
 * `@`, o `/p/<post>` do Instagram) é `format`, e a busca, o `#` e a barra do
 * fim saem; no LinkedIn, o endereço é decodificado (o `%` quebrado é
 * `format`); senão, tira um `@` do começo; passa para minúsculas e NFC; e
 * confere o padrão da rede e as páginas dela que cabem nele (`home`,
 * `explore`), os dois `format`.
 */
export function normalizeSocialHandle(network: SocialNetwork, raw: string): SocialHandleResult {
  const text = raw.trim();
  if (text === '') return { ok: true, handle: null };
  if (text.length > SOCIAL_INPUT_MAX) return problem('format');

  const link = LINK.exec(text)!;
  const host = link[1]!.toLowerCase();
  let candidate: string;
  if (text.includes('/') || ALL_DOMAINS.some((domain) => ownsDomain(host, domain))) {
    const domain = NETWORK_DOMAINS[network].find((item) => ownsDomain(host, item));
    if (!domain) return problem('host');
    const prefix = host === domain ? null : host.slice(0, -(domain.length + 1));
    if (prefix !== null && !NETWORK_SUBDOMAINS[network].test(prefix)) return problem('format');
    const path = PROFILE_PATHS[network].exec(link[2]!.replace(/\/+$/, ''));
    if (!path) return problem('format');
    candidate = path[1]!;
    if (network === 'linkedin') {
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
        return problem('format');
      }
    }
  } else {
    candidate = text.replace(/^@/, '');
  }

  const handle = candidate.toLowerCase().normalize('NFC');
  return fitsNetwork(network, handle) ? { ok: true, handle } : problem('format');
}

/**
 * O usuário guardado está no padrão da rede e não é uma página dela (o
 * último passo do `normalizeSocialHandle`): quem mostra confere de novo antes
 * de montar o link, e o que não passa não aparece.
 */
export function isSocialHandle(network: SocialNetwork, handle: unknown): handle is string {
  return typeof handle === 'string' && fitsNetwork(network, handle);
}

// --- Leitura do perfil guardado ------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** O gênero guardado, ou null (ausente, null ou fora da lista). */
export const genderOf = (value: unknown): Gender | null =>
  (GENDERS as readonly unknown[]).includes(value) ? (value as Gender) : null;

/**
 * As redes guardadas, lidas do mapa pela lista fixa: chave estranha no
 * documento é ignorada, e a rede fora do padrão vale como vazia.
 */
export function socialsOf(value: unknown): FanSocials {
  const map = isRecord(value) ? value : {};
  const read = (network: SocialNetwork): string | null => {
    const handle = Object.prototype.hasOwnProperty.call(map, network) ? map[network] : null;
    return isSocialHandle(network, handle) ? handle : null;
  };
  return {
    instagram: read('instagram'),
    tiktok: read('tiktok'),
    linkedin: read('linkedin'),
    x: read('x'),
  };
}

const hasAnySocial = (socials: FanSocials): boolean =>
  SOCIAL_NETWORKS.some((network) => socials[network] !== null);

/** ISO de um `Timestamp` do Firestore (ou de qualquer coisa com `toMillis`), ou null. */
function isoOf(value: unknown): string | null {
  const toMillis = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  if (typeof toMillis !== 'function') return null;
  const ms = (toMillis as () => unknown).call(value);
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// --- O corpo do PUT /me/profile -----------------------------------------------------

/** As chaves aceitas no corpo, na ordem em que são conferidas. */
export const PROFILE_CHANGE_KEYS = [
  'displayName',
  'username',
  'bio',
  'city',
  'gender',
  'privateAccount',
  'socials',
] as const;

/** O campo do `profile_invalid` (`details.field`). */
export type ProfileInvalidField =
  'displayName' | 'bio' | 'city' | 'gender' | `socials.${SocialNetwork}`;

/** O motivo do `profile_invalid` (`details.reason`). */
export type ProfileInvalidReason =
  'empty' | 'too_long' | 'too_many_lines' | 'invisible' | 'unknown' | SocialProblem;

/** O corpo conferido, ou o campo que recusou com 400 `invalid_request` (`body` sem chave). */
export type ParsedProfileChanges =
  { ok: true; value: ProfileChanges } | { ok: false; field: string };

const profileInvalid = (field: ProfileInvalidField, reason: ProfileInvalidReason) =>
  new ProfileEditError('profile_invalid', { field, reason });

/** O nome limpo e conferido: de 1 a 60 em UTF-16, numa linha visível. */
function cleanName(raw: string): string {
  const name = cleanLine(raw);
  if (name === '') throw profileInvalid('displayName', 'empty');
  if (name.length > DISPLAY_NAME_MAX) throw profileInvalid('displayName', 'too_long');
  if (!isVisibleLine(name)) throw profileInvalid('displayName', 'invisible');
  return name;
}

/** A bio limpa (vazia vira null): até 200 em UTF-16 e 6 linhas, toda linha visível. */
function cleanBio(raw: string | null): string | null {
  if (raw === null) return null;
  const bio = cleanMultiline(raw);
  if (bio === '') return null;
  if (bio.length > BIO_MAX) throw profileInvalid('bio', 'too_long');
  if (bio.split('\n').length > BIO_MAX_LINES) throw profileInvalid('bio', 'too_many_lines');
  if (!isVisibleMultiline(bio)) throw profileInvalid('bio', 'invisible');
  return bio;
}

/** A cidade limpa (vazia vira null): até 80 em UTF-16, numa linha visível. */
function cleanCity(raw: string | null): string | null {
  if (raw === null) return null;
  const city = cleanLine(raw);
  if (city === '') return null;
  if (city.length > FAN_CITY_MAX) throw profileInvalid('city', 'too_long');
  if (!isVisibleLine(city)) throw profileInvalid('city', 'invisible');
  return city;
}

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/**
 * O corpo do `PUT /me/profile`, conferido antes da transação e sem leitura:
 * - corpo que não é objeto ou sem nenhuma chave, chave desconhecida (no topo
 *   ou dentro de `socials`, `__proto__` e `constructor` inclusive, conferidas
 *   por `Object.keys` contra as listas fixas) ou tipo errado: `{ ok: false }`
 *   com o campo (400 `invalid_request` na rota; `socials.<chave>` dentro das
 *   redes);
 * - o @ cru acima de 64 é tipo errado; fora do formato depois do
 *   `normalizeUsername`, lança `username_invalid` (`reason: 'format'`);
 * - o resto fora da regra lança `profile_invalid` com `field` e `reason`.
 * Devolve um objeto novo montado campo a campo, com os textos limpos e as
 * redes normalizadas (a vazia vira null).
 */
export function parseProfileChanges(body: unknown): ParsedProfileChanges {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const keys = Object.keys(body);
  if (keys.length === 0) return { ok: false, field: 'body' };
  const unknownKey = keys.find((key) => !(PROFILE_CHANGE_KEYS as readonly string[]).includes(key));
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  const has = (key: (typeof PROFILE_CHANGE_KEYS)[number]) => keys.includes(key);

  // Os tipos primeiro: o pedido malformado é 400 `invalid_request` antes de qualquer regra.
  if (has('displayName') && typeof body.displayName !== 'string') {
    return { ok: false, field: 'displayName' };
  }
  if (
    has('username') &&
    (typeof body.username !== 'string' || body.username.length > USERNAME_INPUT_MAX)
  ) {
    return { ok: false, field: 'username' };
  }
  for (const key of ['bio', 'city', 'gender'] as const) {
    if (has(key) && !isTextOrNull(body[key])) return { ok: false, field: key };
  }
  if (has('privateAccount') && typeof body.privateAccount !== 'boolean') {
    return { ok: false, field: 'privateAccount' };
  }
  let rawSocials: Record<string, unknown> | null = null;
  let socialKeys: string[] = [];
  if (has('socials')) {
    if (!isRecord(body.socials)) return { ok: false, field: 'socials' };
    rawSocials = body.socials;
    socialKeys = Object.keys(rawSocials);
    if (socialKeys.length === 0) return { ok: false, field: 'socials' };
    for (const key of socialKeys) {
      if (!(SOCIAL_NETWORKS as readonly string[]).includes(key) || !isTextOrNull(rawSocials[key])) {
        return { ok: false, field: `socials.${key}` };
      }
    }
  }

  const changes: ProfileChanges = {};
  if (has('displayName')) changes.displayName = cleanName(body.displayName as string);
  if (has('username')) {
    const username = normalizeUsername(body.username as string);
    if (!USERNAME_PATTERN.test(username)) {
      throw new ProfileEditError('username_invalid', { reason: 'format' });
    }
    changes.username = username;
  }
  if (has('bio')) changes.bio = cleanBio(body.bio as string | null);
  if (has('city')) changes.city = cleanCity(body.city as string | null);
  if (has('gender')) {
    const gender = body.gender as string | null;
    if (gender !== null && !(GENDERS as readonly string[]).includes(gender)) {
      throw profileInvalid('gender', 'unknown');
    }
    changes.gender = gender as Gender | null;
  }
  if (has('privateAccount')) changes.privateAccount = body.privateAccount as boolean;
  if (rawSocials) {
    const socials: Partial<FanSocials> = {};
    for (const network of SOCIAL_NETWORKS) {
      if (!socialKeys.includes(network)) continue;
      const value = rawSocials[network] as string | null;
      const result = normalizeSocialHandle(network, value ?? '');
      if (!result.ok) throw profileInvalid(`socials.${network}`, result.reason);
      socials[network] = result.handle;
    }
    changes.socials = socials;
  }
  return { ok: true, value: changes };
}

// --- A diferença e a gravação ---------------------------------------------------------

/**
 * O que difere do perfil guardado (o retrato lido na transação): fica só o
 * campo cujo valor limpo é outro (o @ normalizado contra o de agora; as redes
 * rede a rede, sobre o mapa guardado). Sem diferença, um objeto vazio: o
 * pedido responde o de agora sem gravar e sem contar no teto.
 */
export function profileDiff(
  stored: Record<string, unknown>,
  changes: ProfileChanges,
): ProfileChanges {
  const diff: ProfileChanges = {};
  if (changes.displayName !== undefined && changes.displayName !== textOf(stored.displayName)) {
    diff.displayName = changes.displayName;
  }
  if (changes.username !== undefined && changes.username !== textOf(stored.username)) {
    diff.username = changes.username;
  }
  if (changes.bio !== undefined && changes.bio !== textOf(stored.bio)) diff.bio = changes.bio;
  if (changes.city !== undefined && changes.city !== textOf(stored.city)) diff.city = changes.city;
  if (changes.gender !== undefined && changes.gender !== genderOf(stored.gender)) {
    diff.gender = changes.gender;
  }
  if (
    changes.privateAccount !== undefined &&
    changes.privateAccount !== (stored.privateAccount === true)
  ) {
    diff.privateAccount = changes.privateAccount;
  }
  if (changes.socials) {
    const current = socialsOf(stored.socials);
    const socials: Partial<FanSocials> = {};
    for (const network of SOCIAL_NETWORKS) {
      const next = changes.socials[network];
      if (next !== undefined && next !== current[network]) socials[network] = next;
    }
    if (Object.keys(socials).length > 0) diff.socials = socials;
  }
  return diff;
}

/** A diferença tem alguma coisa a gravar. */
export const hasProfileChanges = (diff: ProfileChanges): boolean => Object.keys(diff).length > 0;

/**
 * Os campos do `tx.update` do perfil a partir da diferença, sem o @ (as
 * reservas e os campos dele saem do `writeUsernameSwap`) e nunca com
 * `updatedAt`. O `socials` vai inteiro, com as quatro chaves montadas a partir
 * de `SOCIAL_NETWORKS` (a rede mudada e as guardadas), e vira null quando as
 * quatro ficam vazias: nunca `set` com `merge` nem caminho com ponto.
 */
export function profileUpdateOf(
  stored: Record<string, unknown>,
  diff: ProfileChanges,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (diff.displayName !== undefined) fields.displayName = diff.displayName;
  if (diff.bio !== undefined) fields.bio = diff.bio;
  if (diff.city !== undefined) fields.city = diff.city;
  if (diff.gender !== undefined) fields.gender = diff.gender;
  if (diff.privateAccount !== undefined) fields.privateAccount = diff.privateAccount;
  if (diff.socials) {
    const current = socialsOf(stored.socials);
    const changed = diff.socials;
    const pick = (network: SocialNetwork): string | null => {
      const next = changed[network];
      return next === undefined ? current[network] : next;
    };
    const socials: FanSocials = {
      instagram: pick('instagram'),
      tiktok: pick('tiktok'),
      linkedin: pick('linkedin'),
      x: pick('x'),
    };
    fields.socials = hasAnySocial(socials) ? socials : null;
  }
  return fields;
}

// --- As respostas -------------------------------------------------------------------

/**
 * O perfil editável (`EditableProfile`, a resposta do `PUT /me/profile`), do
 * retrato com a diferença aplicada: o ausente vale o padrão (null, `false`), as
 * quatro redes sempre presentes, e o prazo do @ em ISO (null sem prazo).
 */
export function editableProfileOf(data: Record<string, unknown>): EditableProfile {
  return {
    displayName: textOf(data.displayName),
    username: textOf(data.username),
    usernameChangeableAt: isoOf(data.usernameChangeableAt),
    bio: textOf(data.bio),
    city: textOf(data.city),
    gender: genderOf(data.gender),
    privateAccount: data.privateAccount === true,
    socials: socialsOf(data.socials),
  };
}

/**
 * O perfil público (`GET /fans/:fanId`), montado campo a campo: a foto, o nome
 * e o @ sempre; a bio e as redes (só as que passam no padrão) na visão
 * completa. A fechada tem o mesmo corpo seja qual for o motivo (conta privada,
 * suspensa ou que bloqueou quem pede), para o bloqueado não ficar sabendo.
 * Nunca o gênero, a cidade, a conta privada, a suspensão, o `searchKeys`, o
 * prazo do @ nem os outros campos da foto.
 */
export function publicProfileOf(
  uid: string,
  data: Record<string, unknown>,
  restricted: boolean,
): FanPublicProfile {
  const displayName = textOf(data.displayName);
  const username = textOf(data.username);
  const photoURL = textOf(data.photoURL);
  if (restricted) {
    return { uid, displayName, username, photoURL, restricted: true, bio: null, socials: null };
  }
  const socials = socialsOf(data.socials);
  return {
    uid,
    displayName,
    username,
    photoURL,
    restricted: false,
    bio: textOf(data.bio),
    socials: hasAnySocial(socials) ? socials : null,
  };
}
