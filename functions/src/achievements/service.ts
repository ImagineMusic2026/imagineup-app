import type { MyAchievements } from '../api/contract';
import type { LoadedConfig } from '../points/config';
import { levelForXp, type WalletState } from '../points/model';
import { achievementsView } from './model';

// A leitura das conquistas do fã (`GET /me/achievements`, bloco 7, 22.2): a
// carteira, já lida pela rota, e a configuração do cache (o catálogo e a
// régua). As de nível que o XP de agora já alcança contam, com a data do
// `updatedAt` da carteira, antes de a próxima gravação guardá-las (22.6).

export function myAchievements(wallet: WalletState, config: LoadedConfig): MyAchievements {
  return achievementsView({
    catalog: config.achievements.achievements,
    owned: wallet.achievements,
    level: levelForXp(wallet.xp, config.points.levels).level.number,
    updatedAt: wallet.updatedAt,
  });
}
