import {
  applyForFanClub,
  parseApplication,
  readFanClubArtists,
  readMyFanClub,
  withdrawApplication,
  type ApplicationInput,
} from '../../fan-clubs';
import type { FanClubArtists, MyFanClub } from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';

// Rotas do fã-clube gerido pelo fã (seção 34, 34.3), na etapa 1 de 34.14: o
// estado do fã nos Ajustes, as centrais que aceitam fã-clube, candidatar e
// desistir. As que gravam rodam no runIdempotent, com o perfil exigido; a
// desistência é de desfazer e aceita o suspenso. As publicações, os
// seguidores e a página pública chegam nas etapas seguintes.

/**
 * O corpo da candidatura conferido e limpo (`parseApplication`), sem leitura:
 * o malformado é 400 `invalid_request` com o campo, e o fora da regra lança
 * `fan_club_invalid`.
 */
function bodyApplication(input: RouteInput): ApplicationInput {
  const parsed = parseApplication(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

export const fanClubRoutes: ApiRoute[] = [
  {
    // Leve: os Ajustes leem a cada abertura (de 1 a 5 leituras). Sem chave e
    // sem exigir o perfil (a conta só da equipe recebe o estado vazio).
    method: 'GET',
    pattern: '/me/fan-club',
    writes: false,
    async handle({ deps, uid, now }): Promise<MyFanClub> {
      return readMyFanClub(deps.db, uid, now);
    },
  },
  {
    // Só ao abrir a candidatura, para não ler os artistPrivate a cada Ajustes aberto.
    method: 'GET',
    pattern: '/me/fan-club/artists',
    writes: false,
    async handle({ deps, uid }): Promise<FanClubArtists> {
      return readFanClubArtists(deps.db, uid);
    },
  },
  {
    method: 'POST',
    pattern: '/me/fan-club/application',
    writes: true,
    validate: (input) => void bodyApplication(input),
    async handle(ctx) {
      const { body, plan } = await applyForFanClub(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        input: bodyApplication(ctx),
      });
      const result: MyFanClub = body;
      return { body: result, plan };
    },
  },
  {
    // Desistir da pendente: desfazer, então o suspenso também desiste.
    method: 'DELETE',
    pattern: '/me/fan-club/application',
    writes: true,
    allowSuspended: true,
    async handle(ctx) {
      const { body, plan } = await withdrawApplication(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
      });
      const result: MyFanClub = body;
      return { body: result, plan };
    },
  },
];
