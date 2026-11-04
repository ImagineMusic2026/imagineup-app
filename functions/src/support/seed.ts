import type { Firestore } from 'firebase-admin/firestore';

import { NO_GAME } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import { SEED_ENGAGEMENT_CONFIG } from '../posts/seed';
import type { SupportMessageInput } from './model';
import { runSupportResolution } from './panel';
import { runSendSupportMessage } from './service';

// O Suporte do seed dos emuladores (scripts/seed-emulators.mjs, que carrega
// este build; docs/arquitetura-api.md, seção 38, 38.10): um problema da Bia,
// com o aparelho, e uma sugestão da Duda, abertas, e um feedback da Camila,
// resolvido pela equipe de teste pelo núcleo do resolveSupportMessage (grava
// o `support.message.resolved` de verdade). Ids fixos: rodar de novo não grava
// outra mensagem nem resolve de novo. Nunca roda em produção: o script fixa o
// emulador.

const MINUTE_MS = 60 * 1000;

/** As mensagens do seed, de quem (pelo e-mail da conta de teste), há quanto tempo e o que dizem. */
export const SEED_SUPPORT_MESSAGES: readonly {
  id: string;
  email: string;
  minutesAgo: number;
  input: SupportMessageInput;
  resolved: boolean;
}[] = [
  {
    id: 'seed-suporte-problema',
    email: 'bia@teste.imagineup',
    minutesAgo: 30,
    input: {
      kind: 'problem',
      text: 'Quando abro a agenda do Netto pelo card da Início, a tela fica um tempo em branco antes de mostrar os shows.\nAconteceu duas vezes hoje.',
      device: { platform: 'android', osVersion: '14', appVersion: '0.1.0', updateId: '01a1a459' },
    },
    resolved: false,
  },
  {
    id: 'seed-suporte-sugestao',
    email: 'duda@teste.imagineup',
    minutesAgo: 90,
    input: {
      kind: 'idea',
      text: 'Seria legal poder salvar os posts favoritos do mural para ver depois.',
      device: null,
    },
    resolved: false,
  },
  {
    id: 'seed-suporte-feedback',
    email: 'camila@teste.imagineup',
    minutesAgo: 24 * 60,
    input: {
      kind: 'feedback',
      text: 'Amei o fã-clube! Os meus seguidores estão comentando todos os dias.',
      device: null,
    },
    resolved: true,
  },
];

export type SeedSupportResult = { sent: number; resolved: number };

/**
 * As três mensagens pelo núcleo da rota (o seed como ator, sem contar no
 * teto) e a resolução do feedback pela equipe de teste. A conta que não
 * existe no seed fica de fora. Devolve o que entrou agora.
 */
export async function seedSupport(
  db: Firestore,
  uidOf: (email: string) => string | undefined,
  actor: { uid: string; name: string },
  now: number = Date.now(),
): Promise<SeedSupportResult> {
  const options = { now, config: SEED_ENGAGEMENT_CONFIG, actor: SEED_ACTOR, game: NO_GAME };
  const result: SeedSupportResult = { sent: 0, resolved: 0 };
  for (const message of SEED_SUPPORT_MESSAGES) {
    const uid = uidOf(message.email);
    if (!uid) continue;
    const sentAt = now - message.minutesAgo * MINUTE_MS;
    const outcome = await runSendSupportMessage(db, uid, message.input, message.id, {
      ...options,
      now: sentAt,
    });
    if (outcome.created) result.sent += 1;
    if (!message.resolved) continue;
    const before = (await db.collection('supportMessages').doc(message.id).get()).get('status');
    if (before === 'resolved') continue;
    await runSupportResolution(
      db,
      { id: message.id, action: 'resolve' },
      actor,
      sentAt + 30 * MINUTE_MS,
    );
    result.resolved += 1;
  }
  return result;
}
