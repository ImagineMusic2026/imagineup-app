import type { DocumentReference, DocumentSnapshot, Firestore } from 'firebase-admin/firestore';

import { eventOf, eventRef, rsvpRef } from '../agenda/store';
import { isEventOpen } from '../agenda/model';
import type { DailyMissionResponse, Mission, MissionsResponse } from '../api/contract';
import { artistRecord, isPublished } from '../centrals/model';
import { artistRef, membershipRef } from '../centrals/service';
import type { LoadedConfig } from '../points/config';
import { activeSeason, type WalletState } from '../points/model';
import { visibleSeasonPoints } from '../points/wallet';
import { isPostVisible } from '../posts/model';
import { postLikeRef, postOf, postRef } from '../posts/store';
import {
  dailyMissionOf,
  hidesWhenDone,
  missionsView,
  seasonGoalView,
  visibleCandidates,
  type MissionCandidateView,
  type MissionRecord,
  type TargetFacts,
} from './model';

// As leituras das rotas das missões (bloco 7, 22.2): a carteira do fã já foi
// lida pela rota; aqui, um getAll com os alvos citados e, nas missões abertas
// de alvo único, o estado do fã (curtiu, vai, está na central). Não exige
// perfil: carteira que não existe responde tudo em 0.

type Read = { ref: DocumentReference; use: (snap: DocumentSnapshot) => void };

/**
 * Os fatos dos alvos das missões que podem aparecer, num getAll só: o post e
 * a central dele, o show, a central alvo e, para a aberta de alvo único, o
 * estado do fã.
 */
async function readFacts(
  db: Firestore,
  uid: string,
  candidates: readonly MissionCandidateView[],
  now: number,
): Promise<TargetFacts> {
  const posts = new Map<string, boolean>();
  const events = new Map<string, { open: boolean; title: string; startsAt: number } | null>();
  const artists = new Map<string, boolean>();
  const done = new Set<string>();
  const postSnaps = new Map<string, DocumentSnapshot>();
  const artistSnaps = new Map<string, DocumentSnapshot>();
  const reads: Read[] = [];
  // O mesmo documento citado duas vezes (duas missões no mesmo post) é lido uma vez.
  const add = (ref: DocumentReference, use: (snap: DocumentSnapshot) => void) =>
    reads.push({ ref, use });

  for (const { mission, item } of candidates) {
    const target = mission.target;
    if (target?.postId) {
      add(postRef(db, target.postId), (snap) => postSnaps.set(target.postId!, snap));
      if (target.artistId) {
        add(artistRef(db, target.artistId), (snap) => artistSnaps.set(target.artistId!, snap));
      }
    } else if (target?.eventId) {
      const eventId = target.eventId;
      add(eventRef(db, eventId), (snap) => {
        const event = eventOf(snap);
        events.set(
          eventId,
          event && event.startsAt !== null
            ? { open: isEventOpen(event, now), title: event.title, startsAt: event.startsAt }
            : null,
        );
      });
    } else if (target?.artistId) {
      add(artistRef(db, target.artistId), (snap) => artistSnaps.set(target.artistId!, snap));
    }
    const open = item?.completedAt === null || item?.completedAt === undefined;
    if (open && hidesWhenDone(mission)) {
      const mark = (state: boolean) => {
        if (state) done.add(mission.id);
      };
      if (mission.action === 'like' && target?.postId) {
        add(postLikeRef(db, uid, target.postId), (snap) => mark(snap.get('liked') === true));
      } else if (mission.action === 'rsvp' && target?.eventId) {
        add(rsvpRef(db, uid, target.eventId), (snap) => mark(snap.get('going') === true));
      } else if (mission.action === 'join' && target?.artistId) {
        add(membershipRef(db, uid, target.artistId), (snap) => mark(snap.exists));
      }
    }
  }

  const unique = [...new Map(reads.map((read) => [read.ref.path, read.ref])).values()];
  if (unique.length > 0) {
    const snaps = await db.getAll(...unique);
    const byPath = new Map(unique.map((ref, index) => [ref.path, snaps[index]!]));
    for (const read of reads) read.use(byPath.get(read.ref.path)!);
  }

  for (const [id, snap] of artistSnaps) {
    artists.set(id, isPublished(snap.exists ? artistRecord(id, snap.data() ?? {}) : null));
  }
  for (const [postId, snap] of postSnaps) {
    const post = postOf(snap);
    const artistSnap = post?.artistId ? artistSnaps.get(post.artistId) : undefined;
    const artist =
      post?.artistId && artistSnap?.exists
        ? artistRecord(post.artistId, artistSnap.data() ?? {})
        : null;
    posts.set(postId, isPostVisible(post, artist));
  }
  return { posts, events, artists, done };
}

/** As missões visíveis de agora, na ordem do catálogo (com os fatos lidos). */
async function buildMissions(
  db: Firestore,
  uid: string,
  wallet: WalletState,
  config: LoadedConfig,
  now: number,
  pick: (mission: MissionRecord) => boolean,
): Promise<Mission[]> {
  const candidates = visibleCandidates(config.missions.missions.filter(pick), wallet.missions, now);
  if (candidates.length === 0) return [];
  const facts = await readFacts(db, uid, candidates, now);
  return missionsView({
    candidates,
    facts,
    now,
    breakdown: {
      perVisit: config.points.values.invite_visit,
      perSignup: config.points.values.invite_signup,
    },
  });
}

/**
 * A 1g (`GET /missions`): a meta da temporada e as missões de "Hoje" e "Esta
 * semana", com o progresso do período de agora e o destaque de cada período.
 */
export async function readMissions(
  db: Firestore,
  uid: string,
  wallet: WalletState,
  config: LoadedConfig,
  now: number,
): Promise<MissionsResponse> {
  const missions = await buildMissions(db, uid, wallet, config, now, () => true);
  const season = activeSeason(config.season.season, now);
  return {
    season: seasonGoalView({
      goal: config.missions.seasonGoal,
      season,
      seasonMissions: season && wallet.seasonId === season.id ? wallet.seasonMissions : 0,
      seasonPoints: visibleSeasonPoints(wallet, config),
      goalReachedSeasonId: wallet.goalReached?.seasonId ?? null,
    }),
    missions,
  };
}

/**
 * A missão do dia (`GET /missions/daily`, 1b): a mesma montagem, só com as
 * diárias destacadas; a primeira visível, aberta ou concluída hoje, ou null.
 */
export async function readDailyMission(
  db: Firestore,
  uid: string,
  wallet: WalletState,
  config: LoadedConfig,
  now: number,
): Promise<DailyMissionResponse> {
  const missions = await buildMissions(
    db,
    uid,
    wallet,
    config,
    now,
    (mission) => mission.period === 'daily' && mission.featured,
  );
  return { mission: dailyMissionOf(missions) };
}
