import { FieldPath, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';

import type { SectionId } from './model';

// O índice de cada entrada de staffAudit (bloco 11, docs/arquitetura-api.md,
// 26.8): a seção do painel e os alvos (`'<tipo>:<id>'`), para os filtros dos
// Logs (seção, alvo). O writeAudit grava os dois em toda entrada nova; a carga
// scripts/backfill-audit-index.mjs preenche as entradas de antes. Ninguém
// passa os dois à mão: quem grava auditoria fora do writeAudit monta a
// entrada com o auditIndex. Ação nova no AuditAction ganha a seção aqui e a
// linha dela no teste.

/** A seção da entrada: a do painel, ou `team` para a Equipe. */
export type AuditSection = SectionId | 'team';

/** Alvos guardados por entrada; reordenar até 240 ids passa disso, e a tela mostra a contagem. */
export const AUDIT_TARGETS_MAX = 50;

const SECTION_BY_PREFIX: Record<string, AuditSection> = {
  invite: 'team',
  member: 'team',
  artist: 'artists',
  post: 'artists',
  event: 'artists',
  comment: 'moderation',
  mission: 'missions',
  achievement: 'missions',
  season: 'ranking',
  reward: 'rewards',
  redemption: 'rewards',
};

const SECTION_BY_ACTION: Record<string, AuditSection> = {
  'points.config.updated': 'missions',
  'season.goal.updated': 'missions',
  'config.seeded': 'missions',
  'fan.username.reset': 'moderation',
  'fan.photo.removed': 'moderation',
  'fan.suspended': 'moderation',
  'fan.unsuspended': 'moderation',
  'fan.comments.hidden': 'moderation',
  'wallet.adjusted': 'fans',
  'fan.email.lookup': 'fans',
};

/** A seção de uma ação (null para a que o painel não conhece). */
export function auditSection(action: string): AuditSection | null {
  return SECTION_BY_ACTION[action] ?? SECTION_BY_PREFIX[action.split('.')[0] ?? ''] ?? null;
}

/** Os campos de `details` com ids, e o tipo de alvo de cada um. */
const DETAIL_TARGETS: readonly [field: string, type: string][] = [
  ['inviteId', 'invite'],
  ['replacedInviteIds', 'invite'],
  ['canceledInviteIds', 'invite'],
  ['artistId', 'artist'],
  ['artistIds', 'artist'],
  ['managedArtistIds', 'artist'],
  ['postId', 'post'],
  ['postIds', 'post'],
  ['eventId', 'event'],
  ['commentId', 'comment'],
  ['commentIds', 'comment'],
  ['authorUid', 'fan'],
  ['missionId', 'mission'],
  ['missionIds', 'mission'],
  ['achievementId', 'achievement'],
  ['achievementIds', 'achievement'],
  ['seasonId', 'season'],
  ['previousSeasonId', 'season'],
  ['nextSeasonId', 'season'],
  ['expiredNextSeasonId', 'season'],
  ['rewardId', 'reward'],
  ['rewardIds', 'reward'],
  ['code', 'redemption'],
  ['codes', 'redemption'],
];

/** Id que vira alvo: texto de 1 a 200 caracteres, sem `/`. */
const ID_PATTERN = /^[^/]{1,200}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** As ações de um fã (o `targetUid` e o `details.uid` são do fã, e não da equipe). */
const isFanAction = (action: string) => action.startsWith('fan.') || action === 'wallet.adjusted';

/** A entrada como o writeAudit grava, ou como a carga lê (tudo pode vir torto). */
export type AuditIndexInput = {
  action: unknown;
  targetUid?: unknown;
  details?: unknown;
};

export type AuditIndex = { section: AuditSection | null; targets: string[] };

/**
 * A seção e os alvos de uma entrada (puro). Seção: `team` para convites e
 * membros; `artists` para centrais, posts e shows; `moderation` para
 * comentários e as ferramentas de fã da Moderação; `missions` para a régua,
 * missões, conquistas, a meta e a carga inicial; `ranking` para as outras de
 * temporada; `rewards` para a loja; `fans` para o ajuste e a busca por e-mail.
 * Alvos: o `targetUid` (da equipe nas ações da Equipe, do fã nas ações de
 * fã), o `details.uid` das ações de fã e os ids de `details` (cada campo de
 * `DETAIL_TARGETS`, um id ou uma lista), sem repetir, até 50. `details` torto
 * não quebra: o que não é id fica de fora.
 */
export function auditIndex(entry: AuditIndexInput): AuditIndex {
  const action = typeof entry.action === 'string' ? entry.action : '';
  const targets: string[] = [];
  const seen = new Set<string>();
  const add = (type: string, value: unknown) => {
    if (targets.length >= AUDIT_TARGETS_MAX) return;
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) return;
    const target = `${type}:${value}`;
    if (seen.has(target)) return;
    seen.add(target);
    targets.push(target);
  };
  const addAll = (type: string, value: unknown) => {
    if (Array.isArray(value)) for (const item of value) add(type, item);
    else add(type, value);
  };

  const fan = isFanAction(action);
  add(fan ? 'fan' : 'staff', entry.targetUid);
  const details = isRecord(entry.details) ? entry.details : {};
  if (fan) add('fan', details.uid);
  for (const [field, type] of DETAIL_TARGETS) addAll(type, details[field]);
  // A central do ajuste de pontos.
  if (isRecord(details.central)) add('artist', details.central.artistId);
  return { section: auditSection(action), targets };
}

/** Entradas lidas por página na carga. */
const PAGE = 500;

/** Gravações por lote na carga. */
const BATCH = 250;

const needsIndex = (doc: DocumentSnapshot) =>
  doc.get('section') === undefined || !Array.isArray(doc.get('targets'));

async function* auditPages(db: Firestore): AsyncGenerator<DocumentSnapshot[]> {
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let query = db.collection('staffAudit').orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    yield page.docs;
    if (page.size < PAGE) return;
    last = page.docs.at(-1)!;
  }
}

export type AuditIndexBackfill = {
  /** Entradas lidas. */
  total: number;
  /** Entradas sem a seção ou os alvos (as que a carga grava). */
  missing: number;
  /** Das que faltam, quantas por seção (`other` para a ação que o painel não conhece). */
  bySection: Record<string, number>;
};

/** Lê `staffAudit` em páginas e conta as entradas sem a seção ou os alvos. Só lê (o `--dry-run`). */
export async function countAuditIndexBackfill(db: Firestore): Promise<AuditIndexBackfill> {
  let total = 0;
  let missing = 0;
  const bySection: Record<string, number> = {};
  for await (const docs of auditPages(db)) {
    total += docs.length;
    for (const doc of docs) {
      if (!needsIndex(doc)) continue;
      missing += 1;
      const section = auditIndex(doc.data() as AuditIndexInput).section ?? 'other';
      bySection[section] = (bySection[section] ?? 0) + 1;
    }
  }
  return { total, missing, bySection };
}

/**
 * Grava `section` e `targets` nas entradas de `staffAudit` que não têm os
 * dois, pela mesma `auditIndex`, em lotes. A entrada da auditoria não muda
 * depois de gravada, então a carga não precisa de transação; a que já tem os
 * dois fica como está, e rodar de novo não grava nada. Devolve quantas gravou.
 */
export async function writeAuditIndexBackfill(db: Firestore): Promise<number> {
  let written = 0;
  for await (const docs of auditPages(db)) {
    const pending = docs.filter(needsIndex);
    for (let start = 0; start < pending.length; start += BATCH) {
      const batch = db.batch();
      for (const doc of pending.slice(start, start + BATCH)) {
        batch.update(doc.ref, auditIndex(doc.data() as AuditIndexInput));
      }
      await batch.commit();
      written += Math.min(BATCH, pending.length - start);
    }
  }
  return written;
}
