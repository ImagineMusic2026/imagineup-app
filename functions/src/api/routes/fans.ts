import { readFanPublicProfile } from '../../fan-profile';
import type { FanPublicProfile } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute } from '../types';
import { fanParam } from './params';

// O perfil público de outro fã (seção 28 de docs/arquitetura-api.md): a foto,
// o nome e o @ sempre, e a bio e as redes quando o perfil não sai fechado
// (conta privada, suspensa ou que bloqueou quem pede, com o mesmo corpo nos
// três casos). Só lê: sem chave, sem exigir o perfil de quem chama e sem olhar
// a suspensão de quem chama.

export const fanRoutes: ApiRoute[] = [
  {
    // Uma leitura do perfil e, só quando ele não sai fechado por si, a lista
    // de quem o alvo bloqueou. Sem o perfil (conta excluída, só da equipe ou
    // id que não existe): 404.
    method: 'GET',
    pattern: '/fans/:fanId',
    writes: false,
    validate: fanParam,
    async handle({ deps, uid, params }): Promise<FanPublicProfile> {
      const profile = await readFanPublicProfile(deps.db, uid, params.fanId!);
      if (!profile) throw apiError('fan_not_found');
      return profile;
    },
  },
];
