import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { leaveAllCentrals } from './centrals/service';
import { detachReferrals, referralRef, removeInviteData } from './invites/service';
import { dayKey } from './points/model';
import { removeFanEngagement } from './posts/service';
import { emptyShardDelta, pickShard, shardRef, shardWrite } from './points/stats';
import {
  profileDisplayName,
  randomDigits,
  usernameBase,
  usernameCandidates,
  type RandomDigits,
} from './profile';

// Códigos gRPC do Firestore.
const NOT_FOUND = 5;
const FAILED_PRECONDITION = 9;

export type CreateProfileResult = { status: 'created'; username: string } | { status: 'exists' };

/** Relógio e sorteio do shard do cadastro do dia; os testes fixam. */
export type SignupCountOptions = { now?: () => number; shardRandom?: () => number };

/**
 * Cria users/{uid} e reserva o @ em usernames/{@}, na mesma transação, e soma
 * o cadastro no shard do dia dos agregados do painel (`signups.total`, bloco
 * 5, docs/arquitetura-api.md, 20.7), com a marca `signupCounted` no perfil,
 * que a carga dos cadastros antigos (scripts/backfill-signups.mjs) usa para
 * não contar duas vezes. O evento de cadastro pode chegar mais de uma vez: se o
 * perfil já existe, não mexe em nada nem soma de novo. Não grava updatedAt,
 * que é o carimbo de edição do fã e segura as edições dele por 10 s.
 */
export async function createProfile(
  db: Firestore,
  user: { uid: string; displayName?: string | null },
  random: RandomDigits = randomDigits,
  options: SignupCountOptions = {},
): Promise<CreateProfileResult> {
  const now = (options.now ?? Date.now)();
  const shardRandom = options.shardRandom ?? Math.random;
  const profileRef = db.collection('users').doc(user.uid);
  const displayName = profileDisplayName(user.displayName);
  const base = usernameBase(displayName);

  return db.runTransaction(async (tx) => {
    const profile = await tx.get(profileRef);
    if (profile.exists) return { status: 'exists' };

    const candidates = usernameCandidates(base, random).map((username) =>
      db.collection('usernames').doc(username),
    );
    const reservations = await tx.getAll(...candidates);
    const free = reservations.find((reservation) => !reservation.exists);
    // Só acontece se todos os sorteados estiverem tomados: a nova tentativa sorteia outros.
    if (!free) throw new Error('Nenhum @ livre entre os candidatos.');

    tx.create(free.ref, { uid: user.uid, createdAt: FieldValue.serverTimestamp() });
    tx.create(profileRef, {
      displayName,
      username: free.id,
      city: null,
      // A foto entra depois, pelo servidor, com o upload validado.
      photoURL: null,
      createdAt: FieldValue.serverTimestamp(),
      signupCounted: true,
    });
    // O dia é o do relógio da função; o createdAt é o do servidor. Perto da
    // meia-noite os dois podem cair em dias diferentes por milissegundos.
    const day = dayKey(now);
    const delta = emptyShardDelta();
    delta.signups.total = 1;
    tx.set(shardRef(db, day, pickShard(shardRandom)), shardWrite(delta, day, now), {
      merge: true,
    });
    return { status: 'created', username: free.id };
  });
}

/** true se users/{uid} já existe: a entrega repetida do cadastro não espera o nome. */
export async function profileExists(db: Firestore, uid: string): Promise<boolean> {
  return (await db.collection('users').doc(uid).get()).exists;
}

/**
 * true se a conta é só da equipe do painel: staff/{uid} existe, em qualquer
 * status. O aceite do convite grava essa marca antes de criar a conta. A
 * exceção é a conta de fã ligada à equipe (linkStaffInvite grava
 * accountCreatedByInvite: false): ela é de fã e continua com o perfil, mesmo
 * que este gatilho chegue atrasado, depois da ligação.
 */
export async function isStaffAccount(db: Firestore, uid: string): Promise<boolean> {
  const marker = await db.collection('staff').doc(uid).get();
  return marker.exists && marker.get('accountCreatedByInvite') !== false;
}

/** Chaves de idempotência apagadas por lote (o limite de um lote do Firestore é 500). */
const IDEMPOTENCY_DELETE_BATCH = 500;

/** As chaves de idempotência do fã (as respostas guardadas podem ter texto dele). */
async function deleteIdempotencyKeys(db: Firestore, uid: string): Promise<void> {
  const keys = db.collection('idempotency').where('uid', '==', uid).limit(IDEMPOTENCY_DELETE_BATCH);
  for (;;) {
    const page = await keys.get();
    if (page.empty) return;
    const batch = db.batch();
    for (const doc of page.docs) batch.delete(doc.ref);
    await batch.commit();
    if (page.size < IDEMPOTENCY_DELETE_BATCH) return;
  }
}

/**
 * Apaga tudo do fã: as reservas de @, o perfil, o convite dele (o código, os
 * links e os marcadores de visita), os vínculos com as centrais (descontando o
 * fanCount de cada uma), as subcoleções do perfil, quem o trouxe
 * (referrals/{uid}), o `inviterUid` dos convidados dele (que ficam, com null),
 * a carteira (com o extrato e os pontos por central), as chaves de
 * idempotência e o acesso ao painel (staff/{uid}) se a conta era da equipe.
 * Desde o bloco 6, também as curtidas e os comentários (descontando as
 * contagens dos posts), as denúncias que ele fez (descontadas da fila) e os
 * bloqueios (removeFanEngagement), antes do recursiveDelete, que leva as
 * presenças. Pode rodar mais de uma vez. Dado novo do fã fora de users/{uid}
 * precisa entrar aqui.
 *
 * A ordem importa: toda gravação da API lê users/{uid} na transação
 * (requireFan), então depois que o documento do perfil some nenhuma gravação
 * nova do fã passa. Por isso ele sai sozinho primeiro, antes dos vínculos: o
 * recursiveDelete apaga o documento por último, e uma entrada no meio da
 * exclusão criaria um vínculo depois da listagem, que ele levaria sem
 * descontar o fanCount. Os agregados do painel (statsDaily) não descontam:
 * guardam o que aconteceu em cada dia, sem uid (docs/arquitetura-api.md,
 * seções 12 e 19.12). O código do convite sai logo depois do perfil: um claim
 * ou uma visita que leu o código antes grava o marcador antes (e o
 * recursiveDelete o leva) ou repete e responde 404. Os pontos que o fã rendeu a
 * quem o convidou ficam com quem convidou (20.10).
 */
export async function deleteUserData(db: Firestore, uid: string): Promise<void> {
  const reservations = await db.collection('usernames').where('uid', '==', uid).get();
  await Promise.all(
    reservations.docs.map(async (reservation) => {
      try {
        // Só apaga a reserva lida: se outra entrega já a apagou e outra fã tomou
        // o mesmo @ no meio-tempo, a dela fica.
        await reservation.ref.delete({ lastUpdateTime: reservation.updateTime });
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== FAILED_PRECONDITION && code !== NOT_FOUND) throw error;
      }
    }),
  );
  const profile = db.collection('users').doc(uid);
  await profile.delete();
  await removeInviteData(db, uid);
  await leaveAllCentrals(db, uid);
  await removeFanEngagement(db, uid);
  await db.recursiveDelete(profile);
  await referralRef(db, uid).delete();
  await detachReferrals(db, uid);
  await db.recursiveDelete(db.collection('wallets').doc(uid));
  await deleteIdempotencyKeys(db, uid);
  await db.collection('staff').doc(uid).delete();
}
