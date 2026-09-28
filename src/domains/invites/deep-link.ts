/**
 * Links de convite chegam em dois formatos:
 * - link curto do fã: `imagineup://c/ABC`, `/c/ABC` ou `https://<domínio>/c/ABC`;
 * - link compartilhado de uma página com a atribuição: `/artista/netto?ref=ABC`.
 *
 * Os dois viram a rota interna `/convite/ABC` (com `?destino=` no segundo caso),
 * que guarda o código antes de qualquer tela. Tudo aqui é puro e síncrono,
 * porque roda no +native-intent, fora do React.
 */
const CODE = '[A-Za-z0-9_-]{3,64}';
const INVITE_PATH = new RegExp(`^/(?:c|convite)/(${CODE})/?$`);
const REF_PARAM = new RegExp(`^${CODE}$`);

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

export interface InviteLink {
  code: string;
  /** Página que o link abria, para seguir para ela depois de guardar o código. */
  destination: string | null;
}

export function parseInviteLink(input: string): InviteLink | null {
  const { path, query } = parse(input);
  const short = path.match(INVITE_PATH);
  if (short?.[1]) return { code: short[1], destination: null };

  const ref = query.get('ref');
  if (!ref || !REF_PARAM.test(ref)) return null;
  query.delete('ref');
  const rest = query.toString();
  return { code: ref, destination: rest ? `${path}?${rest}` : path };
}

/** Só o código, para quem não precisa do destino. */
export function inviteCodeFromPath(input: string): string | null {
  return parseInviteLink(input)?.code ?? null;
}

export function inviteRoute({ code, destination }: InviteLink): string {
  const base = `/convite/${encodeURIComponent(code)}`;
  return destination && destination !== '/'
    ? `${base}?destino=${encodeURIComponent(destination)}`
    : base;
}

/** Aceita como destino só caminho interno, nunca uma URL de fora. */
export function safeDestination(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
