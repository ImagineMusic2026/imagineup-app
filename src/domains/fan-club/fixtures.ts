import { addDays, format } from 'date-fns';

// As centrais pelo arquivo, fora do index, como as outras fixtures: o seguir
// que faz a entrada passa pelo `followFixture` delas (a regra de coerência da
// seção 13: a entrada paga uma vez, pelo `earnFixturePoints`).
import { buildArtistsFixture, followFixture } from '@/domains/artists/fixtures';
import { ApiError, type ApiErrorDetails } from '@/services/api/errors';
import {
  fixtureBlocks,
  fixtureContact,
  fixtureMembership,
  fixtureNow,
  onFixtureSessionEnd,
} from '@/services/fixtures';
import { parseWhatsapp } from '@/utils/whatsapp';

import {
  FAN_CLUB_ERROR_CODES,
  FAN_CLUB_FOLLOWS_MAX,
  FAN_CLUB_NAME_MAX,
  FAN_CLUB_NAME_MIN,
  FAN_CLUB_PENDING_MAX,
  FAN_CLUB_PITCH_MAX,
  FAN_CLUB_PITCH_MIN,
  FAN_CLUB_POST_TEXT_MAX,
  FAN_CLUB_ROUNDS_MAX,
  type FanClubInvalidField,
  type FanClubInvalidReason,
  type FanClubRefusal,
} from './consts';
import type {
  FanClubApplication,
  FanClubApplicationBody,
  FanClubApplicationHistoryItem,
  FanClubApplicationStatus,
  FanClubArtists,
  FanClubCard,
  FanClubLastReward,
  FanClubListPage,
  FanClubNumbers,
  FanClubPage,
  FanClubPerson,
  FanClubPost,
  FanClubPostRejectReason,
  FanClubPostStatus,
  FanClubRejectReason,
  FanClubReportReason,
  FanClubStatus,
  FanClubUploadSlot,
  FollowedFanClubs,
  FollowFanClubResult,
  MyFanClub,
  MyFanClubClub,
  OwnFanClubPost,
  ReportFanClubPostResult,
  UnfollowFanClubResult,
} from './types';

/**
 * O fã-clube nas builds sem API (seção 34, 34.9 e 34.12): o retrato do seed
 * dos emuladores, com a Camila como a fã logada. Ela é a gestora aprovada do
 * "Netto de Coração" (duas publicações no ar e uma em análise, os dois
 * seguidores do seed, o link que ela compartilhou e o prêmio de 200 pontos);
 * segue o fã-clube de outra fã no Nenho; e não segue o de um fã na central do
 * Rock Salles, da qual ela não é membro: seguir esse faz a entrada junto, pelo
 * `followFixture` das centrais. Fica em memória e volta ao retrato quando a
 * sessão termina (`resetFixtureSession`). Os valores são de exemplo; os reais
 * vêm da API.
 *
 * As publicações de exemplo são só texto: o contrato pede a URL da foto, e as
 * fixtures não guardam arquivo (a primeira do seed tem a foto de teste). A
 * publicação com foto feita nesta sessão nasce com o `kind` `photo` e sem a
 * imagem. O prêmio da loja e a linha "Prêmio do fã-clube" do extrato chegam
 * com a etapa 8 de 34.14, junto dos tipos deles (34.22).
 */

/** O fã que pede, como o `ME_ID` do ranking de exemplo: a Camila do protótipo. */
export const FIXTURE_FAN_ID = 'me';

/** A versão das regras aceita na candidatura: a dos Termos de Uso, como o servidor (decisão 8). */
export const FIXTURE_RULES_VERSION = 'termos-2026-10';

/** O texto do reconhecimento, o mesmo `FAN_CLUB_PRIZE_NOTICE` do servidor (decisão 47). */
export const FIXTURE_PRIZE_NOTICE =
  'A equipe pode reconhecer os fã-clubes com pontos e prêmios, como ingressos, descontos, ' +
  'produtos e encontros, a critério da equipe, sem inscrição, ranking, prazo nem prêmio ' +
  'garantido. A Apple não patrocina nem participa deste reconhecimento.';

/** O fã-clube da Camila, o mesmo nome do seed (`SEED_CAMILA_FAN_CLUB`). */
export const OWN_CLUB_ID = 'fc-netto-de-coracao';
/** O fã-clube que a Camila segue, de outra fã, na central do Nenho (só texto, como no seed). */
export const FOLLOWED_CLUB_ID = 'fc-nenho-sempre';
/** O fã-clube de um fã na central do Rock Salles, da qual a Camila não é membro. */
export const OTHER_CLUB_ID = 'fc-rock-salles-raiz';

const CAMILA: FanClubPerson = {
  uid: FIXTURE_FAN_ID,
  name: 'Camila Ribeiro',
  username: 'camilarib',
  photoURL: null,
};
// Gente do ranking de exemplo, com o @ que o cadastro dá ao nome
// (`fixtureUsername` do perfil): o toque no gestor abre o perfil público dela.
const THALITA: FanClubPerson = {
  uid: 'fa-rank-01',
  name: 'Thalita Santos',
  username: 'thalitasan',
  photoURL: null,
};
const DAVI: FanClubPerson = {
  uid: 'fa-rank-02',
  name: 'Davi Lima',
  username: 'davilim',
  photoURL: null,
};

/** As centrais que não aceitam fotos de fãs, como o seed (`SEED_TEXT_ONLY_ARTIST`). */
const TEXT_ONLY_ARTISTS: ReadonlySet<string> = new Set(['nenho']);

/** Por página, como o servidor: as publicações e "Minhas publicações" de 10, os fã-clubes do artista de 20. */
const POSTS_PAGE = 10;
const ARTIST_CLUBS_PAGE = 20;
/** A Início lê os 20 vínculos mais novos (`FAN_CLUB_FEED_FOLLOWS`). */
const FEED_FOLLOWS = 20;
/** O prazo da vaga de envio da foto (10 min). */
const UPLOAD_SLOT_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Um instante de exemplo: horas antes do relógio das fixtures, ou um instante desta sessão. */
type When = { hoursAgo: number } | { at: string };

const isoOf = (when: When, now: Date): string =>
  'at' in when ? when.at : new Date(now.getTime() - when.hoursAgo * HOUR_MS).toISOString();

interface ClubRecord {
  id: string;
  name: string;
  artistId: string;
  artistName: string;
  owner: FanClubPerson;
  status: FanClubStatus;
  /** O fim do Destaque em dias a partir de hoje, ou null. */
  featuredDays: number | null;
  /** Quem segue além da Camila (a página conta ela junto quando segue). */
  followers: number;
  followers30d: number;
  links: number;
  visits: number;
  signups: number;
  joins: number;
  lastReward: { daysAgo: number; points: number | null; prize: boolean } | null;
}

interface PostRecord {
  id: string;
  clubId: string;
  authorUid: string;
  kind: 'text' | 'photo';
  text: string;
  status: FanClubPostStatus;
  rejectReason: FanClubPostRejectReason | null;
  submitted: When;
  published: When | null;
  reviewed: When | null;
}

interface ApplicationRecord {
  status: FanClubApplicationStatus;
  artistId: string;
  artistName: string;
  proposedName: string;
  round: number;
  submitted: When;
  rejectReason: FanClubRejectReason | null;
  canReapplyAt: string | null;
  closedByStaff: boolean;
  clubId: string | null;
  rulesVersion: string;
  history: {
    round: number;
    decision: 'approved' | 'rejected';
    reason: FanClubRejectReason | null;
    at: When;
  }[];
}

const INITIAL_CLUBS: readonly ClubRecord[] = [
  {
    id: OWN_CLUB_ID,
    name: 'Netto de Coração',
    artistId: 'nettobrito',
    artistName: 'Netto Brito',
    owner: CAMILA,
    status: 'active',
    featuredDays: null,
    // A Bia e a conta do ranking que entrou junto (as duas entradas trazidas)
    // e o link do fã-clube que a Camila compartilhou, como no seed.
    followers: 2,
    followers30d: 2,
    links: 1,
    visits: 0,
    signups: 0,
    joins: 2,
    lastReward: { daysAgo: 2, points: 200, prize: true },
  },
  {
    id: FOLLOWED_CLUB_ID,
    name: 'Nenho Sempre',
    artistId: 'nenho',
    artistName: 'Nenho',
    owner: THALITA,
    status: 'active',
    featuredDays: 12,
    followers: 41,
    followers30d: 9,
    links: 6,
    visits: 18,
    signups: 3,
    joins: 5,
    lastReward: null,
  },
  {
    id: OTHER_CLUB_ID,
    name: 'Rock Salles Raiz',
    artistId: 'rocksalles',
    artistName: 'Rock Salles',
    owner: DAVI,
    status: 'active',
    featuredDays: null,
    followers: 12,
    followers30d: 4,
    links: 2,
    visits: 5,
    signups: 1,
    joins: 2,
    lastReward: null,
  },
];

const INITIAL_POSTS: readonly PostRecord[] = [
  {
    id: 'fcp-netto-ensaio',
    clubId: OWN_CLUB_ID,
    authorUid: FIXTURE_FAN_ID,
    kind: 'text',
    text: 'O ensaio de hoje foi lindo! Quem vem com a gente no show de sábado em Irará?',
    status: 'published',
    rejectReason: null,
    submitted: { hoursAgo: 52 },
    published: { hoursAgo: 30 },
    reviewed: { hoursAgo: 30 },
  },
  {
    id: 'fcp-netto-clipe',
    clubId: OWN_CLUB_ID,
    authorUid: FIXTURE_FAN_ID,
    kind: 'text',
    text: 'Contagem regressiva para o lançamento do clipe novo: faltam 3 dias. Bora assistir juntos!',
    status: 'published',
    rejectReason: null,
    submitted: { hoursAgo: 9 },
    published: { hoursAgo: 6 },
    reviewed: { hoursAgo: 6 },
  },
  {
    id: 'fcp-netto-faixa',
    clubId: OWN_CLUB_ID,
    authorUid: FIXTURE_FAN_ID,
    kind: 'text',
    text: 'Fizemos uma faixa para o próximo show. Quem quer ajudar a pintar no domingo?',
    status: 'pending',
    rejectReason: null,
    submitted: { hoursAgo: 2 },
    published: null,
    reviewed: null,
  },
  {
    id: 'fcp-nenho-feira',
    clubId: FOLLOWED_CLUB_ID,
    authorUid: THALITA.uid,
    kind: 'text',
    text: 'Quem vai no show do Nenho em Feira de Santana? Vamos juntos, o ponto de encontro é na entrada.',
    status: 'published',
    rejectReason: null,
    submitted: { hoursAgo: 26 },
    published: { hoursAgo: 20 },
    reviewed: { hoursAgo: 20 },
  },
  {
    id: 'fcp-nenho-musica',
    clubId: FOLLOWED_CLUB_ID,
    authorUid: THALITA.uid,
    kind: 'text',
    text: 'Qual música do Nenho não pode faltar no show? Responde aqui que eu levo a lista para a turma.',
    status: 'published',
    rejectReason: null,
    submitted: { hoursAgo: 75 },
    published: { hoursAgo: 72 },
    reviewed: { hoursAgo: 72 },
  },
  {
    id: 'fcp-rock-encontro',
    clubId: OTHER_CLUB_ID,
    authorUid: DAVI.uid,
    kind: 'text',
    text: 'Sigam o fã-clube para saber dos encontros antes dos shows do Rock Salles.',
    status: 'published',
    rejectReason: null,
    submitted: { hoursAgo: 50 },
    published: { hoursAgo: 48 },
    reviewed: { hoursAgo: 48 },
  },
];

/** A candidatura da Camila: aprovada na primeira rodada, como no seed. */
function initialApplication(): ApplicationRecord {
  return {
    status: 'approved',
    artistId: 'nettobrito',
    artistName: 'Netto Brito',
    proposedName: 'Netto de Coração',
    round: 1,
    submitted: { hoursAgo: 20 * 24 },
    rejectReason: null,
    canReapplyAt: null,
    closedByStaff: false,
    clubId: OWN_CLUB_ID,
    rulesVersion: FIXTURE_RULES_VERSION,
    history: [{ round: 1, decision: 'approved', reason: null, at: { hoursAgo: 19 * 24 } }],
  };
}

/** O seguir da Camila: o fã-clube do Nenho, há 5 dias. */
const INITIAL_FOLLOWS: readonly [string, When][] = [[FOLLOWED_CLUB_ID, { hoursAgo: 5 * 24 }]];

let application: ApplicationRecord | null = initialApplication();
let clubs: ClubRecord[] = INITIAL_CLUBS.map((club) => ({ ...club }));
let posts: PostRecord[] = INITIAL_POSTS.map((post) => ({ ...post }));
let followed = new Map<string, When>(INITIAL_FOLLOWS);
let reports = new Set<string>();
let slot: { photoPath: string; thumbPath: string; expiresAt: number } | null = null;
// A chave de idempotência já vista e o que ela devolveu, como o servidor.
let answers = new Map<string, unknown>();
let serial = 0;

/** Uma cópia da resposta guardada (só dados do JSON), para a tela não mexer na de dentro. */
const copyOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A mesma chave de novo devolve a resposta da primeira vez, sem gravar; a recusa não fica guardada. */
function once<T>(idempotencyKey: string, run: () => T): T {
  if (answers.has(idempotencyKey)) return copyOf(answers.get(idempotencyKey) as T);
  const result = run();
  answers.set(idempotencyKey, copyOf(result));
  return result;
}

function invalid(field: FanClubInvalidField, reason: FanClubInvalidReason = 'format'): never {
  throw new ApiError('validation', 'Campo fora do formato.', 400, FAN_CLUB_ERROR_CODES.invalid, {
    field,
    reason,
  });
}

function refused(reason: FanClubRefusal, extra: ApiErrorDetails = {}): never {
  throw new ApiError(
    'validation',
    'Isso não pode ser feito no fã-clube agora.',
    409,
    FAN_CLUB_ERROR_CODES.refused,
    { reason, ...extra },
  );
}

function clubNotFound(): never {
  throw new ApiError(
    'notFound',
    'Este fã-clube não está disponível.',
    404,
    FAN_CLUB_ERROR_CODES.notFound,
  );
}

function postNotFound(): never {
  throw new ApiError(
    'notFound',
    'Publicação não encontrada.',
    404,
    FAN_CLUB_ERROR_CODES.postNotFound,
  );
}

/** Os artistas de exemplo pelo id (o nome e a ordem). */
function artistOf(artistId: string) {
  return buildArtistsFixture().find((artist) => artist.id === artistId) ?? null;
}

/** O fim do Destaque (`AAAA-MM-DD`), ou null sem destaque. */
function featuredUntilOf(club: ClubRecord, now: Date): string | null {
  return club.featuredDays === null ? null : format(addDays(now, club.featuredDays), 'yyyy-MM-dd');
}

/** O fã-clube aparece para os fãs: ativo, do artista de exemplo, de gestor que a Camila não bloqueou. */
function isShown(club: ClubRecord): boolean {
  return (
    club.status === 'active' &&
    artistOf(club.artistId) !== null &&
    !fixtureBlocks.has(club.owner.uid)
  );
}

const followerCount = (club: ClubRecord): number =>
  club.followers + (followed.has(club.id) ? 1 : 0);

const pageOf = <T>(
  items: readonly T[],
  cursor: string | null,
  size: number,
): FanClubListPage<T> => {
  const start = cursor === null ? 0 : Math.max(0, Number.parseInt(cursor, 10) || 0);
  const end = start + size;
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
};

/** O fã-clube da candidatura aprovada da Camila, em qualquer status. */
function ownClub(): ClubRecord | null {
  if (application?.status !== 'approved' || application.clubId === null) return null;
  return clubs.find((club) => club.id === application?.clubId) ?? null;
}

/** Pode mandar a candidatura de novo, na ordem do `applicationTurn` do servidor. */
function turnOf(
  previous: ApplicationRecord | null,
  now: Date,
): { refusal: FanClubRefusal; extra?: ApiErrorDetails } | { round: number } {
  if (previous === null) return { round: 1 };
  if (previous.closedByStaff) return { refusal: 'not_allowed' };
  if (previous.status === 'pending') return { refusal: 'already_applied' };
  const club = ownClub();
  if (previous.status === 'approved' && club && club.status !== 'closed')
    return { refusal: 'has_fan_club' };
  if (previous.canReapplyAt !== null && Date.parse(previous.canReapplyAt) > now.getTime()) {
    return { refusal: 'cooldown', extra: { canReapplyAt: previous.canReapplyAt } };
  }
  const round = previous.status === 'withdrawn' ? Math.max(previous.round, 1) : previous.round + 1;
  if (round > FAN_CLUB_ROUNDS_MAX) return { refusal: 'too_many_rounds' };
  return { round };
}

function applicationView(record: ApplicationRecord, now: Date): FanClubApplication {
  const history: FanClubApplicationHistoryItem[] = record.history.map((item) => ({
    round: item.round,
    decision: item.decision,
    reason: item.reason,
    at: isoOf(item.at, now),
  }));
  return {
    status: record.status,
    artistId: record.artistId,
    artistName: record.artistName,
    proposedName: record.proposedName,
    round: record.round,
    submittedAt: isoOf(record.submitted, now),
    rejectReason: record.status === 'rejected' ? record.rejectReason : null,
    canReapplyAt: record.canReapplyAt,
    canApply: 'round' in turnOf(record, now),
    history,
  };
}

function lastRewardOf(club: ClubRecord, now: Date): FanClubLastReward | null {
  if (!club.lastReward) return null;
  const { daysAgo, points, prize } = club.lastReward;
  return { at: new Date(now.getTime() - daysAgo * DAY_MS).toISOString(), points, prize };
}

function clubView(club: ClubRecord, record: ApplicationRecord, now: Date): MyFanClubClub {
  let unavailableReason: MyFanClubClub['unavailableReason'] = null;
  if (club.status === 'closed') unavailableReason = 'closed';
  else if (club.status === 'paused') unavailableReason = 'paused';
  else if (artistOf(club.artistId) === null) unavailableReason = 'artist_off';
  else if (!fixtureMembership.isMember(club.artistId)) unavailableReason = 'not_member';
  const mine = posts.filter((post) => post.clubId === club.id);
  return {
    id: club.id,
    name: club.name,
    artistId: club.artistId,
    artistName: club.artistName,
    status: club.status,
    postCount: mine.filter((post) => post.status === 'published').length,
    pendingPosts: mine.filter((post) => post.status === 'pending').length,
    photosAllowed: !TEXT_ONLY_ARTISTS.has(club.artistId),
    featuredUntil: club.status === 'active' ? featuredUntilOf(club, now) : null,
    lastReward: lastRewardOf(club, now),
    available: unavailableReason === null,
    unavailableReason,
    rulesOutdated: record.rulesVersion !== FIXTURE_RULES_VERSION,
  };
}

function myFanClub(now: Date): MyFanClub {
  const program = {
    open: true,
    rulesUrl: null,
    rulesVersion: FIXTURE_RULES_VERSION,
    notice: FIXTURE_PRIZE_NOTICE,
  };
  if (application === null) return { ...program, application: null, club: null };
  const club = ownClub();
  return {
    ...program,
    application: applicationView(application, now),
    club: club ? clubView(club, application, now) : null,
  };
}

/** O fã-clube da Camila em que ela pode publicar, ou a recusa do servidor, na ordem de 34.5. */
function publishableClub(photo: boolean): ClubRecord {
  const club = ownClub();
  if (!club || club.status !== 'active') refused('club_not_active');
  if (!fixtureMembership.isMember(club.artistId)) refused('not_member');
  if (artistOf(club.artistId) === null) refused('artist_closed');
  if (photo && TEXT_ONLY_ARTISTS.has(club.artistId)) refused('photos_not_allowed');
  if (application && application.rulesVersion !== FIXTURE_RULES_VERSION) refused('rules_outdated');
  const pending = posts.filter((post) => post.clubId === club.id && post.status === 'pending');
  if (pending.length >= FAN_CLUB_PENDING_MAX) refused('too_many_pending');
  return club;
}

function ownPostView(post: PostRecord, now: Date): OwnFanClubPost {
  return {
    id: post.id,
    clubId: post.clubId,
    artistId: clubs.find((club) => club.id === post.clubId)?.artistId ?? '',
    kind: post.kind,
    text: post.text,
    photo: null,
    thumb: null,
    status: post.status,
    rejectReason: post.rejectReason,
    submittedAt: isoOf(post.submitted, now),
    publishedAt: post.published ? isoOf(post.published, now) : null,
    reviewedAt: post.reviewed ? isoOf(post.reviewed, now) : null,
  };
}

function postView(post: PostRecord, club: ClubRecord, now: Date): FanClubPost {
  return {
    id: post.id,
    clubId: club.id,
    clubName: club.name,
    artistId: club.artistId,
    author: club.owner,
    kind: post.kind,
    text: post.text,
    photo: null,
    thumb: null,
    publishedAt: isoOf(post.published ?? post.submitted, now),
  };
}

/** As publicações no ar, da mais nova para a mais antiga. */
function publishedOf(clubIds: ReadonlySet<string>, now: Date): FanClubPost[] {
  return posts
    .filter((post) => clubIds.has(post.clubId) && post.status === 'published')
    .map((post) =>
      postView(
        post,
        clubs.find((club) => club.id === post.clubId)!,
        now,
      ),
    )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
}

/** O nome limpo como o servidor: sem espaço nas pontas e sem "oficial" (a palavra inteira, sem acento). */
function checkName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < FAN_CLUB_NAME_MIN || name.length > FAN_CLUB_NAME_MAX) invalid('name');
  const plain = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/(^|[^a-z0-9])oficial([^a-z0-9]|$)/.test(plain)) invalid('name', 'official');
  return name;
}

/**
 * O "servidor" do fã-clube nas fixtures: as leituras e as gravações das rotas
 * de 34.3, com as recusas na ordem de 34.5, para as telas mostrarem cada
 * estado sem a API. O filtro do que o fã publica (seção 30) fica no servidor.
 */
export const fanClubFixture = {
  mine(now: Date = fixtureNow()): MyFanClub {
    return myFanClub(now);
  },

  numbers(): FanClubNumbers {
    const club = ownClub();
    if (!club) clubNotFound();
    return {
      followers: followerCount(club),
      followers30d: club.followers30d,
      links: club.links,
      visits: club.visits,
      signups: club.signups,
      joins: club.joins,
    };
  },

  /** As centrais da Camila que aceitam fã-clubes, na ordem de destaque. */
  artists(): FanClubArtists {
    const items = buildArtistsFixture()
      .filter((artist) => fixtureMembership.isMember(artist.id))
      .map((artist) => ({
        artistId: artist.id,
        name: artist.name,
        shortName: null,
        thumbUrl: artist.photoURL,
        photosAllowed: !TEXT_ONLY_ARTISTS.has(artist.id),
      }));
    return { items };
  },

  apply(body: FanClubApplicationBody, idempotencyKey: string, now: Date = fixtureNow()): MyFanClub {
    return once(idempotencyKey, () => {
      const name = checkName(body.name);
      const pitch = body.pitch.trim();
      if (pitch.length < FAN_CLUB_PITCH_MIN || pitch.length > FAN_CLUB_PITCH_MAX) invalid('pitch');
      if (!body.instagram?.trim() && !body.tiktok?.trim()) invalid('socials');
      const whatsapp = parseWhatsapp(body.whatsapp);
      if (whatsapp === null) invalid('whatsapp');
      if (body.adult !== true) invalid('adult');
      if (body.rulesVersion !== FIXTURE_RULES_VERSION) invalid('rulesVersion');
      if (!fixtureMembership.isMember(body.artistId)) refused('not_member');
      const artist = artistOf(body.artistId);
      if (artist === null) refused('artist_closed');
      const turn = turnOf(application, now);
      if ('refusal' in turn) refused(turn.refusal, turn.extra);
      application = {
        status: 'pending',
        artistId: artist.id,
        artistName: artist.name,
        proposedName: name,
        round: turn.round,
        submitted: { at: now.toISOString() },
        rejectReason: null,
        canReapplyAt: null,
        closedByStaff: false,
        clubId: null,
        rulesVersion: FIXTURE_RULES_VERSION,
        history: application?.history ?? [],
      };
      fixtureContact.set(whatsapp);
      return myFanClub(now);
    });
  },

  /** Desiste da pendente; sem ela, o estado de agora, sem gravar. */
  withdraw(idempotencyKey: string, now: Date = fixtureNow()): MyFanClub {
    return once(idempotencyKey, () => {
      if (application?.status === 'pending') application = { ...application, status: 'withdrawn' };
      return myFanClub(now);
    });
  },

  acceptRules(rulesVersion: string, idempotencyKey: string, now: Date = fixtureNow()): MyFanClub {
    return once(idempotencyKey, () => {
      if (rulesVersion !== FIXTURE_RULES_VERSION) invalid('rulesVersion');
      const club = ownClub();
      if (!club || club.status === 'closed' || !application) refused('club_not_active');
      application = { ...application, rulesVersion };
      return myFanClub(now);
    });
  },

  /** "Minhas publicações": em todos os status, da mais nova. */
  myPosts(cursor: string | null, now: Date = fixtureNow()): FanClubListPage<OwnFanClubPost> {
    const mine = posts
      .filter((post) => post.authorUid === FIXTURE_FAN_ID)
      .map((post) => ownPostView(post, now))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.id.localeCompare(a.id));
    return pageOf(mine, cursor, POSTS_PAGE);
  },

  /** A vaga da foto: o mesmo que publicar com foto pede, antes de abrir. */
  openUpload(idempotencyKey: string, now: Date = fixtureNow()): FanClubUploadSlot {
    return once(idempotencyKey, () => {
      publishableClub(true);
      serial += 1;
      const id = `fixture-${serial}`;
      slot = {
        photoPath: `fanClubMedia/${FIXTURE_FAN_ID}/club-photo-${id}.jpg`,
        thumbPath: `fanClubMedia/${FIXTURE_FAN_ID}/club-thumb-${id}.jpg`,
        expiresAt: now.getTime() + UPLOAD_SLOT_MS,
      };
      return {
        photoPath: slot.photoPath,
        thumbPath: slot.thumbPath,
        expiresAt: new Date(slot.expiresAt).toISOString(),
      };
    });
  },

  /** Publicar: sempre em análise (decisão 16); com foto, a vaga aberta, que sai. */
  createPost(
    input: { text: string; photo: boolean },
    idempotencyKey: string,
    now: Date = fixtureNow(),
  ): OwnFanClubPost {
    return once(idempotencyKey, () => {
      const text = input.text.trim();
      if (text.length < 1 || text.length > FAN_CLUB_POST_TEXT_MAX) invalid('text');
      const club = publishableClub(input.photo);
      if (input.photo && (slot === null || slot.expiresAt <= now.getTime())) {
        refused('upload_missing');
      }
      if (input.photo) slot = null;
      serial += 1;
      const post: PostRecord = {
        id: `fcp-fixture-${serial}`,
        clubId: club.id,
        authorUid: FIXTURE_FAN_ID,
        kind: input.photo ? 'photo' : 'text',
        text,
        status: 'pending',
        rejectReason: null,
        submitted: { at: now.toISOString() },
        published: null,
        reviewed: null,
      };
      posts = [...posts, post];
      return ownPostView(post, now);
    });
  },

  /** Retira a em análise e tira do ar a publicada; outro status, ou de outro autor, 404. */
  removePost(postId: string, idempotencyKey: string, now: Date = fixtureNow()): OwnFanClubPost {
    return once(idempotencyKey, () => {
      const post = posts.find((candidate) => candidate.id === postId);
      if (!post || post.authorUid !== FIXTURE_FAN_ID) postNotFound();
      if (post.status !== 'pending' && post.status !== 'published') postNotFound();
      const status: FanClubPostStatus = post.status === 'pending' ? 'withdrawn' : 'removed';
      const changed = { ...post, status };
      posts = posts.map((candidate) => (candidate.id === postId ? changed : candidate));
      return ownPostView(changed, now);
    });
  },

  /** Os fã-clubes do artista: os destacados primeiro, depois os mais seguidos. */
  artistClubs(
    artistId: string,
    cursor: string | null,
    now: Date = fixtureNow(),
  ): FanClubListPage<FanClubCard> {
    const cards = clubs
      .filter((club) => club.artistId === artistId && isShown(club))
      .map((club) => ({ club, featured: featuredUntilOf(club, now) !== null }))
      .sort(
        (a, b) =>
          Number(b.featured) - Number(a.featured) ||
          followerCount(b.club) - followerCount(a.club) ||
          a.club.id.localeCompare(b.club.id),
      )
      .map(({ club, featured }): FanClubCard => ({
        id: club.id,
        name: club.name,
        owner: club.owner,
        followers: followerCount(club),
        featured,
        postCount: posts.filter((post) => post.clubId === club.id && post.status === 'published')
          .length,
        isFollowing: followed.has(club.id),
      }));
    return pageOf(cards, cursor, ARTIST_CLUBS_PAGE);
  },

  /** A página pública: 404 para o que não aparece para os fãs (decisão 19). */
  page(clubId: string, now: Date = fixtureNow()): FanClubPage {
    const club = clubs.find((candidate) => candidate.id === clubId);
    if (!club || !isShown(club)) clubNotFound();
    const artist = artistOf(club.artistId)!;
    return {
      id: club.id,
      name: club.name,
      artist: { id: artist.id, name: artist.name, shortName: null, thumbUrl: artist.photoURL },
      owner: club.owner,
      followerCount: followerCount(club),
      postCount: posts.filter((post) => post.clubId === club.id && post.status === 'published')
        .length,
      featured: featuredUntilOf(club, now) !== null,
      isFollowing: followed.has(club.id),
      isOwner: club.owner.uid === FIXTURE_FAN_ID,
      isMember: fixtureMembership.isMember(club.artistId),
    };
  },

  clubPosts(
    clubId: string,
    cursor: string | null,
    now: Date = fixtureNow(),
  ): FanClubListPage<FanClubPost> {
    const club = clubs.find((candidate) => candidate.id === clubId);
    if (!club || !isShown(club)) clubNotFound();
    return pageOf(publishedOf(new Set([clubId]), now), cursor, POSTS_PAGE);
  },

  /** Uma denúncia por publicação; a própria é 400 `own_post`. */
  report(
    postId: string,
    _reason: FanClubReportReason | null,
    idempotencyKey: string,
  ): ReportFanClubPostResult {
    return once(idempotencyKey, () => {
      const post = posts.find((candidate) => candidate.id === postId);
      if (!post || post.status !== 'published') postNotFound();
      if (post.authorUid === FIXTURE_FAN_ID) {
        throw new ApiError('validation', 'Pedido inválido.', 400, 'invalid_request', {
          reason: 'own_post',
        });
      }
      if (reports.has(postId)) return { postId, status: 'already_reported' };
      reports = new Set(reports).add(postId);
      return { postId, status: 'reported' };
    });
  },

  /**
   * Seguir: fora da central, entra junto pelo `followFixture` das centrais,
   * que paga a entrada uma vez (`earnFixturePoints`). Já seguindo, a mesma
   * resposta sem gravar.
   */
  follow(clubId: string, idempotencyKey: string, now: Date = fixtureNow()): FollowFanClubResult {
    return once(idempotencyKey, () => {
      const club = clubs.find((candidate) => candidate.id === clubId);
      if (!club || !isShown(club)) clubNotFound();
      if (club.owner.uid === FIXTURE_FAN_ID) refused('own_fan_club');
      if (followed.has(clubId)) return { clubId, following: true, joined: false, pointsAwarded: 0 };
      if (followed.size >= FAN_CLUB_FOLLOWS_MAX) refused('follow_limit');
      let joined = false;
      let pointsAwarded = 0;
      if (!fixtureMembership.isMember(club.artistId)) {
        pointsAwarded = followFixture.join(
          club.artistId,
          `fan-club-follow:${idempotencyKey}`,
        ).pointsAwarded;
        joined = true;
      }
      followed = new Map(followed).set(clubId, { at: now.toISOString() });
      return { clubId, following: true, joined, pointsAwarded };
    });
  },

  /** Deixar de seguir: em qualquer status do fã-clube, nunca recusa; não mexe na central. */
  unfollow(clubId: string, idempotencyKey: string): UnfollowFanClubResult {
    return once(idempotencyKey, () => {
      if (followed.has(clubId)) {
        followed = new Map(followed);
        followed.delete(clubId);
      }
      return { clubId, following: false };
    });
  },

  /** "Fã-clubes que sigo": do mais novo ao mais antigo, com o indisponível marcado. */
  follows(now: Date = fixtureNow()): FollowedFanClubs {
    const items = [...followed.entries()]
      .map(([clubId, when]) => ({
        club: clubs.find((club) => club.id === clubId),
        at: isoOf(when, now),
      }))
      .filter((entry): entry is { club: ClubRecord; at: string } => entry.club !== undefined)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(({ club, at }) => {
        const available = isShown(club);
        const blocked = fixtureBlocks.has(club.owner.uid);
        return {
          id: club.id,
          name: blocked ? null : club.name,
          artistId: club.artistId,
          artistName: club.artistName,
          owner: available ? club.owner : null,
          followedAt: at,
          available,
        };
      });
    return { items };
  },

  /** "Dos seus fã-clubes": as publicações no ar dos 20 vínculos mais novos disponíveis. */
  feed(cursor: string | null, now: Date = fixtureNow()): FanClubListPage<FanClubPost> {
    const recent = fanClubFixture
      .follows(now)
      .items.slice(0, FEED_FOLLOWS)
      .filter((item) => item.available)
      .map((item) => item.id);
    return pageOf(publishedOf(new Set(recent), now), cursor, POSTS_PAGE);
  },

  /** Volta ao retrato do seed (fim da sessão e testes). */
  reset(): void {
    application = initialApplication();
    clubs = INITIAL_CLUBS.map((club) => ({ ...club }));
    posts = INITIAL_POSTS.map((post) => ({ ...post }));
    followed = new Map(INITIAL_FOLLOWS);
    reports = new Set();
    slot = null;
    answers = new Map();
    serial = 0;
  },
};

onFixtureSessionEnd(() => fanClubFixture.reset());
