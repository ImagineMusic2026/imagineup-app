import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { missionsConfigRef } from '../points/config';
import { catalogDoc } from './panel';
import {
  checkMissionRules,
  type MissionInput,
  type MissionRecord,
  type SeasonGoalConfig,
} from './model';

// O catálogo provisório de missões no seed dos emuladores
// (scripts/seed-emulators.mjs, que carrega este build): as missões das
// fixtures do app sem a relâmpago (pergunta da cliente), com os mesmos ids,
// títulos, alvos, metas e recompensas, até a cliente definir (UP-9). Nunca
// roda em produção: o script fixa o emulador. docs/arquitetura-api.md, 22.13.

const DAY_MS = 24 * 60 * 60 * 1000;

type SeedMission = Omit<MissionInput, 'startsAt' | 'endsAt'> & { id: string };

/** As 5 missões provisórias, todas no ar, na ordem da 1g. */
export const SEED_MISSIONS: readonly SeedMission[] = [
  {
    id: 'm-clipe-netto',
    title: 'Leve 5 pessoas para o clipe novo do Netto',
    action: 'share',
    target: { postId: 'p-clipe', artistId: 'nettobrito', eventId: null },
    goal: 5,
    period: 'daily',
    rewardPoints: 20,
    featured: true,
  },
  {
    id: 'm-curtir-nenho',
    title: 'Curta 5 posts do Nenho',
    action: 'like',
    target: { postId: null, artistId: 'nenho', eventId: null },
    goal: 5,
    period: 'daily',
    rewardPoints: 10,
    featured: false,
  },
  {
    id: 'm-comentar-central',
    title: 'Comente em 3 posts da central',
    action: 'comment',
    target: { postId: null, artistId: 'nettobrito', eventId: null },
    goal: 3,
    period: 'daily',
    rewardPoints: 20,
    featured: false,
  },
  {
    id: 'm-trazer-amigos',
    title: 'Traga 3 amigos novos pro app',
    action: 'invite',
    target: null,
    goal: 3,
    period: 'weekly',
    rewardPoints: 30,
    featured: false,
  },
  {
    id: 'm-presenca-show',
    title: 'Confirme presença em um show',
    action: 'rsvp',
    target: { postId: null, artistId: null, eventId: 'sao-joao-irara' },
    goal: 1,
    period: 'weekly',
    rewardPoints: 15,
    featured: false,
  },
];

/** A meta da temporada do protótipo ("Semana do arrocha", 12 de 20 na Camila). */
export const SEED_SEASON_GOAL: SeasonGoalConfig = {
  seasonId: 'temporada-sao-joao',
  title: 'Semana do arrocha',
  description: 'Complete 20 missões e garanta um lote de ingressos do São João.',
  reachedDescription: 'Meta cumprida: seu lote de ingressos do São João está garantido.',
  metric: 'missions',
  target: 20,
};

/** O catálogo do seed: as missões no ar desde 1 dia antes de `now`, sem fim. */
export function seedCatalog(now: number): MissionRecord[] {
  const startsAt = now - DAY_MS;
  return SEED_MISSIONS.map(({ id, ...mission }) => {
    const input: MissionInput = { ...mission, startsAt, endsAt: null };
    checkMissionRules(input);
    return {
      ...input,
      id,
      status: 'active',
      activatedAt: startsAt,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * Grava config/missions (versão 1, com a cópia em `versions/1`) se ainda não
 * existe, no formato das callables (`catalogDoc`) e sem auditoria. Devolve se
 * gravou. Rodar de novo não muda nada.
 */
export async function seedMissionsCatalog(
  db: Firestore,
  now: number = Date.now(),
): Promise<boolean> {
  const ref = missionsConfigRef(db);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return false;
    const doc = {
      ...catalogDoc(seedCatalog(now), SEED_SEASON_GOAL),
      version: 1,
      updatedAt: Timestamp.fromMillis(now),
      updatedBy: null,
    };
    tx.create(ref, doc);
    tx.create(ref.collection('versions').doc('1'), doc);
    return true;
  });
}
