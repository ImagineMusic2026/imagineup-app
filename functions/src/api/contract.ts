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
  /** 0 até o mural (bloco 6). */
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
