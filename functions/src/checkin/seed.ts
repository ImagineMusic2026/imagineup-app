import type { Firestore } from 'firebase-admin/firestore';

import { parseAchievementsConfig } from '../achievements/model';
import { addAchievement, changeAchievementStatus } from '../achievements/panel';
import { walletFromDoc, walletRef } from '../points/award';
import {
  achievementsConfigRef,
  createConfigSource,
  parsePointsConfig,
  pointsConfigRef,
} from '../points/config';
import { versionOfSnap } from '../points/config-change';
import type { PointsConfig } from '../points/model';
import { changePointsConfig } from '../points/panel';
import { noonDaysAgo, SEED_ACTOR } from '../points/seed';
import type { CallerAuth } from '../staff/service';
import { runCheckin } from './service';

// O check-in diário no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build; docs/arquitetura-api.md, seção 40): a chave ligada em
// config/points, as quatro conquistas de sequência no ar e a Camila com 4 dias
// seguidos até ontem, para o card da Início abrir no 5º dia. Nunca roda em
// produção: o script fixa o emulador. Em produção a chave nasce desligada (a
// carga `seedGameConfig` nunca a liga), e quem liga é o painel, depois do
// combinado do dono com a cliente.

/** As conquistas de sequência do seed, na ordem: os dias e o título. Todas com a chama, em rosa. */
export const SEED_STREAK_ACHIEVEMENTS: readonly { days: number; title: string }[] = [
  { days: 7, title: '7 dias seguidos' },
  { days: 30, title: '30 dias seguidos' },
  { days: 100, title: '100 dias seguidos' },
  { days: 365, title: 'Um ano inteiro' },
];

/** A sequência da Camila no seed: 4 dias seguidos, o último ontem. */
export const CAMILA_SEED_STREAK = 4;

/**
 * O ciclo zerado dos check-ins do seed: o dia que vale 0 não lança nada, e a
 * carteira da Camila fica a do protótipo (12.480, 4.120 e +840), com o mesmo
 * extrato. Só a sequência é gravada.
 */
const SEED_CHECKIN_CYCLE: readonly number[] = [0, 0, 0, 0, 0, 0, 0];

const quiet = { warn: () => undefined, error: () => undefined };

/** Quem muda a configuração no seed: o admin da equipe de teste, como o painel chamaria. */
function callerOf(actor: { uid: string }, now: number): CallerAuth {
  return { uid: actor.uid, token: { auth_time: Math.floor(now / 1000) } };
}

export type SeedCheckinConfigResult = {
  /** A chave foi ligada agora (false: já estava ligada). */
  enabled: boolean;
  /** Quantas conquistas de sequência entraram agora. */
  achievements: number;
};

/**
 * A configuração do check-in no emulador, pelos núcleos das callables do
 * painel (`updatePointsConfig`, `createAchievement` e `setAchievementStatus`),
 * com o admin do seed (o `staff/{uid}` dele precisa existir: o acesso é
 * conferido como no painel) e a auditoria de verdade:
 * 1. liga a chave em config/points, com o ciclo que já estava (o padrão);
 * 2. cria e publica as quatro conquistas de sequência, com o id gerado. A que
 *    já existe com a mesma regra (em qualquer status) fica como está.
 * Um passo à parte, depois da carga `seedGameConfig`, e nunca dentro dela: a
 * carga também roda em produção. Rodar de novo não grava nada.
 */
export async function seedCheckinConfig(
  db: Firestore,
  actor: { uid: string },
  now: number = Date.now(),
): Promise<SeedCheckinConfigResult> {
  const deps = { db, now: () => now };
  const caller = callerOf(actor, now);
  const result: SeedCheckinConfigResult = { enabled: false, achievements: 0 };

  const points = await pointsConfigRef(db).get();
  if (!parsePointsConfig(points.data(), quiet).checkin.enabled) {
    await changePointsConfig(deps, caller, {
      expectedVersion: versionOfSnap(points),
      checkin: { enabled: true },
    });
    result.enabled = true;
  }

  const catalog = await achievementsConfigRef(db).get();
  const existing = parseAchievementsConfig(catalog.data(), quiet).achievements;
  let version = versionOfSnap(catalog);
  for (const { days, title } of SEED_STREAK_ACHIEVEMENTS) {
    if (existing.some((item) => item.rule.type === 'streak' && item.rule.days === days)) continue;
    const created = await addAchievement(deps, caller, {
      expectedVersion: version,
      achievement: { title, icon: 'flame', tone: 'action', rule: { type: 'streak', days } },
    });
    const published = await changeAchievementStatus(deps, caller, {
      expectedVersion: created.version,
      achievementId: created.achievementId,
      status: 'active',
    });
    version = published.version;
    result.achievements += 1;
  }
  return result;
}

/**
 * A sequência da Camila: 4 check-ins, ao meio-dia de São Paulo, de 4 dias
 * atrás até ontem, pelo mesmo núcleo da rota (`runCheckin`), com o ator de
 * sistema (não marca atividade), o jogo lido agora e o ciclo zerado: nenhum
 * lançamento, nenhum shard e nenhum número da carteira mexe, só o `checkin`
 * (4 dias, o último ontem). O `GET /me/checkin` dela mostra o 5º dia por
 * fazer. Não faz nada quando a melhor sequência guardada já tem os 4 dias:
 * rodar de novo não grava. Com menos (a primeira rodada que parou no meio dos
 * 4 check-ins), a rodada seguinte completa: o dia que já está guardado sai
 * `already`, sem gravar, e só os que faltam entram. A sequência só está viva
 * no dia do seed (dado relativo ao dia, como o resto dele). Devolve quantos
 * check-ins entraram agora.
 */
export async function seedCamilaCheckins(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<number> {
  const stored = walletFromDoc((await walletRef(db, uid).get()).data());
  if (stored.checkin.best >= CAMILA_SEED_STREAK) return 0;
  const { points, game } = await createConfigSource(db, { ttlMs: 0 }).get();
  const config: PointsConfig = {
    ...points,
    checkin: { enabled: true, cycle: [...SEED_CHECKIN_CYCLE] },
  };
  let done = 0;
  for (let daysAgo = CAMILA_SEED_STREAK; daysAgo >= 1; daysAgo -= 1) {
    const { plan } = await runCheckin(db, uid, {
      now: noonDaysAgo(now, daysAgo),
      config,
      actor: SEED_ACTOR,
      game,
    });
    if (plan.checkin?.status === 'checked') done += 1;
  }
  return done;
}
