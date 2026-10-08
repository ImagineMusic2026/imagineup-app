import {
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from 'firebase-admin/firestore';

import { defaultAchievements } from '../achievements/model';
import { achievementDoc } from '../achievements/panel';
import { writeAudit } from '../staff/service';
import { achievementsConfigRef, parsePointsConfig, pointsConfigRef } from './config';

// A carga da versão 1 de config/points e config/achievements (bloco 11,
// docs/arquitetura-api.md, 26.9 e decisão 15 de 26.1). Sem os documentos, as
// funções valem o padrão do código (a versão 0), e o painel, que lê o
// Firestore direto, não teria a régua nem os ids das conquistas. A carga grava
// esse mesmo padrão como a versão 1, só onde o documento falta: o que existe
// nunca é tocado. Roda pelo scripts/seed-game-config.mjs (produção, com o ok
// do dono) e pelo seed dos emuladores.

/** O nome de quem grava a carga na auditoria e no `updatedBy` nulo. */
export const CONFIG_SEED_ACTOR_NAME = 'Carga inicial';

export type GameConfigDoc = 'points' | 'achievements';

/** Quais dos dois documentos faltam. Só lê (o `--dry-run`). */
export async function readGameConfigSeed(db: Firestore): Promise<GameConfigDoc[]> {
  const [points, achievements] = await db.getAll(pointsConfigRef(db), achievementsConfigRef(db));
  return [
    ...(points!.exists ? [] : (['points'] as const)),
    ...(achievements!.exists ? [] : (['achievements'] as const)),
  ];
}

/**
 * Numa transação, lê config/points e config/achievements e, para cada um que
 * falta, cria o documento e a cópia em `versions/1`, com `version: 1`,
 * `updatedAt` e `updatedBy: null`, e uma auditoria `config.seeded` (sem
 * autor, "Carga inicial"). config/points recebe os valores, limites, tetos e
 * a régua do padrão; config/achievements, a lista provisória com as datas
 * desta gravação (`activatedAt` nas ativas). Devolve os documentos criados:
 * rodar de novo não grava nada.
 */
export async function seedGameConfig(
  db: Firestore,
  now: number = Date.now(),
): Promise<GameConfigDoc[]> {
  return db.runTransaction(async (tx) => {
    const [points, achievements] = await tx.getAll(pointsConfigRef(db), achievementsConfigRef(db));
    const at = Timestamp.fromMillis(now);
    const created: GameConfigDoc[] = [];
    const create = (name: GameConfigDoc, ref: DocumentReference, body: DocumentData) => {
      const doc = { ...body, version: 1, updatedAt: at, updatedBy: null };
      tx.create(ref, doc);
      tx.create(ref.collection('versions').doc('1'), doc);
      writeAudit(
        tx,
        db,
        {
          action: 'config.seeded',
          actorUid: null,
          actorName: CONFIG_SEED_ACTOR_NAME,
          targetEmail: '',
          targetUid: null,
          details: { doc: name, version: 1 },
        },
        at,
      );
      created.push(name);
    };
    if (!points!.exists) {
      const { values, dailyLimits, actionCaps, levels } = parsePointsConfig(undefined);
      create('points', pointsConfigRef(db), { values, dailyLimits, actionCaps, levels });
    }
    if (!achievements!.exists) {
      create('achievements', achievementsConfigRef(db), {
        achievements: defaultAchievements(now).map(achievementDoc),
      });
    }
    return created;
  });
}
