import type { Firestore } from 'firebase-admin/firestore';

import { NO_GAME } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import { SEED_ENGAGEMENT_CONFIG } from '../posts/seed';
import { runComment } from '../posts/service';
import { parseSuspensionInput, runFanSuspension } from './fans';
import { runModeration } from './panel';
import { runReport } from './service';
import { reportRef } from './store';

// A Moderação do seed dos emuladores (scripts/seed-emulators.mjs, que carrega
// este build; docs/arquitetura-api.md, 26.13): o fã de propaganda com três
// comentários no clipe do Netto, denunciados pela Bia e pela Duda, um deles
// ocultado pela equipe de teste pelo núcleo do moderateComment (grava o
// `comment.hidden` de verdade), e a suspensão do rank-48 pelo núcleo do
// setFanSuspended. Nunca roda em produção: o script fixa o emulador.

const MINUTE_MS = 60 * 1000;

/** O fã de propaganda (a conta fica no script, com a senha). */
export const SEED_SPAM_FAN = {
  email: 'spam@teste.imagineup',
  displayName: 'Promo Seguidores',
} as const;

/** O post onde ele comenta: o clipe do Netto. */
export const SEED_SPAM_POST = 'p-clipe';

/** Os três comentários de propaganda, com ids fixos (o primeiro é o que a equipe oculta). */
export const SEED_SPAM_COMMENTS: readonly { id: string; minutesAgo: number; text: string }[] = [
  {
    id: 'seed-c-spam-1',
    minutesAgo: 50,
    text: 'Ganhe mil seguidores em 24 horas! Chama no meu perfil 🔥',
  },
  {
    id: 'seed-c-spam-2',
    minutesAgo: 45,
    text: 'Seguidores reais e baratos, link no perfil. Promoção só hoje!',
  },
  {
    id: 'seed-c-spam-3',
    minutesAgo: 40,
    text: 'Quer bombar no Insta? Pacotes a partir de R$ 9,90, chama no privado!!!',
  },
];

/** O comentário que a equipe de teste oculta (o item dele sai da fila como ocultado). */
export const SEED_HIDDEN_SPAM_COMMENT = 'seed-c-spam-1';

/** A conta suspensa do seed: a última do ranking. */
export const SEED_SUSPENDED_EMAIL = 'rank-48@teste.imagineup';

/** A nota da suspensão do seed. */
export const SEED_SUSPENSION_NOTE = 'Conta de teste suspensa pelo seed';

export type SeedStaffActor = { uid: string; name: string };

export type SeedModerationResult = { comments: number; reports: number; hidden: boolean };

/**
 * Os comentários de propaganda pelo núcleo da rota (comentar valendo 0 e sem
 * o jogo, como o resto do engajamento do seed), as denúncias da Bia e da Duda
 * (motivo `spam`) em cada um, pelo núcleo da rota, e o primeiro ocultado pela
 * equipe de teste. A foto do fã vem antes (o script), para as cópias nos
 * comentários nascerem com ela. Rodar de novo não muda nada: o comentário e
 * o ocultar voltam sem efeito, e a denúncia que já existe nem é tentada (a do
 * comentário oculto seria recusada). Devolve o que entrou agora.
 */
export async function seedModeration(
  db: Firestore,
  fans: { spam: string; reporters: readonly string[] },
  actor: SeedStaffActor,
  now: number = Date.now(),
): Promise<SeedModerationResult> {
  const options = { now, config: SEED_ENGAGEMENT_CONFIG, actor: SEED_ACTOR, game: NO_GAME };
  const result: SeedModerationResult = { comments: 0, reports: 0, hidden: false };
  for (const comment of SEED_SPAM_COMMENTS) {
    const outcome = await runComment(
      db,
      fans.spam,
      { postId: SEED_SPAM_POST, text: comment.text, commentId: comment.id },
      { ...options, now: now - comment.minutesAgo * MINUTE_MS },
    );
    if (outcome.comment) result.comments += 1;
  }
  for (const reporter of fans.reporters) {
    for (const comment of SEED_SPAM_COMMENTS) {
      // A denúncia feita na rodada anterior fica (o comentário oculto recusaria outra).
      if ((await reportRef(db, comment.id, reporter).get()).exists) continue;
      const outcome = await runReport(
        db,
        reporter,
        { postId: SEED_SPAM_POST, commentId: comment.id, reason: 'spam' },
        options,
      );
      if (outcome.status === 'reported') result.reports += 1;
    }
  }
  const hidden = await runModeration(
    db,
    { postId: SEED_SPAM_POST, commentId: SEED_HIDDEN_SPAM_COMMENT, action: 'hide' },
    { actor, now },
  );
  result.hidden = hidden.auditAction !== null;
  return result;
}

/**
 * A suspensão do fã pelo núcleo do setFanSuspended (motivo `other`, com a
 * nota do seed), com a equipe de teste como ator: grava o `fan.suspended` de
 * verdade. Rodar de novo não muda nada. Devolve se suspendeu agora.
 */
export async function seedSuspension(
  db: Firestore,
  uid: string,
  actor: SeedStaffActor,
  now: number = Date.now(),
): Promise<boolean> {
  const input = parseSuspensionInput(uid, {
    suspended: true,
    reason: 'other',
    note: SEED_SUSPENSION_NOTE,
  });
  const { changed } = await runFanSuspension(db, input, { actor, now });
  return changed;
}
