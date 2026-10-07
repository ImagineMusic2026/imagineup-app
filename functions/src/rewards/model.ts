import { randomInt } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';

import { isEventOpen, type EventRecord } from '../agenda/model';
import type {
  RedemptionStatus as FanRedemptionStatus,
  Reward,
  RewardRedemption,
} from '../api/contract';
import { INVITE_CODE_ALPHABET } from '../invites/model';
import { isContentId } from '../page-cursor';
import { cleanMultiline, isVisibleLine, isVisibleMultiline } from '../visible-line';
import { rewardPanelError } from './errors';

// Loja e resgate (bloco 10), puro: nada aqui lê ou grava o Firestore. O
// service.ts lê, chama estas funções e grava. Contrato em
// docs/arquitetura-api.md, seção 25.

/** Os tipos de recompensa (o `RewardKind` do app): decidem o ícone e a cor do quadro. */
export const REWARD_KINDS = ['ticket', 'videocall', 'merch', 'screen', 'meet'] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

/** Ciclo da recompensa (25.1, decisão 9): rascunho, no ar e encerrada. */
export type RewardDocStatus = 'draft' | 'published' | 'closed';

/**
 * Status do pedido (25.1, decisão 3): solicitado, aprovado, entregue,
 * recusado e, só no servidor, cancelado pela exclusão de conta.
 */
export const REDEMPTION_STATUSES = [
  'requested',
  'approved',
  'delivered',
  'refused',
  'canceled',
] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

// --- Constantes (25.3) --------------------------------------------------------------

/** Limite por fã de uma recompensa nova (25.1, decisão 6). */
export const DEFAULT_PER_FAN_LIMIT = 1;
export const PER_FAN_LIMIT_MAX = 100;
export const COST_MAX = 1_000_000;
export const STOCK_MAX = 100_000;
export const TITLE_MAX = 60;
export const SUBTITLE_MAX = 60;
export const DESCRIPTION_MAX = 1_000;
export const INSTRUCTIONS_MAX = 1_000;
export const REFUSAL_REASON_MAX = 200;
/** Caracteres depois do `UP-`; 1 código sorteado por tentativa (25.1, decisão 2). */
export const REDEMPTION_CODE_LENGTH = 6;
/** Recompensas no ar lidas pela loja. */
export const REWARDS_LIST_MAX = 100;
/** Pedidos do fã lidos pela loja. */
export const FAN_REDEMPTIONS_READ_MAX = 200;
/** Pedidos por transação na exclusão de conta. */
export const REDEMPTION_DELETE_PAGE = 100;
/** Pedidos por chamada do `getRedemptionContacts` (um `getUsers` só). */
export const CONTACTS_MAX = 50;
/** Rascunhos e no ar no `reorderRewards` (as encerradas ficam fora). */
export const REWARDS_REORDER_MAX = 240;
/**
 * Endereço do regulamento das recompensas (25.1, decisão 19): vazio vai como
 * `rulesUrl: null`, e o app esconde o link até a cliente entregar o texto
 * (UP-45). Trocar aqui muda o link de todas as versões do app com um deploy
 * das funções.
 */
export const REWARDS_RULES_URL = '';
/** Foto da recompensa sem largura e altura no upload: a paisagem sugerida (366 por 196). */
export const REWARD_PHOTO_SIZE = { width: 1200, height: 643 } as const;

/** O código de retirada, que é também o id do pedido ("UP-7QXH2R"). */
export const REDEMPTION_CODE_PATTERN = new RegExp(
  `^UP-[${INVITE_CODE_ALPHABET}]{${REDEMPTION_CODE_LENGTH}}$`,
);

/** O `rulesUrl` da loja: null enquanto a constante estiver vazia. */
export function rulesUrlOf(url: string = REWARDS_RULES_URL): string | null {
  return url.trim() === '' ? null : url;
}

/** Sorteio de um índice de 0 até `max` menos 1. */
export type CodeDraw = (max: number) => number;

/** O sorteio de verdade: `crypto.randomInt`, e nunca o `Math.random` (25.17). */
export const cryptoDraw: CodeDraw = (max) => randomInt(0, max);

/**
 * Um código de retirada sorteado: `UP-` mais 6 caracteres do alfabeto do
 * convite (sem vogal, sem 0, 1, I, L e O), perto de 4,8 × 10^8 códigos. Não é
 * sequencial: quem tem um código não adivinha o do vizinho.
 */
export function drawRedemptionCode(draw: CodeDraw = cryptoDraw): string {
  let code = 'UP-';
  for (let index = 0; index < REDEMPTION_CODE_LENGTH; index += 1) {
    const at = Math.min(
      INVITE_CODE_ALPHABET.length - 1,
      Math.max(0, Math.floor(draw(INVITE_CODE_ALPHABET.length))),
    );
    code += INVITE_CODE_ALPHABET[at];
  }
  return code;
}

export function isRedemptionCode(value: unknown): value is string {
  return typeof value === 'string' && REDEMPTION_CODE_PATTERN.test(value);
}

/** Id de recompensa: o do `doc()` do Firestore, os do seed e os do painel (`isContentId`). */
export function isRewardId(value: unknown): value is string {
  return isContentId(value);
}

// --- Registros lidos --------------------------------------------------------------

export type RewardPhoto = { url: string; path: string; width: number; height: number };

/** rewards/{rewardId} como o servidor usa, com as datas em ms. */
export type RewardRecord = {
  id: string;
  kind: RewardKind;
  title: string;
  subtitle: string;
  description: string | null;
  cost: number;
  photo: RewardPhoto | null;
  featured: boolean;
  scarcity: boolean;
  stockTotal: number | null;
  redeemedCount: number;
  perFanLimit: number | null;
  eventId: string | null;
  instructions: string;
  status: RewardDocStatus | null;
  order: number;
  publishedAt: number | null;
  closedAt: number | null;
};

/** redemptions/{code} como o servidor usa, com as datas em ms. */
export type RedemptionRecord = {
  code: string;
  rewardId: string;
  rewardTitle: string;
  rewardKind: string;
  eventId: string | null;
  points: number;
  uid: string | null;
  fanName: string | null;
  fanUsername: string | null;
  status: RedemptionStatus;
  instructions: string;
  refusalReason: string | null;
  refundedPoints: number;
  restocked: boolean | null;
  requestedAt: number;
  approvedAt: number | null;
  deliveredAt: number | null;
  refusedAt: number | null;
  canceledAt: number | null;
  statusAt: number;
  accountDeleted: boolean;
};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

const intOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

function millis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function photoOf(value: unknown): RewardPhoto | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== 'string' || typeof raw.path !== 'string') return null;
  return {
    url: raw.url,
    path: raw.path,
    width: count(raw.width) || REWARD_PHOTO_SIZE.width,
    height: count(raw.height) || REWARD_PHOTO_SIZE.height,
  };
}

const isKind = (value: unknown): value is RewardKind =>
  (REWARD_KINDS as readonly unknown[]).includes(value);

export function rewardRecord(id: string, data: Record<string, unknown>): RewardRecord {
  const status = data.status;
  return {
    id,
    kind: isKind(data.kind) ? data.kind : 'merch',
    title: text(data.title) ?? '',
    subtitle: text(data.subtitle) ?? '',
    description: text(data.description),
    cost: count(data.cost),
    photo: photoOf(data.photo),
    featured: data.featured === true,
    scarcity: data.scarcity === true,
    stockTotal: intOrNull(data.stockTotal),
    redeemedCount: count(data.redeemedCount),
    perFanLimit: intOrNull(data.perFanLimit) || null,
    eventId: isContentId(data.eventId) ? data.eventId : null,
    instructions: text(data.instructions) ?? '',
    status: status === 'draft' || status === 'published' || status === 'closed' ? status : null,
    order: typeof data.order === 'number' && Number.isFinite(data.order) ? data.order : 0,
    publishedAt: millis(data.publishedAt),
    closedAt: millis(data.closedAt),
  };
}

const isRedemptionStatus = (value: unknown): value is RedemptionStatus =>
  (REDEMPTION_STATUSES as readonly unknown[]).includes(value);

export function redemptionRecord(code: string, data: Record<string, unknown>): RedemptionRecord {
  const requestedAt = millis(data.requestedAt) ?? 0;
  return {
    code,
    rewardId: text(data.rewardId) ?? '',
    rewardTitle: text(data.rewardTitle) ?? '',
    rewardKind: text(data.rewardKind) ?? '',
    eventId: text(data.eventId),
    points: count(data.points),
    uid: text(data.uid),
    fanName: text(data.fanName),
    fanUsername: text(data.fanUsername),
    status: isRedemptionStatus(data.status) ? data.status : 'requested',
    instructions: text(data.instructions) ?? '',
    refusalReason: text(data.refusalReason),
    refundedPoints: count(data.refundedPoints),
    restocked: typeof data.restocked === 'boolean' ? data.restocked : null,
    requestedAt,
    approvedAt: millis(data.approvedAt),
    deliveredAt: millis(data.deliveredAt),
    refusedAt: millis(data.refusedAt),
    canceledAt: millis(data.canceledAt),
    statusAt: millis(data.statusAt) ?? requestedAt,
    accountDeleted: data.accountDeleted === true,
  };
}

// --- Status do pedido (25.1, decisões 3 a 5) -----------------------------------------

/**
 * As transições válidas: de solicitado para aprovado, entregue (o entregue
 * pode pular o aprovado, decisão 4) ou recusado; de aprovado para entregue ou
 * recusado (decisão 5). Entregue, recusado e cancelado não mudam mais.
 */
export const REDEMPTION_TRANSITIONS: Readonly<
  Record<RedemptionStatus, readonly RedemptionStatus[]>
> = {
  requested: ['approved', 'delivered', 'refused'],
  approved: ['delivered', 'refused'],
  delivered: [],
  refused: [],
  canceled: [],
};

/**
 * O que impede a troca de `from` para `to`: `unchanged` (o mesmo status, que
 * é sucesso sem efeito), `invalid-transition` (fora da tabela) ou null.
 */
export function transitionProblem(
  from: RedemptionStatus,
  to: RedemptionStatus,
): 'unchanged' | 'invalid-transition' | null {
  if (from === to) return 'unchanged';
  return REDEMPTION_TRANSITIONS[from].includes(to) ? null : 'invalid-transition';
}

/** Os pedidos que seguram vaga e contam no limite por fã (decisões 6 e 11). */
export function countsTowardLimit(status: RedemptionStatus): boolean {
  return status === 'requested' || status === 'approved' || status === 'delivered';
}

/** O pedido ainda pede contato e entrega (o `getRedemptionContacts`, decisão 13). */
export function isOpenRedemption(status: RedemptionStatus): boolean {
  return status === 'requested' || status === 'approved';
}

// --- Resgate (25.4) -------------------------------------------------------------------

export type RewardErrorReason =
  'reward_not_found' | 'sold_out' | 'redeem_limit_reached' | 'reward_changed';

const REWARD_MESSAGES: Record<RewardErrorReason, string> = {
  reward_not_found: 'Recompensa não encontrada.',
  sold_out: 'Recompensa esgotada.',
  redeem_limit_reached: 'Você chegou ao limite de resgates desta recompensa.',
  reward_changed: 'O custo desta recompensa mudou. Confira antes de resgatar.',
};

/**
 * Recusa do resgate. A API traduz para o código de mesmo nome: 404
 * `reward_not_found`, e 409 `sold_out` (com `details.reason`: `closed`,
 * `stock` ou `event`), `redeem_limit_reached` (com `details.limit`) e
 * `reward_changed` (com `details.cost`).
 */
export class RewardError extends Error {
  readonly reason: RewardErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: RewardErrorReason, details?: Record<string, unknown>) {
    super(REWARD_MESSAGES[reason]);
    this.name = 'RewardError';
    this.reason = reason;
    this.details = details;
  }
}

/** O que sobra do estoque (nunca negativo), ou null sem total. */
export function remainingOf(reward: Pick<RewardRecord, 'stockTotal' | 'redeemedCount'>) {
  return reward.stockTotal === null ? null : Math.max(0, reward.stockTotal - reward.redeemedCount);
}

/**
 * A primeira parte das recusas, só com a recompensa lida (25.4, passo 2): não
 * existe ou em rascunho, encerrada, sem vaga. Depois dela, a rota lê o show e
 * os pedidos do fã.
 */
export function rewardProblem(reward: RewardRecord | null): RewardError | null {
  if (!reward || (reward.status !== 'published' && reward.status !== 'closed')) {
    return new RewardError('reward_not_found');
  }
  if (reward.status === 'closed') return new RewardError('sold_out', { reason: 'closed' });
  if (remainingOf(reward) === 0) return new RewardError('sold_out', { reason: 'stock' });
  return null;
}

export type RedeemCheck = {
  reward: RewardRecord | null;
  /** O show da recompensa lido (null sem show ou apagado). */
  event: EventRecord | null;
  expectedCost: number;
  /** Os pedidos do fã nesta recompensa (a consulta do limite). */
  fanRedemptions: readonly Pick<RedemptionRecord, 'status'>[];
  now: number;
};

/**
 * Todas as recusas do resgate, na ordem da rota (25.2 e 25.4): recompensa
 * que não existe ou em rascunho, encerrada, sem vaga, show fechado (já
 * passou, fora do ar, em rascunho ou apagado: `isEventOpen`), custo mudado e
 * limite por fã. O saldo vem depois, do núcleo de pontos.
 */
export function redeemProblem(check: RedeemCheck): RewardError | null {
  const first = rewardProblem(check.reward);
  if (first) return first;
  const reward = check.reward!;
  if (reward.eventId && !isEventOpen(check.event, check.now)) {
    return new RewardError('sold_out', { reason: 'event' });
  }
  if (check.expectedCost !== reward.cost) {
    return new RewardError('reward_changed', { cost: reward.cost });
  }
  if (reward.perFanLimit !== null) {
    const counted = check.fanRedemptions.filter((item) => countsTowardLimit(item.status)).length;
    if (counted >= reward.perFanLimit) {
      return new RewardError('redeem_limit_reached', { limit: reward.perFanLimit });
    }
  }
  return null;
}

/**
 * O corpo do resgate: `{ expectedCost }`, inteiro de 1 a `COST_MAX`. Outro
 * corpo: undefined (400 na rota).
 */
export function parseExpectedCost(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const cost = (body as { expectedCost?: unknown }).expectedCost;
  if (typeof cost !== 'number' || !Number.isInteger(cost) || cost < 1 || cost > COST_MAX) {
    return undefined;
  }
  return cost;
}

// --- O que a loja mostra (25.2) -------------------------------------------------------

/**
 * A recompensa aparece para o fã? Rascunho nunca; no ar sempre; encerrada só
 * para quem tem pedido nela (25.1, decisão 10).
 */
export function isVisibleToFan(
  reward: Pick<RewardRecord, 'status'>,
  hasRedemption: boolean,
): boolean {
  if (reward.status === 'published') return true;
  return reward.status === 'closed' && hasRedemption;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Um pedido como o fã vê: as instruções da recompensa de agora enquanto ele
 * está aberto e a cópia da hora do resgate depois que fecha; o motivo e os
 * pontos devolvidos só no recusado. O cancelado não chega aqui (não tem uid).
 */
export function redemptionView(
  redemption: RedemptionRecord,
  reward: Pick<RewardRecord, 'instructions'> | null,
): RewardRedemption {
  const open = isOpenRedemption(redemption.status);
  const refused = redemption.status === 'refused';
  return {
    id: redemption.code,
    code: redemption.code,
    status: redemption.status as FanRedemptionStatus,
    statusAt: iso(redemption.statusAt),
    points: redemption.points,
    refundedPoints: refused ? redemption.refundedPoints : 0,
    instructions: open && reward ? reward.instructions : redemption.instructions,
    refusalReason: refused ? redemption.refusalReason : null,
    redeemedAt: iso(redemption.requestedAt),
  };
}

/** Do mais novo ao mais antigo; o mesmo instante, pelo código. */
export function compareRedemptions(a: RedemptionRecord, b: RedemptionRecord): number {
  return b.requestedAt - a.requestedAt || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

/**
 * A recompensa da loja (25.2): `soldOut` na encerrada, com o show fechado e
 * sem vaga; o destaque só enquanto ela está no ar; o show só aberto; o
 * `limitReached` pelos pedidos que contam; os pedidos do fã do mais novo ao
 * mais antigo, sem o cancelado.
 */
export function rewardView(
  reward: RewardRecord,
  options: { event: EventRecord | null; redemptions: readonly RedemptionRecord[]; now: number },
): Reward {
  const eventOpen = reward.eventId !== null && isEventOpen(options.event, options.now);
  const remaining = remainingOf(reward);
  const soldOut =
    reward.status === 'closed' || (reward.eventId !== null && !eventOpen) || remaining === 0;
  const mine = options.redemptions
    .filter((item) => item.rewardId === reward.id && item.status !== 'canceled')
    .sort(compareRedemptions);
  const counted = mine.filter((item) => countsTowardLimit(item.status)).length;
  return {
    id: reward.id,
    kind: reward.kind,
    title: reward.title,
    subtitle: reward.subtitle,
    description: reward.description,
    cost: reward.cost,
    imageUrl: reward.photo?.url ?? null,
    featured: reward.status === 'published' && reward.featured,
    scarcity: reward.scarcity,
    stock:
      reward.stockTotal === null ? null : { total: reward.stockTotal, remaining: remaining ?? 0 },
    event:
      eventOpen && options.event
        ? { name: options.event.title, startsAt: iso(options.event.startsAt!) }
        : null,
    status: soldOut ? 'soldOut' : 'available',
    perFanLimit: reward.perFanLimit,
    limitReached: reward.perFanLimit !== null && counted >= reward.perFanLimit,
    redemptions: mine.map((item) => redemptionView(item, reward)),
  };
}

/** A ordem do painel: `order`, depois o id. */
export function compareRewards(a: RewardRecord, b: RewardRecord): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// --- Callables do painel (25.8) ---------------------------------------------------------

// Isolantes bidi (U+2066 a U+2069): vêm em texto colado, e a linha visível os recusa.
const BIDI_ISOLATES = /[⁦-⁩]/g;

/** Texto de uma linha: sem os isolantes colados, em NFC e sem espaço nas pontas. */
function oneLine(value: string): string {
  return value.replace(BIDI_ISOLATES, '').normalize('NFC').trim();
}

const invalidField = (field: string) => rewardPanelError('invalid-request', { field });

function parseLine(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw invalidField(field);
  const line = oneLine(value);
  if (line.length < 1 || line.length > max || !isVisibleLine(line)) throw invalidField(field);
  return line;
}

function parseMultiline(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string') throw invalidField(field);
  const cleaned = cleanMultiline(value);
  if (cleaned.length < 1 || cleaned.length > max || !isVisibleMultiline(cleaned)) {
    throw invalidField(field);
  }
  return cleaned;
}

const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

export function parseRewardKind(value: unknown): RewardKind {
  if (!isKind(value)) throw invalidField('kind');
  return value;
}

export function parseRewardTitle(value: unknown): string {
  return parseLine(value, TITLE_MAX, 'title');
}

export function parseRewardSubtitle(value: unknown): string {
  return parseLine(value, SUBTITLE_MAX, 'subtitle');
}

/** A descrição: null ou texto vazio limpa; senão de 1 a 1.000, várias linhas visíveis. */
export function parseRewardDescription(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && cleanMultiline(value) === '') return null;
  return parseMultiline(value, DESCRIPTION_MAX, 'description');
}

export function parseRewardInstructions(value: unknown): string {
  return parseMultiline(value, INSTRUCTIONS_MAX, 'instructions');
}

export function parseRewardCost(value: unknown): number {
  if (!isInt(value) || value < 1 || value > COST_MAX) throw invalidField('cost');
  return value;
}

/** O total oferecido: inteiro de 0 a 100.000, ou null sem limite. */
export function parseStockTotal(value: unknown): number | null {
  if (value === null) return null;
  if (!isInt(value) || value < 0 || value > STOCK_MAX) throw invalidField('stockTotal');
  return value;
}

/** O limite por fã: inteiro de 1 a 100, ou null sem limite (decisão 6). */
export function parsePerFanLimit(value: unknown): number | null {
  if (value === null) return null;
  if (!isInt(value) || value < 1 || value > PER_FAN_LIMIT_MAX) throw invalidField('perFanLimit');
  return value;
}

/** O show da recompensa: o id de um show (a callable confere que existe), ou null. */
export function parseRewardEventId(value: unknown): string | null {
  if (value === null) return null;
  if (!isContentId(value)) throw invalidField('eventId');
  return value;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalidField(field);
  return value;
}

/** Os campos da recompensa que o painel cadastra (sem a foto, o estoque à parte). */
export type RewardFields = {
  kind: RewardKind;
  title: string;
  subtitle: string;
  description: string | null;
  cost: number;
  featured: boolean;
  scarcity: boolean;
  stockTotal: number | null;
  perFanLimit: number | null;
  eventId: string | null;
  instructions: string;
};

/** O que o `updateReward` muda: sem o estoque (`setRewardStock`) e sem a foto (à parte). */
export type RewardPatch = Partial<Omit<RewardFields, 'stockTotal'>>;

/**
 * O `createReward` (25.8): obrigatórios o tipo, o título, o subtítulo, o
 * custo e as instruções; sem o resto, a descrição null, o destaque e a
 * escassez falsos, sem estoque (`null`), o limite 1 (`null` explícito é sem
 * limite) e sem show.
 */
export function parseRewardCreate(input: Record<string, unknown>): RewardFields {
  return {
    kind: parseRewardKind(input.kind),
    title: parseRewardTitle(input.title),
    subtitle: parseRewardSubtitle(input.subtitle),
    description: input.description === undefined ? null : parseRewardDescription(input.description),
    cost: parseRewardCost(input.cost),
    featured: input.featured === undefined ? false : parseBoolean(input.featured, 'featured'),
    scarcity: input.scarcity === undefined ? false : parseBoolean(input.scarcity, 'scarcity'),
    stockTotal: input.stockTotal === undefined ? null : parseStockTotal(input.stockTotal),
    perFanLimit:
      input.perFanLimit === undefined ? DEFAULT_PER_FAN_LIMIT : parsePerFanLimit(input.perFanLimit),
    eventId: input.eventId === undefined ? null : parseRewardEventId(input.eventId),
    instructions: parseRewardInstructions(input.instructions),
  };
}

/**
 * O `updateReward` (25.8): ausente não muda; `null` limpa o que aceita null
 * (descrição, limite e show). O estoque não muda por aqui (`setRewardStock`).
 */
export function parseRewardPatch(input: Record<string, unknown>): RewardPatch {
  if (input.stockTotal !== undefined) throw invalidField('stockTotal');
  const patch: RewardPatch = {};
  if (input.kind !== undefined) patch.kind = parseRewardKind(input.kind);
  if (input.title !== undefined) patch.title = parseRewardTitle(input.title);
  if (input.subtitle !== undefined) patch.subtitle = parseRewardSubtitle(input.subtitle);
  if (input.description !== undefined) {
    patch.description = parseRewardDescription(input.description);
  }
  if (input.cost !== undefined) patch.cost = parseRewardCost(input.cost);
  if (input.featured !== undefined) patch.featured = parseBoolean(input.featured, 'featured');
  if (input.scarcity !== undefined) patch.scarcity = parseBoolean(input.scarcity, 'scarcity');
  if (input.perFanLimit !== undefined) patch.perFanLimit = parsePerFanLimit(input.perFanLimit);
  if (input.eventId !== undefined) patch.eventId = parseRewardEventId(input.eventId);
  if (input.instructions !== undefined) {
    patch.instructions = parseRewardInstructions(input.instructions);
  }
  return patch;
}

/** Id de recompensa vindo do painel; fora do formato, a recompensa não existe. */
export function parseRewardId(value: unknown): string {
  if (!isRewardId(value)) throw rewardPanelError('reward-not-found');
  return value;
}

/** O status pedido no `setRewardStatus`. */
export function parseRewardTargetStatus(value: unknown): 'published' | 'closed' {
  if (value !== 'published' && value !== 'closed') throw rewardPanelError('invalid-status');
  return value;
}

/** A lista do `reorderRewards`: de 1 a 240 ids, sem repetir. */
export function parseRewardIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > REWARDS_REORDER_MAX ||
    !value.every(isRewardId) ||
    new Set(value).size !== value.length
  ) {
    throw invalidField('rewardIds');
  }
  return [...(value as string[])];
}

/** Pasta da foto de uma recompensa no bucket. */
export function rewardPrefix(rewardId: string): string {
  return `rewards/${rewardId}/`;
}

/** O pedido do `setRedemptionStatus` (25.8), conferido antes de qualquer leitura. */
export type RedemptionStatusRequest = {
  code: string;
  status: 'approved' | 'delivered' | 'refused';
  reason: string | null;
  restock: boolean;
};

export function parseRedemptionStatusRequest(
  input: Record<string, unknown>,
): RedemptionStatusRequest {
  if (!isRedemptionCode(input.redemptionId)) throw invalidField('redemptionId');
  const status = input.status;
  if (status !== 'approved' && status !== 'delivered' && status !== 'refused') {
    throw invalidField('status');
  }
  if (status !== 'refused') {
    if (input.reason !== undefined || input.restock !== undefined) {
      throw rewardPanelError('reason-not-allowed');
    }
    return { code: input.redemptionId, status, reason: null, restock: true };
  }
  const reason =
    input.reason === undefined || input.reason === null
      ? null
      : parseLine(input.reason, REFUSAL_REASON_MAX, 'reason');
  const restock = input.restock === undefined ? true : parseBoolean(input.restock, 'restock');
  return { code: input.redemptionId, status, reason, restock };
}

/** Os códigos do `getRedemptionContacts`: de 1 a 50, sem repetir, no formato. */
export function parseRedemptionCodes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > CONTACTS_MAX ||
    !value.every(isRedemptionCode) ||
    new Set(value).size !== value.length
  ) {
    throw invalidField('redemptionIds');
  }
  return [...(value as string[])];
}
