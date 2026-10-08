import type { FanSocials, Gender, SocialNetwork } from './types';

// Os campos novos do perfil do fã (seção 28 de docs/arquitetura-api.md):
// espelho de functions/src/fan-profile/details.ts. Mudou um, mude o outro e
// as tabelas dos dois testes (src/domains/profile/__tests__/details.test.ts e
// functions/src/fan-profile/details.test.ts). O app confere antes para o fã
// ver o erro no campo; quem decide é o servidor. Sem `new URL`: o app não usa
// `URL` no React Native.

/** Teto da bio, em unidades de UTF-16 (como o nome). */
export const BIO_MAX = 200;

/** Teto de linhas da bio, contadas no texto limpo. */
export const BIO_MAX_LINES = 6;

/** Maior texto cru aceito numa rede (o link colado inteiro). */
export const SOCIAL_INPUT_MAX = 300;

/** Os gêneros, na ordem da tela. O ausente (ou `null`) é "Não informado". */
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
 * invisíveis (os preenchedores Hangul) e as da direita para a esquerda, e as
 * faixas não dependem do `\p{Script=...}` no Hermes.
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

/** O usuário normalizado (`null` para a rede vazia), ou o problema. */
export type SocialHandleResult =
  { ok: true; handle: string | null } | { ok: false; reason: SocialProblem };

const problem = (reason: SocialProblem): SocialHandleResult => ({ ok: false, reason });

/**
 * O usuário de uma rede a partir do que o fã digitou ou colou, nesta ordem:
 * corta as pontas; vazio vira `null`; acima de 300 caracteres é `format`;
 * texto com `/` ou com o domínio de uma rede é link (com ou sem `https://`),
 * lido por expressão regular: domínio de outra rede ou de fora é `host`, o
 * domínio da rede com outro prefixo ou o caminho fora do formato do perfil (o
 * `/company/` do LinkedIn, o TikTok sem `@`, o `/p/<post>` do Instagram) é
 * `format`, e a busca, o `#` e a barra do fim saem; no LinkedIn, o endereço é
 * decodificado (o `%` quebrado é `format`); senão, tira um `@` do começo; passa
 * para minúsculas e NFC; e confere o padrão da rede e as páginas dela que
 * cabem nele (`home`, `explore`), os dois `format`.
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

/**
 * O link do perfil na rede, com o domínio fixo, montado a partir do usuário
 * guardado e conferido de novo: fora do padrão, `null` (a rede não aparece).
 * O endereço do LinkedIn vai com `encodeURIComponent` (os acentos).
 */
export function socialUrl(
  network: SocialNetwork,
  handle: string | null | undefined,
): string | null {
  if (!isSocialHandle(network, handle)) return null;
  switch (network) {
    case 'instagram':
      return `https://www.instagram.com/${handle}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'linkedin':
      return `https://www.linkedin.com/in/${encodeURIComponent(handle)}/`;
    case 'x':
      return `https://x.com/${handle}`;
  }
}

// --- Leitura do perfil guardado ------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** O gênero guardado, ou `null` (ausente, `null` ou fora da lista). */
export const genderOf = (value: unknown): Gender | null =>
  (GENDERS as readonly unknown[]).includes(value) ? (value as Gender) : null;

/**
 * As redes guardadas, lidas do mapa pela lista fixa: chave estranha no
 * documento é ignorada, e a rede fora do padrão vale como vazia. Sem nenhuma,
 * `null`.
 */
export function socialsOf(value: unknown): FanSocials | null {
  if (!isRecord(value)) return null;
  const read = (network: SocialNetwork): string | null => {
    const handle = Object.prototype.hasOwnProperty.call(value, network) ? value[network] : null;
    return isSocialHandle(network, handle) ? handle : null;
  };
  const socials: FanSocials = {
    instagram: read('instagram'),
    tiktok: read('tiktok'),
    linkedin: read('linkedin'),
    x: read('x'),
  };
  return SOCIAL_NETWORKS.some((network) => socials[network] !== null) ? socials : null;
}
