import type { Auth } from 'firebase-admin/auth';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { eveningDaysAgo } from '../rewards/seed';
import { auditIndex } from './audit-index';
import { SECTION_IDS, type SectionId, type StaffRole } from './model';
import type { AuditEntry } from './service';

// A equipe e a auditoria de exemplo do seed dos emuladores
// (scripts/seed-emulators.mjs, que carrega este build; docs/arquitetura-api.md,
// 26.13): as três contas da equipe, uma de cada nível, gravadas como o aceite
// do convite deixaria, e umas 20 entradas de auditoria espalhadas pelos
// últimos 10 dias, montadas com o auditIndex (a seção e os alvos, como o
// writeAudit grava). As senhas ficam no script. Nunca roda em produção: o
// script fixa o emulador.

const HOUR_MS = 60 * 60 * 1000;

export type SeedStaffMember = {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  sections: SectionId[];
  /** O convite que trouxe a conta (o da equipe é o da carga de 29/09). */
  inviteId: string;
  invitedBy: string | null;
};

/** O admin da equipe de teste: o ator da moderação e da suspensão do seed. */
export const SEED_STAFF_ADMIN = {
  uid: 'seed-equipe',
  email: 'equipe@teste.imagineup',
  displayName: 'Equipe de Teste',
} as const;

/** A editora de teste: edita Fãs, Missões, Recompensas e Moderação, sem Artistas. */
export const SEED_STAFF_EDITOR = {
  uid: 'seed-editora',
  email: 'editora@teste.imagineup',
  displayName: 'Editora de Teste',
} as const;

/** O leitor de teste: vê todas as seções, sem mudar nada. */
export const SEED_STAFF_VIEWER = {
  uid: 'seed-leitor',
  email: 'leitor@teste.imagineup',
  displayName: 'Leitor de Teste',
} as const;

/** As três contas da equipe no emulador, uma de cada nível (26.13). */
export const SEED_STAFF: readonly SeedStaffMember[] = [
  {
    ...SEED_STAFF_ADMIN,
    role: 'admin',
    sections: [...SECTION_IDS],
    inviteId: 'seed',
    invitedBy: null,
  },
  {
    ...SEED_STAFF_EDITOR,
    role: 'editor',
    sections: ['fans', 'missions', 'rewards', 'moderation'],
    inviteId: 'seed-convite-editora',
    invitedBy: SEED_STAFF_ADMIN.uid,
  },
  {
    ...SEED_STAFF_VIEWER,
    role: 'viewer',
    sections: [...SECTION_IDS],
    inviteId: 'seed-convite-leitor',
    invitedBy: SEED_STAFF_ADMIN.uid,
  },
];

/**
 * Uma conta da equipe: staff/{uid} antes da conta (como o aceite do convite),
 * para o gatilho de cadastro não criar perfil de fã, e a conta no Auth com a
 * senha dada. O que já existe fica como está (rodar de novo não muda nada).
 */
export async function seedStaffMember(
  db: Firestore,
  auth: Pick<Auth, 'createUser'>,
  member: SeedStaffMember,
  password: string,
  now: number = Date.now(),
): Promise<'created' | 'exists'> {
  const ref = db.collection('staff').doc(member.uid);
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) return;
    const at = Timestamp.fromMillis(now);
    tx.create(ref, {
      uid: member.uid,
      email: member.email,
      displayName: member.displayName,
      role: member.role,
      sections: member.sections,
      status: 'active',
      accountCreatedByInvite: true,
      inviteId: member.inviteId,
      invitedBy: member.invitedBy,
      createdAt: at,
      updatedAt: at,
      updatedBy: null,
    });
  });
  try {
    await auth.createUser({
      uid: member.uid,
      email: member.email,
      password,
      displayName: member.displayName,
      emailVerified: true,
    });
    return 'created';
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'auth/uid-already-exists' || code === 'auth/email-already-exists') {
      return 'exists';
    }
    throw error;
  }
}

type SeedAuditEntry = Omit<AuditEntry, 'createdAt'> & { id: string; at: number };

const ADMIN = { actorUid: SEED_STAFF_ADMIN.uid, actorName: SEED_STAFF_ADMIN.displayName };
const EDITOR = { actorUid: SEED_STAFF_EDITOR.uid, actorName: SEED_STAFF_EDITOR.displayName };
const VIEWER = { actorUid: SEED_STAFF_VIEWER.uid, actorName: SEED_STAFF_VIEWER.displayName };
const NO_TARGET = { targetEmail: '', targetUid: null };

/** Os fãs do seed que a auditoria de exemplo cita (pelo uid). */
export type SeedAuditFans = { bia: string };

/**
 * As entradas de exemplo (26.13): umas 20, com ids fixos, nos últimos 10 dias,
 * por todas as seções que têm ação e pelas contas da equipe, apontando para
 * objetos do seed (os convites da editora e do leitor, a central do Nenho, o
 * clipe, o show do São João, a missão de curtir do Nenho, o estoque do meet &
 * greet, os pedidos antigos da Camila, uma busca por e-mail que achou a Bia).
 * Nenhuma é de ajuste de pontos: as carteiras ficam como os blocos anteriores
 * deixam. As reais do seed (as viradas, a carga inicial, o comentário oculto,
 * a suspensão) vêm dos núcleos.
 */
export function seedAuditEntries(fans: SeedAuditFans, now: number): SeedAuditEntry[] {
  const hoursAgo = (hours: number) => now - hours * HOUR_MS;
  // As decisões dos pedidos da Camila, um minuto depois da transição do seed (às 18:00).
  const decidedAt = (daysAgo: number, minutes = 1) =>
    eveningDaysAgo(now, daysAgo) + minutes * 60_000;
  return [
    {
      id: 'seed-audit-01',
      at: hoursAgo(238),
      action: 'invite.created',
      ...ADMIN,
      targetEmail: SEED_STAFF_EDITOR.email,
      targetUid: null,
      details: {
        inviteId: 'seed-convite-editora',
        role: 'editor',
        sections: ['fans', 'missions', 'rewards', 'moderation'],
        suggestedName: SEED_STAFF_EDITOR.displayName,
        replacedInviteIds: [],
      },
    },
    {
      id: 'seed-audit-02',
      at: hoursAgo(237),
      action: 'invite.created',
      ...ADMIN,
      targetEmail: SEED_STAFF_VIEWER.email,
      targetUid: null,
      details: {
        inviteId: 'seed-convite-leitor',
        role: 'viewer',
        sections: ['overview', 'growth', 'ranking'],
        suggestedName: SEED_STAFF_VIEWER.displayName,
        replacedInviteIds: [],
      },
    },
    {
      id: 'seed-audit-03',
      at: hoursAgo(226),
      action: 'invite.accepted',
      ...EDITOR,
      targetEmail: SEED_STAFF_EDITOR.email,
      targetUid: SEED_STAFF_EDITOR.uid,
      details: {
        inviteId: 'seed-convite-editora',
        role: 'editor',
        sections: ['fans', 'missions', 'rewards', 'moderation'],
        accountCreatedByInvite: true,
      },
    },
    {
      id: 'seed-audit-04',
      at: hoursAgo(214),
      action: 'invite.accepted',
      ...VIEWER,
      targetEmail: SEED_STAFF_VIEWER.email,
      targetUid: SEED_STAFF_VIEWER.uid,
      details: {
        inviteId: 'seed-convite-leitor',
        role: 'viewer',
        sections: ['overview', 'growth', 'ranking'],
        accountCreatedByInvite: true,
      },
    },
    {
      id: 'seed-audit-05',
      at: hoursAgo(210),
      action: 'member.updated',
      ...ADMIN,
      targetEmail: SEED_STAFF_VIEWER.email,
      targetUid: SEED_STAFF_VIEWER.uid,
      details: {
        from: { role: 'viewer', sections: ['overview', 'growth', 'ranking'] },
        to: { role: 'viewer', sections: [...SECTION_IDS] },
      },
    },
    {
      id: 'seed-audit-06',
      at: hoursAgo(190),
      action: 'artist.updated',
      ...ADMIN,
      ...NO_TARGET,
      details: { artistId: 'nenho', name: 'Nenho', changed: ['bio', 'genre'] },
    },
    {
      id: 'seed-audit-07',
      at: hoursAgo(166),
      action: 'event.updated',
      ...ADMIN,
      ...NO_TARGET,
      details: {
        eventId: 'sao-joao-irara',
        title: 'São João de Irará',
        changed: ['featured', 'venue'],
      },
    },
    {
      id: 'seed-audit-08',
      at: decidedAt(6),
      action: 'redemption.approved',
      ...EDITOR,
      ...NO_TARGET,
      details: {
        code: 'UP-4KD9TM',
        rewardId: 'ingressos',
        from: 'requested',
        to: 'approved',
      },
    },
    {
      id: 'seed-audit-09',
      at: decidedAt(5),
      action: 'redemption.delivered',
      ...EDITOR,
      ...NO_TARGET,
      details: { code: 'UP-4KD9TM', rewardId: 'ingressos', from: 'approved', to: 'delivered' },
    },
    {
      id: 'seed-audit-10',
      at: decidedAt(5, 2),
      action: 'redemption.refused',
      ...EDITOR,
      ...NO_TARGET,
      details: {
        code: 'UP-9FJT6V',
        rewardId: 'videochamada',
        from: 'requested',
        to: 'refused',
        refundedPoints: 8_500,
        restocked: true,
        hasReason: true,
      },
    },
    {
      id: 'seed-audit-11',
      at: hoursAgo(120),
      action: 'reward.stock.updated',
      ...EDITOR,
      ...NO_TARGET,
      details: { rewardId: 'meet-netto', before: 15, after: 20, redeemed: 0 },
    },
    {
      id: 'seed-audit-12',
      at: hoursAgo(98),
      action: 'reward.created',
      ...EDITOR,
      ...NO_TARGET,
      details: { rewardId: 'recompensa-rascunho', title: 'Camisa autografada', kind: 'merch' },
    },
    {
      id: 'seed-audit-13',
      at: decidedAt(3),
      action: 'redemption.approved',
      ...EDITOR,
      ...NO_TARGET,
      details: {
        code: 'UP-7QXH2R',
        rewardId: 'passagem-de-som',
        from: 'requested',
        to: 'approved',
      },
    },
    {
      id: 'seed-audit-14',
      at: hoursAgo(52),
      action: 'season.next.updated',
      ...ADMIN,
      ...NO_TARGET,
      details: { seasonId: null, previousSeasonId: 'temporada-primavera' },
    },
    {
      id: 'seed-audit-15',
      at: hoursAgo(30),
      action: 'fan.email.lookup',
      ...EDITOR,
      targetEmail: '',
      targetUid: fans.bia,
      details: { found: true },
    },
    {
      id: 'seed-audit-16',
      at: hoursAgo(26),
      action: 'mission.created',
      ...EDITOR,
      ...NO_TARGET,
      details: { missionId: 'm-curtir-nenho', title: 'Curta 5 posts do Nenho' },
    },
    {
      id: 'seed-audit-17',
      at: hoursAgo(25),
      action: 'mission.published',
      ...EDITOR,
      ...NO_TARGET,
      details: { missionId: 'm-curtir-nenho' },
    },
    {
      id: 'seed-audit-18',
      at: hoursAgo(24),
      action: 'season.goal.updated',
      ...EDITOR,
      ...NO_TARGET,
      details: { seasonId: 'temporada-sao-joao', metric: 'missions', target: 20 },
    },
    {
      id: 'seed-audit-19',
      at: hoursAgo(4),
      action: 'post.updated',
      ...ADMIN,
      ...NO_TARGET,
      details: { postId: 'p-clipe', artistId: 'nettobrito', kind: 'video', changed: ['text'] },
    },
    {
      id: 'seed-audit-20',
      at: hoursAgo(2),
      action: 'post.published',
      ...ADMIN,
      ...NO_TARGET,
      details: { postId: 'p-clipe', artistId: 'nettobrito', from: 'draft' },
    },
  ];
}

/**
 * Grava as entradas de exemplo que faltam, com ids fixos (`set`, e não um id
 * novo: rodar de novo não duplica nem muda nada), cada uma com a seção e os
 * alvos do auditIndex. Devolve quantas gravou agora.
 */
export async function seedPanelAudit(
  db: Firestore,
  fans: SeedAuditFans,
  now: number = Date.now(),
): Promise<number> {
  const entries = seedAuditEntries(fans, now);
  const refs = entries.map((entry) => db.collection('staffAudit').doc(entry.id));
  const existing = await db.getAll(...refs);
  const batch = db.batch();
  let written = 0;
  entries.forEach(({ id: _id, at, ...entry }, index) => {
    if (existing[index]!.exists) return;
    batch.set(refs[index]!, {
      ...entry,
      ...auditIndex(entry),
      createdAt: Timestamp.fromMillis(at),
    });
    written += 1;
  });
  if (written > 0) await batch.commit();
  return written;
}
