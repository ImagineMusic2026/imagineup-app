import { cleanMultiline, isVisibleLine, isVisibleMultiline } from '../visible-line';

// O Suporte dos Ajustes (docs/arquitetura-api.md, seção 38; pedido do dono de
// 03/11/2026): o fã manda à equipe um problema, uma sugestão ou um feedback,
// em texto livre, pelo `POST /me/support`, e a equipe lê na seção Suporte do
// painel. Puro: nada aqui lê ou grava o Firestore.

/** Os três tipos, na ordem dos Ajustes: Reportar problema, Sugerir funcionalidade e Feedback geral. */
export const SUPPORT_KINDS = ['problem', 'idea', 'feedback'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

/** O texto, de 1 a 2.000 caracteres (UTF-16, como o `maxLength` do app) depois de limpo. */
export const SUPPORT_TEXT_MAX = 2_000;

/**
 * Mensagens por dia, somando os três tipos (38.1, decisão 5): o padrão do
 * código do teto `support_message`, ajustável pelo painel no `actionCaps`.
 * Ninguém de verdade manda cinco num dia; o teto segura quem encheria a lista
 * da equipe.
 */
export const SUPPORT_MESSAGES_PER_DAY = 5;

/** Os sistemas do aparelho que o app manda no problema. */
export const SUPPORT_PLATFORMS = ['android', 'ios'] as const;
export type SupportPlatform = (typeof SUPPORT_PLATFORMS)[number];

/** O teto de cada texto do aparelho (a versão do sistema, a do app e o id do update). */
export const DEVICE_FIELD_MAX = 40;

/** O aparelho de quem reporta o problema (38.1, decisão 4): sem nada que identifique a pessoa. */
export type SupportDevice = {
  platform: SupportPlatform;
  osVersion: string | null;
  appVersion: string | null;
  updateId: string | null;
};

export type SupportMessageInput = {
  kind: SupportKind;
  text: string;
  /** Só no `problem`; nos outros, `null`. */
  device: SupportDevice | null;
};

export type ParsedSupportMessage =
  { ok: true; value: SupportMessageInput } | { ok: false; field: string };

const BODY_KEYS = ['kind', 'text', 'device'] as const;
const DEVICE_KEYS = ['platform', 'osVersion', 'appVersion', 'updateId'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isSupportKind = (value: unknown): value is SupportKind =>
  (SUPPORT_KINDS as readonly unknown[]).includes(value);

/** Um texto do aparelho: `null`, ou de 1 a 40 caracteres numa linha visível. */
function deviceText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || value.length < 1 || value.length > DEVICE_FIELD_MAX) {
    return { ok: false };
  }
  return isVisibleLine(value) ? { ok: true, value } : { ok: false };
}

/** O `device` do problema: o objeto com as quatro chaves, o sistema da lista e os textos. */
function parseDevice(value: unknown): SupportDevice | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !(DEVICE_KEYS as readonly string[]).includes(key))) {
    return null;
  }
  if (!(SUPPORT_PLATFORMS as readonly unknown[]).includes(value.platform)) return null;
  const osVersion = deviceText(value.osVersion ?? null);
  const appVersion = deviceText(value.appVersion ?? null);
  const updateId = deviceText(value.updateId ?? null);
  if (!osVersion.ok || !appVersion.ok || !updateId.ok) return null;
  return {
    platform: value.platform as SupportPlatform,
    osVersion: osVersion.value,
    appVersion: appVersion.value,
    updateId: updateId.value,
  };
}

/**
 * O corpo do `POST /me/support` (38.2), conferido antes da transação e sem
 * leitura: corpo que não é objeto (`body`), chave desconhecida (a própria
 * chave), o `kind` fora da lista, o `text` que não é texto ou, limpo pelo
 * `cleanMultiline`, vazio, acima de 2.000 ou com linha invisível (`text`), e
 * o `device` (`device`): obrigatório no `problem`, com o `platform` da lista e
 * os outros três `null` ou de 1 a 40 numa linha visível (a chave ausente vale
 * `null`); nos outros tipos, só ausente ou `null`. O texto bruto acima do
 * dobro do teto nem é limpo.
 */
export function parseSupportMessage(body: unknown): ParsedSupportMessage {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const unknownKey = Object.keys(body).find(
    (key) => !(BODY_KEYS as readonly string[]).includes(key),
  );
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  if (!isSupportKind(body.kind)) return { ok: false, field: 'kind' };
  if (typeof body.text !== 'string' || body.text.length > SUPPORT_TEXT_MAX * 2) {
    return { ok: false, field: 'text' };
  }
  const text = cleanMultiline(body.text);
  if (text.length < 1 || text.length > SUPPORT_TEXT_MAX || !isVisibleMultiline(text)) {
    return { ok: false, field: 'text' };
  }
  let device: SupportDevice | null = null;
  if (body.kind === 'problem') {
    device = parseDevice(body.device);
    if (device === null) return { ok: false, field: 'device' };
  } else if (body.device !== undefined && body.device !== null) {
    return { ok: false, field: 'device' };
  }
  return { ok: true, value: { kind: body.kind, text, device } };
}

/** O estado da mensagem na seção Suporte: aberta ao chegar, resolvida pela equipe. */
export const SUPPORT_STATUSES = ['open', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** O que a equipe faz no card (38.3): marcar como resolvida e reabrir. */
export const SUPPORT_ACTIONS = ['resolve', 'reopen'] as const;
export type SupportAction = (typeof SUPPORT_ACTIONS)[number];

/** O estado que a ação deixa. */
export const statusAfter = (action: SupportAction): SupportStatus =>
  action === 'resolve' ? 'resolved' : 'open';

/** Os ids automáticos do Firestore (20 letras e números) e os fixos do seed, com folga. */
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isSupportMessageId = (value: unknown): value is string =>
  typeof value === 'string' && MESSAGE_ID.test(value);
