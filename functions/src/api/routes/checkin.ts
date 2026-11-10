import { checkinView } from '../../checkin/model';
import { checkIn } from '../../checkin/service';
import { rewardsOf } from '../../points/award';
import { readWallet } from '../../points/wallet';
import type { CheckinResult, CheckinState } from '../contract';
import type { ApiRoute } from '../types';

// O check-in diário com sequência (seção 39 de docs/arquitetura-api.md), atrás
// da chave `config/points.checkin.enabled`, que nasce desligada. O GET só lê e
// não exige perfil, como os outros; o POST grava no runIdempotent, sem corpo
// (o que vier é ignorado) e sem aceitar o fã suspenso (cria e soma: 403).

export const checkinRoutes: ApiRoute[] = [
  {
    // Com a chave desligada, responde `enabled: false` sem ler o Firestore: o
    // app não mostra nada. Com ela ligada, uma leitura da carteira.
    method: 'GET',
    pattern: '/me/checkin',
    writes: false,
    async handle({ uid, now, deps }): Promise<CheckinState> {
      const { points } = await deps.config.get();
      if (!points.checkin.enabled) return checkinView(null, points.checkin, now);
      const wallet = await readWallet(deps.db, uid);
      return checkinView(wallet.checkin, points.checkin, now);
    },
  },
  {
    // Um toque por dia de São Paulo. Com a chave desligada, 409
    // `checkin_disabled`, sem gravar nada. O segundo toque do dia (com outra
    // chave de idempotência) responde 200, com 0 ponto e o mesmo estado.
    method: 'POST',
    pattern: '/me/checkin',
    writes: true,
    async handle(ctx) {
      const { plan, checkin } = await checkIn(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
      });
      const body: CheckinResult = {
        pointsAwarded: plan.pointsAwarded,
        checkin,
        ...rewardsOf(plan),
      };
      return { body, plan };
    },
  },
];
