// As centrais pelo arquivo, fora do index, como as outras fixtures: o seguir
// que faz a entrada passa pelo `followFixture` delas (a regra de coerência da
// seção 13: a entrada paga uma vez, pelo `earnFixturePoints`).
import { buildArtistsFixture, followFixture, SHORT_NAMES } from '@/domains/artists/fixtures';
import { API_ERROR_CODES, ApiError, type ApiErrorDetails } from '@/services/api/errors';
import {
  fixtureBlocks,
  fixtureContact,
  fixtureMembership,
  fixtureNow,
  onFixtureCentralLeft,
  onFixtureFanBlocked,
  onFixtureSessionEnd,
} from '@/services/fixtures';
import { parseWhatsapp } from '@/utils/whatsapp';

import {
  FAN_CLUB_COMMENT_MAX,
  FAN_CLUB_COMMENTS_PAGE,
  FAN_CLUB_ERROR_CODES,
  FAN_CLUB_FOLLOWS_MAX,
  FAN_CLUB_MEMBER_NOTICE_VERSION,
  FAN_CLUB_MENTION_SUGGESTIONS_MAX,
  FAN_CLUB_NAME_MAX,
  FAN_CLUB_NAME_MIN,
  FAN_CLUB_PENDING_MAX,
  FAN_CLUB_PITCH_MAX,
  FAN_CLUB_PITCH_MIN,
  FAN_CLUB_POST_TEXT_MAX,
  FAN_CLUB_REACTIONS,
  FAN_CLUB_ROUNDS_MAX,
  type FanClubInvalidField,
  type FanClubInvalidReason,
  type FanClubReaction,
  type FanClubRefusal,
} from './consts';
import type {
  AddFanClubCommentResult,
  FanClubApplication,
  FanClubApplicationBody,
  FanClubApplicationHistoryItem,
  FanClubApplicationStatus,
  FanClubArtists,
  FanClubCard,
  FanClubComment,
  FanClubCommentHiddenResult,
  FanClubCommentPage,
  FanClubCommentReportReason,
  FanClubCommentReviewResult,
  FanClubEngagement,
  FanClubLastReward,
  FanClubListPage,
  FanClubMention,
  FanClubNumbers,
  FanClubPage,
  FanClubPerson,
  FanClubPost,
  FanClubPostDetails,
  FanClubPostRejectReason,
  FanClubPostStatus,
  FanClubReactionCounts,
  FanClubReactionResult,
  FanClubRejectReason,
  FanClubReportReason,
  FanClubStatus,
  FanClubUploadSlot,
  FollowedFanClubs,
  FollowFanClubBody,
  FollowFanClubResult,
  MentionSuggestion,
  MentionSuggestions,
  MyFanClub,
  MyFanClubClub,
  OwnFanClubPost,
  ReportFanClubCommentResult,
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
 * `followFixture` das centrais. Sair da central e bloquear o gestor apagam o
 * seguir, como no servidor (os ouvintes do `services/fixtures`). Fica em
 * memória e volta ao retrato quando a sessão termina (`resetFixtureSession`).
 * Os valores são de exemplo; os reais vêm da API.
 *
 * O retrato é o da gestora aprovada: a candidatura nova, a desistência, a
 * recusa com o prazo, o regulamento velho e o fã-clube pausado ou encerrado
 * não têm caminho aqui (o código responde como o servidor, mas nada leva a
 * eles); as telas das etapas 7 e 8 testam esses estados com os dados delas.
 *
 * As publicações de exemplo são só texto: o contrato pede a URL da foto, e as
 * fixtures não guardam arquivo (a primeira do seed tem a foto de teste). A
 * publicação com foto feita nesta sessão nasce com o `kind` `photo` e sem a
 * imagem. O prêmio da loja e a linha "Prêmio do fã-clube" do extrato chegam
 * com a etapa 8 de 34.14, junto dos tipos deles (34.22).
 *
 * A Fase 2 (seção 37, 37.9; a etapa 5 de 37.13): as reações e os comentários
 * nas publicações da Camila e do "Nenho Sempre". No fã-clube dela, a Thalita
 * e o Davi (os dois seguidores das fixtures) comentam e reagem, e a Camila
 * responde à Thalita com o @ dela e a marca de gestora; o comentário do Davi
 * na publicação do clipe foi reexibido pela equipe (o ocultar dela dá
 * `staff_decided`). No "Nenho Sempre", o comentário da Camila está oculto pela
 * Thalita, para ela ver "Oculto pelo gestor" e "Pedir revisão". O "Rock
 * Salles Raiz", que ela não segue, recusa reagir, comentar e a sugestão do @
 * com `not_following`. As reações dos outros fãs ficam só na contagem (quem
 * reagiu nunca aparece, R8), e as duas ações rendem 0 ponto, sem missão
 * (37.5). As marcações resolvem os @ das três pessoas de exemplo e dos
 * artistas; a busca do @ acha só as centrais, porque os três estão com o @
 * gerado pelo cadastro (37.7). O filtro do texto fica no servidor.
 *
 * Para a tela da publicação (a etapa 6 de 37.13): no "Nenho Sempre", a
 * Thalita responde ao Davi com o @ dele (o "Ver 1 resposta"); no "Rock Salles
 * Raiz", o texto do Davi marca a central (@rocksalles, o link e a ação do
 * corpo do card), e o comentário dele aparece para a Camila, que não segue e
 * vê o "Seguir o fã-clube" no lugar do campo.
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

/**
 * As pessoas de exemplo que as marcações resolvem pelo @ (o `usernames/{@}`
 * do servidor). Os três estão com o @ gerado pelo cadastro: a busca do @ não
 * os acha (resposta do dono de 27/10/2026, 37.15, pergunta 8), e eles
 * continuam marcáveis pela conversa e pelo @ digitado inteiro.
 */
const PEOPLE: readonly FanClubPerson[] = [CAMILA, THALITA, DAVI];

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
  /** Oficializado pela equipe (34.23): o da Camila, como no seed. */
  official: boolean;
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
  /** As reações dos outros fãs, só a contagem (R8); a da Camila soma à parte. */
  reactions: FanClubReactionCounts;
  /** As marcações do texto do gestor, resolvidas no envio (37.7). */
  mentions: FanClubMention[];
}

/** O status do comentário (37.2): visível, oculto pelo gestor ou pela equipe. */
type CommentStatus = 'visible' | 'manager_hidden' | 'staff_hidden';

interface CommentRecord {
  id: string;
  postId: string;
  author: FanClubPerson;
  text: string;
  mentions: FanClubMention[];
  /** Null no comentário de cima; na resposta, o id do de cima. */
  replyToId: string | null;
  status: CommentStatus;
  /** Quem ocultou (o gestor), ou null. */
  hiddenBy: string | null;
  /** A equipe reexibiu: o gestor não oculta de novo (decisão 21 de 37.1). */
  restoredByStaff: boolean;
  /** O "Pedir revisão" deste ocultar, e o "Manter" da equipe nele. */
  reviewRequested: boolean;
  reviewKept: boolean;
  created: When;
}

const NO_REACTIONS: FanClubReactionCounts = { heart: 0, fire: 0, laugh: 0, wow: 0, clap: 0 };

const reactionsOf = (counts: Partial<FanClubReactionCounts>): FanClubReactionCounts => ({
  ...NO_REACTIONS,
  ...counts,
});

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
    official: true,
    // A Bia e a conta do ranking que entrou junto (as duas entradas trazidas)
    // e o link do fã-clube que a Camila compartilhou, como no seed. Nas
    // reações e nos comentários de exemplo (seção 37), os dois seguidores são
    // a Thalita e o Davi, as pessoas do ranking de exemplo.
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
    official: false,
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
    official: false,
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
    reactions: reactionsOf({ heart: 1, fire: 1 }),
    mentions: [],
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
    reactions: reactionsOf({ clap: 1 }),
    mentions: [],
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
    reactions: reactionsOf({}),
    mentions: [],
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
    reactions: reactionsOf({ heart: 7, fire: 4, laugh: 1, clap: 2 }),
    mentions: [],
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
    reactions: reactionsOf({ heart: 2, laugh: 3, wow: 1 }),
    mentions: [],
  },
  {
    id: 'fcp-rock-encontro',
    clubId: OTHER_CLUB_ID,
    authorUid: DAVI.uid,
    kind: 'text',
    // O @ da central no texto do gestor, resolvido no envio (37.7): o link e a ação do corpo.
    text: 'Sigam o fã-clube para saber dos encontros antes dos shows do @rocksalles.',
    status: 'published',
    rejectReason: null,
    submitted: { hoursAgo: 50 },
    published: { hoursAgo: 48 },
    reviewed: { hoursAgo: 48 },
    reactions: reactionsOf({ heart: 4, fire: 1 }),
    mentions: [{ handle: 'rocksalles', kind: 'artist', id: 'rocksalles', start: 61, end: 72 }],
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

/** As reações da Camila: o coração na publicação dela (como no seed) e o fogo no Nenho. */
const INITIAL_REACTIONS: readonly [string, FanClubReaction][] = [
  ['fcp-netto-clipe', 'heart'],
  ['fcp-nenho-feira', 'fire'],
];

/** Os campos de um comentário visível, nunca oculto nem revisado. */
const VISIBLE = {
  mentions: [],
  replyToId: null,
  status: 'visible',
  hiddenBy: null,
  restoredByStaff: false,
  reviewRequested: false,
  reviewKept: false,
} as const satisfies Partial<CommentRecord>;

/** O @ da Thalita no começo da resposta da Camila (as posições em UTF-16, 37.7). */
const THALITA_MENTION: FanClubMention = {
  handle: 'thalitasan',
  kind: 'fan',
  id: THALITA.uid,
  start: 0,
  end: 11,
};

const INITIAL_COMMENTS: readonly CommentRecord[] = [
  {
    ...VISIBLE,
    id: 'fcc-netto-ensaio-thalita',
    postId: 'fcp-netto-ensaio',
    author: THALITA,
    text: 'Eu vou! Levo a faixa que a gente pintou.',
    created: { hoursAgo: 28 },
  },
  {
    ...VISIBLE,
    id: 'fcc-netto-ensaio-camila',
    postId: 'fcp-netto-ensaio',
    author: CAMILA,
    text: '@thalitasan que demais! Te espero na entrada.',
    mentions: [THALITA_MENTION],
    replyToId: 'fcc-netto-ensaio-thalita',
    created: { hoursAgo: 27 },
  },
  {
    ...VISIBLE,
    id: 'fcc-netto-ensaio-davi',
    postId: 'fcp-netto-ensaio',
    author: DAVI,
    text: 'Bora! Quem mais vai sair de Feira de Santana?',
    created: { hoursAgo: 26 },
  },
  {
    // Reexibido pela equipe depois de uma denúncia: a gestora não oculta de novo.
    ...VISIBLE,
    id: 'fcc-netto-clipe-davi',
    postId: 'fcp-netto-clipe',
    author: DAVI,
    text: 'Já separei a pipoca para a estreia.',
    restoredByStaff: true,
    created: { hoursAgo: 5 },
  },
  {
    ...VISIBLE,
    id: 'fcc-nenho-feira-thalita',
    postId: 'fcp-nenho-feira',
    author: THALITA,
    text: 'O ponto de encontro é na bilheteria, às 19h.',
    created: { hoursAgo: 19 },
  },
  {
    // Oculto pela gestora: a Camila vê "Oculto pelo gestor" e "Pedir revisão".
    ...VISIBLE,
    id: 'fcc-nenho-feira-camila',
    postId: 'fcp-nenho-feira',
    author: CAMILA,
    text: 'Alguém vende ingresso mais barato? Me chama no privado.',
    status: 'manager_hidden',
    hiddenBy: THALITA.uid,
    created: { hoursAgo: 18 },
  },
  {
    ...VISIBLE,
    id: 'fcc-nenho-feira-davi',
    postId: 'fcp-nenho-feira',
    author: DAVI,
    text: 'Chego cedo para pegar a grade!',
    created: { hoursAgo: 17 },
  },
  {
    ...VISIBLE,
    id: 'fcc-nenho-musica-davi',
    postId: 'fcp-nenho-musica',
    author: DAVI,
    text: 'Não pode faltar a do refrão que todo mundo canta junto.',
    created: { hoursAgo: 70 },
  },
  {
    // A gestora do Nenho responde ao Davi com o @ dele: o "Ver 1 resposta" da Camila.
    ...VISIBLE,
    id: 'fcc-nenho-musica-thalita',
    postId: 'fcp-nenho-musica',
    author: THALITA,
    text: '@davilim essa já está na lista!',
    mentions: [{ handle: 'davilim', kind: 'fan', id: DAVI.uid, start: 0, end: 8 }],
    replyToId: 'fcc-nenho-musica-davi',
    created: { hoursAgo: 69 },
  },
  {
    // No fã-clube que a Camila não segue: ela lê, e no lugar do campo vê o "Seguir o fã-clube".
    ...VISIBLE,
    id: 'fcc-rock-encontro-davi',
    postId: 'fcp-rock-encontro',
    author: DAVI,
    text: 'O primeiro encontro é na porta do show, uma hora antes. Quem vem?',
    created: { hoursAgo: 47 },
  },
];

let application: ApplicationRecord | null = initialApplication();
let clubs: ClubRecord[] = INITIAL_CLUBS.map((club) => ({ ...club }));
let posts: PostRecord[] = INITIAL_POSTS.map((post) => ({ ...post }));
let followed = new Map<string, When>(INITIAL_FOLLOWS);
let reports = new Set<string>();
// As reações da Camila por publicação (null depois de tirar, como o servidor).
let myReactions = new Map<string, FanClubReaction | null>(INITIAL_REACTIONS);
let comments: CommentRecord[] = INITIAL_COMMENTS.map((comment) => ({ ...comment }));
// Os comentários que a Camila denunciou (uma por comentário).
let commentReports = new Set<string>();
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

function commentNotFound(): never {
  throw new ApiError(
    'notFound',
    'Comentário não encontrado.',
    404,
    FAN_CLUB_ERROR_CODES.commentNotFound,
  );
}

/** O 400 `invalid_request` do servidor, com o campo ou o motivo (o `own_comment`). */
function invalidRequest(details: ApiErrorDetails): never {
  throw new ApiError('validation', 'Pedido inválido.', 400, 'invalid_request', details);
}

/** O texto do comentário fora da regra: o `comment_invalid` do Mural, com o motivo. */
function commentInvalid(reason: 'empty' | 'too_long'): never {
  throw new ApiError('validation', 'Comentário inválido.', 400, API_ERROR_CODES.commentInvalid, {
    reason,
  });
}

/** Os artistas de exemplo pelo id (o nome e a ordem). */
function artistOf(artistId: string) {
  return buildArtistsFixture().find((artist) => artist.id === artistId) ?? null;
}

/** São Paulo, sem horário de verão desde 2019: o dia do Destaque é o de lá, como o `dayKey` do servidor. */
const SAO_PAULO_OFFSET_MS = -3 * HOUR_MS;

/** O fim do Destaque (`AAAA-MM-DD` de São Paulo), ou null sem destaque. */
function featuredUntilOf(club: ClubRecord, now: Date): string | null {
  if (club.featuredDays === null) return null;
  const end = now.getTime() + SAO_PAULO_OFFSET_MS + club.featuredDays * DAY_MS;
  return new Date(end).toISOString().slice(0, 10);
}

/** O fã-clube aparece para os fãs: ativo, do artista de exemplo, de gestor que a Camila não bloqueou. */
function isShown(club: ClubRecord): boolean {
  return (
    club.status === 'active' &&
    artistOf(club.artistId) !== null &&
    !fixtureBlocks.has(club.owner.uid)
  );
}

/** Os seguidores de agora (o `count()` da página e dos números): os de exemplo e a Camila, quando segue. */
const followerCount = (club: ClubRecord): number =>
  club.followers + (followed.has(club.id) ? 1 : 0);

/**
 * Os seguidores da cópia da noite (o `counts.followers` da lista do artista):
 * os do retrato, que não mudam com o seguir desta sessão, como no servidor,
 * que só os copia de noite.
 */
const copiedFollowers = (club: ClubRecord): number =>
  club.followers + (INITIAL_FOLLOWS.some(([id]) => id === club.id) ? 1 : 0);

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
    official: club.official,
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

// --- Os contadores da Fase 2 (seção 37, 37.2) ------------------------------------------

/** As reações da publicação por emoji: as dos outros fãs e a da Camila. */
function reactionCountsOf(post: PostRecord): FanClubReactionCounts {
  const counts = { ...post.reactions };
  const mine = myReactions.get(post.id) ?? null;
  if (mine !== null) counts[mine] += 1;
  return counts;
}

const totalOf = (counts: FanClubReactionCounts): number =>
  FAN_CLUB_REACTIONS.reduce((sum, key) => sum + counts[key], 0);

/** As respostas visíveis de um comentário de cima (o `replyCount`). */
const visibleRepliesOf = (top: CommentRecord): number =>
  comments.filter((comment) => comment.replyToId === top.id && comment.status === 'visible').length;

/**
 * Os comentários que aparecem (o `commentCount`, 37.2): os de cima visíveis e
 * as respostas visíveis de um comentário de cima visível, de todos os
 * autores, como o contador que o servidor grava.
 */
function commentCountOf(postId: string): number {
  return comments
    .filter((comment) => comment.postId === postId && comment.replyToId === null)
    .filter((top) => top.status === 'visible')
    .reduce((sum, top) => sum + 1 + visibleRepliesOf(top), 0);
}

/** Os contadores da publicação, que o card mostra e a resposta da reação acerta. */
function countersOf(post: PostRecord) {
  const reactionCounts = reactionCountsOf(post);
  return {
    reactionCount: totalOf(reactionCounts),
    reactionCounts,
    commentCount: commentCountOf(post.id),
  };
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
    rejectReason: post.status === 'rejected' ? post.rejectReason : null,
    submittedAt: isoOf(post.submitted, now),
    publishedAt: post.published ? isoOf(post.published, now) : null,
    reviewedAt: post.reviewed ? isoOf(post.reviewed, now) : null,
    ...countersOf(post),
    mentions: post.mentions,
  };
}

function postView(post: PostRecord, club: ClubRecord, now: Date): FanClubPost {
  return {
    id: post.id,
    clubId: club.id,
    clubName: club.name,
    clubOfficial: club.official,
    artistId: club.artistId,
    author: club.owner,
    kind: post.kind,
    text: post.text,
    photo: null,
    thumb: null,
    publishedAt: isoOf(post.published ?? post.submitted, now),
    ...countersOf(post),
    myReaction: myReactions.get(post.id) ?? null,
    mentions: post.mentions,
  };
}

/** As recompensas das duas ações da Fase 2: 0 ponto e nenhuma missão (37.5). */
const NO_REWARDS = {
  completedMissions: [],
  levelUp: null,
  unlockedAchievements: [],
  missionsChanged: false,
};

/**
 * A publicação no ar que quem pede vê (o `readVisiblePost`): publicada, de um
 * fã-clube que aparece para os fãs. Senão, 404 `fan_club_post_not_found`.
 */
function visiblePost(postId: string): { post: PostRecord; club: ClubRecord } {
  const post = posts.find((candidate) => candidate.id === postId);
  if (!post || post.status !== 'published') postNotFound();
  const club = clubs.find((candidate) => candidate.id === post.clubId);
  if (!club || !isShown(club)) postNotFound();
  return { post, club };
}

/**
 * O que reagir e comentar pedem (o `readActionPost`): a publicação no ar e
 * seguir o fã-clube ou ser o gestor; senão, 409 `not_following`.
 */
function actionPost(postId: string): { post: PostRecord; club: ClubRecord; isOwner: boolean } {
  const { post, club } = visiblePost(postId);
  const isOwner = club.owner.uid === FIXTURE_FAN_ID;
  if (!isOwner && !followed.has(club.id)) refused('not_following');
  return { post, club, isOwner };
}

/** O comentário como a Camila recebe (o `fanClubCommentView` do servidor). */
function commentView(comment: CommentRecord, club: ClubRecord, now: Date): FanClubComment {
  const isManagerView = club.owner.uid === FIXTURE_FAN_ID;
  const isAuthor = comment.author.uid === FIXTURE_FAN_ID;
  const managerHidden = comment.status === 'manager_hidden' && (isManagerView || isAuthor);
  let review: FanClubComment['review'] = null;
  if (managerHidden && isAuthor) {
    review = comment.reviewKept ? 'kept' : comment.reviewRequested ? 'requested' : null;
  }
  const hiddenReplies = comments.filter(
    (reply) => reply.replyToId === comment.id && reply.status === 'manager_hidden',
  ).length;
  return {
    id: comment.id,
    postId: comment.postId,
    clubId: club.id,
    author: comment.author,
    isManager: comment.author.uid === club.owner.uid,
    text: comment.text,
    mentions: comment.mentions,
    replyToId: comment.replyToId,
    replyCount: comment.replyToId === null ? visibleRepliesOf(comment) : 0,
    ...(isManagerView && comment.replyToId === null ? { hiddenReplyCount: hiddenReplies } : {}),
    createdAt: isoOf(comment.created, now),
    hidden: managerHidden ? 'manager' : null,
    review,
  };
}

const newestFirst = (now: Date) => (a: CommentRecord, b: CommentRecord) =>
  isoOf(b.created, now).localeCompare(isoOf(a.created, now)) || b.id.localeCompare(a.id);

const oldestFirst = (now: Date) => (a: CommentRecord, b: CommentRecord) =>
  isoOf(a.created, now).localeCompare(isoOf(b.created, now)) || a.id.localeCompare(b.id);

/** Um caractere de palavra antes ou depois do @: aí o @ não marca (37.7). */
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const MENTION_TOKEN = /@([A-Za-z0-9_]+)/g;
const MENTIONS_MAX = 5;

/** O dono de um @: o fã de exemplo pelo @ ou a central no ar pelo id. */
function mentionTargetOf(handle: string): Pick<FanClubMention, 'kind' | 'id'> | null {
  const fan = PEOPLE.find((person) => person.username === handle);
  if (fan) return { kind: 'fan', id: fan.uid };
  const artist = artistOf(handle);
  return artist ? { kind: 'artist', id: artist.id } : null;
}

/**
 * As marcações resolvidas no envio, como o servidor (37.7): o "@" no começo
 * ou depois de um caractere que não é letra, número nem "_", com 3 a 30 de
 * `a-z`, `0-9` e `_`, lido em minúsculas; até 5 @ diferentes; cada
 * ocorrência de um @ resolvido vira marcação, com as posições em UTF-16, e o
 * resto fica texto.
 */
function mentionsOf(text: string): FanClubMention[] {
  const mentions: FanClubMention[] = [];
  const handles = new Set<string>();
  for (const match of text.matchAll(MENTION_TOKEN)) {
    const start = match.index;
    const written = match[1] ?? '';
    const end = start + 1 + written.length;
    const before = Array.from(text.slice(0, start)).at(-1) ?? '';
    const after = Array.from(text.slice(end))[0] ?? '';
    const handle = written.toLowerCase();
    if (WORD_CHAR.test(before) || WORD_CHAR.test(after)) continue;
    if (handle.length < 3 || handle.length > 30) continue;
    if (!handles.has(handle)) {
      if (handles.size >= MENTIONS_MAX) continue;
      handles.add(handle);
    }
    const target = mentionTargetOf(handle);
    if (target) mentions.push({ handle: written, ...target, start, end });
  }
  return mentions;
}

/** A taxa de engajamento de 30 dias do fã-clube da Camila (37.11). */
function engagementOf(club: ClubRecord, now: Date): FanClubEngagement {
  const clubPosts = posts.filter((post) => post.clubId === club.id);
  const ids = new Set(clubPosts.map((post) => post.id));
  // As reações dos outros fãs; a da gestora no próprio fã-clube nunca conta.
  const reactions30d = clubPosts.reduce((sum, post) => sum + totalOf(post.reactions), 0);
  const since = now.getTime() - 30 * DAY_MS;
  const comments30d = comments.filter(
    (comment) =>
      ids.has(comment.postId) &&
      comment.author.uid !== club.owner.uid &&
      Date.parse(isoOf(comment.created, now)) >= since,
  ).length;
  const followers = followerCount(club);
  return {
    reactions30d,
    comments30d,
    rate30d:
      followers > 0 ? Math.round(((reactions30d + comments30d) * 1000) / followers) / 10 : null,
  };
}

/**
 * A conversa da sugestão do @ (37.7, sem o `q`): o gestor (menos para ele
 * mesmo), o artista e quem comentou na publicação, do mais novo, sem quem
 * pede e sem quem ela bloqueou. A resposta conta só embaixo de um comentário
 * de cima visível.
 */
function conversationOf(club: ClubRecord, postId: string | null, now: Date): MentionSuggestion[] {
  const isOwner = club.owner.uid === FIXTURE_FAN_ID;
  const items: MentionSuggestion[] = [];
  const seen = new Set<string>();
  const add = (item: MentionSuggestion) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key) || items.length >= FAN_CLUB_MENTION_SUGGESTIONS_MAX) return;
    seen.add(key);
    items.push(item);
  };
  if (!isOwner && club.owner.username !== null) {
    add({
      kind: 'fan',
      id: club.owner.uid,
      username: club.owner.username,
      name: club.owner.name,
      photoURL: club.owner.photoURL,
      role: 'manager',
      inConversation: true,
    });
  }
  const artist = artistOf(club.artistId);
  if (artist) {
    add({
      kind: 'artist',
      id: artist.id,
      username: artist.id,
      name: artist.name,
      photoURL: artist.photoURL,
      role: 'artist',
      inConversation: true,
    });
  }
  if (postId === null) return items;
  const recent = comments
    .filter((comment) => comment.postId === postId)
    .sort(newestFirst(now))
    .slice(0, 30);
  for (const comment of recent) {
    if (comment.status !== 'visible') continue;
    if (comment.replyToId !== null) {
      const top = comments.find((candidate) => candidate.id === comment.replyToId);
      if (!top || top.status !== 'visible' || (!isOwner && fixtureBlocks.has(top.author.uid))) {
        continue;
      }
    }
    const { author } = comment;
    if (author.uid === FIXTURE_FAN_ID || fixtureBlocks.has(author.uid)) continue;
    if (author.username === null) continue;
    add({
      kind: 'fan',
      id: author.uid,
      username: author.username,
      name: author.name,
      photoURL: author.photoURL,
      role: author.uid === club.owner.uid ? 'manager' : null,
      inConversation: true,
    });
  }
  return items;
}

/**
 * A busca do @ pelo começo (37.7, com o `q`): as centrais no ar e os fãs que
 * escolheram o @, pela ordem do @. Os três fãs de exemplo estão com o @
 * gerado pelo cadastro, então só as centrais aparecem.
 */
function searchOf(club: ClubRecord, q: string): MentionSuggestion[] {
  return buildArtistsFixture()
    .filter((artist) => artist.id.startsWith(q))
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, FAN_CLUB_MENTION_SUGGESTIONS_MAX)
    .map((artist) => {
      const role = artist.id === club.artistId ? ('artist' as const) : null;
      return {
        kind: 'artist' as const,
        id: artist.id,
        username: artist.id,
        name: artist.name,
        photoURL: artist.photoURL,
        role,
        inConversation: role !== null,
      };
    });
}

/** O `q` da busca: de 2 a 30 de `a-z`, `0-9` e `_`, fora dos ids `__.*__` (37.3). */
const MENTION_QUERY = /^(?!__.*__$)[a-z0-9_]{2,30}$/;

function updateComment(commentId: string, patch: Partial<CommentRecord>): void {
  comments = comments.map((comment) =>
    comment.id === commentId ? { ...comment, ...patch } : comment,
  );
}

/**
 * O comentário de uma publicação do fã-clube da Camila (o `readManaged` do
 * servidor), para o ocultar e o reexibir: de outro fã-clube, ou que não
 * existe, 404.
 */
function managedComment(commentId: string): { comment: CommentRecord; club: ClubRecord } {
  const comment = comments.find((candidate) => candidate.id === commentId);
  if (!comment) commentNotFound();
  const post = posts.find((candidate) => candidate.id === comment.postId);
  const club = clubs.find((candidate) => candidate.id === post?.clubId);
  if (!club || club.owner.uid !== FIXTURE_FAN_ID) commentNotFound();
  return { comment, club };
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
  if (/(^|[ \-_.,;:/()])oficial([ \-_.,;:/()]|$)/.test(plain)) invalid('name', 'official');
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

  numbers(now: Date = fixtureNow()): FanClubNumbers {
    const club = ownClub();
    if (!club) clubNotFound();
    return {
      followers: followerCount(club),
      followers30d: club.followers30d,
      links: club.links,
      visits: club.visits,
      signups: club.signups,
      joins: club.joins,
      engagement: engagementOf(club, now),
    };
  },

  /** As centrais da Camila que aceitam fã-clubes, na ordem de destaque. */
  artists(): FanClubArtists {
    const items = buildArtistsFixture()
      .filter((artist) => fixtureMembership.isMember(artist.id))
      .map((artist) => ({
        artistId: artist.id,
        name: artist.name,
        shortName: SHORT_NAMES[artist.id] ?? null,
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
        reactions: NO_REACTIONS,
        mentions: mentionsOf(text),
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

  /**
   * Os fã-clubes do artista, como o servidor: os destacados primeiro (pelos
   * seguidores e pelo id crescente), depois os outros (pelos seguidores e
   * pelo id decrescente), com os seguidores da cópia da noite.
   */
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
          copiedFollowers(b.club) - copiedFollowers(a.club) ||
          (a.featured ? a.club.id.localeCompare(b.club.id) : b.club.id.localeCompare(a.club.id)),
      )
      .map(({ club, featured }): FanClubCard => ({
        id: club.id,
        name: club.name,
        owner: club.owner,
        followers: copiedFollowers(club),
        featured,
        official: club.official,
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
      artist: {
        id: artist.id,
        name: artist.name,
        shortName: SHORT_NAMES[artist.id] ?? null,
        thumbUrl: artist.photoURL,
      },
      owner: club.owner,
      followerCount: followerCount(club),
      postCount: posts.filter((post) => post.clubId === club.id && post.status === 'published')
        .length,
      featured: featuredUntilOf(club, now) !== null,
      official: club.official,
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
   * resposta sem gravar. A versão do aviso de membro no corpo tem de ser a do
   * servidor (seção 37, "Estado"); outra é 400, antes de ler.
   */
  follow(
    clubId: string,
    idempotencyKey: string,
    body: FollowFanClubBody = {},
    now: Date = fixtureNow(),
  ): FollowFanClubResult {
    return once(idempotencyKey, () => {
      if (
        body.memberNoticeVersion !== undefined &&
        body.memberNoticeVersion !== FAN_CLUB_MEMBER_NOTICE_VERSION
      ) {
        invalidRequest({ field: 'memberNoticeVersion' });
      }
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
          official: available && club.official,
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

  // --- A Fase 2 (seção 37, 37.3) -------------------------------------------------------

  /** A publicação no ar, com o que a tela dela pede da página. */
  post(postId: string, now: Date = fixtureNow()): FanClubPostDetails {
    const { post, club } = visiblePost(postId);
    return {
      ...postView(post, club, now),
      isOwner: club.owner.uid === FIXTURE_FAN_ID,
      isFollowing: followed.has(club.id),
      isMember: fixtureMembership.isMember(club.artistId),
      artistName: club.artistName,
    };
  },

  /**
   * Os comentários de cima, do mais novo, ou as respostas de um deles, da mais
   * antiga, 20 por página. Não exige seguir. Só os visíveis; a gestora, no
   * próprio fã-clube, vê também os que ocultou e os de quem bloqueou. Na
   * primeira página dos de cima, quem não é a gestora recebe os dela ocultos
   * pela gestora (o `ownHidden`).
   */
  comments(
    postId: string,
    replyTo: string | null,
    cursor: string | null,
    now: Date = fixtureNow(),
  ): FanClubCommentPage {
    const { club } = visiblePost(postId);
    const isManager = club.owner.uid === FIXTURE_FAN_ID;
    const shown = (comment: CommentRecord): boolean =>
      (comment.status === 'visible' || (isManager && comment.status === 'manager_hidden')) &&
      (isManager || !fixtureBlocks.has(comment.author.uid));
    let items: CommentRecord[];
    if (replyTo !== null) {
      const top = comments.find((comment) => comment.id === replyTo);
      if (!top || top.postId !== postId || top.replyToId !== null || !shown(top)) {
        commentNotFound();
      }
      items = comments
        .filter((comment) => comment.replyToId === top.id && shown(comment))
        .sort(oldestFirst(now));
    } else {
      items = comments
        .filter((comment) => comment.postId === postId && comment.replyToId === null)
        .filter(shown)
        .sort(newestFirst(now));
    }
    const page: FanClubCommentPage = pageOf(
      items.map((comment) => commentView(comment, club, now)),
      cursor,
      FAN_CLUB_COMMENTS_PAGE,
    );
    if (isManager || replyTo !== null || cursor !== null) return page;
    const ownHidden = comments
      .filter(
        (comment) =>
          comment.postId === postId &&
          comment.author.uid === FIXTURE_FAN_ID &&
          comment.status === 'manager_hidden',
      )
      .sort(newestFirst(now))
      .slice(0, 10)
      .map((comment) => commentView(comment, club, now));
    return { ...page, ownHidden };
  },

  /**
   * Comentar ou responder: o texto conferido antes de ler (o `comment_invalid`
   * do Mural), depois seguir ou ser a gestora; a resposta a uma resposta vai
   * para o comentário de cima dela (R7). As marcações resolvidas no envio.
   */
  addComment(
    postId: string,
    input: { text: string; replyToId: string | null },
    idempotencyKey: string,
    now: Date = fixtureNow(),
  ): AddFanClubCommentResult {
    return once(idempotencyKey, () => {
      const text = input.text.trim();
      if (text.length === 0) commentInvalid('empty');
      if (text.length > FAN_CLUB_COMMENT_MAX) commentInvalid('too_long');
      const { club, isOwner } = actionPost(postId);
      const canReply = (comment: CommentRecord | undefined): comment is CommentRecord =>
        comment !== undefined &&
        comment.postId === postId &&
        comment.status === 'visible' &&
        (isOwner || !fixtureBlocks.has(comment.author.uid));
      let replyToId: string | null = null;
      if (input.replyToId !== null) {
        const replied = comments.find((comment) => comment.id === input.replyToId);
        if (!canReply(replied)) commentNotFound();
        replyToId = replied.replyToId ?? replied.id;
        if (replyToId !== replied.id) {
          const top = comments.find((comment) => comment.id === replyToId);
          if (!canReply(top) || top.replyToId !== null) commentNotFound();
        }
      }
      serial += 1;
      const record: CommentRecord = {
        ...VISIBLE,
        id: `fcc-fixture-${serial}`,
        postId,
        author: CAMILA,
        text,
        mentions: mentionsOf(text),
        replyToId,
        created: { at: now.toISOString() },
      };
      comments = [...comments, record];
      return { ...commentView(record, club, now), ...NO_REWARDS };
    });
  },

  /**
   * Reagir ou trocar de emoji: seguir ou ser a gestora. A mesma reação
   * responde os números sem gravar. Sempre 0 ponto, sem missão (37.5).
   */
  react(postId: string, reaction: FanClubReaction, idempotencyKey: string): FanClubReactionResult {
    return once(idempotencyKey, () => {
      if (!FAN_CLUB_REACTIONS.includes(reaction)) invalidRequest({ field: 'reaction' });
      const { post } = actionPost(postId);
      myReactions = new Map(myReactions).set(postId, reaction);
      const { reactionCount, reactionCounts } = countersOf(post);
      return { postId, reaction, reactionCount, reactionCounts, ...NO_REWARDS };
    });
  },

  /**
   * Tirar a reação: nunca recusa, em qualquer status da publicação; sem a
   * publicação, os números vêm zerados.
   */
  clearReaction(postId: string, idempotencyKey: string): FanClubReactionResult {
    return once(idempotencyKey, () => {
      if (myReactions.has(postId)) myReactions = new Map(myReactions).set(postId, null);
      const post = posts.find((candidate) => candidate.id === postId);
      const { reactionCount, reactionCounts } = post
        ? countersOf(post)
        : { reactionCount: 0, reactionCounts: NO_REACTIONS };
      return { postId, reaction: null, reactionCount, reactionCounts, ...NO_REWARDS };
    });
  },

  /**
   * Denunciar um comentário à vista: o visível, da publicação no ar, de
   * autor que ela não bloqueou (a gestora vê todos no próprio fã-clube) e, na
   * resposta, embaixo de um de cima à vista; senão, 404. O próprio é 400
   * `own_comment`; o já denunciado, `already_reported`.
   */
  reportComment(
    commentId: string,
    _reason: FanClubCommentReportReason | null,
    idempotencyKey: string,
  ): ReportFanClubCommentResult {
    return once(idempotencyKey, () => {
      const comment = comments.find((candidate) => candidate.id === commentId);
      if (!comment || comment.status !== 'visible') commentNotFound();
      const post = posts.find((candidate) => candidate.id === comment.postId);
      const club = clubs.find((candidate) => candidate.id === post?.clubId);
      if (!post || post.status !== 'published' || !club || !isShown(club)) commentNotFound();
      const isOwner = club.owner.uid === FIXTURE_FAN_ID;
      const hidden = (person: FanClubPerson) => !isOwner && fixtureBlocks.has(person.uid);
      if (hidden(comment.author)) commentNotFound();
      if (comment.replyToId !== null) {
        const top = comments.find((candidate) => candidate.id === comment.replyToId);
        if (!top || top.status !== 'visible' || hidden(top.author)) commentNotFound();
      }
      if (comment.author.uid === FIXTURE_FAN_ID) invalidRequest({ reason: 'own_comment' });
      if (commentReports.has(commentId)) return { commentId, status: 'already_reported' };
      commentReports = new Set(commentReports).add(commentId);
      return { commentId, status: 'reported' };
    });
  },

  /**
   * O "Pedir revisão": só da autora e só no oculto pela gestora (senão, 404);
   * uma vez por ocultar, e o mantido pela equipe responde `already_requested`.
   */
  requestReview(commentId: string, idempotencyKey: string): FanClubCommentReviewResult {
    return once(idempotencyKey, () => {
      const comment = comments.find((candidate) => candidate.id === commentId);
      if (
        !comment ||
        comment.author.uid !== FIXTURE_FAN_ID ||
        comment.status !== 'manager_hidden'
      ) {
        commentNotFound();
      }
      if (comment.reviewRequested || comment.reviewKept) {
        return { commentId, status: 'already_requested' };
      }
      updateComment(commentId, { reviewRequested: true });
      return { commentId, status: 'requested' };
    });
  },

  /**
   * A gestora oculta um comentário de uma publicação do fã-clube dela, na
   * ordem do servidor: de outro fã-clube ou oculto pela equipe, 404; o
   * fã-clube parado, `club_not_active`; o dela, `own_comment`; o reexibido
   * pela equipe, `staff_decided`; o já oculto por ela responde sem gravar.
   */
  hideComment(commentId: string, idempotencyKey: string): FanClubCommentHiddenResult {
    return once(idempotencyKey, () => {
      const { comment, club } = managedComment(commentId);
      if (comment.status === 'staff_hidden') commentNotFound();
      if (club.status !== 'active') refused('club_not_active');
      if (comment.author.uid === FIXTURE_FAN_ID) invalidRequest({ reason: 'own_comment' });
      if (comment.status === 'visible' && comment.restoredByStaff) refused('staff_decided');
      if (comment.status === 'visible') {
        updateComment(commentId, {
          status: 'manager_hidden',
          hiddenBy: FIXTURE_FAN_ID,
          reviewRequested: false,
          reviewKept: false,
        });
      }
      return { commentId, hidden: true };
    });
  },

  /** A gestora reexibe só o que ela ocultou (senão, 404), com o fã-clube ativo. */
  unhideComment(commentId: string, idempotencyKey: string): FanClubCommentHiddenResult {
    return once(idempotencyKey, () => {
      const { comment, club } = managedComment(commentId);
      if (comment.status !== 'manager_hidden' || comment.hiddenBy !== FIXTURE_FAN_ID) {
        commentNotFound();
      }
      if (club.status !== 'active') refused('club_not_active');
      updateComment(commentId, { status: 'visible', hiddenBy: null });
      return { commentId, hidden: false };
    });
  },

  /**
   * As sugestões do @: o `q` conferido antes de ler (400 no campo); o fã-clube
   * que aparece (senão, 404) e, com a publicação, a dele no ar (senão, 404);
   * só para quem pode comentar ali (`not_following`). Sem o `q`, a conversa;
   * com ele, a busca. Até 8.
   */
  mentions(
    clubId: string,
    postId: string | null,
    q: string | null,
    now: Date = fixtureNow(),
  ): MentionSuggestions {
    if (q !== null && !MENTION_QUERY.test(q)) invalidRequest({ field: 'q' });
    const club = clubs.find((candidate) => candidate.id === clubId);
    if (!club || !isShown(club)) clubNotFound();
    if (postId !== null) {
      const post = posts.find((candidate) => candidate.id === postId);
      if (!post || post.clubId !== club.id || post.status !== 'published') postNotFound();
    }
    if (club.owner.uid !== FIXTURE_FAN_ID && !followed.has(club.id)) refused('not_following');
    return { items: q === null ? conversationOf(club, postId, now) : searchOf(club, q) };
  },

  /** Volta ao retrato do seed (fim da sessão e testes). */
  reset(): void {
    application = initialApplication();
    clubs = INITIAL_CLUBS.map((club) => ({ ...club }));
    posts = INITIAL_POSTS.map((post) => ({ ...post }));
    followed = new Map(INITIAL_FOLLOWS);
    reports = new Set();
    myReactions = new Map(INITIAL_REACTIONS);
    comments = INITIAL_COMMENTS.map((comment) => ({ ...comment }));
    commentReports = new Set();
    slot = null;
    answers = new Map();
    serial = 0;
  },
};

onFixtureSessionEnd(() => fanClubFixture.reset());

/** Tira do seguir da Camila os fã-clubes que a regra pede, como o servidor apaga os vínculos. */
function dropFollows(gone: (club: ClubRecord) => boolean): void {
  const next = new Map(followed);
  for (const clubId of followed.keys()) {
    const club = clubs.find((candidate) => candidate.id === clubId);
    if (club && gone(club)) next.delete(clubId);
  }
  followed = next;
}

// Sair da central apaga os seguimentos dos fã-clubes do artista (decisão 27),
// e bloquear o gestor apaga o do fã-clube dele (decisão 32): desbloquear ou
// voltar à central não devolve o seguir.
onFixtureCentralLeft((artistId) => dropFollows((club) => club.artistId === artistId));
onFixtureFanBlocked((fanId) => dropFollows((club) => club.owner.uid === fanId));
