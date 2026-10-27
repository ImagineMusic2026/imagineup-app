import type { MentionSuggestion } from '../api/contract';
import { isArtistId, isPublished, type ArtistRecord } from '../centrals/model';
import { filterTokens, isBlockedSocial, isBlockedText } from '../content-filter';
import { dayKey, shiftDay } from '../day';
import { parseWhatsapp } from '../fan-contact/model';
import { normalizeSocialHandle } from '../fan-profile/details';
import { FAN_UID_PATTERN, isAutomaticUsername, type PhotoLimits } from '../fan-profile/model';
import { isContentId } from '../page-cursor';
import { commentTextProblem, PostError } from '../posts/model';
import { cleanLine, cleanMultiline, isVisibleLine, isVisibleMultiline } from '../visible-line';

// O fã-clube gerido pelo fã (docs/arquitetura-api.md, seção 34), puro: nada
// aqui lê ou grava o Firestore. As constantes do programa, as regras dos
// campos da candidatura e da publicação, as recusas da API, a leitura dos
// documentos e o prazo do Destaque; desde a Fase 2 (seção 37), as reações e
// os comentários, com o texto pelas regras do comentário do Mural
// (posts/model.ts), e as menções: os @ do texto, o filtro com as marcações e
// as sugestões do @. Este módulo não importa a moderação, os pontos nem a
// equipe: os tetos do dia (moderation/model.ts e points/config.ts) importam
// daqui.

// --- O programa (decisões 8, 9 e 47) --------------------------------------------

/**
 * O programa aberto (decisão 9): o `open` do `GET /me/fan-club`, a linha "Tenha
 * seu fã-clube" e a candidatura. Trocar por `false` fecha a candidatura e
 * esconde a linha num deploy das funções, sem build; os fã-clubes que existem
 * continuam. Mora no código compartilhado: muda num deploy das 69 funções.
 */
export const FAN_CLUB_OPEN: boolean = true;

/**
 * O endereço do Regulamento do Fã-clube (decisão 8). Vazio até o regulamento
 * existir, como o `REWARDS_RULES_URL` da loja: o `rulesUrl` sai `null`, e o
 * aceite da candidatura cita os Termos de Uso (`TERMS_URL` do app).
 */
export const FAN_CLUB_RULES_URL: string = '';

/**
 * A versão aceita na candidatura (decisão 8): a dos Termos de Uso até o
 * regulamento chegar. Quando ela mudar, o gestor aprovado aceita de novo pelo
 * "Meu fã-clube" (o `rulesOutdated`).
 */
export const FAN_CLUB_RULES_VERSION = 'termos-2026-10';

/**
 * O texto do reconhecimento (decisão 47), ligado: a apresentação e o "Meu
 * fã-clube" o mostram. Trocar por `null` desliga o texto num deploy, sem build.
 */
export const FAN_CLUB_PRIZE_NOTICE: string | null =
  'A equipe pode reconhecer os fã-clubes com pontos e prêmios, como ingressos, descontos, ' +
  'produtos e encontros, a critério da equipe, sem inscrição, ranking, prazo nem prêmio ' +
  'garantido. A Apple não patrocina nem participa deste reconhecimento.';

/** O `rulesUrl` do `GET /me/fan-club`: `null` enquanto a constante estiver vazia. */
export function fanClubRulesUrl(url: string = FAN_CLUB_RULES_URL): string | null {
  return url.trim() === '' ? null : url;
}

// --- Os limites (decisões 10, 11 e 35) ------------------------------------------

/** O nome do fã-clube: de 3 a 40, em unidades de UTF-16, como o nome do fã. */
export const FAN_CLUB_NAME_MIN = 3;
export const FAN_CLUB_NAME_MAX = 40;

/** "Como e onde você vai divulgar o fã-clube?": de 20 a 1.000. */
export const FAN_CLUB_PITCH_MIN = 20;
export const FAN_CLUB_PITCH_MAX = 1_000;

/** Candidaturas por dia (o teto `fanclub_apply`, editável no `config/points.actionCaps`). */
export const FAN_CLUB_APPLIES_PER_DAY = 3;

/** As rodadas de candidatura, com 30 dias entre elas depois da recusa. */
export const FAN_CLUB_ROUNDS_MAX = 3;
export const FAN_CLUB_REAPPLY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * As decisões guardadas no `history` da candidatura (as rodadas que a ficha
 * mostra sem os Logs). São até 3 por ciclo; o encerramento a pedido abre um
 * ciclo novo, e o teto segura o documento.
 */
export const FAN_CLUB_HISTORY_MAX = 10;

/** O Destaque: o fim de amanhã a 31 dias, e até 3 destacados por artista ao mesmo tempo. */
export const FEATURE_DAYS_MAX = 31;
export const FEATURED_PER_ARTIST_MAX = 3;

/** O texto da publicação: de 1 a 1.000 (decisão 15). */
export const FAN_CLUB_POST_TEXT_MAX = 1_000;

/** Publicações em análise ao mesmo tempo, no `pendingPosts` do fã-clube (decisão 11). */
export const FAN_CLUB_PENDING_MAX = 3;

/** Publicações por dia (o teto `fanclub_post`, editável no `config/points.actionCaps`). */
export const FAN_CLUB_POSTS_PER_DAY = 5;

/** Vagas de envio de foto por dia (o teto `fanclub_upload`, editável no `config/points.actionCaps`). */
export const FAN_CLUB_UPLOADS_PER_DAY = 10;

/** O prazo da vaga de envio da foto, como o da foto do perfil (27.4). */
export const FAN_CLUB_UPLOAD_SLOT_MS = 10 * 60_000;

/** A foto da publicação (o app gera 1080x1350, em JPEG sem EXIF): até 2 MiB e 1350 de lado. */
export const CLUB_PHOTO_LIMITS: PhotoLimits = { maxBytes: 2 * 1024 * 1024, maxSide: 1350 };

/** A miniatura da publicação (o app gera 480x600): até 300 KiB e 600 de lado. */
export const CLUB_THUMB_LIMITS: PhotoLimits = { maxBytes: 300 * 1024, maxSide: 600 };

/** Publicações por página na página do fã-clube e em "Minhas publicações". */
export const FAN_CLUB_POSTS_PAGE = 10;

/** Fã-clubes por página no `GET /artists/:artistId/fan-clubs`. */
export const ARTIST_FAN_CLUBS_PAGE = 20;

/**
 * Fã-clubes seguidos por fã ao mesmo tempo (decisão 34): o 51º seguir recusa
 * `follow_limit`, e os indisponíveis contam. É também o tamanho do `GET
 * /me/fan-club-follows` e o que a suspensão apaga de uma vez.
 */
export const FAN_CLUB_FOLLOWS_MAX = 50;

/** Seguimentos por dia (o teto `fanclub_follow`, editável no `config/points.actionCaps`). */
export const FAN_CLUB_FOLLOWS_PER_DAY = 30;

/** Os vínculos mais novos que a seção "Dos seus fã-clubes" da Início lê (decisão 30). */
export const FAN_CLUB_FEED_FOLLOWS = 20;

/** O perfil com menos de 7 dias é conta nova, um dos sinais do vínculo (decisão 39). */
export const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;

/** Os novos seguidores contam os últimos 30 dias (decisão 36). */
export const FOLLOWERS_RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Trocas de reação por dia (o teto `fanclub_reaction_set`, seção 37, 37.5):
 * dar e trocar de emoji contam; tirar nunca é recusado.
 */
export const FAN_CLUB_REACTIONS_PER_DAY = 300;

/** Comentários por dia, os de cima e as respostas (o teto `fanclub_comment_sent`, 37.5). */
export const FAN_CLUB_COMMENTS_PER_DAY = 100;

/** Comentários por página, os de cima e as respostas (37.3), como os do Mural. */
export const FAN_CLUB_COMMENTS_PAGE = 20;

// --- Os valores dos documentos (34.4) -------------------------------------------

export const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const FAN_CLUB_STATUSES = ['active', 'paused', 'closed'] as const;
export type FanClubStatus = (typeof FAN_CLUB_STATUSES)[number];

export type FanClubStatusReason = 'staff' | 'owner_request' | 'suspended' | 'account_deleted';

/** Os motivos da recusa da candidatura pela equipe (34.3). */
export const APPLICATION_REJECT_REASONS = [
  'incomplete',
  'not_fit',
  'artist_limit',
  'image_rights',
  'rules',
  'other',
] as const;
export type ApplicationRejectReason = (typeof APPLICATION_REJECT_REASONS)[number];

/** Quem pediu o encerramento: a equipe (o padrão, nunca mais) ou o gestor (decisão 13). */
export const CLOSE_REASONS = ['staff', 'owner_request'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

/** Uma decisão no `history` da candidatura. */
export type ApplicationHistoryItem = {
  round: number;
  decision: 'approved' | 'rejected';
  reason: ApplicationRejectReason | null;
  /** Em ms. */
  at: number;
};

/** `fanClubApplications/{uid}` lido, com as datas em ms. */
export type ApplicationRecord = {
  uid: string;
  artistId: string;
  artistName: string;
  status: ApplicationStatus;
  round: number;
  proposedName: string;
  rulesVersion: string;
  rulesAcceptedAt: number | null;
  adultDeclared: boolean;
  submittedAt: number | null;
  decidedAt: number | null;
  rejectReason: ApplicationRejectReason | null;
  canReapplyAt: number | null;
  clubId: string | null;
  closedByStaff: boolean;
  history: ApplicationHistoryItem[];
};

/** `fanClubs/{clubId}` lido (só o que a API e o painel do servidor usam), com as datas em ms. */
export type FanClubRecord = {
  id: string;
  artistId: string;
  artistName: string;
  ownerUid: string | null;
  name: string | null;
  status: FanClubStatus;
  statusReason: FanClubStatusReason | null;
  postCount: number;
  pendingPosts: number;
  featured: boolean;
  featuredUntil: string | null;
  /** Oficializado pela equipe: o selo do fã-clube oficial (34.23). */
  official: boolean;
  lastReward: { at: number | null; points: number | null; prize: boolean } | null;
  /** Os seguidores da cópia da noite (`counts.followers`, decisão 28): a ordem das listas. */
  followers: number;
  /** As cópias do gestor (null na lápide). */
  ownerName: string | null;
  ownerUsername: string | null;
  ownerPhotoURL: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** Um `Timestamp` (ou qualquer coisa com `toMillis`) em ms, ou null. */
export function millisOf(value: unknown): number | null {
  const toMillis = (value as { toMillis?: unknown } | null | undefined)?.toMillis;
  if (typeof toMillis !== 'function') return null;
  const ms = (toMillis as () => unknown).call(value);
  return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** A rodada guardada: inteiro de 0 a 3 (0 depois do encerramento a pedido); estranha vale 0. */
const roundOf = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  (list as readonly unknown[]).includes(value) ? (value as T) : null;

function historyOf(value: unknown): ApplicationHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): ApplicationHistoryItem[] => {
    if (!isRecord(item)) return [];
    const decision =
      item.decision === 'approved' || item.decision === 'rejected' ? item.decision : null;
    if (decision === null) return [];
    return [
      {
        round: roundOf(item.round),
        decision,
        reason: oneOf(APPLICATION_REJECT_REASONS, item.reason),
        at: millisOf(item.at) ?? 0,
      },
    ];
  });
}

/** A candidatura lida. O status estranho vale `withdrawn` (nada a decidir nem a recusar). */
export function applicationRecord(uid: string, data: Record<string, unknown>): ApplicationRecord {
  return {
    uid,
    artistId: typeof data.artistId === 'string' ? data.artistId : '',
    artistName: typeof data.artistName === 'string' ? data.artistName : '',
    status: oneOf(APPLICATION_STATUSES, data.status) ?? 'withdrawn',
    round: roundOf(data.round),
    proposedName: typeof data.proposedName === 'string' ? data.proposedName : '',
    rulesVersion: typeof data.rulesVersion === 'string' ? data.rulesVersion : '',
    rulesAcceptedAt: millisOf(data.rulesAcceptedAt),
    adultDeclared: data.adultDeclared === true,
    submittedAt: millisOf(data.submittedAt),
    decidedAt: millisOf(data.decidedAt),
    rejectReason: oneOf(APPLICATION_REJECT_REASONS, data.rejectReason),
    canReapplyAt: millisOf(data.canReapplyAt),
    clubId: text(data.clubId),
    closedByStaff: data.closedByStaff === true,
    history: historyOf(data.history),
  };
}

/** O fã-clube lido. O status estranho vale `closed` (não aparece nem publica). */
export function fanClubRecord(id: string, data: Record<string, unknown>): FanClubRecord {
  const reward = isRecord(data.lastReward) ? data.lastReward : null;
  return {
    id,
    artistId: typeof data.artistId === 'string' ? data.artistId : '',
    artistName: typeof data.artistName === 'string' ? data.artistName : '',
    ownerUid: text(data.ownerUid),
    name: text(data.name),
    status: oneOf(FAN_CLUB_STATUSES, data.status) ?? 'closed',
    statusReason: oneOf(
      ['staff', 'owner_request', 'suspended', 'account_deleted'],
      data.statusReason,
    ),
    postCount: count(data.postCount),
    pendingPosts: count(data.pendingPosts),
    featured: data.featured === true,
    featuredUntil: typeof data.featuredUntil === 'string' ? data.featuredUntil : null,
    official: data.official === true,
    lastReward: reward
      ? {
          at: millisOf(reward.at),
          points: typeof reward.points === 'number' ? count(reward.points) : null,
          prize: reward.prize === true,
        }
      : null,
    followers: count(isRecord(data.counts) ? data.counts.followers : undefined),
    ownerName: text(data.ownerName),
    ownerUsername: text(data.ownerUsername),
    ownerPhotoURL: text(data.ownerPhotoURL),
  };
}

/** O fã-clube ativo ou pausado: o "um por fã" da decisão 12 e o `has-content` do artista. */
export const isLiveFanClub = (status: FanClubStatus): boolean =>
  status === 'active' || status === 'paused';

// --- As caixas por artista (decisão 9) --------------------------------------------

/** O que as caixas do `artistPrivate/{id}.fanClubs` valem para o app. */
export type FanClubBoxes = { enabled: boolean; photosAllowed: boolean };

/** A caixa gravada: `true` ou `false`, ou `undefined` sem o campo. */
function storedBox(data: Record<string, unknown> | undefined, key: keyof FanClubBoxes) {
  const boxes = isRecord(data?.fanClubs) ? data.fanClubs : {};
  const value = boxes[key];
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * O valor de cada caixa como o diálogo do artista mostra (decisão 9): o
 * gravado, ou, sem ele, o `imageRightsConfirmed` (ligada para toda central
 * com a autorização de imagem). O `editArtist` compara com ele.
 */
export function fanClubBoxValue(
  data: Record<string, unknown> | undefined,
  key: keyof FanClubBoxes,
): boolean {
  return storedBox(data, key) ?? data?.imageRightsConfirmed === true;
}

/**
 * O que as caixas valem para o fã: só com o `imageRightsConfirmed` (a
 * autorização de imagem cobre as fotos dos fãs, resposta do dono de
 * 16/10/2026), e só o `false` gravado desliga.
 */
export function fanClubBoxes(data: Record<string, unknown> | undefined): FanClubBoxes {
  const rights = data?.imageRightsConfirmed === true;
  return {
    enabled: rights && storedBox(data, 'enabled') !== false,
    photosAllowed: rights && storedBox(data, 'photosAllowed') !== false,
  };
}

// --- As recusas da API (34.3) ------------------------------------------------------

/** O motivo do 400 `fan_club_invalid`. */
export type FanClubInvalidReason = 'format' | 'not_allowed' | 'official';

/**
 * Os campos do `fan_club_invalid`: os da candidatura, o texto da publicação,
 * a foto e a miniatura que chegaram fora do teto (decisão 15) e a versão do
 * regulamento no novo aceite.
 */
export type FanClubInvalidField =
  | 'name'
  | 'pitch'
  | 'instagram'
  | 'tiktok'
  | 'socials'
  | 'whatsapp'
  | 'adult'
  | 'rulesVersion'
  | 'text'
  | 'photo'
  | 'thumb';

/**
 * Os motivos do 409 `fan_club_refused` das etapas 1 e 2 de 34.14 (34.3), mais
 * o `applications_closed`: a candidatura com o `FAN_CLUB_OPEN` desligado
 * (decisão 9; o `program_closed` do `unavailableReason` é o fã-clube fechado
 * para o artista). O `contact_required` é do `PUT /me/contact` (decisão 14).
 * Os da publicação (etapa 2): `club_not_active`, `photos_not_allowed`,
 * `rules_outdated`, `upload_missing` e `too_many_pending`. Os do seguir
 * (etapa 4): `own_fan_club` e `follow_limit`. O da Fase 2 (seção 37, 37.3):
 * `not_following`, comentar e reagir sem seguir e sem ser o gestor.
 */
export type FanClubRefusal =
  | 'applications_closed'
  | 'username_required'
  | 'not_member'
  | 'artist_closed'
  | 'already_applied'
  | 'has_fan_club'
  | 'cooldown'
  | 'too_many_rounds'
  | 'not_allowed'
  | 'contact_required'
  | 'club_not_active'
  | 'photos_not_allowed'
  | 'rules_outdated'
  | 'upload_missing'
  | 'too_many_pending'
  | 'own_fan_club'
  | 'follow_limit'
  | 'not_following';

export type FanClubErrorCode =
  | 'fan_club_invalid'
  | 'fan_club_refused'
  | 'fan_club_not_found'
  | 'fan_club_post_not_found'
  | 'fan_club_comment_not_found';

const FAN_CLUB_MESSAGES: Record<FanClubErrorCode, string> = {
  fan_club_invalid: 'Campo fora do formato.',
  fan_club_refused: 'Isso não pode ser feito no fã-clube agora.',
  fan_club_not_found: 'Fã-clube não encontrado.',
  fan_club_post_not_found: 'Publicação não encontrada.',
  fan_club_comment_not_found: 'Comentário não encontrado.',
};

/**
 * Recusa do fã-clube. A API traduz o `reason` no código dela (400
 * `fan_club_invalid` com `details: { field, reason }`, 409
 * `fan_club_refused` com `details: { reason }` e os 404 `fan_club_not_found`,
 * `fan_club_post_not_found` e `fan_club_comment_not_found`, sem detalhes).
 */
export class FanClubError extends Error {
  readonly reason: FanClubErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: FanClubErrorCode, details?: Record<string, unknown>) {
    super(FAN_CLUB_MESSAGES[reason]);
    this.name = 'FanClubError';
    this.reason = reason;
    this.details = details;
  }
}

export const fanClubInvalid = (field: FanClubInvalidField, reason: FanClubInvalidReason) =>
  new FanClubError('fan_club_invalid', { field, reason });

export const fanClubRefused = (reason: FanClubRefusal, extra: Record<string, unknown> = {}) =>
  new FanClubError('fan_club_refused', { reason, ...extra });

/** O fã-clube que não existe ou que a pessoa não pode ver (404, decisão 19). */
export const fanClubNotFound = () => new FanClubError('fan_club_not_found');

/** A publicação que não existe, fora do ar ou de outro autor (404). */
export const fanClubPostNotFound = () => new FanClubError('fan_club_post_not_found');

/**
 * O comentário que não existe, que quem pede não vê ou de outra publicação
 * (404, seção 37, 37.3): o mesmo nos três casos, para ninguém descobrir o
 * estado de um comentário alheio.
 */
export const fanClubCommentNotFound = () => new FanClubError('fan_club_comment_not_found');

// --- O nome e o texto de divulgação (decisões 8 e 10) ------------------------------

/** A palavra recusada no nome (decisão 10), depois da normalização do filtro. */
const OFFICIAL = 'oficial';

/**
 * O nome tem a palavra "oficial" inteira, depois da normalização do filtro
 * (caixa, acentos, homóglifos, letras repetidas e letras soltas juntadas).
 * "Oficialmente" e "fãclubeoficial" passam: o nome ainda passa pela equipe.
 */
export function hasOfficialWord(name: string): boolean {
  const { pieces, runs } = filterTokens(name);
  return [...pieces, ...runs.map((run) => run.piece)].some((piece) => piece.includes(OFFICIAL));
}

export type ClubNameCheck =
  { ok: true; name: string } | { ok: false; reason: FanClubInvalidReason };

/**
 * O nome do fã-clube limpo e conferido, sem leitura: de 3 a 40 numa linha
 * visível (`format`), sem a palavra "oficial" (`official`) e, por último,
 * fora da lista do filtro (`not_allowed`, o campo `fanClubName`). A
 * candidatura e a aprovação (que confirma ou ajusta o nome) usam a mesma
 * regra.
 */
export function checkClubName(raw: string): ClubNameCheck {
  const name = cleanLine(raw);
  if (name.length < FAN_CLUB_NAME_MIN || name.length > FAN_CLUB_NAME_MAX || !isVisibleLine(name)) {
    return { ok: false, reason: 'format' };
  }
  if (hasOfficialWord(name)) return { ok: false, reason: 'official' };
  if (isBlockedText(name, 'fanClubName')) return { ok: false, reason: 'not_allowed' };
  return { ok: true, name };
}

/** O texto de divulgação limpo: de 20 a 1.000, linhas visíveis e fora do filtro (`fanClubPitch`). */
function cleanPitch(raw: string): string {
  const pitch = cleanMultiline(raw);
  if (
    pitch.length < FAN_CLUB_PITCH_MIN ||
    pitch.length > FAN_CLUB_PITCH_MAX ||
    !isVisibleMultiline(pitch)
  ) {
    throw fanClubInvalid('pitch', 'format');
  }
  if (isBlockedText(pitch, 'fanClubPitch')) throw fanClubInvalid('pitch', 'not_allowed');
  return pitch;
}

/** Uma rede da candidatura, pelo `normalizeSocialHandle` do perfil e pelo filtro das redes. */
function cleanSocial(network: 'instagram' | 'tiktok', raw: string | null): string | null {
  const result = normalizeSocialHandle(network, raw ?? '');
  if (!result.ok) throw fanClubInvalid(network, 'format');
  if (result.handle !== null && isBlockedSocial(result.handle)) {
    throw fanClubInvalid(network, 'not_allowed');
  }
  return result.handle;
}

// --- O corpo da candidatura (34.3 e 34.5) ------------------------------------------

/** As chaves aceitas no corpo do `POST /me/fan-club/application`. */
export const APPLICATION_KEYS = [
  'artistId',
  'name',
  'instagram',
  'tiktok',
  'whatsapp',
  'pitch',
  'adult',
  'rulesVersion',
] as const;

/** O corpo conferido e limpo. */
export type ApplicationInput = {
  artistId: string;
  name: string;
  instagram: string | null;
  tiktok: string | null;
  /** O WhatsApp no formato guardado (`+55`, o DDD e o celular), para o contato do fã (decisão 14). */
  whatsapp: string;
  pitch: string;
};

export type ParsedApplication =
  { ok: true; value: ApplicationInput } | { ok: false; field: string };

const isTextOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/**
 * O corpo da candidatura, conferido antes da transação e sem leitura (o
 * `validate` da rota chama de novo no `handle`):
 * - corpo que não é objeto, chave desconhecida ou tipo errado: `{ ok: false }`
 *   com o campo (400 `invalid_request` na rota);
 * - o resto fora da regra lança `fan_club_invalid` com o campo e o motivo, na
 *   ordem: o nome, o texto de divulgação, as redes (pelo menos uma), o
 *   WhatsApp (obrigatório, pelo `parseWhatsapp` do contato do fã: o celular
 *   brasileiro com o DDD e o 9), o `adult: true` e a `rulesVersion` igual à do
 *   servidor.
 */
export function parseApplication(
  body: unknown,
  rulesVersion: string = FAN_CLUB_RULES_VERSION,
): ParsedApplication {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const keys = Object.keys(body);
  const unknownKey = keys.find((key) => !(APPLICATION_KEYS as readonly string[]).includes(key));
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  if (!isArtistId(body.artistId)) return { ok: false, field: 'artistId' };
  for (const key of ['name', 'pitch', 'whatsapp', 'rulesVersion'] as const) {
    if (typeof body[key] !== 'string') return { ok: false, field: key };
  }
  for (const key of ['instagram', 'tiktok'] as const) {
    if (body[key] !== undefined && !isTextOrNull(body[key])) return { ok: false, field: key };
  }
  if (typeof body.adult !== 'boolean') return { ok: false, field: 'adult' };

  const name = checkClubName(body.name as string);
  if (!name.ok) throw fanClubInvalid('name', name.reason);
  const pitch = cleanPitch(body.pitch as string);
  const instagram = cleanSocial('instagram', (body.instagram as string | null | undefined) ?? null);
  const tiktok = cleanSocial('tiktok', (body.tiktok as string | null | undefined) ?? null);
  if (instagram === null && tiktok === null) throw fanClubInvalid('socials', 'format');
  const whatsapp = parseWhatsapp(body.whatsapp);
  if (whatsapp === null) throw fanClubInvalid('whatsapp', 'format');
  if (body.adult !== true) throw fanClubInvalid('adult', 'format');
  if (body.rulesVersion !== rulesVersion) throw fanClubInvalid('rulesVersion', 'format');
  return {
    ok: true,
    value: { artistId: body.artistId, name: name.name, instagram, tiktok, whatsapp, pitch },
  };
}

// --- A candidatura de novo (34.5) ---------------------------------------------------

/** A recusa da candidatura nova pelo que a anterior diz, ou a rodada da nova. */
export type ApplicationTurn =
  | { ok: true; round: number }
  | { ok: false; refusal: FanClubRefusal; details?: Record<string, unknown> };

/**
 * Se a candidatura pode ir de novo, pela anterior e pelo status do fã-clube
 * dela (puro), na ordem de 34.5: encerrado pela equipe (`not_allowed`, para
 * sempre), pendente (`already_applied`), aprovada com o fã-clube ativo ou
 * pausado (`has_fan_club`), o `canReapplyAt` no futuro (`cooldown`, com a
 * data) e a 3ª rodada já usada (`too_many_rounds`). A rodada nova: 1 na
 * primeira, a mesma depois de desistir, mais 1 depois da recusa ou do
 * fã-clube encerrado a pedido (que volta a rodada a 0).
 */
export function applicationTurn(
  previous: ApplicationRecord | null,
  clubStatus: FanClubStatus | null,
  now: number,
): ApplicationTurn {
  if (previous === null) return { ok: true, round: 1 };
  if (previous.closedByStaff) return { ok: false, refusal: 'not_allowed' };
  if (previous.status === 'pending') return { ok: false, refusal: 'already_applied' };
  if (previous.status === 'approved' && clubStatus !== null && isLiveFanClub(clubStatus)) {
    return { ok: false, refusal: 'has_fan_club' };
  }
  if (previous.canReapplyAt !== null && previous.canReapplyAt > now) {
    return {
      ok: false,
      refusal: 'cooldown',
      details: { canReapplyAt: new Date(previous.canReapplyAt).toISOString() },
    };
  }
  const round = previous.status === 'withdrawn' ? Math.max(previous.round, 1) : previous.round + 1;
  if (round > FAN_CLUB_ROUNDS_MAX) return { ok: false, refusal: 'too_many_rounds' };
  return { ok: true, round };
}

/** O `canReapplyAt` da recusa: 30 dias depois, ou null na 3ª rodada (não há outra). */
export function reapplyAfterRejection(round: number, now: number): number | null {
  return round >= FAN_CLUB_ROUNDS_MAX ? null : now + FAN_CLUB_REAPPLY_MS;
}

/** O `history` com a decisão nova no fim, dentro do teto (saem as mais antigas). */
export function withHistory(
  history: readonly ApplicationHistoryItem[],
  item: ApplicationHistoryItem,
): ApplicationHistoryItem[] {
  return [...history, item].slice(-FAN_CLUB_HISTORY_MAX);
}

// --- O Destaque (decisão 35) ---------------------------------------------------------

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O fim do Destaque (`AAAA-MM-DD`, o dia de São Paulo), de amanhã a 31 dias,
 * ou null fora disso (data que não existe inclusive).
 */
export function parseFeaturedUntil(value: unknown, now: number): string | null {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return null;
  if (shiftDay(value, 0) !== value) return null;
  const today = dayKey(now);
  if (value < shiftDay(today, 1) || value > shiftDay(today, FEATURE_DAYS_MAX)) return null;
  return value;
}

/** O Destaque vale hoje: marcado e com o fim de hoje em diante (a `api` confere o prazo). */
export function isFeaturedNow(
  club: Pick<FanClubRecord, 'featured' | 'featuredUntil'>,
  now: number,
): boolean {
  return club.featured && club.featuredUntil !== null && club.featuredUntil >= dayKey(now);
}

// --- O Recompensar (decisões 43 a 46 e 50) ---------------------------------------------

/**
 * O `grantId` do Recompensar: o formato do `adjustmentId` do Ajuste (o painel
 * sorteia ao abrir o diálogo, como o `newAdjustmentId`). É o id do registro
 * `fanClubs/{clubId}/prizes/{grantId}` e o evento do lançamento
 * `fanclub_prize:<grantId>`.
 */
export const FAN_CLUB_GRANT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** O cupom do parceiro, numa linha, e a mensagem da equipe ao gestor (decisão 43). */
export const PRIZE_COUPON_MAX = 60;
export const PRIZE_MESSAGE_MAX = 140;

/** A nota interna do Recompensar (34.3): de 1 a 200, numa linha, sem dado pessoal. */
export const REWARD_NOTE_MAX = 200;

/** O prêmio pedido no Recompensar: a recompensa "Só para prêmios", o "O cupom já é o prêmio", o cupom e a mensagem. */
export type PrizeInput = {
  rewardId: string;
  delivered: boolean;
  coupon: string | null;
  message: string | null;
};

/** O Recompensar conferido (sem o teto do papel, que a callable confere com quem chama). */
export type RewardGrantInput = {
  grantId: string;
  /** Os pontos, só no saldo (decisão 45); null sem pontos. */
  points: number | null;
  prize: PrizeInput | null;
  note: string;
};

export type ParsedRewardGrant =
  { ok: true; value: RewardGrantInput } | { ok: false; field: string };

const PRIZE_KEYS = ['rewardId', 'delivered', 'coupon', 'message'] as const;

/** O cupom: ausente, null ou vazio vale null; senão de 1 a 60, numa linha visível, sem quebra. */
export function parsePrizeCoupon(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const coupon = cleanLine(value);
  if (coupon === '') return { ok: true, value: null };
  if (coupon.length > PRIZE_COUPON_MAX || !isVisibleLine(coupon)) return { ok: false };
  return { ok: true, value: coupon };
}

/** A mensagem: ausente, null ou vazia vale null; senão de 1 a 140, limpa (`cleanMultiline`). */
export function parsePrizeMessage(
  value: unknown,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const message = cleanMultiline(value);
  if (message === '') return { ok: true, value: null };
  if (message.length > PRIZE_MESSAGE_MAX || !isVisibleMultiline(message)) return { ok: false };
  return { ok: true, value: message };
}

/**
 * Os campos do `reward` da `decideFanClub` (34.3), puro: o `grantId` no
 * formato; os `points`, inteiro a partir de 1 (o teto do papel vem depois),
 * ou ausentes; o `prize`, `{ rewardId, delivered, coupon, message }` sem
 * outras chaves, ou ausente; pelo menos um dos dois (senão o campo `points`);
 * e a `note` de 1 a 200, numa linha visível. O primeiro campo fora do formato
 * volta como `field`.
 */
export function parseRewardGrant(fields: Record<string, unknown>): ParsedRewardGrant {
  const fail = (field: string): ParsedRewardGrant => ({ ok: false, field });
  if (typeof fields.grantId !== 'string' || !FAN_CLUB_GRANT_ID_PATTERN.test(fields.grantId)) {
    return fail('grantId');
  }
  let points: number | null = null;
  if (fields.points !== undefined && fields.points !== null) {
    if (
      typeof fields.points !== 'number' ||
      !Number.isSafeInteger(fields.points) ||
      fields.points < 1
    ) {
      return fail('points');
    }
    points = fields.points;
  }
  let prize: PrizeInput | null = null;
  if (fields.prize !== undefined && fields.prize !== null) {
    const raw = fields.prize;
    if (
      !isRecord(raw) ||
      Object.keys(raw).some((key) => !(PRIZE_KEYS as readonly string[]).includes(key))
    ) {
      return fail('prize');
    }
    // O id da recompensa: o `isRewardId` da loja, que é o `isContentId`.
    if (!isContentId(raw.rewardId)) return fail('prize.rewardId');
    if (typeof raw.delivered !== 'boolean') return fail('prize.delivered');
    const coupon = parsePrizeCoupon(raw.coupon);
    if (!coupon.ok) return fail('prize.coupon');
    const message = parsePrizeMessage(raw.message);
    if (!message.ok) return fail('prize.message');
    prize = {
      rewardId: raw.rewardId,
      delivered: raw.delivered,
      coupon: coupon.value,
      message: message.value,
    };
  }
  if (points === null && prize === null) return fail('points');
  if (typeof fields.note !== 'string') return fail('note');
  const note = cleanLine(fields.note);
  if (note.length < 1 || note.length > REWARD_NOTE_MAX || !isVisibleLine(note)) {
    return fail('note');
  }
  return { ok: true, value: { grantId: fields.grantId, points, prize, note } };
}

/** `fanClubs/{clubId}/prizes/{grantId}` lido (decisão 50): sem o código do pedido nem o cupom. */
export type FanClubPrizeRecord = {
  grantId: string;
  clubId: string;
  artistId: string;
  points: number | null;
  ledgerId: string | null;
  prize: { rewardId: string; rewardTitle: string; rewardKind: string; delivered: boolean } | null;
  note: string;
  at: number | null;
};

export function fanClubPrizeRecord(id: string, data: Record<string, unknown>): FanClubPrizeRecord {
  const prize = isRecord(data.prize) ? data.prize : null;
  return {
    grantId: id,
    clubId: typeof data.clubId === 'string' ? data.clubId : '',
    artistId: typeof data.artistId === 'string' ? data.artistId : '',
    points: typeof data.points === 'number' && data.points > 0 ? count(data.points) : null,
    ledgerId: text(data.ledgerId),
    prize: prize
      ? {
          rewardId: typeof prize.rewardId === 'string' ? prize.rewardId : '',
          rewardTitle: typeof prize.rewardTitle === 'string' ? prize.rewardTitle : '',
          rewardKind: typeof prize.rewardKind === 'string' ? prize.rewardKind : '',
          delivered: prize.delivered === true,
        }
      : null,
    note: typeof data.note === 'string' ? data.note : '',
    at: millisOf(data.at),
  };
}

/**
 * O registro gravado é o mesmo Recompensar do pedido (34.3): os pontos, a
 * recompensa, o "O cupom já é o prêmio" e a nota; e, com o pedido de prêmio
 * achado pelo `grantId` (`order`, sem a exclusão de conta, que tira o cupom e
 * a mensagem), o cupom e a mensagem, que moram só nele. Outros valores com o
 * mesmo `grantId`: `grant-id-reused`.
 */
export function sameRewardGrant(
  stored: FanClubPrizeRecord,
  input: RewardGrantInput,
  order: { coupon: string | null; message: string | null } | null,
): boolean {
  if (stored.points !== input.points || stored.note !== input.note) return false;
  if ((stored.prize === null) !== (input.prize === null)) return false;
  if (!stored.prize || !input.prize) return true;
  if (
    stored.prize.rewardId !== input.prize.rewardId ||
    stored.prize.delivered !== input.prize.delivered
  ) {
    return false;
  }
  return (
    order === null || (order.coupon === input.prize.coupon && order.message === input.prize.message)
  );
}

/** As travas do prêmio que falham (decisão 46), na ordem; null quando todas passam. */
export type PrizeBlock = 'club_not_active' | 'not_adult' | 'owner_suspended';

export function prizeBlock(input: {
  club: Pick<FanClubRecord, 'status' | 'ownerUid'>;
  adultDeclared: boolean;
  ownerSuspended: boolean;
}): PrizeBlock | null {
  if (input.club.status !== 'active' || input.club.ownerUid === null) return 'club_not_active';
  if (!input.adultDeclared) return 'not_adult';
  if (input.ownerSuspended) return 'owner_suspended';
  return null;
}

// --- As publicações (decisões 15 a 20) ------------------------------------------------

export const FAN_CLUB_POST_STATUSES = [
  'pending',
  'published',
  'rejected',
  'withdrawn',
  'hidden',
  'removed',
] as const;
export type FanClubPostStatus = (typeof FAN_CLUB_POST_STATUSES)[number];

/** Os motivos da recusa da publicação pela equipe (34.3). */
export const POST_REJECT_REASONS = [
  'image_rights',
  'off_topic',
  'quality',
  'rules',
  'other',
] as const;
export type PostRejectReason = (typeof POST_REJECT_REASONS)[number];

/**
 * A pasta das fotos das publicações de um gestor no Storage, fora de
 * `fans/{uid}/`, que a varredura da foto do perfil esvazia (34.6). Com a
 * barra do fim, para o prefixo não pegar outro uid.
 */
export const fanClubMediaFolder = (uid: string): string => `fanClubMedia/${uid}/`;

/** O nome de um arquivo da vaga: `club-photo-<id>.jpg` ou `club-thumb-<id>.jpg` (o `storage.rules`). */
export const FAN_CLUB_MEDIA_NAME = /^club-(photo|thumb)-[a-z0-9-]{8,40}\.jpg$/;

/** Os dois nomes de uma vaga, com o mesmo id: a foto e a miniatura. */
export function slotFileNames(id: string): { photo: string; thumb: string } {
  return { photo: `club-photo-${id}.jpg`, thumb: `club-thumb-${id}.jpg` };
}

/**
 * Os dois nomes guardados numa vaga (`fileNames`), na ordem da foto e da
 * miniatura, ou null fora do formato.
 */
export function slotNamesOf(value: unknown): { photo: string; thumb: string } | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [photo, thumb] = value as unknown[];
  if (typeof photo !== 'string' || typeof thumb !== 'string') return null;
  if (!FAN_CLUB_MEDIA_NAME.test(photo) || !FAN_CLUB_MEDIA_NAME.test(thumb)) return null;
  if (!photo.startsWith('club-photo-') || !thumb.startsWith('club-thumb-')) return null;
  return { photo, thumb };
}

/** A diferença de proporção aceita entre a foto e a miniatura (o arredondamento da redução). */
export const PROPORTION_TOLERANCE = 0.02;

/**
 * A miniatura tem a proporção da foto (o app gera as duas em 4:5 da mesma
 * imagem), com a folga do arredondamento: a dupla de imagens diferentes, com
 * outra forma, é recusada. A mesma forma com outro conteúdo passa: a equipe
 * revisa as duas (34.10).
 */
export function sameProportion(
  photo: { width: number; height: number },
  thumb: { width: number; height: number },
): boolean {
  if (photo.width < 1 || photo.height < 1 || thumb.width < 1 || thumb.height < 1) return false;
  const a = photo.width / photo.height;
  const b = thumb.width / thumb.height;
  return Math.abs(a - b) <= PROPORTION_TOLERANCE * a;
}

/** Uma imagem da publicação: a URL com token, o caminho e o tamanho lido no arquivo. */
export type PostImage = { url: string; path: string; width: number; height: number };

/** A foto e a miniatura da publicação com foto. */
export type PostMedia = { photo: PostImage; thumb: PostImage };

/** `fanClubPosts/{postId}` lido, com as datas em ms. */
export type FanClubPostRecord = {
  id: string;
  clubId: string;
  artistId: string;
  authorUid: string;
  authorName: string | null;
  authorUsername: string | null;
  authorPhotoURL: string | null;
  kind: 'text' | 'photo';
  text: string;
  media: PostMedia | null;
  status: FanClubPostStatus;
  rejectReason: PostRejectReason | null;
  submittedAt: number;
  publishedAt: number | null;
  reviewedAt: number | null;
  /**
   * Os contadores da Fase 2 (seção 37, 37.2), somados com `increment` na
   * transação da reação e do comentário: as reações (o total e por emoji) e
   * os comentários que aparecem. O ausente vale 0, sem carga nas publicações
   * de antes.
   */
  reactionCount: number;
  reactionCounts: FanClubReactionCounts;
  commentCount: number;
  /** As marcações do texto do gestor, resolvidas no envio (37.7); o ausente vale a lista vazia. */
  mentions: FanClubMention[];
};

const dimension = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;

function postImageOf(value: unknown): PostImage | null {
  if (!isRecord(value) || typeof value.url !== 'string' || typeof value.path !== 'string') {
    return null;
  }
  return {
    url: value.url,
    path: value.path,
    width: dimension(value.width),
    height: dimension(value.height),
  };
}

function postMediaOf(value: unknown): PostMedia | null {
  if (!isRecord(value)) return null;
  const photo = postImageOf(value.photo);
  const thumb = postImageOf(value.thumb);
  return photo && thumb ? { photo, thumb } : null;
}

/** A publicação lida. O status estranho vale `removed` (não aparece nem se decide). */
export function fanClubPostRecord(id: string, data: Record<string, unknown>): FanClubPostRecord {
  const media = postMediaOf(data.media);
  return {
    id,
    clubId: typeof data.clubId === 'string' ? data.clubId : '',
    artistId: typeof data.artistId === 'string' ? data.artistId : '',
    authorUid: typeof data.authorUid === 'string' ? data.authorUid : '',
    authorName: text(data.authorName),
    authorUsername: text(data.authorUsername),
    authorPhotoURL: text(data.authorPhotoURL),
    kind: media !== null ? 'photo' : 'text',
    text: typeof data.text === 'string' ? data.text : '',
    media,
    status: oneOf(FAN_CLUB_POST_STATUSES, data.status) ?? 'removed',
    rejectReason: oneOf(POST_REJECT_REASONS, data.rejectReason),
    submittedAt: millisOf(data.submittedAt) ?? 0,
    publishedAt: millisOf(data.publishedAt),
    reviewedAt: millisOf(data.reviewedAt),
    reactionCount: count(data.reactionCount),
    reactionCounts: reactionCountsOf(data.reactionCounts),
    commentCount: count(data.commentCount),
    mentions: mentionsOf(data.mentions),
  };
}

/** Os caminhos da mídia de uma publicação (a foto e a miniatura), para apagar ou trocar o token. */
export const postMediaPaths = (post: Pick<FanClubPostRecord, 'media'>): string[] =>
  post.media ? [post.media.photo.path, post.media.thumb.path] : [];

/** As chaves aceitas no corpo do `POST /me/fan-club/posts`. */
export const POST_KEYS = ['text', 'photo'] as const;

/** O corpo da publicação conferido e limpo. */
export type PostInput = { text: string; photo: boolean };

export type ParsedPost = { ok: true; value: PostInput } | { ok: false; field: string };

/**
 * O corpo da publicação, conferido antes da transação e sem leitura (o
 * `validate` da rota chama de novo no `handle`): corpo que não é objeto,
 * chave desconhecida, o `text` que não é texto e o `photo` que não é booleano
 * são `{ ok: false }` com o campo (400 `invalid_request`); o texto de 1 a
 * 1.000 em linhas visíveis (`format`) e fora do filtro (`not_allowed`, o campo
 * `fanClubPost`) lança `fan_club_invalid` com `field: 'text'`. Desde a Fase 2
 * (seção 37, 37.7), o filtro confere o texto com o "@" tirado de todo @ que
 * pode virar marcação, como o do comentário; a conferência que vale é a da
 * transação, depois de resolver (`isBlockedWithMentions`).
 */
export function parsePost(body: unknown): ParsedPost {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const unknownKey = Object.keys(body).find(
    (key) => !(POST_KEYS as readonly string[]).includes(key),
  );
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  if (typeof body.text !== 'string') return { ok: false, field: 'text' };
  if (typeof body.photo !== 'boolean') return { ok: false, field: 'photo' };
  const cleaned = cleanMultiline(body.text);
  if (
    cleaned.length < 1 ||
    cleaned.length > FAN_CLUB_POST_TEXT_MAX ||
    !isVisibleMultiline(cleaned)
  ) {
    throw fanClubInvalid('text', 'format');
  }
  const filtered = mentionFilterText(cleaned, findMentionTokens(cleaned));
  if (isBlockedText(filtered, 'fanClubPost')) throw fanClubInvalid('text', 'not_allowed');
  return { ok: true, value: { text: cleaned, photo: body.photo } };
}

/**
 * O corpo do novo aceite (`PUT /me/fan-club/rules`): `{ rulesVersion }`. Corpo
 * que não é objeto, chave desconhecida e versão que não é texto são
 * `{ ok: false }` com o campo; a versão diferente da do servidor lança
 * `fan_club_invalid` com `field: 'rulesVersion'`.
 */
export function parseRulesAcceptance(
  body: unknown,
  rulesVersion: string = FAN_CLUB_RULES_VERSION,
): { ok: true } | { ok: false; field: string } {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const unknownKey = Object.keys(body).find((key) => key !== 'rulesVersion');
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  if (typeof body.rulesVersion !== 'string') return { ok: false, field: 'rulesVersion' };
  if (body.rulesVersion !== rulesVersion) throw fanClubInvalid('rulesVersion', 'format');
  return { ok: true };
}

// --- A atribuição (decisões 22 a 24) ---------------------------------------------------

/** O crédito pelo código do gestor vale até 30 dias depois do cadastro de quem entra (decisão 23). */
export const FAN_CLUB_CREDIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** O perfil de quem entra tem até 30 dias (o `createdAt`); sem a data, não. */
export function isWithinCreditWindow(profileCreatedAt: number | null, now: number): boolean {
  return profileCreatedAt !== null && now - profileCreatedAt <= FAN_CLUB_CREDIT_WINDOW_MS;
}

/** Como a entrada foi trazida: seguindo o fã-clube (etapa 4) ou pelo código do gestor. */
export type FanClubCreditVia = 'follow' | 'owner_code';

/** O crédito de uma entrada: o fã-clube que trouxe, a central dele e o caminho. */
export type FanClubCredit = { clubId: string; artistId: string; via: FanClubCreditVia };

/** Os números do fã-clube que somam nos shards, na transação da ação (decisão 24). */
export const FAN_CLUB_COUNT_FIELDS = ['links', 'visits', 'signups', 'joins'] as const;
export type FanClubCountField = (typeof FAN_CLUB_COUNT_FIELDS)[number];
export type FanClubCounts = Record<FanClubCountField, number>;

/**
 * A soma dos shards do fã-clube, campo a campo: o que não é número conta 0, e
 * a soma nunca sai negativa (só há `increment` de 1 para cima; um valor
 * estranho não derruba a tela).
 */
export function sumFanClubShards(shards: readonly Record<string, unknown>[]): FanClubCounts {
  const sums: FanClubCounts = { links: 0, visits: 0, signups: 0, joins: 0 };
  for (const shard of shards) {
    for (const field of FAN_CLUB_COUNT_FIELDS) {
      const value = shard[field];
      if (typeof value === 'number' && Number.isFinite(value)) sums[field] += Math.trunc(value);
    }
  }
  for (const field of FAN_CLUB_COUNT_FIELDS) sums[field] = Math.max(0, sums[field]);
  return sums;
}

// --- Os seguidores (decisões 26 a 34 e 39) ---------------------------------------------

/** Os sinais de qualidade do vínculo de seguir, gravados na hora de seguir (decisão 39). */
export type FollowSignals = { newAccount: boolean; chosenUsername: boolean; byOwnerCode: boolean };

/**
 * Os três sinais do vínculo (decisão 39): a conta nova (o perfil com menos de
 * 7 dias; sem a data, não), o @ escolhido (não o automático; sem @, não) e o
 * trazido pelo gestor (o `referrals.inviterUid` de quem segue é o gestor).
 * Muitos seguidores novos, de @ automático e trazidos pelo próprio gestor são
 * o retrato da fazenda de seguidores.
 */
export function followSignals(input: {
  profileCreatedAt: number | null;
  username: unknown;
  inviterUid: unknown;
  ownerUid: string;
  now: number;
}): FollowSignals {
  const { profileCreatedAt, username, now } = input;
  return {
    newAccount: profileCreatedAt !== null && now - profileCreatedAt < NEW_ACCOUNT_MS,
    chosenUsername:
      typeof username === 'string' && username !== '' && !isAutomaticUsername(username),
    byOwnerCode: typeof input.inviterUid === 'string' && input.inviterUid === input.ownerUid,
  };
}

/**
 * A versão do aviso "o gestor vê que você é membro" (decisão 5 de 36.1; seção
 * 37, "Estado"), que o app manda ao seguir e o vínculo novo guarda com a data
 * (`memberNoticeVersion` e `memberNoticeAt`). Muda junto com o texto do app: o
 * app que manda a versão de antes recebe 400 até o EAS Update.
 */
export const FAN_CLUB_MEMBER_NOTICE_VERSION = 'membros-2026-10';

export type ParsedFollow = { ok: true; value: string | null } | { ok: false; field: string };

/**
 * O corpo do seguir (`PUT /me/fan-club-follows/:clubId`), conferido antes da
 * transação e sem leitura: `{ memberNoticeVersion }`, a versão do aviso que o
 * fã viu no botão de seguir. Sem corpo, `null` ou `{}` é o app de antes, que
 * segue sem o aviso (`value: null`, o vínculo sem a marca, 36.5). O corpo que
 * não é objeto, a chave desconhecida e a versão que não é texto ou não é a do
 * servidor são `{ ok: false }` com o campo (400 `invalid_request`).
 */
export function parseFollowBody(
  body: unknown,
  version: string = FAN_CLUB_MEMBER_NOTICE_VERSION,
): ParsedFollow {
  if (body === undefined || body === null) return { ok: true, value: null };
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const keys = Object.keys(body);
  const unknownKey = keys.find((key) => key !== 'memberNoticeVersion');
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  if (keys.length === 0) return { ok: true, value: null };
  if (body.memberNoticeVersion !== version) return { ok: false, field: 'memberNoticeVersion' };
  return { ok: true, value: version };
}

// --- A cópia da noite (decisões 28, 35 e 37) --------------------------------------------

/** Fã-clubes copiados por noite, os de cópia mais antiga primeiro (decisão 37). */
export const FAN_CLUB_COPY_MAX = 500;

/** Fã-clubes copiados ao mesmo tempo (decisão 37). */
export const FAN_CLUB_COPY_CONCURRENCY = 10;

/**
 * O prazo da cópia, contado do começo do handler do `closeStatsDays` (que tem
 * 300 s): depois dele, nenhum fã-clube novo começa, e o que sobrou fica para a
 * noite seguinte, que começa pelos de cópia mais antiga.
 */
export const FAN_CLUB_COPY_BUDGET_MS = 270_000;

/** Os números da cópia da noite (`counts`, 34.4), sem a data. */
export type FanClubCopyCounts = {
  followers: number;
  followers30d: number;
  newAccounts: number;
  automaticUsername: number;
  byOwnerCode: number;
  joins: number;
  retained: number;
  signups: number;
  visits: number;
  links: number;
};

/** O retrato de um mês (`monthStart` e `lastMonth`, 34.4). */
export type FanClubMonth = {
  month: string;
  followers: number;
  joins: number;
  signups: number;
  visits: number;
  links: number;
};

const MONTH_FIELDS = ['followers', 'joins', 'signups', 'visits', 'links'] as const;

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** O mês de São Paulo (`AAAA-MM`). */
export const monthOf = (now: number): string => dayKey(now).slice(0, 7);

/** O retrato gravado, ou null sem ele (ou fora do formato: a cópia começa de novo). */
export function fanClubMonthOf(value: unknown): FanClubMonth | null {
  if (!isRecord(value) || typeof value.month !== 'string' || !MONTH_PATTERN.test(value.month)) {
    return null;
  }
  const month: FanClubMonth = {
    month: value.month,
    followers: 0,
    joins: 0,
    signups: 0,
    visits: 0,
    links: 0,
  };
  for (const field of MONTH_FIELDS) {
    const number = value[field];
    month[field] = typeof number === 'number' && Number.isFinite(number) ? Math.trunc(number) : 0;
  }
  return month;
}

/**
 * O retrato do mês na cópia (decisão 37), puro: na primeira cópia do
 * fã-clube, só o `monthStart` com os números de agora; na primeira cópia de
 * um mês, também o `lastMonth`, os números de agora menos os do `monthStart`
 * (com o mês dele: o que mudou desde a primeira cópia daquele mês), e o
 * `monthStart` novo; no resto do mês, null (nada a gravar). Os seguidores do
 * `lastMonth` são o saldo do mês e podem sair negativos.
 */
export function monthTurn(
  monthStart: FanClubMonth | null,
  counts: FanClubCopyCounts,
  now: number,
): { monthStart: FanClubMonth; lastMonth: FanClubMonth | null } | null {
  const month = monthOf(now);
  if (monthStart !== null && monthStart.month === month) return null;
  const start: FanClubMonth = { month, followers: 0, joins: 0, signups: 0, visits: 0, links: 0 };
  for (const field of MONTH_FIELDS) start[field] = counts[field];
  if (monthStart === null) return { monthStart: start, lastMonth: null };
  const last: FanClubMonth = { ...monthStart };
  for (const field of MONTH_FIELDS) last[field] = counts[field] - monthStart[field];
  return { monthStart: start, lastMonth: last };
}

/** O Destaque marcado com o prazo vencido: a cópia da noite o desliga (decisão 35). */
export const isFeatureExpired = (
  club: Pick<FanClubRecord, 'featured' | 'featuredUntil'>,
  now: number,
): boolean => club.featured && !isFeaturedNow(club, now);

/**
 * A proporção de um sinal acima da qual a ficha do fã-clube avisa (decisão
 * 39): passou da metade. O limite é proposta, fácil de trocar.
 */
export const QUALITY_WARNING_SHARE = 0.5;

export type QualitySignal = 'newAccounts' | 'automaticUsername' | 'byOwnerCode';

/** As três proporções da qualidade dos seguidores e os sinais que passam da metade. */
export type FollowerQuality = Record<QualitySignal, number> & { warnings: QualitySignal[] };

/**
 * A qualidade dos seguidores pela cópia (decisão 39), pura: cada sinal sobre
 * os seguidores (0 sem seguidores), e o aviso de cada um acima da metade. A
 * ficha do painel (34.10, item 5) mostra o mesmo: esta é a referência dela.
 */
export function followerQuality(
  counts: Pick<FanClubCopyCounts, 'followers' | QualitySignal>,
): FollowerQuality {
  const signals: QualitySignal[] = ['newAccounts', 'automaticUsername', 'byOwnerCode'];
  const share = (value: number) => (counts.followers > 0 ? value / counts.followers : 0);
  const quality = {
    newAccounts: share(counts.newAccounts),
    automaticUsername: share(counts.automaticUsername),
    byOwnerCode: share(counts.byOwnerCode),
  };
  return {
    ...quality,
    warnings: signals.filter((signal) => quality[signal] > QUALITY_WARNING_SHARE),
  };
}

// --- As denúncias das publicações (decisão 18) ----------------------------------------

/** Como a fila da denúncia termina: pela equipe, pelo gestor que retirou ou pela exclusão dele. */
export type ReportResolution = 'kept' | 'actioned' | 'withdrawn' | 'author_deleted';

/**
 * O id da denúncia: uma por fã e publicação, regravada a cada rodada do item.
 * O `_` separa sem ambiguidade (o uid não tem `_`).
 */
export const fanClubReportId = (reporterUid: string, postId: string): string =>
  `${reporterUid}_${postId}`;

// --- As reações e os comentários (seção 37, Fase 2) --------------------------------------

/**
 * As reações (R1): a chave no dado, nunca o emoji, que traria a normalização e
 * o seletor de variação do coração. A ordem é a da fileira do app: coração,
 * fogo, risada, espanto e aplauso.
 */
export const FAN_CLUB_REACTIONS = ['heart', 'fire', 'laugh', 'wow', 'clap'] as const;
export type FanClubReactionKey = (typeof FAN_CLUB_REACTIONS)[number];

/** As reações da publicação por emoji (`reactionCounts`, 37.2). */
export type FanClubReactionCounts = Record<FanClubReactionKey, number>;

export const emptyReactionCounts = (): FanClubReactionCounts => ({
  heart: 0,
  fire: 0,
  laugh: 0,
  wow: 0,
  clap: 0,
});

/** O `reactionCounts` gravado: cada emoji da lista, e o ausente ou estranho vale 0. */
export function reactionCountsOf(value: unknown): FanClubReactionCounts {
  const counts = emptyReactionCounts();
  if (!isRecord(value)) return counts;
  for (const key of FAN_CLUB_REACTIONS) counts[key] = count(value[key]);
  return counts;
}

/** A reação gravada, ou null: sem reação, tirada (`reaction: null`) ou fora da lista. */
export const fanClubReactionOf = (value: unknown): FanClubReactionKey | null =>
  oneOf(FAN_CLUB_REACTIONS, value);

/**
 * O id da reação: uma por fã e publicação (`{uid}_{postId}`), na ordem do
 * `fanClubReportId`, para os ids compostos do fã-clube terem uma ordem só
 * (decisão 9 de 37.1). O `_` separa sem ambiguidade (o uid não tem `_`).
 */
export const fanClubReactionId = (uid: string, postId: string): string => `${uid}_${postId}`;

export type ParsedReaction = { ok: true; value: FanClubReactionKey } | { ok: false; field: string };

/**
 * O corpo do `PUT /fan-club-posts/:postId/reaction` (`{ reaction }`),
 * conferido antes da transação e sem leitura: o corpo que não é objeto, a
 * chave desconhecida e a reação fora da lista fechada são `{ ok: false }` com
 * o campo (400 `invalid_request`).
 */
export function parseReaction(body: unknown): ParsedReaction {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const unknownKey = Object.keys(body).find((key) => key !== 'reaction');
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  const reaction = fanClubReactionOf(body.reaction);
  return reaction === null ? { ok: false, field: 'reaction' } : { ok: true, value: reaction };
}

/** O que uma troca de reação muda na publicação: o total e cada emoji que mexe. */
export type ReactionDelta = {
  total: number;
  counts: Partial<Record<FanClubReactionKey, number>>;
};

/**
 * A conta da troca de reação (37.3), de `from` para `to` (null é sem
 * reação): dar soma 1 no total e no emoji; trocar tira 1 do emoji de antes e
 * soma 1 no novo, sem mexer no total; tirar tira 1 do total e do emoji. A
 * mesma reação não muda nada.
 */
export function reactionDelta(
  from: FanClubReactionKey | null,
  to: FanClubReactionKey | null,
): ReactionDelta {
  if (from === to) return { total: 0, counts: {} };
  const counts: Partial<Record<FanClubReactionKey, number>> = {};
  if (from !== null) counts[from] = -1;
  if (to !== null) counts[to] = 1;
  return { total: (to === null ? 0 : 1) - (from === null ? 0 : 1), counts };
}

/**
 * Os contadores depois da troca, a partir dos lidos na transação: a resposta
 * da reação, que o app usa para acertar o otimista. Nunca abaixo de 0 (um
 * número torto gravado não vira negativo na tela).
 */
export function applyReactionDelta(
  reactionCount: number,
  reactionCounts: FanClubReactionCounts,
  delta: ReactionDelta,
): { reactionCount: number; reactionCounts: FanClubReactionCounts } {
  const next = { ...reactionCounts };
  for (const key of FAN_CLUB_REACTIONS) {
    next[key] = Math.max(0, next[key] + (delta.counts[key] ?? 0));
  }
  return { reactionCount: Math.max(0, reactionCount + delta.total), reactionCounts: next };
}

/**
 * O status do comentário (37.2): visível, oculto pelo gestor (o autor ainda
 * vê, com o "Pedir revisão") ou oculto pela equipe (some também para o autor).
 */
export const FAN_CLUB_COMMENT_STATUSES = ['visible', 'manager_hidden', 'staff_hidden'] as const;
export type FanClubCommentStatus = (typeof FAN_CLUB_COMMENT_STATUSES)[number];

/**
 * Uma marcação resolvida (37.7): o @ como estava no texto, o tipo, o uid do
 * fã ou o id da central e as posições no texto gravado, em unidades UTF-16.
 */
export type FanClubMention = {
  handle: string;
  kind: 'fan' | 'artist';
  id: string;
  start: number;
  end: number;
};

const position = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** As marcações gravadas; a fora do formato fica de fora, e o ausente vale a lista vazia. */
export function mentionsOf(value: unknown): FanClubMention[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): FanClubMention[] => {
    if (!isRecord(item)) return [];
    const start = position(item.start);
    const end = position(item.end);
    const kind = item.kind === 'fan' || item.kind === 'artist' ? item.kind : null;
    if (
      typeof item.handle !== 'string' ||
      typeof item.id !== 'string' ||
      item.id === '' ||
      kind === null ||
      start === null ||
      end === null ||
      end <= start
    ) {
      return [];
    }
    return [{ handle: item.handle, kind, id: item.id, start, end }];
  });
}

/** `fanClubComments/{commentId}` lido (37.2), com as datas em ms. */
export type FanClubCommentRecord = {
  id: string;
  clubId: string;
  postId: string;
  artistId: string;
  authorUid: string;
  /** As cópias do perfil de quem comentou, acertadas pelo `syncFanProfile` (37.8). */
  authorName: string | null;
  authorUsername: string | null;
  authorPhotoURL: string | null;
  text: string;
  mentions: FanClubMention[];
  mentionUids: string[];
  /** Null no comentário de cima; na resposta, o id do comentário de cima. */
  replyToId: string | null;
  /** No comentário de cima: as respostas visíveis. */
  replyCount: number;
  /** No comentário de cima: as respostas no `manager_hidden`. */
  managerHiddenReplyCount: number;
  status: FanClubCommentStatus;
  hiddenAt: number | null;
  hiddenBy: string | null;
  restoredByStaffAt: number | null;
  reviewRequestedAt: number | null;
  reviewOutcome: 'kept' | null;
  createdAt: number;
};

/** O comentário lido. O status estranho vale `staff_hidden` (não aparece para ninguém). */
export function fanClubCommentRecord(
  id: string,
  data: Record<string, unknown>,
): FanClubCommentRecord {
  return {
    id,
    clubId: typeof data.clubId === 'string' ? data.clubId : '',
    postId: typeof data.postId === 'string' ? data.postId : '',
    artistId: typeof data.artistId === 'string' ? data.artistId : '',
    authorUid: typeof data.authorUid === 'string' ? data.authorUid : '',
    authorName: text(data.authorName),
    authorUsername: text(data.authorUsername),
    authorPhotoURL: text(data.authorPhotoURL),
    text: typeof data.text === 'string' ? data.text : '',
    mentions: mentionsOf(data.mentions),
    mentionUids: Array.isArray(data.mentionUids)
      ? data.mentionUids.filter((uid): uid is string => typeof uid === 'string' && uid !== '')
      : [],
    replyToId: text(data.replyToId),
    replyCount: count(data.replyCount),
    managerHiddenReplyCount: count(data.managerHiddenReplyCount),
    status: oneOf(FAN_CLUB_COMMENT_STATUSES, data.status) ?? 'staff_hidden',
    hiddenAt: millisOf(data.hiddenAt),
    hiddenBy: text(data.hiddenBy),
    restoredByStaffAt: millisOf(data.restoredByStaffAt),
    reviewRequestedAt: millisOf(data.reviewRequestedAt),
    reviewOutcome: data.reviewOutcome === 'kept' ? 'kept' : null,
    createdAt: millisOf(data.createdAt) ?? 0,
  };
}

/** As chaves aceitas no corpo do `POST /fan-club-posts/:postId/comments`. */
export const COMMENT_KEYS = ['text', 'replyToId'] as const;

/** O corpo do comentário conferido e limpo. */
export type CommentInput = { text: string; replyToId: string | null };

export type ParsedComment = { ok: true; value: CommentInput } | { ok: false; field: string };

/**
 * O corpo do comentário (`{ text, replyToId? }`, 37.3), conferido antes da
 * transação e sem leitura (o `validate` da rota chama de novo no `handle`):
 * o corpo que não é objeto, a chave desconhecida, o `text` que não é texto e o
 * `replyToId` que não é texto nem null são `{ ok: false }` com o campo (400
 * `invalid_request`); o `replyToId` fora do formato dos ids é 404
 * `fan_club_comment_not_found`, como o id do caminho; e o texto passa pela
 * limpeza e pelas regras do comentário do Mural (`commentTextProblem`: de 1 a
 * 500 em UTF-16, as linhas visíveis e o filtro no campo `comment`, decisão 9
 * de 36.1), com o `comment_invalid` e o motivo. O filtro confere o texto com
 * o "@" tirado de todo @ que pode virar marcação (seção 37, 37.7), a
 * conferência mais fraca, que nunca barra o que a da transação aceitaria: a
 * que vale vem depois de resolver (`isBlockedWithMentions`).
 */
export function parseFanClubComment(body: unknown): ParsedComment {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const unknownKey = Object.keys(body).find(
    (key) => !(COMMENT_KEYS as readonly string[]).includes(key),
  );
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  if (typeof body.text !== 'string') return { ok: false, field: 'text' };
  const replyTo = body.replyToId;
  if (replyTo !== undefined && replyTo !== null && typeof replyTo !== 'string') {
    return { ok: false, field: 'replyToId' };
  }
  if (typeof replyTo === 'string' && !isContentId(replyTo)) throw fanClubCommentNotFound();
  const cleaned = cleanMultiline(body.text);
  const problem = commentTextProblem(
    cleaned,
    mentionFilterText(cleaned, findMentionTokens(cleaned)),
  );
  if (problem) throw new PostError('comment_invalid', { reason: problem });
  return {
    ok: true,
    value: { text: cleaned, replyToId: typeof replyTo === 'string' ? replyTo : null },
  };
}

/**
 * Para onde vai a resposta (R7): a resposta a uma resposta fica no mesmo
 * nível, embaixo do comentário de cima dela.
 */
export const replyTarget = (replied: Pick<FanClubCommentRecord, 'id' | 'replyToId'>): string =>
  replied.replyToId ?? replied.id;

/**
 * O que um comentário novo soma (37.3): o `commentCount` da publicação,
 * sempre (ele nasce visível, e a resposta só nasce embaixo de um comentário
 * de cima visível), e, na resposta, o `replyCount` do comentário de cima.
 */
export function newCommentCounts(replyToId: string | null): {
  commentCount: number;
  replyCount: number;
} {
  return { commentCount: 1, replyCount: replyToId === null ? 0 : 1 };
}

// --- As menções (seção 37, 37.7; a etapa 2 de 37.13) ---------------------------------------

/** Os @ diferentes que viram marcação num texto: os primeiros que aparecem (37.7). */
export const FAN_CLUB_MENTIONS_MAX = 5;

/** As sugestões do @ por pedido, da conversa ou da busca (37.3). */
export const MENTION_SUGGESTIONS_MAX = 8;

/** Os últimos comentários da publicação que a conversa da sugestão lê (37.7). */
export const MENTION_CONVERSATION_COMMENTS = 30;

/** As reservas do @ que a busca da sugestão lê, fãs e centrais juntos (37.7). */
export const MENTION_SEARCH_READS = 12;

/**
 * O `q` da busca do @ (37.3): de 2 a 30 de `a-z`, `0-9` e `_`, sem o "@" e em
 * minúsculas, o começo de um @ de fã ou de central, fora dos ids `__.*__`, que
 * o Firestore reserva (o `q` vira o cursor `usernames/{q}` do `startAt`, e o
 * reservado derrubaria a busca com 500).
 */
export const MENTION_QUERY_PATTERN = /^(?!__.*__$)[a-z0-9_]{2,30}$/;

/**
 * Uma ocorrência de @ que pode virar marcação (37.7): o @ normalizado (em
 * minúsculas, o id da reserva em `usernames/`), o @ como foi escrito (sem o
 * "@") e as posições no texto, em unidades UTF-16: o `start` no "@" e o `end`
 * logo depois da última letra do @.
 */
export type MentionToken = { handle: string; written: string; start: number; end: number };

// O que forma o @ depois do "@": o padrão do @ das centrais (o
// `HANDLE_PATTERN`, que contém o `USERNAME_PATTERN` dos fãs), em qualquer caixa.
const HANDLE_CHAR = /[A-Za-z0-9_]/;
// O que, colado no @, o tira da marcação: letra, número ou "_" antes do "@" (o
// e-mail, o "a_@bia") e letra ou número logo depois do @ (o "@joséfina" não
// marca o "@jos").
const WORD_CHAR = /^[\p{L}\p{N}_]$/u;

/** O caractere inteiro (o ponto de código, com o par de surrogates) que termina antes da posição, ou ''. */
function codePointBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text.charAt(index - 1);
}

/** O caractere inteiro que começa na posição, ou ''. */
const codePointFrom = (text: string, index: number): string =>
  index < text.length ? String.fromCodePoint(text.codePointAt(index)!) : '';

/**
 * Os @ do texto que podem virar marcação (37.7), na ordem do texto: um "@" no
 * começo ou depois de um caractere que não é letra, número nem "_", seguido de
 * 3 a 30 de `a-z`, `0-9` e `_` (o maiúsculo vale, lido em minúsculas, como no
 * `normalizeUsername`) e sem letra nem número colado depois. O @ no formato
 * que o Firestore reserva (`__.*__`) nunca vira documento e fica texto. Valem
 * os `max` primeiros @ diferentes, com todas as ocorrências deles; os
 * seguintes ficam texto.
 */
export function findMentionTokens(
  text: string,
  max: number = FAN_CLUB_MENTIONS_MAX,
): MentionToken[] {
  const tokens: MentionToken[] = [];
  const handles = new Set<string>();
  for (let start = text.indexOf('@'); start !== -1; start = text.indexOf('@', start + 1)) {
    let end = start + 1;
    while (end < text.length && HANDLE_CHAR.test(text.charAt(end))) end += 1;
    const written = text.slice(start + 1, end);
    const handle = written.toLowerCase();
    if (
      WORD_CHAR.test(codePointBefore(text, start)) ||
      WORD_CHAR.test(codePointFrom(text, end)) ||
      !isArtistId(handle)
    ) {
      continue;
    }
    if (!handles.has(handle)) {
      if (handles.size >= max) continue;
      handles.add(handle);
    }
    tokens.push({ handle, written, start, end });
  }
  return tokens;
}

/** Os @ diferentes das ocorrências, na ordem em que aparecem: as reservas que a transação lê. */
export const mentionHandles = (tokens: readonly MentionToken[]): string[] => [
  ...new Set(tokens.map((token) => token.handle)),
];

/**
 * O texto que o filtro da seção 30 confere (37.7): o "@" tirado das
 * ocorrências cujo @ o `strip` aceita (sem ele, todas), que passam a ser
 * conferidas como palavra, o @ sozinho, sem a troca do "@" por "a" do
 * `pieceVersions`; o resto fica como está. A normalização e as chaves do
 * filtro não mudam (a `FILTER_NORMALIZATION_VERSION` fica): muda só o texto
 * que vai a ele. Nada daqui é gravado.
 */
export function mentionFilterText(
  text: string,
  tokens: readonly MentionToken[],
  strip: (handle: string) => boolean = () => true,
): string {
  let out = '';
  let from = 0;
  for (const token of tokens) {
    if (!strip(token.handle)) continue;
    out += text.slice(from, token.start);
    from = token.start + 1;
  }
  return out + text.slice(from);
}

/** O alvo de um @ resolvido: o fã (o uid, qualquer conta, R3) ou a central no ar (o id). */
export type MentionTarget = { kind: 'fan' | 'artist'; id: string };

/**
 * A reserva do @ lida (`usernames/{@}`, 37.7): com o `uid`, é fã; com o
 * `artistId`, é central, que ainda precisa estar no ar (o rascunho também
 * reserva o @). Sem reserva, ou sem um dos dois no formato, null: fica texto.
 */
export function reservationTargetOf(
  data: Record<string, unknown> | undefined,
): MentionTarget | null {
  if (!data) return null;
  if (typeof data.uid === 'string' && FAN_UID_PATTERN.test(data.uid)) {
    return { kind: 'fan', id: data.uid };
  }
  if (isArtistId(data.artistId)) return { kind: 'artist', id: data.artistId };
  return null;
}

/**
 * As marcações que o texto grava (37.2 e 37.7): cada ocorrência de um @
 * resolvido, com o @ como foi escrito, o alvo e as posições, e os uids dos
 * fãs marcados, sem repetir, na ordem do texto. O @ sem alvo fica texto. O
 * link segue a pessoa (o `id`), e não o @, que muda.
 */
export function resolvedMentions(
  tokens: readonly MentionToken[],
  targets: ReadonlyMap<string, MentionTarget>,
): { mentions: FanClubMention[]; mentionUids: string[] } {
  const mentions: FanClubMention[] = [];
  const uids = new Set<string>();
  for (const token of tokens) {
    const target = targets.get(token.handle);
    if (!target) continue;
    mentions.push({
      handle: token.written,
      kind: target.kind,
      id: target.id,
      start: token.start,
      end: token.end,
    });
    if (target.kind === 'fan') uids.add(target.id);
  }
  return { mentions, mentionUids: [...uids] };
}

/**
 * O texto bate no filtro da seção 30 com as marcações resolvidas (37.7): o
 * "@" tirado só das ocorrências dos @ resolvidos; o @ que não resolveu fica
 * com o "@" e a troca, como antes. É a conferência que vale, na transação,
 * depois de resolver; a do corpo, antes de ler, tira o "@" de todos.
 */
export const isBlockedWithMentions = (
  text: string,
  tokens: readonly MentionToken[],
  targets: ReadonlyMap<string, MentionTarget>,
  field: 'comment' | 'fanClubPost',
): boolean =>
  isBlockedText(
    mentionFilterText(text, tokens, (handle) => targets.has(handle)),
    field,
  );

/**
 * A conversa da sugestão do @ (37.7, sem o `q`), nesta ordem: o gestor (as
 * cópias do fã-clube, menos para ele mesmo), o artista do fã-clube (o @ é o
 * id) e quem comentou na publicação, do comentário mais novo ao mais antigo,
 * sem repetir. O comentário conta como aparece na tela de quem pede: visível
 * e, na resposta, embaixo de um comentário de cima visível de autor que ele
 * não bloqueou (o gestor, no próprio fã-clube, vê também os de quem ele
 * bloqueou, 37.8). Ficam de fora quem pede, quem ele bloqueou e o autor sem o
 * @ na cópia. Ficam quem bloqueou quem pede e o suspenso: os comentários deles
 * estão na tela, e tirá-los daqui contaria o bloqueio ou a suspensão (decisão
 * 14 de 28.1). Nada diz quem segue (R5). Até 8.
 */
export function conversationSuggestions(input: {
  uid: string;
  club: Pick<FanClubRecord, 'ownerUid' | 'ownerName' | 'ownerUsername' | 'ownerPhotoURL'>;
  artist: Pick<ArtistRecord, 'id' | 'name' | 'thumbUrl'>;
  blocked: readonly string[];
  /** Os últimos comentários da publicação, do mais novo ao mais antigo. */
  comments: readonly FanClubCommentRecord[];
  /** Os comentários de cima das respostas, pelo id (os da consulta e os lidos à parte). */
  tops: ReadonlyMap<string, FanClubCommentRecord>;
}): MentionSuggestion[] {
  const { uid, club, artist } = input;
  const blocked = new Set(input.blocked);
  const isOwner = club.ownerUid === uid;
  const items: MentionSuggestion[] = [];
  const seen = new Set<string>();
  const add = (item: MentionSuggestion) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key) || items.length >= MENTION_SUGGESTIONS_MAX) return;
    seen.add(key);
    items.push(item);
  };
  if (club.ownerUid !== null && !isOwner && club.ownerUsername !== null) {
    add({
      kind: 'fan',
      id: club.ownerUid,
      username: club.ownerUsername,
      name: club.ownerName,
      photoURL: club.ownerPhotoURL,
      role: 'manager',
      inConversation: true,
    });
  }
  add({
    kind: 'artist',
    id: artist.id,
    username: artist.id,
    name: artist.name,
    photoURL: artist.thumbUrl,
    role: 'artist',
    inConversation: true,
  });
  for (const comment of input.comments) {
    if (comment.status !== 'visible') continue;
    if (comment.replyToId !== null) {
      const top = input.tops.get(comment.replyToId);
      if (
        !top ||
        top.status !== 'visible' ||
        top.replyToId !== null ||
        top.postId !== comment.postId ||
        (!isOwner && blocked.has(top.authorUid))
      ) {
        continue;
      }
    }
    const author = comment.authorUid;
    if (author === uid || blocked.has(author) || comment.authorUsername === null) continue;
    add({
      kind: 'fan',
      id: author,
      username: comment.authorUsername,
      name: comment.authorName,
      photoURL: comment.authorPhotoURL,
      role: author === club.ownerUid ? 'manager' : null,
      inConversation: true,
    });
  }
  return items;
}

/** O fã achado pela busca do @: o perfil lido com `select` e a lista de quem ele bloqueou. */
export type MentionSearchFan = {
  name: string | null;
  photoURL: string | null;
  privateAccount: boolean;
  suspended: boolean;
  /** Já trocou o @ (o `usernameChangedAt` gravado): o @ foi escolhido, e não gerado do nome. */
  chosenUsername: boolean;
  /** Os fãs que ele bloqueou. */
  blocked: readonly string[];
};

/** Os campos do perfil que a busca do @ lê (o `select` do `getAll`, 37.7). */
export const MENTION_SEARCH_PROFILE_FIELDS = [
  'displayName',
  'username',
  'photoURL',
  'privateAccount',
  'suspendedAt',
  'usernameChangedAt',
] as const;

/** O fã da busca, do perfil lido (null sem perfil: conta excluída ou só da equipe). */
export function mentionSearchFanOf(
  profile: Record<string, unknown> | undefined,
  blocked: readonly string[],
): MentionSearchFan | null {
  if (!profile) return null;
  return {
    name: text(profile.displayName),
    photoURL: text(profile.photoURL),
    privateAccount: profile.privateAccount === true,
    suspended: profile.suspendedAt !== undefined && profile.suspendedAt !== null,
    chosenUsername: millisOf(profile.usernameChangedAt) !== null,
    blocked,
  };
}

/**
 * A busca da sugestão do @ (37.7, com o `q`): as reservas achadas pelo
 * começo do @, na ordem do @, fãs e centrais juntos. Ficam de fora quem pede,
 * quem ele bloqueou, a central fora do ar, o fã sem perfil, o fã com o @
 * gerado do nome (sem o `usernameChangedAt`, resposta do dono, 37.15,
 * pergunta 8) e, do mesmo jeito e sem dizer qual, a conta privada, a suspensa
 * e a de quem bloqueou quem pede (decisão 14 de 28.1; 37.15, pergunta 7).
 * Nunca pelo nome (R6) e nunca quem segue (R5). O gestor e o artista do
 * fã-clube levam o papel e o `inConversation`: os dois estão sempre na
 * conversa. Até 8.
 */
export function searchSuggestions(input: {
  uid: string;
  club: Pick<FanClubRecord, 'ownerUid' | 'artistId'>;
  blocked: readonly string[];
  hits: readonly { handle: string; target: MentionTarget }[];
  fans: ReadonlyMap<string, MentionSearchFan>;
  artists: ReadonlyMap<string, ArtistRecord>;
}): MentionSuggestion[] {
  const blocked = new Set(input.blocked);
  const items: MentionSuggestion[] = [];
  const seen = new Set<string>();
  for (const { handle, target } of input.hits) {
    if (items.length >= MENTION_SUGGESTIONS_MAX) break;
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) continue;
    if (target.kind === 'artist') {
      const artist = input.artists.get(target.id);
      if (!isPublished(artist)) continue;
      const role = artist.id === input.club.artistId ? 'artist' : null;
      seen.add(key);
      items.push({
        kind: 'artist',
        id: artist.id,
        username: artist.id,
        name: artist.name,
        photoURL: artist.thumbUrl,
        role,
        inConversation: role !== null,
      });
      continue;
    }
    if (target.id === input.uid || blocked.has(target.id)) continue;
    const fan = input.fans.get(target.id);
    if (
      !fan ||
      !fan.chosenUsername ||
      fan.privateAccount ||
      fan.suspended ||
      fan.blocked.includes(input.uid)
    ) {
      continue;
    }
    const role = target.id === input.club.ownerUid ? 'manager' : null;
    seen.add(key);
    items.push({
      kind: 'fan',
      id: target.id,
      username: handle,
      name: fan.name,
      photoURL: fan.photoURL,
      role,
      inConversation: role !== null,
    });
  }
  return items;
}
