// Roteador próprio da API (sem Express): a rota é { method, pattern, writes,
// handle }, com `:param` no padrão. O caminho é o req.path, que chega sem o
// nome da função em produção e no emulador: nunca monte rota com /api na frente.

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

export type RouteMatch<R> =
  | { kind: 'match'; route: R; params: Record<string, string> }
  | { kind: 'not_found' }
  | { kind: 'method_not_allowed'; allow: Method[] }
  | { kind: 'invalid' };

type Pattern = { method: Method; pattern: string };

function segments(path: string): string[] {
  return path.split('/').slice(1);
}

/** Tira a barra do fim (`/me/wallet/` é `/me/wallet`); `/` sozinho fica. */
export function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

type SegmentMatch = { params: Record<string, string> } | 'no' | 'invalid';

function matchSegments(pattern: string, path: string[]): SegmentMatch {
  const parts = segments(pattern);
  if (parts.length !== path.length) return 'no';
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const value = path[index]!;
    if (part.startsWith(':')) {
      if (value === '') return 'no';
      let decoded: string;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        return 'invalid';
      }
      // Barra codificada (%2F) dentro de um id nunca é id.
      if (decoded.includes('/')) return 'invalid';
      params[part.slice(1)] = decoded;
    } else if (part !== value) {
      return 'no';
    }
  }
  return { params };
}

/**
 * A rota do método e do caminho, com os parâmetros. Caminho que existe com
 * outro método é 405; que não existe, 404; com id malformado, inválido (400).
 */
export function matchRoute<R extends Pattern>(
  routes: readonly R[],
  method: string,
  rawPath: string,
): RouteMatch<R> {
  const path = normalizePath(rawPath);
  if (path === '/') return { kind: 'not_found' };
  const parts = segments(path);
  const allow: Method[] = [];
  let invalid = false;
  for (const route of routes) {
    const found = matchSegments(route.pattern, parts);
    if (found === 'no') continue;
    if (found === 'invalid') {
      invalid = true;
      continue;
    }
    if (route.method === method) return { kind: 'match', route, params: found.params };
    allow.push(route.method);
  }
  if (invalid) return { kind: 'invalid' };
  if (allow.length > 0) return { kind: 'method_not_allowed', allow };
  return { kind: 'not_found' };
}
