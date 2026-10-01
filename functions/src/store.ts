import { FieldValue, type Firestore } from 'firebase-admin/firestore';

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

/**
 * Cria users/{uid} e reserva o @ em usernames/{@}, na mesma transação. O
 * evento de cadastro pode chegar mais de uma vez: se o perfil já existe, não
 * mexe em nada. Não grava updatedAt, que é o carimbo de edição do fã e segura
 * as edições dele por 10 s.
 */
export async function createProfile(
  db: Firestore,
  user: { uid: string; displayName?: string | null },
  random: RandomDigits = randomDigits,
): Promise<CreateProfileResult> {
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

/**
 * Apaga tudo do fã: as reservas de @ e o perfil com as subcoleções, e o acesso
 * ao painel (staff/{uid}) se a conta era da equipe. Pode rodar mais de uma
 * vez. Dado novo do fã fora de users/{uid} (carteira, convites) precisa entrar
 * aqui.
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
  await db.recursiveDelete(db.collection('users').doc(uid));
  await db.collection('staff').doc(uid).delete();
}
