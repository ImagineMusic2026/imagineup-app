import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
} from 'firebase-admin/firestore';

import { redemptionRecord, rewardRecord, type RedemptionRecord, type RewardRecord } from './model';

// Onde mora a loja (bloco 10): o catálogo em rewards/{rewardId} e os pedidos
// em redemptions/{código}, os dois na raiz (docs/arquitetura-api.md, 25.1,
// decisão 1, e 25.3).

export function rewardsRef(db: Firestore): CollectionReference {
  return db.collection('rewards');
}

export function rewardRef(db: Firestore, rewardId: string): DocumentReference {
  return rewardsRef(db).doc(rewardId);
}

export function redemptionsRef(db: Firestore): CollectionReference {
  return db.collection('redemptions');
}

/** O pedido: o id é o código de retirada (25.1, decisão 2). */
export function redemptionRef(db: Firestore, code: string): DocumentReference {
  return redemptionsRef(db).doc(code);
}

export function rewardOf(snap: DocumentSnapshot | undefined): RewardRecord | null {
  return snap?.exists ? rewardRecord(snap.id, snap.data() ?? {}) : null;
}

export function redemptionOf(snap: DocumentSnapshot | undefined): RedemptionRecord | null {
  return snap?.exists ? redemptionRecord(snap.id, snap.data() ?? {}) : null;
}
