import { apiUrl } from './server';

/** De onde o `api.ts` de um domínio lê: a API do servidor ou as fixtures tipadas do domínio. */
export type DataSource = 'api' | 'fixtures';

/**
 * Os domínios de dados do app, cada um com o bloco do servidor que liga as
 * rotas dele (docs/arquitetura-api.md, seção 2).
 */
export type DataDomain =
  /** /me/wallet, /me/progress e /me/ledger (bloco 1). */
  | 'wallet'
  /** /me/achievements (bloco 7). */
  | 'achievements'
  /** /me/invite e o claim do convite (bloco 5). */
  | 'invite'
  /** Centrais e artistas (bloco 4). */
  | 'artists'
  /** Mural, comentários e curtidas (bloco 6). */
  | 'posts'
  /** Shows e presenças (bloco 6). */
  | 'agenda'
  /** Missões (bloco 7). */
  | 'missions'
  /** Temporada e ranking (bloco 8). */
  | 'ranking'
  /** Loja e resgate (bloco 10). */
  | 'rewards';

/**
 * Domínios com rota no servidor. Cada bloco acrescenta o seu no commit que
 * entrega as rotas dele; os outros seguem nas fixtures mesmo com a API ligada.
 */
export const SERVER_DOMAINS: ReadonlySet<DataDomain> = new Set<DataDomain>(['wallet', 'artists']);

/**
 * A fonte de um domínio: a API quando ela está configurada (emulador em
 * desenvolvimento, ou `EXPO_PUBLIC_API_URL`) e o domínio já tem rota no
 * servidor; as fixtures no resto. Sem API (as builds de hoje), tudo nas
 * fixtures. Só o `api.ts` de cada domínio e o cache do React Query olham para
 * isto: a view e o `queries.ts` não sabem de onde o dado veio.
 */
export function sourceOf(domain: DataDomain): DataSource {
  return apiUrl && SERVER_DOMAINS.has(domain) ? 'api' : 'fixtures';
}

const ALL_DOMAINS: readonly DataDomain[] = [
  'wallet',
  'achievements',
  'invite',
  'artists',
  'posts',
  'agenda',
  'missions',
  'ranking',
  'rewards',
];

/** true enquanto algum domínio ainda lê das fixtures (o estado em memória delas importa). */
export function usesFixtures(): boolean {
  return ALL_DOMAINS.some((domain) => sourceOf(domain) === 'fixtures');
}
