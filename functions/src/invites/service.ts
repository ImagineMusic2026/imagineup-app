import {
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import {
  addDailyCount,
  addInviteCounts,
  applyAwards,
  planAwards,
  requireFan,
  requireProfile,
  retryOnAlreadyExists,
  walletRef,
  type AwardContext,
  type AwardPlan,
  type FanContext,
} from '../points/award';
import {
  dayKey,
  ledgerId,
  type Actor,
  type AwardEntry,
  type AwardStatus,
  type PointsConfig,
} from '../points/model';
import { pickShard } from '../points/stats';
import {
  drawInviteCode,
  INVITE_CODE_DRAWS,
  INVITE_LINKS_PER_DAY,
  INVITE_VISITS_SENT_PER_DAY,
  InviteError,
  inviteOwnership,
  isInviteOwner,
  isWithinClaimWindow,
  originKind,
  personKey,
  type ClaimInput,
  type ReferralAwardStatus,
  type SharedLink,
  type VisitInput,
} from './model';

// Convite no Firestore (bloco 5): o código de cada fã (inviteCodes/{code} e
// fanInvites/{uid}), os links que ele compartilhou
// (fanInvites/{uid}/inviteLinks), quem já contou como visitante
// (fanInvites/{uid}/inviteVisitors/{personKey}) e quem trouxe quem
// (referrals/{uid}). A ordem de uma rota que grava é a de sempre: chave e fã
// (runIdempotent), leituras do domínio, planAwards, gravações do domínio.
// docs/arquitetura-api.md, seção 20.

/** Convidados de quem excluiu a conta, desligados por página. */
const DETACH_PAGE = 200;

export function inviteCodeRef(db: Firestore, code: string): DocumentReference {
  return db.collection('inviteCodes').doc(code);
}

export function fanInviteRef(db: Firestore, uid: string): DocumentReference {
  return db.collection('fanInvites').doc(uid);
}

export function inviteLinksRef(db: Firestore, uid: string): CollectionReference {
  return fanInviteRef(db, uid).collection('inviteLinks');
}

export function inviteLinkRef(db: Firestore, uid: string, linkId: string): DocumentReference {
  return inviteLinksRef(db, uid).doc(linkId);
}

/** O marcador de quem já contou como visitante de um convidante: o id é a chave da pessoa. */
export function inviteVisitorRef(
  db: Firestore,
  inviterUid: string,
  key: string,
): DocumentReference {
  return fanInviteRef(db, inviterUid).collection('inviteVisitors').doc(key);
}

export function referralsRef(db: Firestore): CollectionReference {
  return db.collection('referrals');
}

/** Quem trouxe o fã: o id é o uid do convidado. */
export function referralRef(db: Firestore, uid: string): DocumentReference {
  return referralsRef(db).doc(uid);
}

/** inviteCodes/{code} como o convite usa. */
type InviteCodeRecord = { code: string; uid: string; ownerKey: string | null };

function codeRecord(snap: DocumentSnapshot | undefined): InviteCodeRecord | null {
  if (!snap?.exists) return null;
  const uid = snap.get('uid');
  if (typeof uid !== 'string' || uid === '') return null;
  const ownerKey = snap.get('ownerKey');
  return { code: snap.id, uid, ownerKey: typeof ownerKey === 'string' ? ownerKey : null };
}

function codeOf(snap: DocumentSnapshot | undefined): string | null {
  const code = snap?.exists ? snap.get('code') : null;
  return typeof code === 'string' && code !== '' ? code : null;
}

const tsOrNull = (ms: number | null) => (ms === null ? null : Timestamp.fromMillis(ms));

/** O status de um lançamento de quem convidou no plano (`skipped` quando não entrou). */
function statusOf(plan: AwardPlan, uid: string, entryId: string): AwardStatus {
  return (
    plan.results.find((result) => result.uid === uid && result.entryId === entryId)?.status ??
    'skipped'
  );
}

/** Quem chama o convite: o uid, o e-mail do ID token (nunca o do corpo) e o segredo do HMAC. */
export type InviteCaller = { uid: string; email: string | null };

// --- Código do fã ------------------------------------------------------------------

/**
 * O código de convite do fã (`GET /me/invite`), criado na primeira chamada:
 * 1. lê fanInvites/{uid} fora de transação; existe, devolve;
 * 2. numa transação: relê fanInvites e o perfil (outra chamada pode ter
 *    criado no meio); sem perfil, recusa como o requireFan;
 * 3. sorteia 5 códigos e fica com o primeiro livre em inviteCodes;
 * 4. cria inviteCodes/{code}, com o `ownerKey` (a chave da pessoa do dono),
 *    e fanInvites/{uid}.
 * Duas chamadas ao mesmo tempo dão um código só: uma repete e acha o outro.
 */
export async function ensureInviteCode(
  db: Firestore,
  caller: InviteCaller,
  deps: { inviteKey: string; random: () => number; now: number },
): Promise<string> {
  const known = codeOf(await fanInviteRef(db, caller.uid).get());
  if (known) return known;
  return retryOnAlreadyExists(() =>
    db.runTransaction(async (tx) => {
      const [invite, profile] = await tx.getAll(
        fanInviteRef(db, caller.uid),
        db.collection('users').doc(caller.uid),
      );
      const current = codeOf(invite);
      if (current) return current;
      await requireProfile(tx, db, caller.uid, profile!);
      const drawn = [
        ...new Set(Array.from({ length: INVITE_CODE_DRAWS }, () => drawInviteCode(deps.random))),
      ];
      const snaps = await tx.getAll(...drawn.map((code) => inviteCodeRef(db, code)));
      const free = snaps.find((snap) => !snap.exists);
      // 5 tomados entre 3,8 × 10^11: na prática não acontece. Erro de servidor.
      if (!free) throw new Error('Nenhum código de convite livre entre os sorteados.');
      const at = Timestamp.fromMillis(deps.now);
      tx.create(free.ref, {
        code: free.id,
        kind: 'fan',
        uid: caller.uid,
        ownerKey: personKey(caller.email, caller.uid, deps.inviteKey),
        createdAt: at,
        schemaVersion: 1,
      });
      tx.create(fanInviteRef(db, caller.uid), {
        uid: caller.uid,
        code: free.id,
        createdAt: at,
        schemaVersion: 1,
      });
      return free.id;
    }),
  );
}

// --- Claim ---------------------------------------------------------------------------

export type InviteWork = {
  fan: FanContext;
  award: AwardContext;
  email: string | null;
  inviteKey: string;
};

export type ClaimOutcome = { status: 'claimed' | 'already_claimed'; plan?: AwardPlan };

/** Os lançamentos do convite na carteira de quem convidou, pela chave da pessoa. */
function inviteEntries(
  code: string,
  key: string,
  sources: readonly ('invite_visit' | 'invite_signup')[],
): AwardEntry[] {
  return sources.map((source) => ({
    kind: 'earn',
    source,
    eventId: key,
    subject: { type: 'invite', id: code },
  }));
}

/** referrals/{uid}, como o claim grava (20.3). */
function referralDoc(
  fan: FanContext,
  input: ClaimInput,
  claim: {
    inviterUid: string | null;
    code: string;
    now: number;
    day: string;
    award: { visit: ReferralAwardStatus; signup: ReferralAwardStatus };
  },
): Record<string, unknown> {
  return {
    uid: fan.uid,
    inviterUid: claim.inviterUid,
    code: claim.code,
    via: input.via,
    link: input.link ? { kind: input.link.kind, targetId: input.link.targetId } : null,
    utm: { ...input.utm },
    openedAt: tsOrNull(input.openedAt),
    signupAt: tsOrNull(fan.profileCreatedAt),
    claimedAt: Timestamp.fromMillis(claim.now),
    day: claim.day,
    award: claim.award,
    inviterRemovedAt: null,
    schemaVersion: 1,
  };
}

/**
 * Claim do convite (`POST /invites/claim`), depois de o runIdempotent ler a
 * chave, o perfil e a carteira do convidado:
 * 1. um getAll: o código e referrals/{uid}; código que não existe é 404;
 * 2. referrals/{uid} existe: `already_claimed`, sem plano;
 * 3. a própria conta dona do código: 409 `self`;
 * 4. conta de mais de 7 dias (ou sem data no perfil): 409 `account_too_old`;
 * 5. a mesma pessoa noutra conta (o `ownerKey` do código): `claimed`, como um
 *    claim comum, com referrals/{uid} sem quem convidou e o `award` `self`,
 *    sem plano, sem marcador e fora dos agregados. A resposta igual à de
 *    qualquer outro claim impede que alguém descubra de quem é um código
 *    criando uma conta com o apelido de um e-mail (o Firebase não confere o
 *    e-mail), e a conta gasta o claim único (20.6);
 * 6. o marcador de visita da pessoa nesse convidante;
 * 7. planAwards com a visita e o cadastro de quem convidou, pela chave da
 *    pessoa (sem perfil, saem `skipped`);
 * 8. referrals/{uid}, com a origem e o `award`; o marcador, se quem convidou
 *    existe e a pessoa ainda não tinha contado; o cadastro convidado (e a
 *    visita, se o marcador nasceu) nos agregados.
 * Os pontos vão sem central (decisão 11): o convite é do fã.
 */
export async function claimInvite(
  tx: Transaction,
  db: Firestore,
  ctx: InviteWork & { input: ClaimInput },
): Promise<ClaimOutcome> {
  const { fan, award, input } = ctx;
  const [codeSnap, referral] = await tx.getAll(
    inviteCodeRef(db, input.code),
    referralRef(db, fan.uid),
  );
  const invite = codeRecord(codeSnap);
  if (!invite) throw new InviteError('invite_not_found');
  if (referral!.exists) return { status: 'already_claimed' };

  const key = personKey(ctx.email, fan.uid, ctx.inviteKey);
  const owner = inviteOwnership(invite, { uid: fan.uid, key });
  if (owner === 'account') throw new InviteError('invite_not_allowed', { reason: 'self' });
  if (!isWithinClaimWindow(fan.profileCreatedAt, award.now)) {
    throw new InviteError('invite_not_allowed', { reason: 'account_too_old' });
  }
  if (owner === 'person') {
    tx.create(
      referralRef(db, fan.uid),
      referralDoc(fan, input, {
        inviterUid: null,
        code: invite.code,
        now: award.now,
        day: dayKey(award.now),
        award: { visit: 'self', signup: 'self' },
      }),
    );
    return { status: 'claimed' };
  }

  // Fora do primeiro getAll: o caminho depende do dono, que só se sabe agora.
  const markerRef = inviteVisitorRef(db, invite.uid, key);
  const marker = await tx.get(markerRef);
  const plan = await planAwards(
    tx,
    db,
    [
      { uid: fan.uid, entries: [], fan },
      {
        uid: invite.uid,
        entries: inviteEntries(invite.code, key, ['invite_visit', 'invite_signup']),
      },
    ],
    award,
  );
  const visit = statusOf(plan, invite.uid, ledgerId({ source: 'invite_visit', eventId: key }));
  const signup = statusOf(plan, invite.uid, ledgerId({ source: 'invite_signup', eventId: key }));
  const inviterActive = signup !== 'skipped';

  const at = Timestamp.fromMillis(award.now);
  tx.create(
    referralRef(db, fan.uid),
    referralDoc(fan, input, {
      inviterUid: invite.uid,
      code: invite.code,
      now: award.now,
      day: plan.day,
      award: { visit, signup },
    }),
  );

  const kind = originKind(input);
  addInviteCounts(plan, {
    event: 'signup',
    kind,
    utmSource: input.utm.source,
    utmCampaign: input.utm.campaign,
  });
  if (inviterActive && !marker.exists) {
    tx.create(markerRef, { via: 'claim', day: plan.day, createdAt: at });
    addInviteCounts(plan, { event: 'visit', kind });
  }
  return { status: 'claimed', plan };
}

/**
 * Claim fora da API: o seed dos emuladores. Abre a transação, exige o perfil
 * (sem marcar atividade), faz o mesmo claimInvite da rota e grava o plano.
 */
export async function runClaim(
  db: Firestore,
  caller: InviteCaller,
  input: ClaimInput,
  options: {
    now: number;
    config: PointsConfig;
    actor: Actor;
    inviteKey: string;
    random?: () => number;
  },
): Promise<ClaimOutcome> {
  const random = options.random ?? Math.random;
  return retryOnAlreadyExists(() =>
    db.runTransaction(async (tx) => {
      const [profile, wallet] = await tx.getAll(
        db.collection('users').doc(caller.uid),
        walletRef(db, caller.uid),
      );
      const fan = await requireFan(tx, db, caller.uid, profile!, wallet!, options.now, {
        markActivity: false,
      });
      const award: AwardContext = {
        now: options.now,
        config: options.config,
        shard: pickShard(random),
        actor: options.actor,
      };
      const outcome = await claimInvite(tx, db, {
        fan,
        award,
        email: caller.email,
        inviteKey: options.inviteKey,
        input,
      });
      if (outcome.plan) applyAwards(tx, db, outcome.plan);
      return outcome;
    }),
  );
}

// --- Visita ----------------------------------------------------------------------------

export type VisitOutcome = { counted: boolean; plan?: AwardPlan };

/**
 * Visita ao link de convite no app (`POST /invites/visit`), de conta logada:
 * 1. o código; que não existe é 404;
 * 2. o dono do código (pelo uid ou pela chave do e-mail): `counted: false`;
 * 3. quem visita já mandou 20 visitas hoje: `counted: false`;
 * 4. o marcador de visita da pessoa nesse convidante;
 * 5. planAwards com a visita de quem convidou, pela chave da pessoa: roda
 *    também com o marcador já criado (a visita que antes saiu `capped` ou
 *    `zero` paga agora, a que já pagou sai `duplicate`);
 * 6. +1 nas visitas mandadas do dia de quem chama; o marcador, se quem
 *    convidou existe e a pessoa ainda não tinha contado, com a visita nos
 *    agregados. `counted` é o marcador ter nascido aqui.
 * O `counted` fica no servidor (testes e seed): a rota responde sempre o
 * mesmo corpo, senão ele diria a quem chama, pelo apelido de um e-mail, se
 * aquela pessoa é dona do código ou já passou por ele (20.6).
 */
export async function recordInviteVisit(
  tx: Transaction,
  db: Firestore,
  ctx: InviteWork & { input: VisitInput },
): Promise<VisitOutcome> {
  const { fan, award, input } = ctx;
  const invite = codeRecord(await tx.get(inviteCodeRef(db, input.code)));
  if (!invite) throw new InviteError('invite_not_found');
  const key = personKey(ctx.email, fan.uid, ctx.inviteKey);
  if (isInviteOwner(invite, { uid: fan.uid, key })) return { counted: false };

  // O teto vale para o fã que chama; o sistema (seed, testes) não conta.
  const countsSent = award.actor.type === 'fan';
  const sentToday = fan.wallet.days[dayKey(award.now)]?.count.invite_visit_sent ?? 0;
  if (countsSent && sentToday >= INVITE_VISITS_SENT_PER_DAY) return { counted: false };

  const markerRef = inviteVisitorRef(db, invite.uid, key);
  const marker = await tx.get(markerRef);
  const plan = await planAwards(
    tx,
    db,
    [
      { uid: fan.uid, entries: [], fan },
      { uid: invite.uid, entries: inviteEntries(invite.code, key, ['invite_visit']) },
    ],
    award,
  );
  if (countsSent) addDailyCount(plan, fan, 'invite_visit_sent');
  const visit = statusOf(plan, invite.uid, ledgerId({ source: 'invite_visit', eventId: key }));
  if (visit === 'skipped' || marker.exists) return { counted: false, plan };
  tx.create(markerRef, {
    via: 'visit',
    day: plan.day,
    createdAt: Timestamp.fromMillis(award.now),
  });
  addInviteCounts(plan, { event: 'visit', kind: input.link.kind });
  return { counted: true, plan };
}

// --- Links compartilhados -----------------------------------------------------------

export type LinkOutcome = { created: boolean; plan?: AwardPlan };

/**
 * Link compartilhado (`PUT /me/invite/links/:linkId`): um por destino.
 * 1. um getAll: fanInvites/{uid}, o link e, no link de uma central,
 *    artists/{@}; sem código ainda, 404;
 * 2. o link já existe, a central não existe ou não está publicada, ou o fã já
 *    registrou 30 novos hoje: `created: false`;
 * 3. cria o link, +1 nos links do dia de quem chama e o link nos agregados.
 * O post não é conferido: o mural ainda é de exemplo (bloco 6).
 */
export async function recordInviteLink(
  tx: Transaction,
  db: Firestore,
  ctx: { fan: FanContext; award: AwardContext; link: SharedLink },
): Promise<LinkOutcome> {
  const { fan, award, link } = ctx;
  const refs = [fanInviteRef(db, fan.uid), inviteLinkRef(db, fan.uid, link.linkId)];
  if (link.kind === 'artist' && link.targetId) {
    refs.push(db.collection('artists').doc(link.targetId));
  }
  const [invite, existing, artist] = await tx.getAll(...refs);
  if (!invite!.exists) throw new InviteError('invite_not_found');
  if (existing!.exists) return { created: false };
  if (artist && artist.get('status') !== 'published') return { created: false };
  const countsDaily = award.actor.type === 'fan';
  const today = fan.wallet.days[dayKey(award.now)]?.count.invite_link ?? 0;
  if (countsDaily && today >= INVITE_LINKS_PER_DAY) return { created: false };

  const plan = await planAwards(tx, db, [{ uid: fan.uid, entries: [], fan }], award);
  tx.create(inviteLinkRef(db, fan.uid, link.linkId), {
    uid: fan.uid,
    linkId: link.linkId,
    kind: link.kind,
    targetId: link.targetId,
    createdAt: Timestamp.fromMillis(award.now),
  });
  if (countsDaily) addDailyCount(plan, fan, 'invite_link');
  addInviteCounts(plan, { event: 'link', kind: link.kind });
  return { created: true, plan };
}

/**
 * Links fora da API: o seed dos emuladores, um por transação, sem marcar
 * atividade e sem contar no teto do dia (o sistema não conta).
 */
export async function runInviteLinks(
  db: Firestore,
  uid: string,
  links: readonly SharedLink[],
  options: { now: number; config: PointsConfig; actor: Actor; random?: () => number },
): Promise<number> {
  const random = options.random ?? Math.random;
  let created = 0;
  for (const link of links) {
    const outcome = await retryOnAlreadyExists(() =>
      db.runTransaction(async (tx) => {
        const [profile, wallet] = await tx.getAll(
          db.collection('users').doc(uid),
          walletRef(db, uid),
        );
        const fan = await requireFan(tx, db, uid, profile!, wallet!, options.now, {
          markActivity: false,
        });
        const award: AwardContext = {
          now: options.now,
          config: options.config,
          shard: pickShard(random),
          actor: options.actor,
        };
        const result = await recordInviteLink(tx, db, { fan, award, link });
        if (result.plan) applyAwards(tx, db, result.plan);
        return result;
      }),
    );
    if (outcome.created) created += 1;
  }
  return created;
}

// --- Leituras ----------------------------------------------------------------------------

/**
 * Os números do convite no Perfil (1e): os links que o fã compartilhou e as
 * contas que existem e entraram pelo convite dele. Dois `count()`, fora da
 * carteira e sem documento disputado (seção 4).
 */
export async function countInviteStats(
  db: Firestore,
  uid: string,
): Promise<{ linksCreated: number; peopleBrought: number }> {
  const [links, people] = await Promise.all([
    inviteLinksRef(db, uid).count().get(),
    referralsRef(db).where('inviterUid', '==', uid).count().get(),
  ]);
  return { linksCreated: links.data().count, peopleBrought: people.data().count };
}

// --- Exclusão de conta ---------------------------------------------------------------

/**
 * O fã como convidante sai: o código para de valer na hora (404, e o app de
 * quem guardou o link esquece), e saem os links e os marcadores de visita.
 * Apaga cada código só se ainda for deste fã (relido numa transação), o de
 * fanInvites/{uid} e qualquer outro com o uid dele. Roda depois de o perfil
 * sair (deleteUserData): daí em diante nenhum código novo nasce. Repetir é
 * seguro.
 */
export async function removeInviteData(db: Firestore, uid: string): Promise<void> {
  const ref = fanInviteRef(db, uid);
  const [invite, owned] = await Promise.all([
    ref.get(),
    db.collection('inviteCodes').where('uid', '==', uid).get(),
  ]);
  const codes = new Set(owned.docs.map((doc) => doc.id));
  const known = codeOf(invite);
  if (known) codes.add(known);
  for (const code of codes) {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(inviteCodeRef(db, code));
      if (snap.exists && snap.get('uid') === uid) tx.delete(snap.ref);
    });
  }
  await db.recursiveDelete(ref);
}

/**
 * O fã como convidante sai: os convidados dele ficam, sem o `inviterUid`
 * (null) e com o `inviterRemovedAt`. Página por página, numa transação que
 * relê cada um (o convidado pode estar excluindo a conta ao mesmo tempo); o
 * update tira o documento da consulta seguinte. Devolve quantos desligou.
 */
export async function detachReferrals(
  db: Firestore,
  uid: string,
  now: () => number = Date.now,
): Promise<number> {
  let detached = 0;
  for (;;) {
    const page = await referralsRef(db).where('inviterUid', '==', uid).limit(DETACH_PAGE).get();
    if (page.empty) return detached;
    detached += await db.runTransaction(async (tx) => {
      const snaps = await tx.getAll(...page.docs.map((doc) => doc.ref));
      const at = Timestamp.fromMillis(now());
      let count = 0;
      for (const snap of snaps) {
        if (!snap.exists || snap.get('inviterUid') !== uid) continue;
        tx.update(snap.ref, { inviterUid: null, inviterRemovedAt: at });
        count += 1;
      }
      return count;
    });
    if (page.size < DETACH_PAGE) return detached;
  }
}
