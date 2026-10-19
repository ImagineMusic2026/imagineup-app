import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';

import { isWithinCreditWindow, type FanClubCredit } from './model';
import { fanClubCreditRef, readOwnClubOf } from './store';

// A atribuição do fã-clube (docs/arquitetura-api.md, seção 34, decisão 23; a
// etapa 3 de 34.14): as leituras do crédito da entrada trazida pelo código do
// gestor, na entrada da central (o `joinCentrals`) e no claim do convite (o
// `claimInvite`). As gravações (o marcador e os shards) ficam no store. Só
// importa o model e o store: as centrais e o convite chamam daqui, e nada aqui
// chama de volta, por isso os dois caminhos abaixo são escritos aqui.

/** `referrals/{uid}`: quem trouxe o fã (o `referralRef` do convite, que importa daqui). */
const referralOf = (db: Firestore, uid: string): DocumentReference =>
  db.collection('referrals').doc(uid);

/** `users/{uid}/centrals/{artistId}`: o vínculo (o `membershipRef` das centrais, que importam daqui). */
const membershipOf = (db: Firestore, uid: string, artistId: string): DocumentReference =>
  db.collection('users').doc(uid).collection('centrals').doc(artistId);

/**
 * O fã-clube ativo de quem convidou: a candidatura dele aprovada e o fã-clube
 * dela, ainda dele e ativo (o pausado, pela equipe ou pela suspensão, não
 * credita). Uma leitura, mais uma com o `clubId`; null sem ele.
 */
async function readOwnerClub(
  tx: Transaction,
  db: Firestore,
  inviterUid: string,
): Promise<{ clubId: string; artistId: string } | null> {
  const own = await readOwnClubOf(tx, db, inviterUid);
  if (own === null || own.record.status !== 'active' || own.record.artistId === '') return null;
  return { clubId: own.record.id, artistId: own.record.artistId };
}

/**
 * O crédito da entrada pelo código do gestor (decisão 23; 34.5, "O crédito
 * pelo código do gestor"), na transação da entrada, antes de o
 * `joinCentrals` gravar. Sem central nova ou com o perfil de mais de 30 dias,
 * não lê nada. Senão, o `referrals/{uid}`; com o `inviterUid`, o fã-clube
 * ativo dele (`readOwnerClub`); com ele de uma das centrais novas, o marcador.
 * Devolve o crédito sem o marcador, e o `joinCentrals` só o grava com o
 * `firstJoin` da entrada. No `POST /me/artists`, que entra em várias centrais
 * de uma vez, só a do fã-clube do gestor leva o crédito, e só uma vez. De 0 a
 * 4 leituras.
 */
export async function readEntryCredit(
  tx: Transaction,
  db: Firestore,
  options: {
    uid: string;
    profileCreatedAt: number | null;
    now: number;
    /** As centrais em que o fã entra agora (sem as que ele já seguia). */
    joining: readonly string[];
  },
): Promise<FanClubCredit | null> {
  const { uid, joining } = options;
  if (joining.length === 0 || !isWithinCreditWindow(options.profileCreatedAt, options.now)) {
    return null;
  }
  const referral = await tx.get(referralOf(db, uid));
  const inviterUid = referral.exists ? referral.get('inviterUid') : null;
  if (typeof inviterUid !== 'string' || inviterUid === '' || inviterUid === uid) return null;
  const club = await readOwnerClub(tx, db, inviterUid);
  if (club === null || !joining.includes(club.artistId)) return null;
  const marker = await tx.get(fanClubCreditRef(db, uid, club.artistId));
  if (marker.exists) return null;
  return { ...club, via: 'owner_code' };
}

/**
 * O crédito no claim que chega depois da entrada (decisão 23): o fã-clube
 * ativo de quem convidou e, com ele, o vínculo de quem chega com a central
 * dele e o marcador, num `getAll`. Credita o vínculo que já existe, com o
 * `firstJoin`, sem `fanClubId` e sem marcador, sem olhar o extrato (a entrada
 * do onboarding já pagou o `central_join`, e o `firstJoin` diz que ela foi a
 * primeira). Devolve o crédito e o vínculo a regravar, ou null. De 1 a 4
 * leituras; com o perfil de mais de 30 dias, nenhuma.
 */
export async function readClaimCredit(
  tx: Transaction,
  db: Firestore,
  options: { uid: string; inviterUid: string; profileCreatedAt: number | null; now: number },
): Promise<{ credit: FanClubCredit; membership: DocumentReference } | null> {
  const { uid, inviterUid } = options;
  if (inviterUid === uid || !isWithinCreditWindow(options.profileCreatedAt, options.now)) {
    return null;
  }
  const club = await readOwnerClub(tx, db, inviterUid);
  if (club === null) return null;
  const [membership, marker] = await tx.getAll(
    membershipOf(db, uid, club.artistId),
    fanClubCreditRef(db, uid, club.artistId),
  );
  if (!membership!.exists || membership!.get('firstJoin') !== true) return null;
  const fanClubId = membership!.get('fanClubId');
  if ((typeof fanClubId === 'string' && fanClubId !== '') || marker!.exists) return null;
  return { credit: { ...club, via: 'owner_code' }, membership: membership!.ref };
}
