import type { ActionRewards } from '@/domains/missions';

/**
 * O fã-clube gerido pelo fã (docs/arquitetura-api.md, seção 34). As respostas
 * espelham as do `functions/src/api/contract.ts` (a parte "Fã-clube gerido
 * pelo fã"): mudou um, mude o outro. As datas chegam em ISO.
 */

/** Uma página das listas do fã-clube: `nextCursor` null na última. */
export interface FanClubListPage<T> {
  items: T[];
  nextCursor: string | null;
}

// --- A candidatura e o fã-clube do gestor (etapa 1 de 34.14) ---------------------

/** O status da candidatura. */
export type FanClubApplicationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** O motivo da recusa da candidatura pela equipe (o app mostra um texto fixo por código). */
export type FanClubRejectReason =
  'incomplete' | 'not_fit' | 'artist_limit' | 'image_rights' | 'rules' | 'other';

/** Uma decisão da equipe na candidatura, para as rodadas. */
export interface FanClubApplicationHistoryItem {
  round: number;
  decision: 'approved' | 'rejected';
  reason: FanClubRejectReason | null;
  at: string;
}

/** A candidatura do fã, no `GET /me/fan-club`. */
export interface FanClubApplication {
  status: FanClubApplicationStatus;
  artistId: string;
  artistName: string;
  proposedName: string;
  /** De 1 a 3; 0 depois do encerramento a pedido. */
  round: number;
  submittedAt: string | null;
  rejectReason: FanClubRejectReason | null;
  /** Null sem prazo, também na recusa da 3ª rodada (não há outra). */
  canReapplyAt: string | null;
  /** O fã pode mandar a candidatura de novo agora (false para sempre com o encerramento pela equipe). */
  canApply: boolean;
  history: FanClubApplicationHistoryItem[];
}

/**
 * Por que o fã-clube não aparece para os fãs ou o gestor não publica:
 * pausado, artista fora do ar, fã-clube fechado para o artista, o gestor fora
 * da central e o encerrado (o `closed`, que o código acrescentou, 34.22).
 */
export type FanClubUnavailableReason =
  'paused' | 'artist_off' | 'program_closed' | 'not_member' | 'closed';

export type FanClubStatus = 'active' | 'paused' | 'closed';

/** O último reconhecimento da equipe, sem a nota. */
export interface FanClubLastReward {
  at: string | null;
  points: number | null;
  prize: boolean;
}

/** O fã-clube do gestor, no `GET /me/fan-club`. */
export interface MyFanClubClub {
  id: string;
  name: string;
  artistId: string;
  artistName: string;
  status: FanClubStatus;
  postCount: number;
  pendingPosts: number;
  /** O artista aceita fotos de fãs (a caixa e o fã-clube aberto para o artista). */
  photosAllowed: boolean;
  /** O fim do Destaque (`AAAA-MM-DD`), só dentro do prazo. */
  featuredUntil: string | null;
  lastReward: FanClubLastReward | null;
  available: boolean;
  unavailableReason: FanClubUnavailableReason | null;
  /** O regulamento aceito numa versão velha: o publicar espera o novo aceite. */
  rulesOutdated: boolean;
}

/** `GET /me/fan-club` (e a resposta da candidatura, da desistência e do novo aceite). */
export interface MyFanClub {
  /** O programa aberto (`FAN_CLUB_OPEN`): sem ele e sem candidatura, os Ajustes escondem a linha. */
  open: boolean;
  /** O regulamento; null até ele existir, e o app usa os Termos de Uso. */
  rulesUrl: string | null;
  /** A versão que a candidatura e o novo aceite mandam no `rulesVersion`. */
  rulesVersion: string;
  /** O texto do reconhecimento (`FAN_CLUB_PRIZE_NOTICE`), ou null desligado. */
  notice: string | null;
  application: FanClubApplication | null;
  club: MyFanClubClub | null;
}

/** `GET /me/fan-club/numbers`: só no "Meu fã-clube". */
export interface FanClubNumbers {
  followers: number;
  /** Quem segue agora e seguiu nos últimos 30 dias. */
  followers30d: number;
  links: number;
  /** Uma vez por pessoa e convidante (34.22, etapa 3). */
  visits: number;
  signups: number;
  /** Entradas trazidas para a central oficial (decisão 23). */
  joins: number;
}

/** Uma central do fã que aceita fã-clubes, no `GET /me/fan-club/artists`. */
export interface FanClubArtist {
  artistId: string;
  name: string;
  shortName: string | null;
  thumbUrl: string | null;
  photosAllowed: boolean;
}

export interface FanClubArtists {
  items: FanClubArtist[];
}

/**
 * O corpo do `POST /me/fan-club/application`: as redes com o @ como o fã
 * digitou (o servidor limpa), pelo menos uma; o WhatsApp vai para o contato
 * do fã (decisão 14); o `adult` sempre `true`; e a `rulesVersion` do `MyFanClub`.
 */
export interface FanClubApplicationBody {
  artistId: string;
  name: string;
  instagram: string | null;
  tiktok: string | null;
  whatsapp: string;
  pitch: string;
  adult: true;
  rulesVersion: string;
}

export interface ApplyForFanClubVariables {
  body: FanClubApplicationBody;
  /** A da tentativa: a mesma depois de uma falha incerta, nova depois de uma recusa. */
  idempotencyKey: string;
}

/** Desistir, o novo aceite, retirar e deixar de seguir levam só a chave da tentativa. */
export interface FanClubWriteVariables {
  idempotencyKey: string;
}

export interface AcceptFanClubRulesVariables extends FanClubWriteVariables {
  rulesVersion: string;
}

// --- As publicações (etapa 2 de 34.14) ----------------------------------------------

export type FanClubPostStatus =
  'pending' | 'published' | 'rejected' | 'withdrawn' | 'hidden' | 'removed';

/** O motivo da recusa da publicação pela equipe (o app mostra um texto fixo por código). */
export type FanClubPostRejectReason = 'image_rights' | 'off_topic' | 'quality' | 'rules' | 'other';

/** Uma imagem da publicação: a URL com token e o tamanho lido no arquivo. */
export interface FanClubPostImage {
  url: string;
  width: number;
  height: number;
}

/**
 * A publicação como o gestor vê em "Minhas publicações" (e a resposta do
 * publicar e do retirar). A foto e a miniatura só vêm em análise e no ar.
 */
export interface OwnFanClubPost {
  id: string;
  clubId: string;
  artistId: string;
  kind: 'text' | 'photo';
  text: string;
  photo: FanClubPostImage | null;
  thumb: FanClubPostImage | null;
  status: FanClubPostStatus;
  rejectReason: FanClubPostRejectReason | null;
  submittedAt: string;
  publishedAt: string | null;
  reviewedAt: string | null;
}

/**
 * A vaga de envio da foto (`POST /me/fan-club/upload`, sem corpo): os dois
 * caminhos do Storage que o servidor sorteou (a foto e a miniatura) e o prazo.
 */
export interface FanClubUploadSlot {
  photoPath: string;
  thumbPath: string;
  expiresAt: string;
}

/** O corpo do `POST /me/fan-club/posts`: com `photo`, os arquivos da vaga aberta. */
export interface CreateFanClubPostVariables {
  text: string;
  photo: boolean;
  idempotencyKey: string;
}

export interface RemoveFanClubPostVariables extends FanClubWriteVariables {
  postId: string;
}

/** O gestor, no fã-clube e nas publicações: as cópias do perfil dele. */
export interface FanClubPerson {
  uid: string;
  name: string | null;
  username: string | null;
  photoURL: string | null;
}

/** Uma publicação no ar (a página do fã-clube e a Início). */
export interface FanClubPost {
  id: string;
  clubId: string;
  clubName: string;
  artistId: string;
  author: FanClubPerson;
  kind: 'text' | 'photo';
  text: string;
  photo: FanClubPostImage | null;
  thumb: FanClubPostImage | null;
  publishedAt: string;
}

export interface FanClubPageArtist {
  id: string;
  name: string;
  shortName: string | null;
  thumbUrl: string | null;
}

/** A página pública (`GET /fan-clubs/:clubId`). Nunca prêmio nem pontos (decisão 48). */
export interface FanClubPage {
  id: string;
  name: string;
  artist: FanClubPageArtist;
  owner: FanClubPerson;
  /** O número exato, pelo `count()` de quem segue agora (decisão 28). */
  followerCount: number;
  postCount: number;
  /** O Destaque, com o prazo conferido. */
  featured: boolean;
  isFollowing: boolean;
  isOwner: boolean;
  /** Quem pede é da central oficial do artista. */
  isMember: boolean;
}

/** Um fã-clube na lista do artista (`GET /artists/:artistId/fan-clubs`). */
export interface FanClubCard {
  id: string;
  name: string;
  owner: FanClubPerson;
  /** Os seguidores da cópia da noite (o app arredonda). */
  followers: number;
  featured: boolean;
  postCount: number;
  isFollowing: boolean;
}

/** O motivo da denúncia de uma publicação: os de sempre mais o uso indevido de imagem (decisão 18). */
export type FanClubReportReason = 'spam' | 'offensive' | 'harassment' | 'image_misuse' | 'other';

export interface ReportFanClubPostVariables {
  postId: string;
  /** Null sem motivo. */
  reason: FanClubReportReason | null;
  idempotencyKey: string;
}

export interface ReportFanClubPostResult {
  postId: string;
  status: 'reported' | 'already_reported';
}

// --- Os seguidores (etapa 4 de 34.14) ------------------------------------------------

/**
 * Seguir (`PUT /me/fan-club-follows/:clubId`), com as recompensas da entrada
 * (`ActionRewards`): o `joined` diz se o seguir fez a entrada na central
 * oficial agora (a comemoração da entrada), e o `pointsAwarded`, os pontos
 * dela. Já seguindo: `joined: false` e 0.
 */
export interface FollowFanClubResult extends ActionRewards {
  clubId: string;
  following: true;
  joined: boolean;
  pointsAwarded: number;
}

export interface UnfollowFanClubResult {
  clubId: string;
  following: false;
}

export interface FollowFanClubVariables extends FanClubWriteVariables {
  clubId: string;
}

/**
 * Um fã-clube seguido, em "Fã-clubes que sigo". Indisponível: o nome só
 * quando ele ainda existe e o gestor não está bloqueado, e sem o gestor.
 */
export interface FollowedFanClub {
  id: string;
  name: string | null;
  artistId: string;
  artistName: string;
  owner: FanClubPerson | null;
  followedAt: string;
  available: boolean;
}

/** `GET /me/fan-club-follows`: até 50, do mais novo ao mais antigo. */
export interface FollowedFanClubs {
  items: FollowedFanClub[];
}
