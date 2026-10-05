import type { Firestore, Transaction } from 'firebase-admin/firestore';

import type { AwardContext, AwardPlan, FanContext } from '../points/award';
import type { ConfigSource } from '../points/config';
import type { TokenVerifier } from './auth';
import type { Method } from './router';

/** O que o handler usa do pedido (o Request do Express cabe aqui; os testes usam objetos falsos). */
export interface ApiRequest {
  method: string;
  path: string;
  get(name: string): string | undefined;
  query: Record<string, unknown>;
  body: unknown;
  rawBody?: Buffer;
}

/** O que o handler usa da resposta (o Response do Express cabe aqui). */
export interface ApiResponse {
  status(code: number): ApiResponse;
  set(field: string, value: string): ApiResponse;
  json(body: unknown): void;
}

export type ApiDeps = {
  db: Firestore;
  auth: TokenVerifier;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
  /** Sorteio do shard, a cada tentativa da transação; os testes fixam. */
  random?: () => number;
  /** Valores e régua com cache; a temporada do lançamento vem da transação. */
  config?: ConfigSource;
  /**
   * O segredo do HMAC da chave da pessoa do convite (bloco 5): a função api lê
   * o INVITE_KEY_SECRET a cada pedido; os testes fixam. Sem ele, só as rotas do
   * convite falham.
   */
  inviteKey?: () => string;
};

export type ResolvedDeps = Required<ApiDeps>;

export type RouteInput = {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
};

export type ReadContext = RouteInput & {
  uid: string;
  /** O e-mail do ID token, ou null; nunca o do corpo. */
  email: string | null;
  now: number;
  deps: ResolvedDeps;
};

export type WriteContext = ReadContext & {
  tx: Transaction;
  /** O retrato do fã do requireFan, com a carteira e as marcas de atividade. */
  fan: FanContext;
  /** O contexto do planAwards: agora, valores, shard sorteado nesta tentativa e o fã como ator. */
  award: AwardContext;
};

/** O que a rota que grava devolve: a resposta e, se lançou pontos, o plano (com quem chama). */
export type WorkResult = { status?: number; body: unknown; plan?: AwardPlan };

type RouteBase = {
  method: Method;
  pattern: string;
  /** Confere parâmetros, busca e corpo antes de tudo; recusa com invalid_request. */
  validate?: (input: RouteInput) => void;
};

export type ReadRoute = RouteBase & {
  writes: false;
  handle: (ctx: ReadContext) => Promise<unknown>;
};

/**
 * Rota que grava: roda dentro do runIdempotent, com a chave e o fã já lidos.
 * Ordem fixa: leituras do domínio, planAwards, gravações do domínio.
 */
export type WriteRoute = RouteBase & {
  writes: true;
  handle: (ctx: WriteContext) => Promise<WorkResult>;
};

export type ApiRoute = ReadRoute | WriteRoute;
