import type { Auth, UserRecord } from 'firebase-admin/auth';
import {
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from 'firebase-admin/firestore';
import type { FunctionsErrorCode } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';

import { auditIndex, type AuditIndex } from './audit-index';
import { inviteEmailParams, type InviteEmailParams } from './email';
import { staffError } from './errors';
import {
  accessFor,
  BOOTSTRAP_INVITER_NAME,
  inviteExpiry,
  inviteState,
  inviteUrl,
  isActiveAdmin,
  leavesNoActiveAdmin,
  parseAccess,
  parseEmail,
  parseInviteId,
  parseName,
  parseOptionalName,
  parsePassword,
  parseRole,
  parseSections,
  parseUid,
  requestFields,
  sessionAllowed,
  type EmailStatus,
  type InviteStatus,
  type SectionId,
  type StaffRole,
  type StaffStatus,
} from './model';
import { hashInviteToken, newInviteToken, tokenMatches } from './token';

/** staff/{uid}: quem é da equipe do painel. Só o servidor grava. */
export type StaffMember = {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  sections: SectionId[];
  status: StaffStatus;
  accountCreatedByInvite: boolean;
  inviteId: string;
  invitedBy: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: string | null;
  /**
   * Só nas contas que já existiam e foram ligadas pelo linkStaffInvite: o
   * auth_time (segundos) do login que ligou. Sessão com login anterior não usa
   * o acesso, nem nas regras nem nas funções.
   */
  authValidAfter?: number;
};

/** staffInvites/{inviteId}. O token nunca é gravado, só o sha256 dele. */
export type StaffInvite = {
  email: string;
  suggestedName: string | null;
  role: StaffRole;
  sections: SectionId[];
  tokenHash: string;
  status: InviteStatus;
  expiresAt: Timestamp;
  invitedBy: string | null;
  invitedByName: string;
  createdAt: Timestamp;
  lastSentAt: Timestamp;
  /** Quem gerou o link que vale agora (criou ou reenviou por último); null no bootstrap. */
  lastSentBy: string | null;
  sendCount: number;
  emailStatus: EmailStatus;
  acceptingUid: string | null;
  acceptedUid: string | null;
  acceptedAt: Timestamp | null;
  canceledAt: Timestamp | null;
  canceledBy: string | null;
  cancelReason: 'admin' | 'replaced' | null;
};

/** Ações registradas em staffAudit: as da equipe e as das seções do painel. */
export type AuditAction =
  | 'invite.created'
  | 'invite.resent'
  | 'invite.canceled'
  | 'invite.accepted'
  | 'member.updated'
  | 'member.disabled'
  | 'member.enabled'
  | 'member.removed'
  | 'artist.created'
  | 'artist.updated'
  | 'artist.published'
  | 'artist.unpublished'
  | 'artist.deleted'
  | 'artist.reordered'
  | 'post.created'
  | 'post.updated'
  | 'post.published'
  | 'post.unpublished'
  | 'post.deleted'
  | 'event.created'
  | 'event.updated'
  | 'event.published'
  | 'event.unpublished'
  | 'event.deleted'
  | 'comment.hidden'
  | 'comment.kept'
  | 'comment.restored'
  | 'points.config.updated'
  | 'season.updated'
  | 'season.next.updated'
  | 'season.ended'
  | 'season.close.requested'
  | 'season.closed'
  | 'mission.created'
  | 'mission.updated'
  | 'mission.published'
  | 'mission.archived'
  | 'mission.reordered'
  | 'season.goal.updated'
  | 'achievement.created'
  | 'achievement.updated'
  | 'achievement.published'
  | 'achievement.archived'
  | 'achievement.reordered'
  | 'reward.created'
  | 'reward.updated'
  | 'reward.published'
  | 'reward.closed'
  | 'reward.stock.updated'
  | 'reward.reordered'
  | 'reward.deleted'
  | 'redemption.approved'
  | 'redemption.delivered'
  | 'redemption.refused'
  | 'redemption.contacts.viewed'
  | 'wallet.adjusted'
  | 'fan.email.lookup'
  | 'fan.username.reset'
  | 'fan.photo.removed'
  | 'fan.profile.cleared'
  | 'fan.suspended'
  | 'fan.unsuspended'
  | 'fan.comments.hidden'
  | 'config.seeded';

/**
 * staffAudit/{autoId}: uma entrada por mudança feita pelo painel. Nas ações
 * de outras seções (artistas, posts, shows, moderação e, desde o bloco 10, a
 * loja), targetEmail fica '' e targetUid null, e o alvo vai em details. A
 * auditoria nunca leva o texto de um comentário, nem o uid, o nome, o @ ou o
 * e-mail de quem resgatou (25.8).
 */
export type AuditEntry = {
  action: AuditAction;
  actorUid: string | null;
  actorName: string;
  targetEmail: string;
  targetUid: string | null;
  details: Record<string, unknown>;
  createdAt: Timestamp;
};

/** O que as funções da equipe usam do Admin SDK de Auth (trocável nos testes). */
export type StaffAuth = Pick<
  Auth,
  'getUser' | 'getUserByEmail' | 'createUser' | 'updateUser' | 'deleteUser'
>;

export type SendInviteEmail = (params: InviteEmailParams) => Promise<EmailStatus>;

export type StaffDeps = {
  db: Firestore;
  auth: StaffAuth;
  /** Base do link do convite (PANEL_URL). */
  panelUrl: string;
  sendInviteEmail: SendInviteEmail;
  /** Relógio em ms; os testes fixam o tempo. */
  now?: () => number;
};

/**
 * Quem chamou, como o onCall entrega em request.auth. `auth_time` é o momento
 * do login, em segundos, e continua o mesmo nos tokens renovados da sessão.
 */
export type CallerAuth = {
  uid: string;
  token: { email?: string; auth_time: number; firebase?: { sign_in_provider?: string } };
};

export type InviteLinkResult = {
  inviteId: string;
  inviteUrl: string;
  expiresAt: string;
  emailStatus: EmailStatus;
};

export type InvitePreview = {
  email: string;
  suggestedName: string | null;
  role: StaffRole;
  sections: SectionId[];
  expiresAt: string;
  invitedByName: string;
  accountExists: boolean;
};

const clock = (deps: { now?: () => number }) => (deps.now ?? Date.now)();
const staffRef = (db: Firestore, uid: string) => db.collection('staff').doc(uid);
const invitesOf = (db: Firestore) => db.collection('staffInvites');

/**
 * Grava uma entrada de staffAudit na transação da mudança, com a seção e os
 * alvos do `auditIndex` (os filtros dos Logs, bloco 11, 26.8).
 */
export function writeAudit(
  tx: Transaction,
  db: Firestore,
  entry: Omit<AuditEntry, 'createdAt'>,
  createdAt: Timestamp,
): void {
  const record: AuditEntry & AuditIndex = { ...entry, ...auditIndex(entry), createdAt };
  tx.create(db.collection('staffAudit').doc(), record);
}

function authErrorCode(error: unknown): string | undefined {
  return (error as { code?: string }).code;
}

async function findUser(auth: StaffAuth, uid: string): Promise<UserRecord | null> {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    if (authErrorCode(error) === 'auth/user-not-found') return null;
    throw error;
  }
}

async function findUserByEmail(auth: StaffAuth, email: string): Promise<UserRecord | null> {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (authErrorCode(error) === 'auth/user-not-found') return null;
    throw error;
  }
}

async function deleteAccount(auth: StaffAuth, uid: string): Promise<void> {
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (authErrorCode(error) !== 'auth/user-not-found') throw error;
  }
}

/**
 * Admin ativo que chamou, lido na transação: se ele perder o acesso no meio, a
 * mudança não passa. Sessão de antes do login que ligou o acesso (authValidAfter)
 * também não passa.
 */
async function readAdmin(tx: Transaction, db: Firestore, caller: CallerAuth): Promise<StaffMember> {
  const actor = (await tx.get(staffRef(db, caller.uid))).data() as StaffMember | undefined;
  if (!actor || !isActiveAdmin(actor) || !sessionAllowed(actor, caller.token.auth_time)) {
    throw staffError('not-admin');
  }
  return actor;
}

/** uids dos admins ativos, lidos na transação (trava os docs contra mudanças ao mesmo tempo). */
async function activeAdminUids(tx: Transaction, db: Firestore): Promise<string[]> {
  const admins = await tx.get(db.collection('staff').where('role', '==', 'admin'));
  return admins.docs.filter((doc) => isActiveAdmin(doc.data())).map((doc) => doc.id);
}

/**
 * Recusa convidar quem já é da equipe com esse e-mail. `ignoreUids` são marcas
 * pendentes de aceites do próprio convite, ou de convites que saem agora, que
 * não contam.
 */
function assertNotMember(
  members: QueryDocumentSnapshot[],
  alreadyCode: FunctionsErrorCode,
  ignoreUids: readonly (string | null)[] = [],
): void {
  const statuses = members
    .filter((doc) => !ignoreUids.includes(doc.id))
    .map((doc) => doc.get('status'));
  if (statuses.some((status) => status === 'active' || status === 'pending')) {
    throw staffError('already-staff', alreadyCode);
  }
  if (statuses.includes('disabled')) throw staffError('member-disabled');
}

/** Campos de um convite cancelado agora. */
function canceledFields(now: Timestamp, canceledBy: string | null, reason: 'admin' | 'replaced') {
  return { status: 'canceled' as const, canceledAt: now, canceledBy, cancelReason: reason };
}

/**
 * Reservas de aceite ainda sem acesso (staff/{acceptingUid} pending) dos
 * convites que vão ser cancelados, lidas na transação antes das gravações.
 * Saem junto com o convite: senão a marca de um aceite que caiu no meio barra
 * um novo convite para o mesmo e-mail.
 */
async function readReservations(
  tx: Transaction,
  db: Firestore,
  invites: readonly DocumentSnapshot[],
): Promise<DocumentSnapshot[]> {
  const found: DocumentSnapshot[] = [];
  for (const invite of invites) {
    const uid: unknown = invite.get('acceptingUid');
    if (typeof uid !== 'string' || uid === '') continue;
    const marker = await tx.get(staffRef(db, uid));
    if (marker.get('status') === 'pending' && marker.get('inviteId') === invite.id) {
      found.push(marker);
    }
  }
  return found;
}

/**
 * Tira a conta do Auth de uma reserva de aceite que não vai virar acesso
 * (convite cancelado, ou aceite que perdeu a corrida). O uid foi gerado pelo
 * servidor para o convite: a conta nunca foi de fã, mesmo que o gatilho tenha
 * criado um perfil porque a marca sumiu antes dele (o deleteUserProfile limpa).
 * A conta sai antes da marca: sem ela, o gatilho de cadastro não cria perfil
 * de fã mesmo que rode depois. Se a marca virou membro por outro caminho
 * (active ou disabled), a conta fica.
 */
async function discardReservedAccount(deps: StaffDeps, uid: string): Promise<void> {
  const { db } = deps;
  const marker = await staffRef(db, uid).get();
  if (marker.exists && marker.get('status') !== 'pending') return;
  await deleteAccount(deps.auth, uid);
  await db.runTransaction(async (tx) => {
    const current = await tx.get(staffRef(db, uid));
    if (current.get('status') === 'pending') tx.delete(current.ref);
  });
}

/**
 * discardReservedAccount de cada reserva que saiu com um convite cancelado,
 * depois da transação. O cancelamento já valeu: uma falha aqui só fica no log.
 */
async function discardReservedAccounts(deps: StaffDeps, uids: readonly string[]): Promise<void> {
  for (const uid of uids) {
    try {
      await discardReservedAccount(deps, uid);
    } catch (error) {
      logger.warn('A conta de um aceite que não terminou ficou no Auth.', {
        uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Convites pendentes de um admin que perde o papel, com as reservas deles. */
type IssuedInvites = { invites: QueryDocumentSnapshot[]; reservations: DocumentSnapshot[] };

/**
 * Convites pendentes que o admin `uid` criou ou reenviou por último (ele tem ou
 * teve o link), lidos na transação que tira dele o papel de admin. Saem junto:
 * senão, desativado, rebaixado ou removido, ele voltaria ao painel aceitando
 * um deles.
 */
async function readIssuedInvites(
  tx: Transaction,
  db: Firestore,
  uid: string,
): Promise<IssuedInvites> {
  const pending = await tx.get(invitesOf(db).where('status', '==', 'pending'));
  const invites = pending.docs.filter(
    (doc) => doc.get('invitedBy') === uid || doc.get('lastSentBy') === uid,
  );
  return { invites, reservations: await readReservations(tx, db, invites) };
}

/**
 * Cancela os convites de readIssuedInvites (cancelReason 'admin', por quem tirou
 * o papel), apaga as reservas deles e grava um invite.canceled para cada um.
 * Devolve os ids cancelados.
 */
function cancelIssuedInvites(
  tx: Transaction,
  db: Firestore,
  issued: IssuedInvites,
  change: { actorUid: string; actorName: string; issuerUid: string; now: Timestamp },
): string[] {
  for (const invite of issued.invites) {
    tx.update(invite.ref, canceledFields(change.now, change.actorUid, 'admin'));
    writeAudit(
      tx,
      db,
      {
        action: 'invite.canceled',
        actorUid: change.actorUid,
        actorName: change.actorName,
        targetEmail: invite.get('email'),
        targetUid: null,
        details: { inviteId: invite.id, reason: 'admin', issuerLostAdmin: change.issuerUid },
      },
      change.now,
    );
  }
  for (const reservation of issued.reservations) tx.delete(reservation.ref);
  return issued.invites.map((invite) => invite.id);
}

const NO_ISSUED_INVITES: IssuedInvites = { invites: [], reservations: [] };

/** Convite do link: existe, o token bate, está pendente e dentro da validade. */
function usableInvite(snap: DocumentSnapshot, token: unknown, nowMs: number): StaffInvite {
  const invite = snap.data() as StaffInvite | undefined;
  // Id inexistente e token errado dão a mesma resposta.
  if (!invite || !tokenMatches(token, invite.tokenHash)) throw staffError('invalid');
  const state = inviteState(invite, nowMs);
  if (state !== 'pending') throw staffError(state);
  return invite;
}

/** Como usableInvite, e o e-mail da conta logada precisa ser o do convite. */
function linkableInvite(
  snap: DocumentSnapshot,
  token: unknown,
  caller: CallerAuth,
  nowMs: number,
): StaffInvite {
  const invite = snap.data() as StaffInvite | undefined;
  if (!invite || !tokenMatches(token, invite.tokenHash)) throw staffError('invalid');
  if (caller.token.email?.trim().toLowerCase() !== invite.email) {
    throw staffError('email-mismatch');
  }
  return usableInvite(snap, token, nowMs);
}

function newInviteDoc(invite: {
  email: string;
  suggestedName: string | null;
  role: StaffRole;
  sections: SectionId[];
  token: string;
  expiresAt: Timestamp;
  invitedBy: string | null;
  invitedByName: string;
  now: Timestamp;
  emailStatus: EmailStatus;
}): StaffInvite {
  return {
    email: invite.email,
    suggestedName: invite.suggestedName,
    role: invite.role,
    sections: invite.sections,
    tokenHash: hashInviteToken(invite.token),
    status: 'pending',
    expiresAt: invite.expiresAt,
    invitedBy: invite.invitedBy,
    invitedByName: invite.invitedByName,
    createdAt: invite.now,
    lastSentAt: invite.now,
    lastSentBy: invite.invitedBy,
    sendCount: 1,
    emailStatus: invite.emailStatus,
    acceptingUid: null,
    acceptedUid: null,
    acceptedAt: null,
    canceledAt: null,
    canceledBy: null,
    cancelReason: null,
  };
}

/**
 * Manda o e-mail do convite e devolve o link. O convite é gravado como failed
 * (e-mail ainda não confirmado) e só muda com a resposta do envio: se a função
 * cair no meio, o painel mostra "falhou" e o admin copia o link.
 */
async function deliverInvite(
  deps: StaffDeps,
  invite: {
    ref: DocumentReference;
    email: string;
    suggestedName: string | null;
    role: StaffRole;
    inviterName: string;
    token: string;
    expiresAt: Timestamp;
  },
): Promise<InviteLinkResult> {
  const url = inviteUrl(deps.panelUrl, invite.ref.id, invite.token);
  const emailStatus = await deps.sendInviteEmail(
    inviteEmailParams({
      email: invite.email,
      suggestedName: invite.suggestedName,
      inviterName: invite.inviterName,
      role: invite.role,
      inviteUrl: url,
      expiresAt: invite.expiresAt.toDate(),
    }),
  );
  if (emailStatus !== 'failed') await invite.ref.update({ emailStatus });
  return {
    inviteId: invite.ref.id,
    inviteUrl: url,
    expiresAt: invite.expiresAt.toDate().toISOString(),
    emailStatus,
  };
}

/**
 * createStaffInvite: só admin ativo. Convites pendentes para o mesmo e-mail
 * viram canceled (replaced), e a reserva de um aceite deles que caiu no meio
 * sai junto. O token só existe no link devolvido.
 */
export async function createInvite(
  deps: StaffDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<InviteLinkResult> {
  if (!caller) throw staffError('unauthenticated');
  const actorUid = caller.uid;
  const input = requestFields(data);
  const email = parseEmail(input.email);
  const suggestedName = parseOptionalName(input.suggestedName);
  const { role, sections } = parseAccess(input.role, input.sections);
  const { db } = deps;
  const nowMs = clock(deps);
  const now = Timestamp.fromMillis(nowMs);
  const expiresAt = Timestamp.fromMillis(inviteExpiry(nowMs));
  const token = newInviteToken();
  const ref = invitesOf(db).doc();

  const { inviterName, released } = await db.runTransaction(async (tx) => {
    const actor = await readAdmin(tx, db, caller);
    const members = await tx.get(db.collection('staff').where('email', '==', email));
    const invites = await tx.get(invitesOf(db).where('email', '==', email));
    const replaced = invites.docs.filter((doc) => doc.get('status') === 'pending');
    const reservations = await readReservations(tx, db, replaced);
    assertNotMember(
      members.docs,
      'already-exists',
      reservations.map((reservation) => reservation.id),
    );
    for (const doc of replaced) tx.update(doc.ref, canceledFields(now, actorUid, 'replaced'));
    for (const reservation of reservations) tx.delete(reservation.ref);
    tx.create(
      ref,
      newInviteDoc({
        email,
        suggestedName,
        role,
        sections,
        token,
        expiresAt,
        invitedBy: actorUid,
        invitedByName: actor.displayName,
        now,
        emailStatus: 'failed',
      }),
    );
    writeAudit(
      tx,
      db,
      {
        action: 'invite.created',
        actorUid,
        actorName: actor.displayName,
        targetEmail: email,
        targetUid: null,
        details: {
          inviteId: ref.id,
          role,
          sections,
          suggestedName,
          replacedInviteIds: replaced.map((doc) => doc.id),
        },
      },
      now,
    );
    return {
      inviterName: actor.displayName,
      released: reservations.map((reservation) => reservation.id),
    };
  });

  await discardReservedAccounts(deps, released);
  return deliverInvite(deps, { ref, email, suggestedName, role, inviterName, token, expiresAt });
}

/**
 * resendStaffInvite: token e validade novos (o link antigo para de valer),
 * sendCount + 1 e outro e-mail. Convite vencido pode: renova. O e-mail sai
 * no nome de quem convidou; quem reenviou fica em lastSentBy.
 */
export async function resendInvite(
  deps: StaffDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<InviteLinkResult> {
  if (!caller) throw staffError('unauthenticated');
  const actorUid = caller.uid;
  const inviteId = parseInviteId(requestFields(data).inviteId, 'invite-not-found');
  const { db } = deps;
  const nowMs = clock(deps);
  const now = Timestamp.fromMillis(nowMs);
  const expiresAt = Timestamp.fromMillis(inviteExpiry(nowMs));
  const token = newInviteToken();
  const ref = invitesOf(db).doc(inviteId);

  const invite = await db.runTransaction(async (tx) => {
    const actor = await readAdmin(tx, db, caller);
    const current = (await tx.get(ref)).data() as StaffInvite | undefined;
    if (!current) throw staffError('invite-not-found');
    if (current.status !== 'pending') throw staffError('not-pending');
    const members = await tx.get(db.collection('staff').where('email', '==', current.email));
    assertNotMember(members.docs, 'failed-precondition', [current.acceptingUid]);
    tx.update(ref, {
      tokenHash: hashInviteToken(token),
      expiresAt,
      lastSentAt: now,
      lastSentBy: actorUid,
      sendCount: FieldValue.increment(1),
      emailStatus: 'failed',
    });
    writeAudit(
      tx,
      db,
      {
        action: 'invite.resent',
        actorUid,
        actorName: actor.displayName,
        targetEmail: current.email,
        targetUid: null,
        details: { inviteId, sendCount: current.sendCount + 1 },
      },
      now,
    );
    return current;
  });

  return deliverInvite(deps, {
    ref,
    email: invite.email,
    suggestedName: invite.suggestedName,
    role: invite.role,
    inviterName: invite.invitedByName,
    token,
    expiresAt,
  });
}

/**
 * cancelStaffInvite: pending vira canceled (admin). A reserva de um aceite que
 * caiu no meio sai junto (marca e conta), e o e-mail pode ser convidado de
 * novo. Um aceite em andamento vê o cancelamento no fim e desfaz a conta.
 */
export async function cancelInvite(
  deps: StaffDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  if (!caller) throw staffError('unauthenticated');
  const actorUid = caller.uid;
  const inviteId = parseInviteId(requestFields(data).inviteId, 'invite-not-found');
  const { db } = deps;
  const now = Timestamp.fromMillis(clock(deps));
  const ref = invitesOf(db).doc(inviteId);

  const released = await db.runTransaction(async (tx) => {
    const actor = await readAdmin(tx, db, caller);
    const snap = await tx.get(ref);
    const current = snap.data() as StaffInvite | undefined;
    if (!current) throw staffError('invite-not-found');
    if (current.status !== 'pending') throw staffError('not-pending');
    const reservations = await readReservations(tx, db, [snap]);
    tx.update(ref, canceledFields(now, actorUid, 'admin'));
    for (const reservation of reservations) tx.delete(reservation.ref);
    writeAudit(
      tx,
      db,
      {
        action: 'invite.canceled',
        actorUid,
        actorName: actor.displayName,
        targetEmail: current.email,
        targetUid: null,
        details: { inviteId, reason: 'admin' },
      },
      now,
    );
    return reservations.map((reservation) => reservation.id);
  });
  await discardReservedAccounts(deps, released);
  return { ok: true };
}

/**
 * getStaffInvite: pública. Mostra o convite de quem tem o link e diz se o
 * e-mail já tem conta no app (aí a página pede a senha dessa conta).
 */
export async function getInvite(deps: StaffDeps, data: unknown): Promise<InvitePreview> {
  const input = requestFields(data);
  const inviteId = parseInviteId(input.inviteId);
  const { db } = deps;
  const invite = usableInvite(await invitesOf(db).doc(inviteId).get(), input.token, clock(deps));

  const account = await findUserByEmail(deps.auth, invite.email);
  let accountExists = account !== null;
  if (account) {
    const status = (await staffRef(db, account.uid).get()).get('status');
    if (status === 'active') throw staffError('already-staff');
    // Conta que nasceu numa tentativa anterior deste convite, sem terminar: o
    // aceite continua dela, com a senha nova.
    if (account.uid === invite.acceptingUid && status === 'pending') accountExists = false;
  }
  return {
    email: invite.email,
    suggestedName: invite.suggestedName,
    role: invite.role,
    sections: invite.sections,
    expiresAt: invite.expiresAt.toDate().toISOString(),
    invitedByName: invite.invitedByName,
    accountExists,
  };
}

/**
 * Solta a reserva de um aceite que não vai terminar (o e-mail ficou com outra
 * conta). Só age se a conta reservada não existe no Auth: com ela criada, a
 * próxima tentativa continua de onde parou.
 */
async function releaseReservation(
  deps: StaffDeps,
  inviteRef: DocumentReference,
  uid: string,
): Promise<void> {
  if (await findUser(deps.auth, uid)) return;
  const { db } = deps;
  await db.runTransaction(async (tx) => {
    const invite = await tx.get(inviteRef);
    const marker = await tx.get(staffRef(db, uid));
    if (invite.get('status') === 'pending' && invite.get('acceptingUid') === uid) {
      tx.update(inviteRef, { acceptingUid: null });
    }
    if (marker.get('status') === 'pending') tx.delete(marker.ref);
  });
}

/**
 * Cria a conta reservada, ou continua de uma tentativa anterior do mesmo
 * convite (conta com esse uid e esse e-mail já existe): vale a senha e o nome
 * desta tentativa.
 */
async function ensureInviteAccount(
  deps: StaffDeps,
  inviteRef: DocumentReference,
  account: { uid: string; email: string; displayName: string; password: string },
): Promise<void> {
  let existing = await findUser(deps.auth, account.uid);
  if (!existing) {
    try {
      await deps.auth.createUser({
        uid: account.uid,
        email: account.email,
        password: account.password,
        displayName: account.displayName,
        emailVerified: true,
      });
      return;
    } catch (error) {
      existing = await findUser(deps.auth, account.uid);
      if (!existing) {
        const code = authErrorCode(error);
        if (code === 'auth/email-already-exists') {
          // Alguém criou conta com esse e-mail no meio do aceite.
          await releaseReservation(deps, inviteRef, account.uid);
          throw staffError('account-exists');
        }
        if (code === 'auth/invalid-password') throw staffError('weak-password');
        if (code === 'auth/invalid-display-name') throw staffError('invalid-name');
        if (code === 'auth/invalid-email') throw staffError('invalid-email');
        // Falha sem resposta clara: a reserva fica, e a nova tentativa continua dela.
        throw error;
      }
      // Um pedido ao mesmo tempo criou a conta primeiro: segue como repetição.
    }
  }
  if (existing.email?.toLowerCase() !== account.email) {
    throw new Error('A conta reservada para o convite tem outro e-mail.');
  }
  await deps.auth.updateUser(account.uid, {
    password: account.password,
    displayName: account.displayName,
    emailVerified: true,
  });
}

/**
 * acceptStaffInvite: conta nova, sem login. Idempotente e seguro em corrida:
 * 1. reserva o uid no convite (acceptingUid) e grava staff/{uid} pending
 *    antes da conta existir, para o gatilho de cadastro não criar perfil de fã.
 *    A reserva de uma tentativa anterior só é reaproveitada enquanto a marca
 *    pendente dela existe; sem a marca (o admin tirou o membro pendente), vai
 *    outro uid;
 * 2. cria a conta no Auth (ou continua a de uma tentativa anterior);
 * 3. ativa o membro e marca o convite accepted, se ele ainda estiver pendente
 *    e a marca pendente continuar lá.
 * Se o convite foi cancelado ou a marca sumiu no meio, a conta criada aqui é
 * desfeita.
 */
export async function acceptInvite(
  deps: StaffDeps,
  data: unknown,
): Promise<{ uid: string; email: string }> {
  const input = requestFields(data);
  const inviteId = parseInviteId(input.inviteId);
  const { db } = deps;
  const inviteRef = invitesOf(db).doc(inviteId);
  const invite = usableInvite(await inviteRef.get(), input.token, clock(deps));
  const displayName = parseName(input.displayName);
  const password = parsePassword(input.password);
  const existing = await findUserByEmail(deps.auth, invite.email);

  const reservation = await db.runTransaction(async (tx) => {
    const fresh = usableInvite(await tx.get(inviteRef), input.token, clock(deps));
    const reserved = fresh.acceptingUid ? await tx.get(staffRef(db, fresh.acceptingUid)) : null;
    // Membro ativo ou desativado com o convite ainda pendente: o fluxo não
    // produz isso; melhor parar do que mexer no acesso de alguém.
    if (reserved?.exists && reserved.get('status') !== 'pending') throw staffError('conflict');
    const uid = reserved?.exists ? reserved.id : db.collection('staff').doc().id;
    // O e-mail já é de outra conta: a página troca para o fluxo de conta existente.
    if (existing && existing.uid !== uid) {
      return { kind: 'account-exists' as const, staleUid: fresh.acceptingUid };
    }
    const now = Timestamp.fromMillis(clock(deps));
    if (reserved?.exists) {
      tx.update(reserved.ref, { displayName, updatedAt: now });
    } else {
      const pending: StaffMember = {
        uid,
        email: fresh.email,
        displayName,
        role: fresh.role,
        sections: fresh.sections,
        status: 'pending',
        accountCreatedByInvite: true,
        inviteId,
        invitedBy: fresh.invitedBy,
        createdAt: now,
        updatedAt: now,
        updatedBy: null,
      };
      tx.create(staffRef(db, uid), pending);
    }
    if (fresh.acceptingUid !== uid) tx.update(inviteRef, { acceptingUid: uid });
    return { kind: 'reserved' as const, uid, email: fresh.email };
  });

  if (reservation.kind === 'account-exists') {
    // Reserva de uma tentativa antiga, de antes de o e-mail ganhar conta: sai.
    if (reservation.staleUid) await releaseReservation(deps, inviteRef, reservation.staleUid);
    throw staffError('account-exists');
  }

  const { uid, email } = reservation;
  await ensureInviteAccount(deps, inviteRef, { uid, email, displayName, password });

  const outcome = await db.runTransaction(async (tx) => {
    const current = (await tx.get(inviteRef)).data() as StaffInvite | undefined;
    const markerRef = staffRef(db, uid);
    const marker = await tx.get(markerRef);
    if (!current) return 'invalid' as const;
    if (current.status === 'accepted') {
      return current.acceptedUid === uid ? ('done' as const) : ('accepted' as const);
    }
    if (current.status === 'canceled') return 'canceled' as const;
    if (current.acceptingUid !== null && current.acceptingUid !== uid) return 'conflict' as const;
    // A marca pendente sumiu no meio (o admin tirou o membro pendente): ela não
    // volta como membro ativo, e a conta criada aqui é desfeita.
    if (marker.get('status') !== 'pending') return 'conflict' as const;
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(markerRef, {
      uid,
      email: current.email,
      displayName,
      role: current.role,
      sections: current.sections,
      status: 'active',
      accountCreatedByInvite: true,
      inviteId,
      invitedBy: current.invitedBy,
      updatedAt: now,
      updatedBy: uid,
    });
    tx.update(inviteRef, {
      status: 'accepted',
      acceptingUid: uid,
      acceptedUid: uid,
      acceptedAt: now,
    });
    writeAudit(
      tx,
      db,
      {
        action: 'invite.accepted',
        actorUid: uid,
        actorName: displayName,
        targetEmail: current.email,
        targetUid: uid,
        details: {
          inviteId,
          role: current.role,
          sections: current.sections,
          accountCreatedByInvite: true,
        },
      },
      now,
    );
    return 'activated' as const;
  });

  if (outcome === 'activated' || outcome === 'done') return { uid, email };
  await discardReservedAccounts(deps, [uid]);
  throw staffError(outcome);
}

/**
 * linkStaffInvite: conta que já existe (fã), logada. O e-mail do login, e o
 * da conta agora, precisa ser o do convite. O perfil de fã fica como está.
 *
 * Qualquer um cria conta no app com qualquer e-mail, sem confirmar. Se a
 * pessoa convidada recupera a senha de uma conta que outra pessoa criou com o
 * e-mail dela, o token de quem criou ainda vale até 1 h (as regras e o onCall
 * não conferem revogação). Por isso o acesso só vale para sessões com login
 * a partir deste (authValidAfter), e, se o e-mail nunca foi confirmado, saem os
 * provedores que não são a senha nem o deste login.
 */
export async function linkInvite(
  deps: StaffDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ uid: string }> {
  if (!caller) throw staffError('unauthenticated');
  const input = requestFields(data);
  const inviteId = parseInviteId(input.inviteId);
  const { db } = deps;
  const { uid } = caller;
  const inviteRef = invitesOf(db).doc(inviteId);
  const invite = linkableInvite(await inviteRef.get(), input.token, caller, clock(deps));
  const displayName = parseName(input.displayName);

  const status = (await staffRef(db, uid).get()).get('status');
  if (status === 'active') throw staffError('already-staff');
  if (status === 'disabled') throw staffError('member-disabled');
  // O e-mail do token é de quando ele saiu (até 1 h): confere a conta de agora,
  // que é a que vai ficar com o e-mail confirmado.
  const account = await findUser(deps.auth, uid);
  if (!account) throw staffError('unauthenticated');
  if (account.email?.trim().toLowerCase() !== invite.email) throw staffError('email-mismatch');
  // Reserva de um aceite antigo (de antes de o e-mail ter esta conta), sem
  // conta criada: a marca pendente dela sai junto.
  const staleUid =
    invite.acceptingUid &&
    invite.acceptingUid !== uid &&
    !(await findUser(deps.auth, invite.acceptingUid))
      ? invite.acceptingUid
      : null;

  // O link chegou neste e-mail, e quem está logado entrou na conta. E-mail
  // nunca confirmado: a conta pode ter nascido na mão de outra pessoa, e sai
  // todo provedor ligado por ela (fica a senha, que quem está aqui sabe, e o
  // provedor deste login).
  if (!account.emailVerified) {
    const provider = caller.token.firebase?.sign_in_provider ?? 'password';
    const providersToUnlink = account.providerData
      .map((info) => info.providerId)
      .filter((id) => id !== 'password' && id !== provider);
    await deps.auth.updateUser(uid, {
      emailVerified: true,
      ...(providersToUnlink.length > 0 ? { providersToUnlink } : {}),
    });
  }
  // Só as sessões deste login em diante usam o acesso ao painel.
  const authValidAfter = caller.token.auth_time;

  await db.runTransaction(async (tx) => {
    const fresh = linkableInvite(await tx.get(inviteRef), input.token, caller, clock(deps));
    const markerRef = staffRef(db, uid);
    const marker = await tx.get(markerRef);
    const stale = staleUid ? await tx.get(staffRef(db, staleUid)) : null;
    const current = marker.get('status');
    if (current === 'active') throw staffError('already-staff');
    if (current === 'disabled') throw staffError('member-disabled');
    const now = Timestamp.fromMillis(clock(deps));
    // Conta criada por uma tentativa de aceite deste convite continua marcada assim.
    const accountCreatedByInvite = marker.get('accountCreatedByInvite') === true;
    const member = {
      uid,
      email: fresh.email,
      displayName,
      role: fresh.role,
      sections: fresh.sections,
      status: 'active' as const,
      accountCreatedByInvite,
      inviteId,
      invitedBy: fresh.invitedBy,
      updatedAt: now,
      updatedBy: uid,
      authValidAfter,
    };
    if (marker.exists) tx.update(markerRef, member);
    else tx.set(markerRef, { ...member, createdAt: now });
    if (stale?.get('status') === 'pending') tx.delete(stale.ref);
    tx.update(inviteRef, {
      status: 'accepted',
      acceptingUid: uid,
      acceptedUid: uid,
      acceptedAt: now,
    });
    writeAudit(
      tx,
      db,
      {
        action: 'invite.accepted',
        actorUid: uid,
        actorName: displayName,
        targetEmail: fresh.email,
        targetUid: uid,
        details: {
          inviteId,
          role: fresh.role,
          sections: fresh.sections,
          accountCreatedByInvite,
          linkedExistingAccount: true,
        },
      },
      now,
    );
  });
  return { uid };
}

/** Membro alvo de uma mudança, lido na transação. */
async function readTarget(tx: Transaction, db: Firestore, uid: string): Promise<StaffMember> {
  const target = (await tx.get(staffRef(db, uid))).data() as StaffMember | undefined;
  if (!target) throw staffError('not-member');
  return target;
}

/**
 * updateStaffMember: papel e/ou seções. Ninguém muda o próprio acesso, e o
 * painel nunca fica sem admin ativo (conferido na transação, então dois
 * admins não conseguem rebaixar um ao outro ao mesmo tempo). Admin rebaixado
 * perde os convites pendentes que criou ou reenviou.
 */
export async function updateMember(
  deps: StaffDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  if (!caller) throw staffError('unauthenticated');
  const actorUid = caller.uid;
  const input = requestFields(data);
  const uid = parseUid(input.uid);
  const role = input.role === undefined ? undefined : parseRole(input.role);
  const sections = input.sections === undefined ? undefined : parseSections(input.sections);
  if (role === undefined && sections === undefined) throw staffError('invalid-request');
  const { db } = deps;

  const released = await db.runTransaction(async (tx) => {
    const actor = await readAdmin(tx, db, caller);
    if (uid === actorUid) throw staffError('self');
    const target = await readTarget(tx, db, uid);
    const admins = await activeAdminUids(tx, db);
    if (target.status === 'pending') throw staffError('pending-member');
    const next = accessFor(role ?? target.role, sections ?? target.sections);
    const unchanged =
      next.role === target.role && next.sections.join() === (target.sections ?? []).join();
    if (unchanged) return [];
    if (isActiveAdmin(target) && next.role !== 'admin' && leavesNoActiveAdmin(admins, uid)) {
      throw staffError('last-admin');
    }
    const losesAdmin = target.role === 'admin' && next.role !== 'admin';
    const issued = losesAdmin ? await readIssuedInvites(tx, db, uid) : NO_ISSUED_INVITES;
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(staffRef(db, uid), {
      role: next.role,
      sections: next.sections,
      updatedAt: now,
      updatedBy: actorUid,
    });
    const canceledInviteIds = cancelIssuedInvites(tx, db, issued, {
      actorUid,
      actorName: actor.displayName,
      issuerUid: uid,
      now,
    });
    writeAudit(
      tx,
      db,
      {
        action: 'member.updated',
        actorUid,
        actorName: actor.displayName,
        targetEmail: target.email,
        targetUid: uid,
        details: {
          from: { role: target.role, sections: target.sections },
          to: next,
          ...(losesAdmin ? { canceledInviteIds } : {}),
        },
      },
      now,
    );
    return issued.reservations.map((reservation) => reservation.id);
  });
  await discardReservedAccounts(deps, released);
  return { ok: true };
}

/**
 * setStaffMemberActive: active e disabled. Não mexe na conta do Auth (ela pode
 * ser de fã também): as regras leem staff/{uid} a cada pedido, e o corte no
 * painel é na hora. Admin desativado perde os convites pendentes que criou ou
 * reenviou; reativar não os devolve.
 */
export async function setMemberActive(
  deps: StaffDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  if (!caller) throw staffError('unauthenticated');
  const actorUid = caller.uid;
  const input = requestFields(data);
  const uid = parseUid(input.uid);
  if (typeof input.active !== 'boolean') throw staffError('invalid-request');
  const next: StaffStatus = input.active ? 'active' : 'disabled';
  const { db } = deps;

  const released = await db.runTransaction(async (tx) => {
    const actor = await readAdmin(tx, db, caller);
    if (uid === actorUid) throw staffError('self');
    const target = await readTarget(tx, db, uid);
    const admins = await activeAdminUids(tx, db);
    if (target.status === 'pending') throw staffError('pending-member');
    if (target.status === next) return [];
    if (next === 'disabled' && isActiveAdmin(target) && leavesNoActiveAdmin(admins, uid)) {
      throw staffError('last-admin');
    }
    const losesAdmin = next === 'disabled' && target.role === 'admin';
    const issued = losesAdmin ? await readIssuedInvites(tx, db, uid) : NO_ISSUED_INVITES;
    const now = Timestamp.fromMillis(clock(deps));
    tx.update(staffRef(db, uid), { status: next, updatedAt: now, updatedBy: actorUid });
    const canceledInviteIds = cancelIssuedInvites(tx, db, issued, {
      actorUid,
      actorName: actor.displayName,
      issuerUid: uid,
      now,
    });
    writeAudit(
      tx,
      db,
      {
        action: next === 'active' ? 'member.enabled' : 'member.disabled',
        actorUid,
        actorName: actor.displayName,
        targetEmail: target.email,
        targetUid: uid,
        details: {
          role: target.role,
          from: target.status,
          to: next,
          ...(losesAdmin ? { canceledInviteIds } : {}),
        },
      },
      now,
    );
    return issued.reservations.map((reservation) => reservation.id);
  });
  await discardReservedAccounts(deps, released);
  return { ok: true };
}

/**
 * removeStaffMember: apaga staff/{uid}. A conta do Auth só sai se nasceu no
 * convite e não é de fã (sem users/{uid}); senão continua como estava. Admin
 * removido perde os convites pendentes que criou ou reenviou. Membro pendente
 * (aceite que caiu no meio) solta a reserva no convite: a próxima tentativa
 * de aceite gera outro uid em vez de reviver este. As centrais que ele geria
 * (artistPrivate com managerUid dele) ficam sem gestor na mesma transação, e a
 * auditoria da remoção lista quais foram.
 */
export async function removeMember(
  deps: StaffDeps,
  caller: CallerAuth | undefined,
  data: unknown,
): Promise<{ ok: true }> {
  if (!caller) throw staffError('unauthenticated');
  const actorUid = caller.uid;
  const uid = parseUid(requestFields(data).uid);
  const { db } = deps;

  const { deleteAuthAccount, released } = await db.runTransaction(async (tx) => {
    const actor = await readAdmin(tx, db, caller);
    if (uid === actorUid) throw staffError('self');
    const target = await readTarget(tx, db, uid);
    const admins = await activeAdminUids(tx, db);
    const fanProfile = await tx.get(db.collection('users').doc(uid));
    const reservedInvite =
      target.status === 'pending' && typeof target.inviteId === 'string' && target.inviteId
        ? await tx.get(invitesOf(db).doc(target.inviteId))
        : null;
    const losesAdmin = target.role === 'admin';
    const issued = losesAdmin ? await readIssuedInvites(tx, db, uid) : NO_ISSUED_INVITES;
    // Centrais geridas por ele: o gestor fica em artistPrivate/{artistId} (só a
    // equipe lê) e aponta para um staff/{uid} existente.
    const managed = await tx.get(db.collection('artistPrivate').where('managerUid', '==', uid));
    if (isActiveAdmin(target) && leavesNoActiveAdmin(admins, uid)) {
      throw staffError('last-admin');
    }
    const deleteAccount = target.accountCreatedByInvite === true && !fanProfile.exists;
    const now = Timestamp.fromMillis(clock(deps));
    tx.delete(staffRef(db, uid));
    if (reservedInvite?.get('status') === 'pending' && reservedInvite.get('acceptingUid') === uid) {
      tx.update(reservedInvite.ref, { acceptingUid: null });
    }
    for (const internal of managed.docs) {
      tx.update(internal.ref, {
        managerUid: null,
        managerName: null,
        updatedAt: now,
        updatedBy: actorUid,
      });
    }
    const managedArtistIds = managed.docs.map((internal) => internal.id);
    const canceledInviteIds = cancelIssuedInvites(tx, db, issued, {
      actorUid,
      actorName: actor.displayName,
      issuerUid: uid,
      now,
    });
    writeAudit(
      tx,
      db,
      {
        action: 'member.removed',
        actorUid,
        actorName: actor.displayName,
        targetEmail: target.email,
        targetUid: uid,
        details: {
          role: target.role,
          sections: target.sections,
          status: target.status,
          accountDeleted: deleteAccount,
          ...(losesAdmin ? { canceledInviteIds } : {}),
          ...(managedArtistIds.length > 0 ? { managedArtistIds } : {}),
        },
      },
      now,
    );
    return {
      deleteAuthAccount: deleteAccount,
      released: issued.reservations.map((reservation) => reservation.id),
    };
  });

  if (deleteAuthAccount) await deleteAccount(deps.auth, uid);
  await discardReservedAccounts(deps, released);
  return { ok: true };
}

/**
 * Convite do primeiro admin (scripts/staff-bootstrap-invite.mjs). Recusa se
 * já existe admin ativo, se o e-mail já é da equipe ou se há convite pendente
 * e dentro da validade para ele (vencido é trocado por este). Não manda
 * e-mail: o script mostra o link.
 */
export async function createBootstrapInvite(
  deps: Pick<StaffDeps, 'db' | 'panelUrl' | 'now'>,
  emailValue: unknown,
): Promise<{ inviteId: string; inviteUrl: string; expiresAt: string; email: string }> {
  const email = parseEmail(emailValue);
  const { db } = deps;
  const nowMs = clock(deps);
  const now = Timestamp.fromMillis(nowMs);
  const expiresAt = Timestamp.fromMillis(inviteExpiry(nowMs));
  const { role, sections } = accessFor('admin', undefined);
  const token = newInviteToken();
  const ref = invitesOf(db).doc();

  await db.runTransaction(async (tx) => {
    const admins = await activeAdminUids(tx, db);
    const members = await tx.get(db.collection('staff').where('email', '==', email));
    const invites = await tx.get(invitesOf(db).where('email', '==', email));
    if (admins.length > 0) throw staffError('admin-exists');
    assertNotMember(members.docs, 'failed-precondition');
    const pending = invites.docs.filter((doc) => doc.get('status') === 'pending');
    if (pending.some((doc) => inviteState(doc.data() as StaffInvite, nowMs) === 'pending')) {
      throw staffError('invite-pending');
    }
    for (const doc of pending) {
      tx.update(doc.ref, {
        status: 'canceled',
        canceledAt: now,
        canceledBy: null,
        cancelReason: 'replaced',
      });
    }
    tx.create(
      ref,
      newInviteDoc({
        email,
        suggestedName: null,
        role,
        sections,
        token,
        expiresAt,
        invitedBy: null,
        invitedByName: BOOTSTRAP_INVITER_NAME,
        now,
        emailStatus: 'skipped',
      }),
    );
    writeAudit(
      tx,
      db,
      {
        action: 'invite.created',
        actorUid: null,
        actorName: BOOTSTRAP_INVITER_NAME,
        targetEmail: email,
        targetUid: null,
        details: {
          inviteId: ref.id,
          role,
          sections,
          bootstrap: true,
          replacedInviteIds: pending.map((doc) => doc.id),
        },
      },
      now,
    );
  });

  return {
    inviteId: ref.id,
    inviteUrl: inviteUrl(deps.panelUrl, ref.id, token),
    expiresAt: expiresAt.toDate().toISOString(),
    email,
  };
}
