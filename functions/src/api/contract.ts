// Tipos das respostas da API, espelho dos types.ts do app
// (src/domains/*/types.ts). Mudou um, mude o outro. Campo novo na resposta é
// sempre opcional para o app: app instalado não pode quebrar.

/** `Wallet` de src/domains/profile/types.ts. */
export type Wallet = {
  /** Saldo para trocar por recompensas; cai no resgate. */
  balance: number;
  /** Pontos de nível, que nunca caem. */
  xp: number;
  /** Pontos da temporada, que contam no ranking. */
  seasonPoints: number;
  /**
   * ISO da última gravação da carteira, ou null sem carteira (bloco 10, 25.2):
   * o app compara com o `statusAt` de uma recusa da loja. Opcional no app.
   */
  updatedAt: string | null;
};

/** `Level` de src/domains/profile/types.ts. */
export type Level = { number: number; name: string; minXp: number };

/** `FanStats` de src/domains/profile/types.ts. */
export type FanStats = { linksCreated: number; peopleBrought: number; seasons: number };

/** `MyProgress` de src/domains/profile/types.ts. */
export type MyProgress = {
  xp: number;
  level: Level;
  /** null no nível máximo. */
  nextLevel: Level | null;
  /** Ganhos dos últimos 7 dias, sem descontar resgates. */
  weekEarned: number;
  stats: FanStats;
};

/** `Page<T>` do app: `nextCursor` null na última página; o cursor é texto opaco. */
export type Page<T> = { items: T[]; nextCursor: string | null };

/** Uma linha do extrato (/me/ledger). O app monta o texto a partir de `source` e `subject` (bloco 7). */
export type LedgerEntry = {
  id: string;
  /** `refund` é a devolução do resgate recusado (bloco 10). */
  kind: 'earn' | 'spend' | 'adjust' | 'refund';
  source: string;
  points: number;
  xpDelta: number;
  seasonDelta: number;
  artistId: string | null;
  centralSeasonDelta: number;
  centralTotalDelta: number;
  subject: { type: string; id: string } | null;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** O `name` da central, em qualquer status; null sem central ou com ela apagada (bloco 7). */
  artistName: string | null;
  /**
   * O título da missão quando concluiu (bloco 7) ou o da recompensa no resgate
   * e na devolução (bloco 10), guardado no lançamento.
   */
  subjectTitle: string | null;
};

// --- Missões e conquistas (bloco 7), espelho de src/domains/missions/types.ts e
// de src/domains/profile/types.ts ------------------------------------------------

/** `MissionAction` do app: `join` é novo no bloco 7. */
export type MissionAction = 'like' | 'comment' | 'rsvp' | 'join' | 'share' | 'invite';

/** `MissionTarget` do app: só as chaves que existem. */
export type MissionTarget = { postId?: string; artistId?: string; eventId?: string };

/** `Mission` do app (`GET /missions` e `GET /missions/daily`, 22.2). */
export type Mission = {
  id: string;
  title: string;
  /** A do catálogo; na concluída que pagou, a paga. */
  rewardPoints: number;
  progress: { current: number; target: number };
  /** ISO: o menor entre o `endsAt` da missão e o fim do período. */
  endsAt: string;
  /** O servidor nunca manda `expired` nem `locked` (a relâmpago fica de fora). */
  status: 'active' | 'completed';
  action: MissionAction;
  target: MissionTarget | null;
  period: 'daily' | 'weekly';
  /** A primeira destacada visível de cada período. */
  featured: boolean;
  /** Só no `share`: os valores do convite da configuração. */
  pointsBreakdown: { perVisit: number; perSignup: number } | null;
  /** ISO, na concluída. */
  completedAt: string | null;
  /** Sempre null (a relâmpago fica de fora). */
  unlockHint: null;
  /** Só no `rsvp` com show alvo. */
  event: { name: string; startsAt: string } | null;
};

/** `SeasonGoal` do app: a meta da temporada da 1g. `metric` é novo (opcional no app). */
export type SeasonGoal = {
  id: string;
  title: string;
  description: string;
  completedCount: number;
  targetCount: number;
  /** ISO: o fim da temporada. */
  endsAt: string;
  metric: 'missions' | 'points';
};

/** `MissionsResponse` do app. */
export type MissionsResponse = { season: SeasonGoal | null; missions: Mission[] };

/** `DailyMissionResponse` do app. */
export type DailyMissionResponse = { mission: Mission | null };

/** `Achievement` do app. */
export type Achievement = {
  id: string;
  title: string;
  icon: string;
  tone: 'action' | 'points' | 'events';
  /** ISO; null bloqueada. */
  unlockedAt: string | null;
};

/** `MyAchievements` do app (`GET /me/achievements`). */
export type MyAchievements = {
  unlockedCount: number;
  totalCount: number;
  highlights: Achievement[];
};

/** Uma missão concluída e paga agora, na resposta da ação. */
export type CompletedMission = {
  id: string;
  title: string;
  rewardPoints: number;
  /** ISO. */
  completedAt: string;
};

/** Uma conquista desbloqueada agora, na resposta da ação. */
export type UnlockedAchievement = { id: string; title: string };

/**
 * As recompensas da ação para quem chama (22.2), nas respostas das rotas que
 * gravam curtir, comentar, "Eu vou", entrar e seguir: os quatro campos vão
 * sempre. Opcionais no app.
 */
export type ActionRewards = {
  completedMissions: CompletedMission[];
  /** O nível novo quando subiu (duas subidas de uma vez mandam o final), senão null. */
  levelUp: Level | null;
  unlockedAchievements: UnlockedAchievement[];
  /**
   * Alguma unidade contou no progresso de quem chama, ou a meta da temporada
   * mudou para ele (os pontos da temporada, na meta por pontos, ou a meta
   * cumprida agora): o app busca as missões de novo.
   */
  missionsChanged: boolean;
};

// --- Centrais (bloco 4), espelho de src/domains/artists/types.ts ---------------

/** `Artist` do app: uma central publicada da lista (1l, busca, chips do ranking). */
export type Artist = {
  id: string;
  name: string;
  /** Miniatura da foto (`thumb.url`); null sem foto. */
  photoURL: string | null;
  /** Membros da central no app. */
  fanCount: number;
  /** Ordem do painel: os primeiros são os destaques da 1l. */
  order: number;
};

/** `FanCentral` do app: uma central de "Suas centrais" (1b, 1e). */
export type FanCentral = {
  artistId: string;
  name: string;
  shortName: string | null;
  photoURL: string | null;
  fanCount: number;
  /**
   * A posição do fã no ranking da central (bloco 8): a do `/me/rank` da
   * central; null sem pontos na temporada mostrada ou fora dos membros.
   */
  fanRank: number | null;
  /** Pontos do fã na central, na temporada mostrada (bloco 8, 23.2). */
  seasonPoints: number;
};

/** `ArtistDetails` do app: a página da central (1d). */
export type ArtistDetails = {
  id: string;
  name: string;
  /** A capa em paisagem do painel, se existir; senão a foto 3:4 (a 1d recorta pelo topo). */
  coverUrl: string | null;
  photoURL: string | null;
  verified: boolean;
  managedByImagine: boolean;
  fanCount: number;
  /** Posts no ar da central, pelo `count()` (bloco 6). */
  postCount: number;
  /** Soma do total de pontos dos fãs na central ("PTS DA CENTRAL"). */
  centralPoints: number;
  isMember: boolean;
};

/** `FollowArtistsResult` do app (`POST /me/artists`). */
export type FollowArtistsResult = {
  /** Todas as centrais publicadas que o fã segue depois da ação, na ordem do /me/centrals. */
  followedArtistIds: string[];
  /** Pontos de entrada pagos agora (campo novo, opcional no app). */
  pointsAwarded: number;
};

/** `JoinCentralResult` do app (`PUT /me/centrals/:artistId`). */
export type JoinCentralResult = { artistId: string; pointsAwarded: number };

/** `LeaveCentralResult` do app (`DELETE /me/centrals/:artistId`). */
export type LeaveCentralResult = { artistId: string };

// --- Convite (bloco 5), espelho de src/domains/invites/types.ts e do MyInvite de
// src/domains/profile/types.ts -------------------------------------------------

/** `MyInvite` do app (`GET /me/invite`). `url` e `linkBase` são novos, opcionais no app. */
export type MyInvite = {
  code: string;
  /** O link do atalho Convidar: `linkBase` mais `/?ref=<code>`. */
  url: string;
  /** Base dos links que o fã compartilha (muda com o domínio, sem build nova). */
  linkBase: string;
  /** `values.invite_visit` da configuração. */
  pointsPerVisit: number;
  /** `values.invite_signup` da configuração. */
  pointsPerSignup: number;
};

/** Os `utm_*` que o app manda: só estes três; os outros são descartados. */
export type InviteUtm = { source?: string; medium?: string; campaign?: string };

/** `InviteClaimBody` do app (`POST /invites/claim`). */
export type InviteClaimBody = {
  code: string;
  via: 'link' | 'code';
  /** Com `via: 'link'`; null com `via: 'code'`. */
  link: { path: string } | null;
  utm?: InviteUtm;
  /** ISO; null com `via: 'code'`. */
  openedAt?: string | null;
};

/** `InviteClaimResult` do app. */
export type InviteClaimResult = { status: 'claimed' | 'already_claimed' };

/** `InviteVisitBody` do app (`POST /invites/visit`). */
export type InviteVisitBody = {
  code: string;
  link: { path: string };
  utm?: InviteUtm;
  openedAt?: string | null;
};

/**
 * `InviteVisitResult` do app: sempre o mesmo corpo, contando ou não (a
 * resposta não diz se a pessoa é dona do código nem se já passou por ele).
 */
export type InviteVisitResult = { status: 'received' };

/** `InviteLinkResult` do app (`PUT /me/invite/links/:linkId`). */
export type InviteLinkResult = { linkId: string; created: boolean };

// --- Mural e agenda (bloco 6), espelho de src/domains/posts/types.ts e
// src/domains/agenda/types.ts -------------------------------------------------

/** `PostKind` do app. */
export type PostKind = 'photo' | 'video' | 'text' | 'event';

/** `PostArtist` do app: a central do post. */
export type PostArtist = {
  id: string;
  name: string;
  verified: boolean;
  /** Miniatura da foto da central (`thumb.url`); null sem foto. */
  photoURL: string | null;
};

/**
 * `PostMedia` do app. Foto e vídeo sempre trazem a mídia, mesmo sem arquivo
 * (as URLs nulas e as medidas padrão): o app decide a miniatura por ela.
 */
export type PostMedia = {
  /** A foto inteira, ou o mp4 do vídeo; null sem arquivo. */
  url: string | null;
  /** A miniatura (da foto ou da capa do vídeo); null sem arquivo. */
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
};

/** `PostEvent` do app: o show do post de show, no ar e não encerrado. */
export type PostEvent = {
  id: string;
  title: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  /** "Aracaju, SE". */
  city: string;
};

/** `Post` do app (`GET /feed`, `GET /artists/:id/posts`, `GET /posts/:id`). */
export type Post = {
  id: string;
  kind: PostKind;
  artist: PostArtist;
  text: string;
  media: PostMedia | null;
  event: PostEvent | null;
  /** A primeira publicação (o "há 2 h" do mural), ISO. */
  createdAt: string;
  /** A cópia das curtidas, com a de quem chama que a cópia ainda não viu (21.6). */
  likeCount: number;
  /** A cópia dos comentários visíveis (no detalhe, com os de quem chama mais novos que ela). */
  commentCount: number;
  likedByMe: boolean;
  /** `values.invite_visit` da configuração; null quando é 0. */
  sharePointsPerVisit: number | null;
};

/** `PostComment` do app, sem `status` e `localId`, que só existem no app. */
export type PostComment = {
  id: string;
  postId: string;
  /** O uid de quem escreveu ("Você", a semente do avatar e o bloqueio). */
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  /** Sempre false neste bloco (a resposta do artista é pergunta, 21.16). */
  authorIsArtist: boolean;
  text: string;
  /** ISO. */
  createdAt: string;
};

/** `PointsAward` do app: o que curtir rendeu. */
export type PointsAward = { pointsAwarded: number };

/** `AddCommentResult` do app: o comentário gravado e o que ele rendeu. */
export type AddCommentResult = PostComment & PointsAward;

/** Motivo da denúncia de um comentário (lista fechada, provisória até a UP-48). */
export type CommentReportReason = 'spam' | 'offensive' | 'harassment' | 'other';

/** Corpo de `POST /posts/:postId/comments/:commentId/report`. */
export type ReportCommentBody = { reason: CommentReportReason | null };

/** Resposta da denúncia: a segunda do mesmo fã não muda nada. */
export type ReportCommentResult = {
  commentId: string;
  status: 'reported' | 'already_reported';
};

/** Resposta de `PUT` e `DELETE /me/blocks/:fanId`. */
export type BlockFanResult = { fanId: string; blocked: boolean };

/** `AgendaArtist` do app. */
export type AgendaArtist = { id: string; name: string };

/** `AgendaEvent` do app: um show da agenda. */
export type AgendaEvent = {
  id: string;
  title: string;
  /** Só as centrais no ar, na ordem do show. */
  artists: AgendaArtist[];
  city: string;
  /** UF. */
  state: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  imageUrl: string | null;
  /** `values.invite_signup` da configuração; null quando é 0. */
  invitePointsPerSignup: number | null;
  /** O local (campo novo, opcional no app; guardado, ainda não mostrado). */
  venue: string | null;
};

/** `AgendaPage` do app: o destaque só na primeira página da agenda geral. */
export type AgendaPage = Page<AgendaEvent> & { featured: AgendaEvent | null };

/** `MyRsvps` do app: os shows abertos em que o fã confirmou presença. */
export type MyRsvps = { eventIds: string[] };

/** `RsvpResult` do app. */
export type RsvpResult = { eventId: string; going: boolean; pointsAwarded: number };

// --- Ranking e temporadas (bloco 8), espelho de src/domains/ranking/types.ts ---

/** `Season` do app: a temporada mostrada (`GET /ranking/season`, 23.2). */
export type Season = {
  id: string;
  /** "São João", lido como "Temporada de São João". */
  name: string;
  /** ISO. */
  startsAt: string;
  /** ISO: o fim de verdade (depois do `endSeason`, o instante do encerramento). */
  endsAt: string;
  status: 'active' | 'ended';
  /** O título do 1º lugar; null usa o "Líder da temporada" do app. */
  leaderTitle: string | null;
};

/** `LeaderboardEntry` do app: uma linha do ranking. */
export type LeaderboardEntry = {
  position: number;
  userId: string;
  displayName: string | null;
  photoURL: string | null;
  city: string | null;
  /** Os pontos da temporada no recorte. */
  points: number;
  /** Posições ganhas (positivo) ou perdidas desde o retrato da semana; 0 sem retrato. */
  change: number;
  isMe: boolean;
};

/** `LeaderboardPage` do app (`GET /ranking`). */
export type LeaderboardPage = Page<LeaderboardEntry>;

/** `RankTarget` do app: a próxima meta do fã. */
export type RankTarget = { kind: 'top' | 'position'; position: number; pointsLeft: number };

/** `MyRank` do app (`GET /me/rank`). */
export type MyRank = {
  /** null sem pontos no recorte (ou fora dos membros, na central). */
  position: number | null;
  points: number;
  /** null sem posição, no 1º lugar e na temporada encerrada. */
  target: RankTarget | null;
  /** Só no recorte de central da temporada lida ao vivo: o fã é membro? (campo novo, opcional no app). */
  member?: boolean;
};

// --- Perfil editável (bloco 9), espelho de src/domains/profile/types.ts ---

/**
 * `UsernameStatus` do app: livre, o @ de agora (também o automático), de outro
 * fã ou de uma central, fora do formato, ou reservado (inclusive o padrão do
 * automático, que só o gerador cria).
 */
export type UsernameStatus = 'available' | 'current' | 'taken' | 'invalid' | 'reserved';

/** `UsernameAvailability` do app (`GET /me/username/availability`): o @ normalizado. */
export type UsernameAvailability = { username: string; status: UsernameStatus };

/** `UsernameChange` do app (`PUT /me/username`): datas ISO, null se o fã nunca trocou. */
export type UsernameChange = {
  username: string;
  changedAt: string | null;
  changeableAt: string | null;
};

/** `PhotoChange` do app (`PUT` e `DELETE /me/photo`): a URL de download com token, ou null. */
export type PhotoChange = { photoURL: string | null };

// --- Loja e resgate (bloco 10), espelho de src/domains/rewards/types.ts ---

/** `RewardKind` do app: decide o ícone e a cor do quadro. */
export type RewardKind = 'ticket' | 'videocall' | 'merch' | 'screen' | 'meet';

/** `RewardStatus` do app: `soldOut` na encerrada, sem vaga ou com o show fechado. */
export type RewardStatus = 'available' | 'soldOut';

/** `RewardStock` do app: o total oferecido e o que sobra (nunca negativo). */
export type RewardStock = { remaining: number; total: number };

/** `RewardEvent` do app: o show aberto da recompensa, montado na hora. */
export type RewardEvent = { name: string; startsAt: string };

/** `RedemptionStatus` do app: o `canceled` nunca chega ao fã (o pedido cancelado não tem uid). */
export type RedemptionStatus = 'requested' | 'approved' | 'delivered' | 'refused';

/** `RewardRedemption` do app: um pedido do fã nesta recompensa (25.2). */
export type RewardRedemption = {
  /** O mesmo valor do `code`: a chave da lista no app. */
  id: string;
  code: string;
  status: RedemptionStatus;
  /** ISO: o instante do status de agora. */
  statusAt: string;
  /** O que o pedido gastou. */
  points: number;
  /** O que a recusa devolveu de fato; 0 fora do recusado. */
  refundedPoints: number;
  /** As da recompensa de agora no pedido aberto; a cópia da hora do resgate no fechado. */
  instructions: string;
  /** Só no recusado: o texto da equipe, ou null. */
  refusalReason: string | null;
  /** ISO. */
  redeemedAt: string;
};

/** `Reward` do app (`GET /rewards`, 25.2). */
export type Reward = {
  id: string;
  kind: RewardKind;
  title: string;
  subtitle: string;
  description: string | null;
  cost: number;
  imageUrl: string | null;
  featured: boolean;
  scarcity: boolean;
  stock: RewardStock | null;
  event: RewardEvent | null;
  status: RewardStatus;
  /** O limite de pedidos por fã, ou null sem limite (campo novo, opcional no app). */
  perFanLimit: number | null;
  /** O fã já tem o limite de pedidos que contam (só para mostrar; campo novo). */
  limitReached: boolean;
  /** Os pedidos do fã, do mais novo ao mais antigo. */
  redemptions: RewardRedemption[];
};

/** `RewardsResponse` do app: a loja na ordem do painel e o endereço do regulamento. */
export type RewardsResponse = { rulesUrl: string | null; rewards: Reward[] };

/** `RedeemResult` do app (`POST /rewards/:rewardId/redeem`): o pedido nasce `requested`. */
export type RedeemResult = {
  redemptionId: string;
  rewardId: string;
  code: string;
  balance: number;
  instructions: string;
  /** ISO. */
  redeemedAt: string;
  status: 'requested';
};
