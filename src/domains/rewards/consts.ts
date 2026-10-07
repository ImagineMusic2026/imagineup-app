import { Handshake, ImageIcon, Shirt, Ticket, Video, type LucideIcon } from 'lucide-react-native';

import type { IconTileTone } from '@/components/icon-tile';
import { API_ERROR_CODES } from '@/services/api/errors';

import type { RewardKind } from './types';

export interface RewardIconSpec {
  icon: LucideIcon;
  tone: IconTileTone;
}

/**
 * Ícone e cor de cada tipo de recompensa, pela regra de cor do app: ciano para
 * o que acontece num show (ingresso, meet & greet, foto no telão), rosa para o
 * resto, e nunca lima, que é só de pontos. O protótipo pinta o ingresso de
 * rosa e a videochamada de ciano; a regra do app vale até o dono dizer o
 * contrário, como nas missões (1g). Fora do saldo, o quadro fica de vidro.
 */
export const REWARD_ICONS: Record<RewardKind, RewardIconSpec> = {
  ticket: { icon: Ticket, tone: 'events' },
  meet: { icon: Handshake, tone: 'events' },
  screen: { icon: ImageIcon, tone: 'events' },
  videocall: { icon: Video, tone: 'action' },
  merch: { icon: Shirt, tone: 'action' },
};

/**
 * Códigos que o servidor devolve quando recusa o resgate (25.2). O de saldo é
 * o da carteira (`API_ERROR_CODES`), que a `fixtureWallet.spend` também
 * devolve. O `too_many_requests` é o teto do dia (10 resgates); o
 * `idempotency_key_reused` no resgate quer dizer que a chave já gravou um
 * pedido com outro corpo (a primeira tentativa deu certo, 25.5).
 */
export const REDEEM_ERROR_CODES = {
  insufficientPoints: API_ERROR_CODES.insufficientPoints,
  soldOut: API_ERROR_CODES.soldOut,
  notFound: 'reward_not_found',
  limitReached: 'redeem_limit_reached',
  changed: 'reward_changed',
  dailyLimit: 'too_many_requests',
  alreadyRedeemed: 'idempotency_key_reused',
} as const;

/**
 * O regulamento das recompensas nas fixtures (25.1, decisão 19): vazio
 * esconde o link, até a cliente entregar o texto (UP-45). Com a API, vale o
 * `rulesUrl` da loja, que o servidor manda.
 */
export const REWARDS_RULES_URL = '';
