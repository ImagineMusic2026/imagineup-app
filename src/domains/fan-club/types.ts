import type { ActionRewards } from '@/domains/missions';

import type { FanClubReaction } from './consts';

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
  /** Oficializado pela equipe: o selo do fã-clube oficial (34.23). */
  official: boolean;
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
  /** A taxa de engajamento de 30 dias (seção 37, 37.11); só o servidor da Fase 2 manda. */
  engagement?: FanClubEngagement;
}

/**
 * A taxa de engajamento de 30 dias (37.11): as reações novas e os comentários
 * dos fãs nos últimos 30 dias de São Paulo e a soma sobre os seguidores de
 * agora, em porcentagem com uma casa decimal. Sem seguidor, `rate30d` null.
 */
export interface FanClubEngagement {
  reactions30d: number;
  comments30d: number;
  rate30d: number | null;
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
  /** As reações, o total e por emoji (seção 37, 37.3); só o servidor da Fase 2 manda. */
  reactionCount?: number;
  reactionCounts?: FanClubReactionCounts;
  /** Os comentários que aparecem (37.2). */
  commentCount?: number;
  /** As marcações do texto, resolvidas no envio (37.7). */
  mentions?: FanClubMention[];
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
  /** O fã-clube oficializado pela equipe: o selo ao lado do nome (34.23). */
  clubOfficial: boolean;
  artistId: string;
  author: FanClubPerson;
  kind: 'text' | 'photo';
  text: string;
  photo: FanClubPostImage | null;
  thumb: FanClubPostImage | null;
  publishedAt: string;
  /**
   * As reações, o total e por emoji (seção 37, 37.3, R8): a contagem é de
   * todos, e quem reagiu nunca aparece. Só o servidor da Fase 2 manda: o card
   * mostra a reação e os comentários só com o `reactionCount` (37.16).
   */
  reactionCount?: number;
  reactionCounts?: FanClubReactionCounts;
  /** Os comentários que aparecem: os de cima visíveis e as respostas visíveis deles (37.2). */
  commentCount?: number;
  /** A reação de quem pede, ou null. */
  myReaction?: FanClubReaction | null;
  /** As marcações do texto do gestor, resolvidas no envio (37.7). */
  mentions?: FanClubMention[];
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
  /** Oficializado pela equipe: o selo do fã-clube oficial (34.23). */
  official: boolean;
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
  /** Oficializado pela equipe: o selo do fã-clube oficial (34.23). */
  official: boolean;
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
 * O corpo do seguir (`FollowFanClubBody`, seção 37, "Estado"): a versão do
 * aviso "o gestor vê que você é membro" que o botão de seguir mostrou
 * (`FAN_CLUB_MEMBER_NOTICE_VERSION`). O app de antes seguia sem corpo, e o
 * vínculo ficava sem a marca.
 */
export interface FollowFanClubBody {
  memberNoticeVersion?: string;
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
  /** Oficializado pela equipe, só no disponível (34.23). */
  official: boolean;
}

/** `GET /me/fan-club-follows`: até 50, do mais novo ao mais antigo. */
export interface FollowedFanClubs {
  items: FollowedFanClub[];
}

// --- A Fase 2: reações, comentários e menções (seção 37, 37.3) -------------------------

/** As reações de uma publicação por emoji (`reactionCounts`, 37.2). */
export type FanClubReactionCounts = Record<FanClubReaction, number>;

/**
 * Uma marcação resolvida no texto (37.7): o @ como foi escrito, o tipo, o uid
 * do fã ou o id da central e as posições no texto, em unidades UTF-16 (um
 * emoji conta 2). O app confere o trecho antes de ligar o link.
 */
export interface FanClubMention {
  handle: string;
  kind: 'fan' | 'artist';
  id: string;
  start: number;
  end: number;
}

/**
 * A publicação no ar (`GET /fan-club-posts/:postId`): a tela da publicação,
 * com o que ela pede da página (seguir, ser o gestor e ser da central) e o
 * nome do artista.
 */
export interface FanClubPostDetails extends FanClubPost {
  isOwner: boolean;
  isFollowing: boolean;
  isMember: boolean;
  artistName: string;
}

/**
 * Um comentário de publicação de fã-clube. O `isManager` é calculado na
 * leitura (o autor é o gestor de agora). O `hidden` sai só para o autor e
 * para o gestor, e o `review`, só para o autor (o ocultar e o pedido de
 * revisão, 37.6); o `hiddenReplyCount`, só para o gestor no próprio
 * fã-clube.
 */
export interface FanClubComment {
  id: string;
  postId: string;
  clubId: string;
  author: FanClubPerson;
  isManager: boolean;
  text: string;
  mentions: FanClubMention[];
  /** Null no comentário de cima; na resposta, o id do comentário de cima. */
  replyToId: string | null;
  /** No comentário de cima: as respostas visíveis. */
  replyCount: number;
  hiddenReplyCount?: number;
  /** ISO. */
  createdAt: string;
  hidden: 'manager' | null;
  review: 'requested' | 'kept' | null;
}

/**
 * O estado da linha do comentário do fã que ainda não está na lista do
 * servidor (37.9, item 4, no molde do Mural): indo, "Não enviado" (a falha,
 * que o toque tenta de novo) ou "Não publicado" (o texto recusado pelo filtro).
 */
export type FanClubCommentLineStatus = 'pending' | 'failed' | 'refused';

/**
 * Uma linha da lista de comentários da tela da publicação: o comentário do
 * servidor ou a linha local do fã. A linha local tem o `status`, e o
 * comentário que o servidor gravou guarda o `localId` da linha que ele troca,
 * para a mesma linha seguir na tela.
 */
export interface FanClubCommentLine extends FanClubComment {
  localId?: string;
  status?: FanClubCommentLineStatus;
}

/**
 * `GET /fan-club-posts/:postId/comments`: os comentários de cima, do mais
 * novo, ou, com o `replyTo`, as respostas de um deles, da mais antiga. O
 * `ownHidden` vem só na primeira página dos de cima, para quem não é o
 * gestor: os dele ocultos pelo gestor naquela publicação (até 10).
 */
export interface FanClubCommentPage extends FanClubListPage<FanClubComment> {
  ownHidden?: FanClubComment[];
}

/** Comentar (`POST /fan-club-posts/:postId/comments`): o comentário e as recompensas. */
export type AddFanClubCommentResult = FanClubComment & ActionRewards;

/**
 * Reagir e tirar a reação (`PUT` e `DELETE /fan-club-posts/:postId/reaction`):
 * a reação de agora e os contadores depois da gravação, com que o app acerta o
 * otimista.
 */
export interface FanClubReactionResult extends ActionRewards {
  postId: string;
  reaction: FanClubReaction | null;
  reactionCount: number;
  reactionCounts: FanClubReactionCounts;
}

/**
 * Uma sugestão do @ (`GET /fan-clubs/:clubId/mentions`, 37.7): o fã ou a
 * central, com o @ (o da central é o id), o nome e a foto. O `role` é o papel
 * no fã-clube; o `inConversation`, que a pessoa está na conversa da
 * publicação. Nada diz quem segue (R5).
 */
export interface MentionSuggestion {
  kind: 'fan' | 'artist';
  id: string;
  username: string;
  name: string | null;
  photoURL: string | null;
  role: 'manager' | 'artist' | null;
  inConversation: boolean;
}

/** `GET /fan-clubs/:clubId/mentions`: até 8, a conversa primeiro. */
export interface MentionSuggestions {
  items: MentionSuggestion[];
}

/** A denúncia de um comentário (`POST /fan-club-comments/:commentId/report`). */
export interface ReportFanClubCommentResult {
  commentId: string;
  status: 'reported' | 'already_reported';
}

/** O "Pedir revisão" do autor (`POST /fan-club-comments/:commentId/review`). */
export interface FanClubCommentReviewResult {
  commentId: string;
  status: 'requested' | 'already_requested';
}

/** O ocultar e o reexibir do gestor (`PUT` e `DELETE /me/fan-club/hidden-comments/:commentId`). */
export interface FanClubCommentHiddenResult {
  commentId: string;
  hidden: boolean;
}

/** A página dos comentários: os de cima (`replyTo` null) ou as respostas de um deles. */
export interface FanClubCommentsQuery {
  postId: string;
  replyTo: string | null;
  cursor: string | null;
}

/** Tirar a reação: a publicação e a chave do toque. */
export interface ClearFanClubReactionVariables {
  postId: string;
  idempotencyKey: string;
}

/** Reagir com um emoji ou trocar de emoji, cada toque com a chave dele. */
export interface SetFanClubReactionVariables extends ClearFanClubReactionVariables {
  reaction: FanClubReaction;
}

/** Comentar ou responder (`replyToId` do comentário respondido). */
export interface AddFanClubCommentVariables {
  postId: string;
  text: string;
  replyToId: string | null;
  idempotencyKey: string;
}

/** O motivo da denúncia de comentário: os do Mural, sem o de imagem; null sem motivo. */
export type FanClubCommentReportReason = 'spam' | 'offensive' | 'harassment' | 'other';

export interface ReportFanClubCommentVariables {
  commentId: string;
  reason: FanClubCommentReportReason | null;
  idempotencyKey: string;
}

/** O pedido de revisão, o ocultar e o reexibir levam só o comentário e a chave. */
export interface FanClubCommentWriteVariables {
  commentId: string;
  idempotencyKey: string;
}

/** A busca das sugestões: a publicação (sem ela, a nova publicação do gestor) e o começo do @. */
export interface FanClubMentionsQuery {
  clubId: string;
  postId: string | null;
  /** De 2 a 30 de `a-z`, `0-9` e `_`, sem o "@"; null pede a conversa. */
  q: string | null;
}
