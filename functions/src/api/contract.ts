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
  kind: 'earn' | 'spend' | 'adjust';
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
  /** Só na missão: o título dela quando concluiu, guardado no lançamento (bloco 7). */
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
  /** null até o bloco 8 (posição por central). */
  fanRank: number | null;
  /** Pontos do fã na central, na temporada da configuração. */
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
