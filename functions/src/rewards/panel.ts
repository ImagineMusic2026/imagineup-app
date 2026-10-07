import type { Auth } from 'firebase-admin/auth';
import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { isEventOpen } from '../agenda/model';
import { eventOf, eventRef } from '../agenda/store';
import { removeFiles, type ArtistFiles } from '../artists/files';
import { imageSize, isImageContentType } from '../artists/model';
import type { ConfigSource } from '../points/config';
import { pickShard } from '../points/stats';
import { isFileIn, staleFiles } from '../posts/model';
import { requestFields } from '../staff/model';
import { directRead, readPanelActor, transactionRead, type PanelActor } from '../staff/panel-actor';
import { writeAudit, type AuditAction, type CallerAuth } from '../staff/service';
import { rewardPanelError } from './errors';
import {
  isOpenRedemption,
  parseRedemptionCodes,
  parseRedemptionStatusRequest,
  parseRewardCreate,
  parseRewardId,
  parseRewardIds,
  parseRewardPatch,
  parseRewardTargetStatus,
  parseStockTotal,
  redemptionRecord,
  remainingOf,
  REWARD_PHOTO_SIZE,
  rewardPrefix,
  type RewardFields,
  type RewardPhoto,
} from './model';
import { applyRedemptionStatus } from './service';
import { redemptionRef, redemptionsRef, rewardOf, rewardRef, rewardsRef } from './store';

// Callables do painel para a loja (bloco 10, docs/arquitetura-api.md, 25.8):
// admin, ou editor com a seção rewards, cadastra, edita, publica, encerra,
// repõe o estoque, ordena e apaga o rascunho sem pedido, e cuida dos pedidos
// (aprovar, marcar entregue, recusar com motivo) e dos contatos de quem
// resgatou. A foto sobe do navegador para rewards/{rewardId}/ e a função
// confere o arquivo. As telas são do bloco 11 (imagineup-admin).

/** As dependências das callables da loja (25.8). */
export type RewardsPanelDeps = {
  db: Firestore;
  /** O Storage da foto (o mesmo das centrais, dos posts e dos shows). */
  files: ArtistFiles;
  /** Para os contatos de quem resgatou, numa chamada só. */
  auth: Pick<Auth, 'getUsers'>;
  /** Para a devolução da recusa (só a versão entra no lançamento). */
  config: ConfigSource;
  /** Relógio em ms; os testes fixam. */
  now?: () => number;
  /** Sorteio do shard dos agregados; os testes fixam. */
  random?: () => number;
};

const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();

function audit(
  tx: Transaction,
  db: Firestore,
  action: AuditAction,
  actor: PanelActor,
  details: Record<string, unknown>,
  now: Timestamp,
): void {
  writeAudit(
    tx,
    db,
    {
      action,
      actorUid: actor.uid,
      actorName: actor.name,
      targetEmail: '',
      targetUid: null,
      details,
    },
    now,
  );
}

const editor = (deps: RewardsPanelDeps, caller: CallerAuth | undefined) =>
  readPanelActor(directRead, deps.db, caller, 'rewards', 'edit');

const editorIn = (tx: Transaction, deps: RewardsPanelDeps, caller: CallerAuth | undefined) =>
  readPanelActor(transactionRead(tx), deps.db, caller, 'rewards', 'edit');

/** O show citado existe (em qualquer status). */
async function requireEvent(tx: Transaction, db: Firestore, eventId: string): Promise<void> {
  if (!(await tx.get(eventRef(db, eventId))).exists) throw rewardPanelError('event-not-found');
}

/** O fim da ordem: o maior `order` mais 1 (0 sem recompensa). */
async function nextRewardOrder(tx: Transaction, db: Firestore): Promise<number> {
  const last = await tx.get(rewardsRef(db).orderBy('order', 'desc').limit(1));
  const order = last.docs[0]?.get('order');
  return typeof order === 'number' && Number.isFinite(order) ? Math.floor(order) + 1 : 0;
}

/** Os campos de uma recompensa nova (o núcleo do `createReward` e do seed). */
export function newRewardDoc(
  fields: RewardFields,
  options: {
    order: number;
    status: 'draft' | 'published';
    now: number;
    by: string;
  },
): Record<string, unknown> {
  const at = Timestamp.fromMillis(options.now);
  return {
    ...fields,
    photo: null,
    redeemedCount: 0,
    status: options.status,
    order: options.order,
    publishedAt: options.status === 'published' ? at : null,
    closedAt: null,
    createdAt: at,
    updatedAt: at,
    createdBy: options.by,
    updatedBy: options.by,
    schemaVersion: 1,
  };
}

/**
 * createReward: o rascunho, no fim da ordem, sem foto e sem pedido. O
 * `rewardId` pode vir do painel (`doc(collection(db, 'rewards')).id`): o mesmo
 * id de novo responde sem gravar (25.5). O show precisa existir.
 */
export async function addReward(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ rewardId: string }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const given = input.rewardId === undefined ? null : parseRewardIdField(input.rewardId);
  const fields = parseRewardCreate(input);

  return db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const ref = given ? rewardRef(db, given) : rewardsRef(db).doc();
    if (given && (await tx.get(ref)).exists) return { rewardId: ref.id };
    if (fields.eventId) await requireEvent(tx, db, fields.eventId);
    const order = await nextRewardOrder(tx, db);
    const now = clock(deps);
    tx.create(ref, newRewardDoc(fields, { order, status: 'draft', now, by: actor.uid }));
    audit(
      tx,
      db,
      'reward.created',
      actor,
      { rewardId: ref.id, title: fields.title, kind: fields.kind },
      Timestamp.fromMillis(now),
    );
    return { rewardId: ref.id };
  });
}

/** O `rewardId` que o painel gera: fora do formato é pedido inválido. */
function parseRewardIdField(value: unknown): string {
  try {
    return parseRewardId(value);
  } catch {
    throw rewardPanelError('invalid-request', { field: 'rewardId' });
  }
}

/** `photo` do updateReward: null tira; senão `{ photoPath }`, um arquivo direto da pasta. */
async function parsePhoto(
  files: ArtistFiles,
  value: unknown,
  rewardId: string,
): Promise<RewardPhoto | null> {
  if (value === null) return null;
  const path = (value as { photoPath?: unknown } | undefined)?.photoPath;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !isFileIn(path, rewardPrefix(rewardId))
  ) {
    throw rewardPanelError('invalid-photo');
  }
  const file = await files.describe(path);
  if (!file) throw rewardPanelError('photo-not-found');
  if (!isImageContentType(file.contentType)) throw rewardPanelError('invalid-photo');
  const url = await files.downloadUrl(path);
  return { url, path, ...imageSize(file.customMetadata, REWARD_PHOTO_SIZE) };
}

/** Limpa a pasta da recompensa depois de trocar ou tirar a foto (como a dos shows), sem travar. */
async function pruneRewardFiles(
  deps: RewardsPanelDeps,
  rewardId: string,
  keep: string[],
): Promise<void> {
  try {
    const prefix = rewardPrefix(rewardId);
    const paths = await deps.files.list(prefix);
    const current = await rewardRef(deps.db, rewardId).get();
    const photoPath = (current.get('photo') as { path?: unknown } | null)?.path;
    const stale = staleFiles(paths, prefix, [
      ...keep,
      typeof photoPath === 'string' ? photoPath : null,
    ]);
    const leftovers = await removeFiles(deps.files, stale);
    if (leftovers.length > 0) {
      logger.warn('Fotos antigas de uma recompensa ficaram no Storage.', {
        rewardId,
        paths: leftovers.map((leftover) => leftover.path),
      });
    }
  } catch (error) {
    logger.warn('A limpeza da pasta de uma recompensa no Storage falhou.', {
      rewardId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * updateReward: ausente não muda; null limpa a descrição, o limite e o show.
 * Muda em qualquer status, também o custo (o resgate confere, 25.1, decisão
 * 8). O estoque muda pelo `setRewardStock`. Nada mudou: ok, sem gravar nem
 * auditar.
 */
export async function editReward(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const rewardId = parseRewardId(input.rewardId);
  const patch = parseRewardPatch(input);
  const photo =
    input.photo === undefined ? undefined : await parsePhoto(deps.files, input.photo, rewardId);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(rewardRef(db, rewardId));
    if (!snap.exists) throw rewardPanelError('reward-not-found');
    const current = snap.data() ?? {};
    const changes: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const [field, value] of Object.entries(patch)) {
      const before = current[field] ?? null;
      if (value === before) continue;
      changes[field] = value;
      changed.push(field);
    }
    if (typeof changes.eventId === 'string') await requireEvent(tx, db, changes.eventId);
    const currentPhoto = (current.photo as { path?: unknown } | null) ?? null;
    if (photo === null && currentPhoto) {
      changes.photo = null;
      changed.push('photo');
    } else if (photo && photo.path !== currentPhoto?.path) {
      changes.photo = photo;
      changed.push('photo');
    }
    if (changed.length === 0) return;
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(snap.ref, { ...changes, updatedAt: now, updatedBy: actor.uid });
    // Os campos mudados, sem os textos.
    audit(tx, db, 'reward.updated', actor, { rewardId, changed }, now);
  });

  if (photo !== undefined) await pruneRewardFiles(deps, rewardId, photo ? [photo.path] : []);
  return { ok: true };
}

/**
 * setRewardStatus: publicar o rascunho (com `publishedAt` na primeira vez) ou
 * reabrir a encerrada, no fim da ordem; com show, só com ele aberto
 * (`event-not-open`). Encerrar só a no ar (`not-published` no rascunho), sem
 * mexer nos pedidos. O mesmo status é ok, sem gravar.
 */
export async function changeRewardStatus(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const rewardId = parseRewardId(input.rewardId);
  const status = parseRewardTargetStatus(input.status);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(rewardRef(db, rewardId));
    const reward = rewardOf(snap);
    if (!reward) throw rewardPanelError('reward-not-found');
    const from = reward.status;
    if (from === status) return;
    const at = clock(deps);
    const now = Timestamp.fromMillis(at);
    if (status === 'closed') {
      if (from !== 'published') throw rewardPanelError('not-published');
      tx.update(snap.ref, { status, closedAt: now, updatedAt: now, updatedBy: actor.uid });
      audit(tx, db, 'reward.closed', actor, { rewardId, title: reward.title }, now);
      return;
    }
    const [event, order] = await Promise.all([
      reward.eventId ? tx.get(eventRef(db, reward.eventId)) : Promise.resolve(null),
      from === 'closed' ? nextRewardOrder(tx, db) : Promise.resolve(null),
    ]);
    if (reward.eventId && !isEventOpen(event ? eventOf(event) : null, at)) {
      throw rewardPanelError('event-not-open');
    }
    tx.update(snap.ref, {
      status,
      ...(reward.publishedAt === null ? { publishedAt: now } : {}),
      ...(order !== null ? { order } : {}),
      updatedAt: now,
      updatedBy: actor.uid,
    });
    audit(
      tx,
      db,
      'reward.published',
      actor,
      { rewardId, title: reward.title, ...(from === 'closed' ? { reopened: true } : {}) },
      now,
    );
  });
  return { ok: true };
}

/**
 * setRewardStock: o total oferecido (de 0 a 100.000, ou null sem limite),
 * nunca abaixo do já resgatado (`stock-below-redeemed`). Repor nunca apaga o
 * resgatado: o resgate grava a contagem, e esta callable, o total (25.1,
 * decisão 11). Responde o que sobra.
 */
export async function changeRewardStock(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; remaining: number | null }> {
  const { db } = deps;
  await editor(deps, caller);
  const input = requestFields(data);
  const rewardId = parseRewardId(input.rewardId);
  if (input.stockTotal === undefined) {
    throw rewardPanelError('invalid-request', { field: 'stockTotal' });
  }
  const stockTotal = parseStockTotal(input.stockTotal);

  return db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(rewardRef(db, rewardId));
    const reward = rewardOf(snap);
    if (!reward) throw rewardPanelError('reward-not-found');
    if (stockTotal !== null && stockTotal < reward.redeemedCount) {
      throw rewardPanelError('stock-below-redeemed', { redeemed: reward.redeemedCount });
    }
    const remaining = remainingOf({ stockTotal, redeemedCount: reward.redeemedCount });
    if (stockTotal === reward.stockTotal) return { ok: true as const, remaining };
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(snap.ref, { stockTotal, updatedAt: now, updatedBy: actor.uid });
    audit(
      tx,
      db,
      'reward.stock.updated',
      actor,
      { rewardId, before: reward.stockTotal, after: stockTotal, redeemed: reward.redeemedCount },
      now,
    );
    return { ok: true as const, remaining };
  });
}

/**
 * reorderRewards: a lista completa dos rascunhos e das no ar, sem faltar,
 * sobrar nem repetir (`invalid-request`); as encerradas ficam fora e mantêm o
 * `order` delas. Cada uma que muda de lugar grava o `order`.
 */
export async function reorderRewardList(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const rewardIds = parseRewardIds(requestFields(data).rewardIds);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const current = await tx.get(rewardsRef(db).where('status', 'in', ['draft', 'published']));
    const orders = new Map(current.docs.map((doc) => [doc.id, doc.get('order')]));
    if (rewardIds.length !== orders.size || rewardIds.some((id) => !orders.has(id))) {
      throw rewardPanelError('invalid-request', { field: 'rewardIds' });
    }
    const moves = rewardIds
      .map((id, order) => ({ id, order }))
      .filter(({ id, order }) => orders.get(id) !== order);
    if (moves.length === 0) return;
    const now = Timestamp.fromMillis(clock(deps));
    for (const { id, order } of moves) {
      tx.update(rewardRef(db, id), { order, updatedAt: now, updatedBy: actor.uid });
    }
    audit(tx, db, 'reward.reordered', actor, { rewardIds }, now);
  });
  return { ok: true };
}

/**
 * deleteReward: só a que nunca foi ao ar (`was-published`) e sem pedido
 * (`has-redemptions`). A pasta da foto sai depois.
 */
export async function removeReward(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  const { db } = deps;
  await editor(deps, caller);
  const rewardId = parseRewardId(requestFields(data).rewardId);

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const snap = await tx.get(rewardRef(db, rewardId));
    const reward = rewardOf(snap);
    if (!reward) throw rewardPanelError('reward-not-found');
    const orders = await tx.get(redemptionsRef(db).where('rewardId', '==', rewardId).limit(1));
    if (reward.publishedAt !== null) throw rewardPanelError('was-published');
    if (!orders.empty) throw rewardPanelError('has-redemptions');
    const now = Timestamp.fromMillis(clock(deps));
    tx.delete(snap.ref);
    audit(
      tx,
      db,
      'reward.deleted',
      actor,
      { rewardId, kind: reward.kind, title: reward.title },
      now,
    );
  });

  try {
    const paths = await deps.files.list(rewardPrefix(rewardId));
    await removeFiles(deps.files, paths);
  } catch (error) {
    logger.warn('A limpeza da pasta de uma recompensa apagada falhou.', {
      rewardId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { ok: true };
}

const STATUS_AUDIT: Record<'approved' | 'delivered' | 'refused', AuditAction> = {
  approved: 'redemption.approved',
  delivered: 'redemption.delivered',
  refused: 'redemption.refused',
};

/**
 * setRedemptionStatus: as transições da decisão 3 (25.4), conferidas no
 * servidor, com a devolução dos pontos e da vaga na recusa. O mesmo status
 * responde sem gravar nem auditar, com o `refundedPoints` guardado. A
 * auditoria leva o código, a recompensa e os status, nunca o uid do fã.
 */
export async function changeRedemptionStatus(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true; status: string; refundedPoints: number }> {
  const { db } = deps;
  await editor(deps, caller);
  const request = parseRedemptionStatusRequest(requestFields(data));
  const { points: config } = await deps.config.get();
  const random = deps.random ?? Math.random;

  return db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    const now = clock(deps);
    const outcome = await applyRedemptionStatus(
      tx,
      db,
      { code: request.code, to: request.status, reason: request.reason, restock: request.restock },
      {
        now,
        config,
        shard: pickShard(random),
        actor: { type: 'staff', uid: actor.uid, name: actor.name },
      },
    );
    if (outcome.changed) {
      audit(
        tx,
        db,
        STATUS_AUDIT[request.status],
        actor,
        {
          code: request.code,
          rewardId: outcome.rewardId,
          from: outcome.from,
          to: outcome.status,
          ...(request.status === 'refused'
            ? {
                refundedPoints: outcome.refundedPoints,
                restocked: outcome.restocked,
                hasReason: request.reason !== null,
              }
            : {}),
        },
        Timestamp.fromMillis(now),
      );
    }
    return { ok: true as const, status: outcome.status, refundedPoints: outcome.refundedPoints };
  });
}

export type RedemptionContact = {
  redemptionId: string;
  name: string | null;
  username: string | null;
  email: string | null;
};

/**
 * getRedemptionContacts (25.1, decisão 13): o nome, o @ e o e-mail de agora
 * de quem fez os pedidos abertos (solicitados e aprovados), para a equipe
 * entregar. Pedido que não existe ou já fechou fica fora da resposta
 * (minimização de dados); o de uma conta que não existe mais volta com tudo
 * null. Só admin ou editor com `rewards`: o leitor vê a cópia do nome e do @
 * no pedido, nunca o e-mail. Uma auditoria por chamada, com os códigos e a
 * quantidade, sem nome, @ nem e-mail.
 */
export async function readRedemptionContacts(
  deps: RewardsPanelDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ contacts: RedemptionContact[] }> {
  const { db } = deps;
  await editor(deps, caller);
  const codes = parseRedemptionCodes(requestFields(data).redemptionIds);

  const snaps = await db.getAll(...codes.map((code) => redemptionRef(db, code)));
  const open = snaps
    .filter((snap) => snap.exists)
    .map((snap) => redemptionRecord(snap.id, snap.data() ?? {}))
    .filter((item) => isOpenRedemption(item.status) && item.uid !== null);
  const uids = [...new Set(open.map((item) => item.uid!))];
  const profiles =
    uids.length > 0 ? await db.getAll(...uids.map((uid) => db.collection('users').doc(uid))) : [];
  const profileOf = new Map(uids.map((uid, index) => [uid, profiles[index]]));
  const users =
    uids.length > 0 ? await deps.auth.getUsers(uids.map((uid) => ({ uid }))) : { users: [] };
  const userOf = new Map(users.users.map((user) => [user.uid, user]));

  const contacts = open.map((item): RedemptionContact => {
    const user = userOf.get(item.uid!);
    if (!user) return { redemptionId: item.code, name: null, username: null, email: null };
    const profile = profileOf.get(item.uid!);
    const name = profile?.exists ? profile.get('displayName') : null;
    const username = profile?.exists ? profile.get('username') : null;
    return {
      redemptionId: item.code,
      name: typeof name === 'string' ? name : null,
      username: typeof username === 'string' ? username : null,
      email: user.email ?? null,
    };
  });

  await db.runTransaction(async (tx) => {
    const actor = await editorIn(tx, deps, caller);
    audit(
      tx,
      db,
      'redemption.contacts.viewed',
      actor,
      { codes: contacts.map((contact) => contact.redemptionId), count: contacts.length },
      Timestamp.fromMillis(clock(deps)),
    );
  });
  return { contacts };
}
