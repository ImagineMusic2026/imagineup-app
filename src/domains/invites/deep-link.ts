import { INVITE_UTM_MAX } from './consts';
import type { InviteUtm } from './types';

/**
 * Links de convite chegam em dois formatos:
 * - link curto do fã: `imagineup://c/ABC`, `/c/ABC` ou `https://<domínio>/c/ABC`;
 * - link compartilhado de uma página com a atribuição: `/artista/netto?ref=ABC`.
 *
 * Os dois viram a rota interna `/convite/ABC` (com `?destino=` no segundo caso,
 * e os `utm_*` da campanha), que guarda o código antes de qualquer tela. Tudo
 * aqui é puro e síncrono, porque roda no +native-intent, fora do React.
 */
const CODE = '[A-Za-z0-9_-]{3,64}';
const INVITE_PATH = new RegExp(`^/(?:c|convite)/(${CODE})/?$`);
const REF_PARAM = new RegExp(`^${CODE}$`);

/** Os `utm_*` que ficam (decisão 8 do bloco 5): os outros podem levar quem recebeu o link. */
const KEPT_UTM = { utm_source: 'source', utm_medium: 'medium', utm_campaign: 'campaign' } as const;

interface ParsedLink {
  path: string;
  query: URLSearchParams;
}

function parse(input: string): ParsedLink {
  // Em https o que vem depois de // é o domínio; no esquema do app
  // (imagineup://c/ABC) já é o caminho.
  let withoutScheme = /^https?:\/\//i.test(input)
    ? input.replace(/^https?:\/\/[^/]*/i, '')
    : input.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  // No Expo Go o link vem como exp://192.168.0.10:8081/--/c/ABC.
  if (/^exps?:\/\//i.test(input))
    withoutScheme = withoutScheme.replace(/^[^/]*\/--(?=\/|\?|$)/, '');
  const [pathPart = '', rest = ''] = withoutScheme.split('?');
  const queryPart = rest.split('#')[0] ?? '';
  const cleanPath = pathPart.split('#')[0] ?? '';
  return {
    path: cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`,
    query: new URLSearchParams(queryPart),
  };
}

/**
 * Tira todo `utm_*` da busca (eles não são da página) e devolve só os três
 * que ficam, cada um com até 200 caracteres. Muda a busca recebida.
 */
function takeUtm(query: URLSearchParams): InviteUtm {
  const utm: InviteUtm = {};
  for (const [param, field] of Object.entries(KEPT_UTM)) {
    const value = query.get(param);
    if (value) utm[field] = value.slice(0, INVITE_UTM_MAX);
  }
  for (const name of [...query.keys()]) {
    if (name.toLowerCase().startsWith('utm_')) query.delete(name);
  }
  return utm;
}

export interface InviteLink {
  code: string;
  /** Página que o link abria, para seguir para ela depois de guardar o código. */
  destination: string | null;
  /** A campanha do link (só `utm_source`, `utm_medium` e `utm_campaign`). */
  utm: InviteUtm;
}

export function parseInviteLink(input: string): InviteLink | null {
  const { path, query } = parse(input);
  const short = path.match(INVITE_PATH);
  if (short?.[1]) return { code: short[1], destination: null, utm: takeUtm(query) };

  const ref = query.get('ref');
  if (!ref || !REF_PARAM.test(ref)) return null;
  query.delete('ref');
  const utm = takeUtm(query);
  const rest = query.toString();
  return { code: ref, destination: rest ? `${path}?${rest}` : path, utm };
}

/** Só o código, para quem não precisa do destino. */
export function inviteCodeFromPath(input: string): string | null {
  return parseInviteLink(input)?.code ?? null;
}

export function inviteRoute({ code, destination, utm }: InviteLink): string {
  const base = `/convite/${encodeURIComponent(code)}`;
  const params = new URLSearchParams();
  if (destination && destination !== '/') params.set('destino', destination);
  for (const [param, field] of Object.entries(KEPT_UTM)) {
    const value = utm[field];
    if (value) params.set(param, value);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Os `utm_*` que a rota `/convite/[codigo]` recebeu, de volta para o formato do convite. */
export function utmFromParams(params: Record<string, unknown>): InviteUtm {
  const utm: InviteUtm = {};
  for (const [param, field] of Object.entries(KEPT_UTM)) {
    const value = params[param];
    if (typeof value === 'string' && value) utm[field] = value.slice(0, INVITE_UTM_MAX);
  }
  return utm;
}

/** Aceita como destino só caminho interno, nunca uma URL de fora. */
export function safeDestination(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
