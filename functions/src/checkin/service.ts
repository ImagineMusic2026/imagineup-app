import type { Firestore, Transaction } from 'firebase-admin/firestore';

import type { CheckinState } from '../api/contract';
import {
  planAwards,
  runAsFan,
  type AwardContext,
  type AwardPlan,
  type FanContext,
  type RunOptions,
} from '../points/award';
import { CheckinError, checkinView } from './model';

// O check-in do dia pelo servidor (docs/arquitetura-api.md, seção 39): na
// transação do runIdempotent do `POST /me/checkin`, na ordem de sempre. Quem
// decide o dia, paga o valor do ciclo e guarda a sequência é o núcleo de
// pontos (`checkin: true` no planAwards, como as unidades das missões): aqui
// fica só a chave e a montagem da resposta.

/** O plano de pontos e o estado do check-in depois dele (o `checkin` da resposta). */
export type CheckinOutcome = { plan: AwardPlan; checkin: CheckinState };

/**
 * O check-in de hoje de quem chama. Com a chave desligada, recusa com
 * `checkin_disabled` antes de planejar: a transação cai e nada é gravado (nem
 * a chave de idempotência, nem a marca de atividade). Com ela ligada, o plano
 * leva o pedido e o núcleo decide: o primeiro do dia paga o valor do ciclo e
 * anda a sequência; o segundo (outra chave, ou o pedido que chega fora de
 * ordem perto da meia-noite) não paga nem anda a sequência e responde o mesmo
 * estado, com 0 ponto. A conquista de sequência só destrava num plano destes,
 * o que roda o check-in (no primeiro toque ou no segundo), e sai nas
 * recompensas da resposta. O estado sai do que o plano calculou, pelo relógio
 * do pedido.
 */
export async function checkIn(
  tx: Transaction,
  db: Firestore,
  options: { fan: FanContext; award: AwardContext },
): Promise<CheckinOutcome> {
  const { fan, award } = options;
  if (!award.config.checkin.enabled) throw new CheckinError('checkin_disabled');
  const plan = await planAwards(tx, db, [{ uid: fan.uid, fan, entries: [], checkin: true }], award);
  const record = plan.checkin?.record ?? fan.wallet.checkin;
  return { plan, checkin: checkinView(record, award.config.checkin, award.now) };
}

/**
 * O check-in fora da API (o seed dos emuladores), pelo mesmo núcleo da rota:
 * com o ator e a configuração dados, sem marcar atividade.
 */
export function runCheckin(
  db: Firestore,
  uid: string,
  options: RunOptions,
): Promise<CheckinOutcome> {
  return runAsFan(db, uid, options, (tx, fan, award) => checkIn(tx, db, { fan, award }));
}
