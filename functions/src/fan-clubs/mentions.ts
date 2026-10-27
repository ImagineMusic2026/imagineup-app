import { FieldPath, type DocumentReference, type Firestore } from 'firebase-admin/firestore';

import type { MentionSuggestion, MentionSuggestions } from '../api/contract';
import type { ArtistRecord } from '../centrals/model';
import { blockedOf } from '../moderation/model';
import { blockListRef } from '../moderation/store';
import { isContentId } from '../page-cursor';
import {
  conversationSuggestions,
  fanClubCommentRecord,
  fanClubPostNotFound,
  fanClubPostRecord,
  fanClubRefused,
  MENTION_CONVERSATION_COMMENTS,
  MENTION_SEARCH_PROFILE_FIELDS,
  MENTION_SEARCH_READS,
  mentionSearchFanOf,
  reservationTargetOf,
  searchSuggestions,
  type FanClubCommentRecord,
  type FanClubRecord,
  type MentionSearchFan,
} from './model';
import { readVisibleClub } from './posts';
import {
  fanClubCommentRef,
  fanClubCommentsOf,
  fanClubFollowRef,
  fanClubPostRef,
  readMentionedArtists,
  usernamesOf,
} from './store';

// As sugestões do @ (docs/arquitetura-api.md, seção 37, 37.3 e 37.7; a etapa
// 2 de 37.13): `GET /fan-clubs/:clubId/mentions`, em duas chamadas, para não
// pagar a conversa a cada tecla. Sem o `q`, a conversa (o gestor, o artista e
// quem comentou na publicação), que o app guarda enquanto a tela está aberta e
// filtra pelo começo do @; com o `q`, a busca pelo começo do @, só das
// centrais no ar e dos fãs que escolheram o @. Nenhuma das duas diz quem segue
// o fã-clube (R5; decisões 29 de 34.1 e 5 de 36.1), e nenhuma busca pelo nome
// (R6). O resolver das marcações no envio fica no store (as leituras) e no
// model (o puro), porque a publicação do gestor e o comentário usam.

/** A busca das sugestões, já conferida (`?postId=` e `?q=`, os dois opcionais). */
export type MentionsQuery = { postId: string | null; q: string | null };

const profileRef = (db: Firestore, uid: string): DocumentReference =>
  db.collection('users').doc(uid);

/**
 * `GET /fan-clubs/:clubId/mentions` (37.3), fora de transação, nesta ordem: o
 * fã-clube com as condições da página (`readVisibleClub`; senão, 404
 * `fan_club_not_found`), com o vínculo de seguir de quem pede e, com o
 * `postId`, a publicação, lidos junto do artista; com o `postId`, a
 * publicação no ar deste fã-clube (senão, 404 `fan_club_post_not_found`, sem
 * ler os comentários: a conversa nunca lista os autores de outro fã-clube nem
 * os de uma publicação fora do ar); e só para quem pode comentar ali, seguir
 * ou ser o gestor (senão, 409 `not_following`). Sem o `q`, a conversa
 * (`readConversation`); com ele, a busca (`searchMentions`). Até 8.
 */
export async function readMentionSuggestions(
  db: Firestore,
  uid: string,
  clubId: string,
  query: MentionsQuery,
): Promise<MentionSuggestions> {
  const { club, artist, blocked, extra } = await readVisibleClub(db, uid, clubId, (visible) => [
    fanClubFollowRef(db, uid, visible.id),
    ...(query.postId === null ? [] : [fanClubPostRef(db, query.postId)]),
  ]);
  const [follow, postSnap] = extra;
  if (query.postId !== null) {
    const post = postSnap?.exists ? fanClubPostRecord(postSnap.id, postSnap.data() ?? {}) : null;
    if (post === null || post.clubId !== club.id || post.status !== 'published') {
      throw fanClubPostNotFound();
    }
  }
  if (club.ownerUid !== uid && follow?.exists !== true) throw fanClubRefused('not_following');
  const items =
    query.q === null
      ? await readConversation(db, uid, { club, artist, blocked, postId: query.postId })
      : await searchMentions(db, uid, { club, blocked, q: query.q });
  return { items };
}

/**
 * A conversa (37.7, sem o `q`): os últimos 30 comentários da publicação, de
 * cima e respostas (o índice `postId` e `createdAt` decrescente, o da lista
 * do painel), e, num `getAll`, os comentários de cima das respostas que não
 * vieram na consulta, sem repetir (só das respostas visíveis de quem pode
 * entrar na sugestão). Sem a publicação (a nova publicação do gestor, que
 * ainda não tem id), só o gestor e o artista. A ordem e o que fica de fora
 * estão no `conversationSuggestions`.
 */
async function readConversation(
  db: Firestore,
  uid: string,
  input: {
    club: FanClubRecord;
    artist: ArtistRecord;
    blocked: string[];
    postId: string | null;
  },
): Promise<MentionSuggestion[]> {
  const { club, artist, blocked, postId } = input;
  let comments: FanClubCommentRecord[] = [];
  const tops = new Map<string, FanClubCommentRecord>();
  if (postId !== null) {
    const snap = await fanClubCommentsOf(db)
      .where('postId', '==', postId)
      .orderBy('createdAt', 'desc')
      .limit(MENTION_CONVERSATION_COMMENTS)
      .get();
    comments = snap.docs.map((doc) => fanClubCommentRecord(doc.id, doc.data()));
    for (const comment of comments) tops.set(comment.id, comment);
    const skip = new Set([uid, ...blocked]);
    const missing = [
      ...new Set(
        comments
          .filter(
            (comment) =>
              comment.status === 'visible' &&
              comment.replyToId !== null &&
              !tops.has(comment.replyToId) &&
              !skip.has(comment.authorUid),
          )
          .map((comment) => comment.replyToId!),
      ),
    ].filter(isContentId);
    if (missing.length > 0) {
      const snaps = await db.getAll(...missing.map((id) => fanClubCommentRef(db, id)));
      for (const snap of snaps) {
        if (snap.exists) tops.set(snap.id, fanClubCommentRecord(snap.id, snap.data() ?? {}));
      }
    }
  }
  return conversationSuggestions({ uid, club, artist, blocked, comments, tops });
}

/**
 * A busca (37.7, com o `q`): as reservas de `usernames/` pela ordem do id, do
 * `q` ao `q` seguido de ``, até 12, com fãs e centrais juntos; e, de uma
 * vez, um `getAll` dos perfis (com o `select` dos campos que a busca usa), um
 * das listas de bloqueio dos fãs achados (sem quem pede e sem quem ele
 * bloqueou, que ficam de fora sem ler) e um das centrais. Umas 40 leituras por
 * busca, no ritmo de 27.3. O que fica de fora está no `searchSuggestions`.
 */
async function searchMentions(
  db: Firestore,
  uid: string,
  input: { club: FanClubRecord; blocked: string[]; q: string },
): Promise<MentionSuggestion[]> {
  const { club, blocked, q } = input;
  const snap = await usernamesOf(db)
    .orderBy(FieldPath.documentId())
    .startAt(q)
    .endAt(`${q}`)
    .limit(MENTION_SEARCH_READS)
    .get();
  const hits = snap.docs.flatMap((doc) => {
    const target = reservationTargetOf(doc.data());
    return target ? [{ handle: doc.id, target }] : [];
  });
  const skip = new Set([uid, ...blocked]);
  const fanUids = [
    ...new Set(
      hits
        .filter((hit) => hit.target.kind === 'fan' && !skip.has(hit.target.id))
        .map((hit) => hit.target.id),
    ),
  ];
  const artistIds = [
    ...new Set(hits.filter((hit) => hit.target.kind === 'artist').map((hit) => hit.target.id)),
  ];
  const [profiles, lists, artists] = await Promise.all([
    fanUids.length === 0
      ? []
      : db.getAll(...fanUids.map((fanUid) => profileRef(db, fanUid)), {
          fieldMask: [...MENTION_SEARCH_PROFILE_FIELDS],
        }),
    fanUids.length === 0
      ? []
      : db.getAll(...fanUids.map((fanUid) => blockListRef(db, fanUid)), {
          fieldMask: ['blocked'],
        }),
    readMentionedArtists(db, artistIds),
  ]);
  const fans = new Map<string, MentionSearchFan>();
  fanUids.forEach((fanUid, index) => {
    const profile = profiles[index];
    const fan = mentionSearchFanOf(
      profile?.exists ? profile.data() : undefined,
      blockedOf(lists[index]?.get('blocked')),
    );
    if (fan) fans.set(fanUid, fan);
  });
  return searchSuggestions({ uid, club, blocked, hits, fans, artists });
}
