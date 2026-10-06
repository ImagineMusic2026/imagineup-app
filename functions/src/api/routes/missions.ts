import { myAchievements } from '../../achievements/service';
import { readDailyMission, readMissions } from '../../missions/service';
import { readWallet } from '../../points/wallet';
import type { DailyMissionResponse, MissionsResponse, MyAchievements } from '../contract';
import type { ReadRoute } from '../types';

// Rotas do bloco 7: as missões da 1g com a meta da temporada, a missão do dia
// da 1b e as conquistas da 1e. Só leem (a carteira e a configuração do cache,
// mais os alvos das missões) e não exigem perfil: carteira que não existe
// responde tudo em 0. docs/arquitetura-api.md, seção 22.

export const missionRoutes: ReadRoute[] = [
  {
    method: 'GET',
    pattern: '/missions',
    writes: false,
    async handle({ uid, now, deps }): Promise<MissionsResponse> {
      const [wallet, config] = await Promise.all([readWallet(deps.db, uid), deps.config.get()]);
      return readMissions(deps.db, uid, wallet, config, now);
    },
  },
  {
    method: 'GET',
    pattern: '/missions/daily',
    writes: false,
    async handle({ uid, now, deps }): Promise<DailyMissionResponse> {
      const [wallet, config] = await Promise.all([readWallet(deps.db, uid), deps.config.get()]);
      return readDailyMission(deps.db, uid, wallet, config, now);
    },
  },
  {
    method: 'GET',
    pattern: '/me/achievements',
    writes: false,
    async handle({ uid, deps }): Promise<MyAchievements> {
      const [wallet, config] = await Promise.all([readWallet(deps.db, uid), deps.config.get()]);
      return myAchievements(wallet, config);
    },
  },
];
