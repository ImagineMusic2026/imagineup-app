import { countInviteStats } from '../../invites/service';
import {
  decodeLedgerCursor,
  LEDGER_LIMIT_DEFAULT,
  LEDGER_LIMIT_MAX,
  progressView,
  readLedgerPage,
  readWallet,
  walletView,
} from '../../points/wallet';
import type { LedgerEntry, MyProgress, Page, Wallet } from '../contract';
import { apiError } from '../errors';
import type { ReadRoute, RouteInput } from '../types';

// Rotas do bloco 1: carteira, progresso e extrato do fã. Só leem (uma leitura
// da carteira e a configuração do cache) e não criam nada: carteira que não
// existe responde zerada. Desde o bloco 5, o progresso conta também os links e
// as pessoas trazidas pelo convite (20.2). docs/arquitetura-api.md, seção 6.

/** Parâmetro de busca como texto: ausente é undefined; lista ou objeto é inválido. */
function queryText(query: Record<string, unknown>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw apiError('invalid_request', { field: name });
  return value;
}

function ledgerQuery(input: RouteInput): {
  limit: number;
  cursor: ReturnType<typeof decodeLedgerCursor>;
} {
  const limitText = queryText(input.query, 'limit');
  let limit = LEDGER_LIMIT_DEFAULT;
  if (limitText !== undefined) {
    if (!/^\d{1,3}$/.test(limitText)) throw apiError('invalid_request', { field: 'limit' });
    limit = Number(limitText);
    if (limit < 1 || limit > LEDGER_LIMIT_MAX) {
      throw apiError('invalid_request', { field: 'limit' });
    }
  }
  const cursorText = queryText(input.query, 'cursor');
  const cursor =
    cursorText === undefined || cursorText === '' ? null : decodeLedgerCursor(cursorText);
  if (cursorText && !cursor) throw apiError('invalid_request', { field: 'cursor' });
  return { limit, cursor };
}

export const meRoutes: ReadRoute[] = [
  {
    method: 'GET',
    pattern: '/me/wallet',
    writes: false,
    async handle({ uid, deps }): Promise<Wallet> {
      const [wallet, config] = await Promise.all([readWallet(deps.db, uid), deps.config.get()]);
      return walletView(wallet, config);
    },
  },
  {
    method: 'GET',
    pattern: '/me/progress',
    writes: false,
    async handle({ uid, now, deps }): Promise<MyProgress> {
      const [wallet, config, invites] = await Promise.all([
        readWallet(deps.db, uid),
        deps.config.get(),
        countInviteStats(deps.db, uid),
      ]);
      return progressView(wallet, config, now, invites);
    },
  },
  {
    method: 'GET',
    pattern: '/me/ledger',
    writes: false,
    validate: (input) => void ledgerQuery(input),
    async handle(ctx): Promise<Page<LedgerEntry>> {
      return readLedgerPage(ctx.deps.db, ctx.uid, ledgerQuery(ctx));
    },
  },
];
