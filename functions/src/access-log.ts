import { isIP } from 'node:net';

import {
  onCall,
  type CallableFunction,
  type CallableOptions,
  type CallableRequest,
  type CallableResponse,
} from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';

// O registro de acesso (docs/arquitetura-api.md, 31.6): a cada pedido que chega
// ao handler da api, menos o GET /health (32.1, decisão 18), que é a sonda do
// teste de disponibilidade, e a cada chamada que chega ao handler de uma
// callable do painel, uma linha só com o IP e o uid, que o sink
// registros-de-acesso guarda por 184 dias (Marco Civil, art. 15; a seção 8 da
// política de privacidade promete só a data, a hora e o IP). A data e a hora
// são as da própria entrada do log. Nada de rota, URL, aparelho nem corpo nessa
// linha. As agendadas, os gatilhos e as filas não escrevem a linha: não são
// acesso de quem usa o app.

/**
 * O texto da linha. É contrato: o filtro do sink
 * (docs/protecao/registro-acesso/filtro-linha-acesso.txt) lê o stdout e o
 * `jsonPayload.message` igual a este texto, e a consulta judicial (31.8) lê o
 * `jsonPayload.ip` e o `jsonPayload.uid`. O texto, os dois campos e o nível
 * info (o stdout; o `warn` e o `error` vão ao stderr e sairiam do bucket) só
 * mudam junto com o sink, no mesmo dia. O outro texto de log que é contrato é
 * a frase do closeStatsDays (STATS_DAYS_CLOSED_LOG, em points/close.ts). Os
 * dois são presos por teste (31.11), que lê também o arquivo do filtro.
 */
export const ACCESS_LOG_MESSAGE = 'acesso';

/** O que o clientIp lê do pedido: o Request do Express e o ApiRequest cabem aqui. */
export type IpSource = { get?(name: string): string | undefined; ip?: string };

/**
 * O IP de quem chamou. Com o X-Forwarded-For, o último item, o que o
 * front-end do Google acrescenta no Cloud Run sem balanceador: nunca o
 * primeiro, que o cliente escreve como quiser, e nunca o `req.ip`, que o
 * Express tira do primeiro item quando confia no proxy. Sem o cabeçalho, o
 * `req.ip`. Só vale um IP de verdade: o `isIP` do `node:net`, sem a zona do
 * IPv6 (`fe80::1%texto`), que o `isIP` aceita com qualquer texto. Fora disso,
 * null, e nenhum texto do cliente chega à linha. Sem pedido (o `.run` dos
 * testes chega sem `rawRequest`), null.
 */
export function clientIp(req: IpSource | undefined): string | null {
  if (!req) return null;
  const forwarded = req.get?.('X-Forwarded-For');
  if (forwarded !== undefined) return validIp(forwarded.split(',').at(-1));
  return validIp(req.ip);
}

function validIp(value: string | undefined): string | null {
  const ip = value?.trim();
  return ip && !ip.includes('%') && isIP(ip) !== 0 ? ip : null;
}

/** A linha `acesso`, sempre no nível info. O `uid` é null sem login. */
export function logAccess(ip: string | null, uid: string | null): void {
  logger.info(ACCESS_LOG_MESSAGE, { ip, uid });
}

/** As funções criadas pelo onPanelCall, para o teste do manifesto. */
const panelCalls = new WeakSet<object>();

/**
 * O onCall das callables do painel, com a linha `acesso` (31.6). As opções
 * passam ao onCall sem mudança: o `cors`, a região, a memória, a CPU, a
 * concorrência, os `secrets`, o `timeoutSeconds` e o `__endpoint` (o manifesto
 * que o firebase-tools lê no deploy e que o cpu.test.ts confere) ficam iguais.
 *
 * A linha sai no começo do handler, antes de chamar o de verdade, com o uid
 * que o SDK já conferiu em `request.auth`: sai mesmo quando a chamada estoura
 * o tempo. O que não chega ao handler fica sem ela, só no log de pedido de 30
 * dias (31.9): o preflight do CORS, o pedido fora do formato de callable e o
 * token inválido ou vencido. A chamada sem token chega, com o uid null.
 *
 * Callable nova entra sempre por aqui: o access-log.test.ts falha se alguma
 * callable exportada vier do onCall puro.
 */
export function onPanelCall<T = unknown, Return = unknown, Stream = unknown>(
  opts: CallableOptions<T>,
  handler: (request: CallableRequest<T>, response?: CallableResponse<Stream>) => Return,
): CallableFunction<T, Return extends Promise<unknown> ? Return : Promise<Return>, Stream> {
  const fn = onCall<T, Return, Stream>(opts, (request, response) => {
    logAccess(clientIp(request.rawRequest), request.auth?.uid ?? null);
    return handler(request, response);
  });
  panelCalls.add(fn);
  return fn;
}

/** true para a função que veio do onPanelCall. */
export function isPanelCall(fn: unknown): boolean {
  return typeof fn === 'function' && panelCalls.has(fn);
}
