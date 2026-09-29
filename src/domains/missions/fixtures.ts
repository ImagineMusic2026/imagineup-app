import type { DailyMission } from './types';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
// "Termina em 4 h" por meia hora, como no protótipo (a contagem arredonda para baixo).
const ENDS_IN_MS = 4 * HOUR_MS + 30 * MINUTE_MS;

/**
 * Missão do dia de exemplo, a da home do protótipo (1b): levar 5 pessoas ao
 * clipe novo do Netto pelo link do post com o código do fã (dentro do
 * contrato: é o link de post do app com atribuição). 3 de 5, vale 20 e termina
 * em 4 h e meia a partir de `now`. Os valores são exemplo; os reais vêm da API.
 */
export function buildDailyMissionFixture(now: Date): DailyMission {
  return {
    id: 'm-clipe-netto',
    title: 'Leve 5 pessoas para o clipe novo do Netto',
    rewardPoints: 20,
    progress: { current: 3, target: 5 },
    endsAt: new Date(now.getTime() + ENDS_IN_MS).toISOString(),
    status: 'active',
    action: 'share',
    target: { postId: 'p-clipe', artistId: 'netto-brito' },
  } satisfies DailyMission;
}
