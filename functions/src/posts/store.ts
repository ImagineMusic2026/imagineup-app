import type {
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';

import { artistRecord, type ArtistRecord } from '../centrals/model';
import { artistRef } from '../centrals/service';
import { isContentId } from '../page-cursor';
import { isPostVisible, postRecord, type PostRecord } from './model';

// Onde mora o mural (bloco 6): os caminhos e a leitura do post visível, que o
// mural, a moderação, o convite (link de post) e a exclusão de conta usam.
// docs/arquitetura-api.md, 21.3.

export function postsRef(db: Firestore): CollectionReference {
  return db.collection('posts');
}

export function postRef(db: Firestore, postId: string): DocumentReference {
  return postsRef(db).doc(postId);
}

/** Os comentários de um post. Nome específico pela regra de grupo (21.11). */
export function commentsRef(db: Firestore, postId: string): CollectionReference {
  return postRef(db, postId).collection('postComments');
}

export function commentRef(db: Firestore, postId: string, commentId: string): DocumentReference {
  return commentsRef(db, postId).doc(commentId);
}

/** As contagens do post em shards. */
export function countShardsRef(db: Firestore, postId: string): CollectionReference {
  return db.collection('postStats').doc(postId).collection('countShards');
}

export function countShardRef(db: Firestore, postId: string, shard: number): DocumentReference {
  return countShardsRef(db, postId).doc(String(shard));
}

/** As curtidas do fã (com o estado): users/{uid}/postLikes. */
export function postLikesRef(db: Firestore, uid: string): CollectionReference {
  return db.collection('users').doc(uid).collection('postLikes');
}

export function postLikeRef(db: Firestore, uid: string, postId: string): DocumentReference {
  return postLikesRef(db, uid).doc(postId);
}

export function postOf(snap: DocumentSnapshot | undefined): PostRecord | null {
  return snap?.exists ? postRecord(snap.id, snap.data() ?? {}) : null;
}

export function artistOf(snap: DocumentSnapshot | undefined): ArtistRecord | null {
  return snap?.exists ? artistRecord(snap.id, snap.data() ?? {}) : null;
}

/** O post lido e a central dele, ou null quando o post não é visível. */
export type VisiblePost = { post: PostRecord; artist: ArtistRecord };

/**
 * Lê o post (com os documentos de `extra` no mesmo getAll) e, numa segunda
 * leitura, a central dele, na transação. A leitura do post e da central fica
 * na transação de propósito: é ela que põe em ordem a ação do fã e o
 * `setPostStatus` ou o `setArtistStatus`. Id fora do formato: o post não
 * existe, sem ler nada.
 */
export async function readVisiblePost(
  tx: Transaction,
  db: Firestore,
  postId: string,
  extra: readonly DocumentReference[] = [],
): Promise<{ visible: VisiblePost | null; extra: DocumentSnapshot[] }> {
  if (!isContentId(postId)) {
    const snaps = extra.length > 0 ? await tx.getAll(...extra) : [];
    return { visible: null, extra: snaps };
  }
  const [postSnap, ...rest] = await tx.getAll(postRef(db, postId), ...extra);
  const post = postOf(postSnap);
  if (!post || !post.artistId) return { visible: null, extra: rest };
  const artist = artistOf(await tx.get(artistRef(db, post.artistId)));
  return { visible: isPostVisible(post, artist) ? { post, artist: artist! } : null, extra: rest };
}
