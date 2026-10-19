import { isArtistId } from '../centrals/model';
import { filterTokens, isBlockedSocial, isBlockedText } from '../content-filter';
import { dayKey, shiftDay } from '../day';
import { normalizeSocialHandle } from '../fan-profile/details';
import { cleanLine, cleanMultiline, isVisibleLine, isVisibleMultiline } from '../visible-line';

// O fã-clube gerido pelo fã (docs/arquitetura-api.md, seção 34), puro: nada
// aqui lê ou grava o Firestore. As constantes do programa, as regras dos
// campos da candidatura, as recusas da API, a leitura dos documentos e o
// prazo do Destaque. Este módulo não importa a moderação, os pontos nem a
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
  lastReward: { at: number | null; points: number | null; prize: boolean } | null;
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
    lastReward: reward
      ? {
          at: millisOf(reward.at),
          points: typeof reward.points === 'number' ? count(reward.points) : null,
          prize: reward.prize === true,
        }
      : null,
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

/** Os campos do `fan_club_invalid` na candidatura. */
export type FanClubInvalidField =
  'name' | 'pitch' | 'instagram' | 'tiktok' | 'socials' | 'whatsapp' | 'adult' | 'rulesVersion';

/**
 * Os motivos do 409 `fan_club_refused` desta etapa (34.3), mais o
 * `program_closed`: a candidatura com o `FAN_CLUB_OPEN` desligado (decisão 9).
 */
export type FanClubRefusal =
  | 'program_closed'
  | 'username_required'
  | 'not_member'
  | 'artist_closed'
  | 'already_applied'
  | 'has_fan_club'
  | 'cooldown'
  | 'too_many_rounds'
  | 'not_allowed';

export type FanClubErrorCode = 'fan_club_invalid' | 'fan_club_refused';

const FAN_CLUB_MESSAGES: Record<FanClubErrorCode, string> = {
  fan_club_invalid: 'Campo fora do formato.',
  fan_club_refused: 'A candidatura não pode ser feita agora.',
};

/**
 * Recusa do fã-clube. A API traduz o `reason` no código dela (400
 * `fan_club_invalid` com `details: { field, reason }` e 409
 * `fan_club_refused` com `details: { reason }`).
 */
export class FanClubError extends Error {
  readonly reason: FanClubErrorCode;
  readonly details: Record<string, unknown>;

  constructor(reason: FanClubErrorCode, details: Record<string, unknown>) {
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
 *   `adult: true` e a `rulesVersion` igual à do servidor.
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
  for (const key of ['name', 'pitch', 'rulesVersion'] as const) {
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
  if (body.adult !== true) throw fanClubInvalid('adult', 'format');
  if (body.rulesVersion !== rulesVersion) throw fanClubInvalid('rulesVersion', 'format');
  return {
    ok: true,
    value: { artistId: body.artistId, name: name.name, instagram, tiktok, pitch },
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
