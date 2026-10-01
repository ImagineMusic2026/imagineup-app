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
 * Códigos que o servidor devolve quando recusa o resgate. O de saldo é o da
 * carteira (`API_ERROR_CODES`), que a `fixtureWallet.spend` também devolve.
 */
export const REDEEM_ERROR_CODES = {
  insufficientPoints: API_ERROR_CODES.insufficientPoints,
  soldOut: 'sold_out',
  notFound: 'reward_not_found',
} as const;
