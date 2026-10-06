import { createHmac } from 'node:crypto';

import { isHandleFormat } from '../artists/model';
import type { MissionTick } from '../missions/model';
import { isContentId } from '../page-cursor';
import type { AwardStatus } from '../points/model';
import type { OriginKind } from '../points/stats';

// Convite com atribuição e origem do fã (bloco 5), puro: nada aqui lê ou grava
// o Firestore. O service.ts lê, chama daqui e grava. Contrato em
// docs/arquitetura-api.md, seção 20.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Letras do código sorteado: sem vogal (não forma palavra) e sem 0, 1, I, L e
 * O (não se confundem ao ditar nem ao digitar no cadastro).
 */
export const INVITE_CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';

/** 28^8, perto de 3,8 × 10^11 códigos: colisão e chute ficam fora de alcance. */
export const INVITE_CODE_LENGTH = 8;

/** Códigos sorteados de uma vez na criação; fica o primeiro livre. */
export const INVITE_CODE_DRAWS = 5;

/**
 * Base dos links que o fã compartilha, espelho do `SHARE_LINK_BASE` do app
 * (`src/domains/invites/consts.ts`). Vai na resposta do `GET /me/invite`
 * (`linkBase`): a troca de domínio (bloco 13) muda os links sem build nova.
 */
export const INVITE_LINK_BASE = 'https://imagineup-painel.vercel.app';

/** Só conta criada há até 7 dias vira convidada (o `createdAt` do perfil). */
export const INVITE_CLAIM_WINDOW_MS = 7 * DAY_MS;

/** Visitas a links de convite que uma conta manda por dia de São Paulo. */
export const INVITE_VISITS_SENT_PER_DAY = 20;

/** Links novos que um fã registra por dia de São Paulo. */
export const INVITE_LINKS_PER_DAY = 30;

/** O `openedAt` do aparelho vale de 30 dias antes do pedido até 5 min depois. */
export const OPENED_AT_PAST_MS = 30 * DAY_MS;
export const OPENED_AT_FUTURE_MS = 5 * 60 * 1000;

/** Tamanho do caminho do link no corpo (só para classificar; não é guardado). */
export const INVITE_PATH_MAX = 200;

/** Tamanho de cada `utm_*` cru no corpo, e do valor normalizado guardado. */
export const UTM_RAW_MAX = 200;
export const UTM_MAX = 100;

export type InviteErrorReason = 'invite_not_found' | 'invite_not_allowed';

const INVITE_ERROR_MESSAGES: Record<InviteErrorReason, string> = {
  invite_not_found: 'Convite não encontrado.',
  invite_not_allowed: 'Este convite não vale para esta conta.',
};

/**
 * Recusa do convite. A API traduz `invite_not_found` para o 404 e
 * `invite_not_allowed` para o 409 combinados com o app (`toApiHttpError`),
 * com o motivo em `details.reason` (`self`, só para a própria conta dona do
 * código, ou `account_too_old`).
 */
export class InviteError extends Error {
  readonly reason: InviteErrorReason;
  readonly details: Record<string, unknown> | undefined;

  constructor(reason: InviteErrorReason, details?: Record<string, unknown>) {
    super(INVITE_ERROR_MESSAGES[reason]);
    this.name = 'InviteError';
    this.reason = reason;
    this.details = details;
  }
}

// --- Código ----------------------------------------------------------------------

/** Um código sorteado (o `random` das dependências; os testes fixam). */
export function drawInviteCode(random: () => number): string {
  let code = '';
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    const at = Math.min(
      INVITE_CODE_ALPHABET.length - 1,
      Math.floor(random() * INVITE_CODE_ALPHABET.length),
    );
    code += INVITE_CODE_ALPHABET[at];
  }
  return code;
}

/** O código como vem do app (o `CODE` de `invites/deep-link.ts`). */
const RAW_CODE = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * O código como o servidor procura: sem espaços nem hífens, em maiúsculas,
 * no formato `^[A-Z0-9_]{3,64}$`; fora disso, null. O app tem a mesma função
 * (`src/domains/invites/link.ts`), com a mesma tabela de testes: mudou uma,
 * mude a outra. Confere o ASCII antes de passar para maiúsculas: o `ß` viraria
 * `SS`.
 */
export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/[\s-]+/g, '');
  return /^[A-Za-z0-9_]{3,64}$/.test(compact) ? compact.toUpperCase() : null;
}

/** O link do atalho Convidar: a base mais `/?ref=<código>`. */
export function inviteUrl(code: string, base: string = INVITE_LINK_BASE): string {
  return `${base}/?ref=${encodeURIComponent(code)}`;
}

// --- Chave da pessoa ------------------------------------------------------------

/**
 * O e-mail como chave da pessoa: minúsculas, sem espaço nas pontas, sem o `+`
 * e o que vem depois na parte local; no Gmail (e no `googlemail.com`), sem os
 * pontos da parte local e com o domínio `gmail.com`. Sem `@` ou com a parte
 * local vazia, null.
 */
export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local ? `${local}@${domain}` : null;
}

const KEY_PREFIX = 'imagineup:invite:v1:';

/** Uid que cabe direto no id do lançamento e do marcador. */
const PLAIN_UID = /^[A-Za-z0-9_-]{1,128}$/;

function hmac(secret: string, text: string): string {
  return createHmac('sha256', secret).update(`${KEY_PREFIX}${text}`, 'utf8').digest('hex');
}

/**
 * A chave da pessoa (decisão 4 de 20.1): `e` mais os 40 primeiros caracteres
 * hexadecimais de HMAC-SHA256(segredo, prefixo + e-mail normalizado), com o
 * e-mail do ID token. Sem e-mail, `u` mais o uid (o uid fora do formato do id
 * vira `h` mais o HMAC dele). É o id dos lançamentos do convite e do marcador
 * de visita: a conta excluída e recriada com o mesmo e-mail tem outro uid, e a
 * mesma chave. HMAC, e não sha256, para quem lê o extrato não testar um e-mail
 * conhecido contra ele. Nunca troque o segredo (20.17).
 */
export function personKey(email: string | null | undefined, uid: string, secret: string): string {
  if (!secret) throw new Error('INVITE_KEY_SECRET vazio: a chave da pessoa não sai sem ele.');
  const normalized = email ? normalizeEmail(email) : null;
  if (normalized) return `e${hmac(secret, normalized).slice(0, 40)}`;
  if (PLAIN_UID.test(uid)) return `u${uid}`;
  return `h${hmac(secret, `uid:${uid}`).slice(0, 40)}`;
}

/**
 * Quem chama diante do dono do código: a mesma conta (`account`), a mesma
 * pessoa noutra conta (`person`: o `ownerKey` do código igual à chave de quem
 * chama, `nome+1@gmail.com` ou `n.o.m.e@gmail.com` da dona de
 * `nome@gmail.com`) ou outra pessoa (null). O claim trata os dois casos de
 * jeitos diferentes: só a mesma conta ouve que o código é dela (20.6).
 */
export function inviteOwnership(
  invite: { uid: string; ownerKey: string | null },
  caller: { uid: string; key: string },
): 'account' | 'person' | null {
  if (invite.uid === caller.uid) return 'account';
  return invite.ownerKey !== null && invite.ownerKey === caller.key ? 'person' : null;
}

/** Quem chama é o dono do código, pela conta ou pela pessoa. */
export function isInviteOwner(
  invite: { uid: string; ownerKey: string | null },
  caller: { uid: string; key: string },
): boolean {
  return inviteOwnership(invite, caller) !== null;
}

/**
 * O `award` de `referrals/{uid}`: o que quem convidou recebeu em cada
 * lançamento, ou `self` quando a conta é da mesma pessoa que é dona do código
 * (o autoconvite pelo apelido do e-mail, sem lançamento nenhum).
 */
export type ReferralAwardStatus = AwardStatus | 'self';

/** A conta ainda pode virar convidada: perfil criado há até 7 dias. */
export function isWithinClaimWindow(profileCreatedAt: number | null, now: number): boolean {
  return profileCreatedAt !== null && now - profileCreatedAt <= INVITE_CLAIM_WINDOW_MS;
}

// --- Origem --------------------------------------------------------------------

export type InviteLinkKind = 'invite' | 'post' | 'artist' | 'agenda' | 'other';

/** O tipo do link e o id do post ou da central (null no resto). */
export type InviteLinkOrigin = { kind: InviteLinkKind; targetId: string | null };

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Classifica o caminho que o link abria: `/` e `/c/<código>` são `invite`;
 * `/post/<id>`, `post`; `/artista/<id>`, `artist` (id no formato do @);
 * `/agenda`, `agenda`; o resto, e id fora do formato, `other`. O id de post
 * segue o `isContentId` (fora os `__.*__`, que o Firestore reserva: o claim e
 * a visita leem o post para a missão de link, e a leitura de um id reservado
 * seria recusada). A busca é ignorada, e o caminho em si não é guardado: um
 * `other` pode levar qualquer texto.
 */
export function classifyInvitePath(path: string): InviteLinkOrigin {
  const clean = path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/';
  if (clean === '/') return { kind: 'invite', targetId: null };
  const parts = clean.split('/').slice(1);
  const [head, id, ...rest] = parts;
  if (rest.length > 0) return { kind: 'other', targetId: null };
  if (head === 'c' && id !== undefined && id !== '') return { kind: 'invite', targetId: null };
  if (head === 'agenda' && id === undefined) return { kind: 'agenda', targetId: null };
  if ((head === 'post' || head === 'artista') && id !== undefined) {
    const decoded = decodeSegment(id);
    if (head === 'post' && isContentId(decoded)) {
      return { kind: 'post', targetId: decoded };
    }
    if (head === 'artista' && isHandleFormat(decoded)) {
      return { kind: 'artist', targetId: decoded };
    }
  }
  return { kind: 'other', targetId: null };
}

/** Telefone com DDD (10 ou 11), CPF (11) e afins: 10 dígitos juntos, sem contar espaço e pontuação. */
const LONG_NUMBER = /\d{10,}/;

/**
 * Um `utm_*` como fica guardado: com `@`, ou com 10 dígitos ou mais juntos
 * (ignorando espaço, pontuação e símbolos), vira null antes de tudo; senão,
 * sem espaço nas pontas, em minúsculas e sem acento (implementação: "São
 * João" vira `sao-joao`, e não `s-o-jo-o`); cada trecho fora de
 * `[a-z0-9._~-]` vira um `-`; sem `-` nas pontas (implementação: nem `_`,
 * para o valor nunca ser o `_none` dos shards nem um `__x__`, que o Firestore
 * reserva nos nomes de campo); até 100 caracteres; vazio vira null. O valor cru nunca é guardado: o `.` fica para nomes como `v1.2`,
 * e um e-mail colado sem o corte do `@` continuaria sendo o e-mail.
 */
export function normalizeUtm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.includes('@')) return null;
  if (LONG_NUMBER.test(value.replace(/[\s\p{P}\p{S}]+/gu, ''))) return null;
  const clean = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9._~-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, UTM_MAX)
    .replace(/[-_]+$/g, '');
  return clean === '' ? null : clean;
}

/** Os três `utm_*` que ficam, normalizados; cada um texto ou null. */
export type InviteUtm = { source: string | null; medium: string | null; campaign: string | null };

export const NO_UTM: InviteUtm = { source: null, medium: null, campaign: null };

// --- Corpos ----------------------------------------------------------------------

export type ClaimVia = 'link' | 'code';

/** O corpo do `POST /invites/claim`, conferido e normalizado. */
export type ClaimInput = {
  code: string;
  via: ClaimVia;
  /** Só com `via: 'link'`. */
  link: InviteLinkOrigin | null;
  utm: InviteUtm;
  /** ms; null fora da faixa, sem valor ou com `via: 'code'`. */
  openedAt: number | null;
};

/** O corpo do `POST /invites/visit`, conferido e normalizado. */
export type VisitInput = {
  code: string;
  link: InviteLinkOrigin;
  utm: InviteUtm;
  openedAt: number | null;
};

/** Resultado de um parse: o valor, ou o campo que recusou (400 `invalid_request`). */
export type Parsed<T> = { ok: true; value: T } | { ok: false; field: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseCode(value: unknown): string | null {
  if (typeof value !== 'string' || !RAW_CODE.test(value)) return null;
  return normalizeInviteCode(value);
}

function parseLinkPath(value: unknown): InviteLinkOrigin | null {
  if (!isRecord(value)) return null;
  const { path } = value;
  if (typeof path !== 'string' || path.length > INVITE_PATH_MAX) return null;
  if (!path.startsWith('/') || path.includes('//')) return null;
  return classifyInvitePath(path);
}

const UTM_FIELDS = ['source', 'medium', 'campaign'] as const;

/** `utm` opcional: só `source`, `medium` e `campaign`; o resto (content, term, id) é ignorado. */
function parseUtm(value: unknown): Parsed<InviteUtm> {
  if (value === undefined || value === null) return { ok: true, value: { ...NO_UTM } };
  if (!isRecord(value)) return { ok: false, field: 'utm' };
  const utm: InviteUtm = { ...NO_UTM };
  for (const field of UTM_FIELDS) {
    const raw = value[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string' || raw.length > UTM_RAW_MAX) {
      return { ok: false, field: `utm.${field}` };
    }
    utm[field] = normalizeUtm(raw);
  }
  return { ok: true, value: utm };
}

/** `openedAt`: ISO ou null; fora de 30 dias antes até 5 min depois de agora, null. */
function parseOpenedAt(value: unknown, now: number): Parsed<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, field: 'openedAt' };
  const at = Date.parse(value);
  if (Number.isNaN(at)) return { ok: false, field: 'openedAt' };
  const inRange = at >= now - OPENED_AT_PAST_MS && at <= now + OPENED_AT_FUTURE_MS;
  return { ok: true, value: inRange ? at : null };
}

/**
 * Corpo do claim: `code` (o `CODE` do app, normalizado), `via` (`link` ou
 * `code`), `link: { path }` só com `link` (null com `code`), `utm` opcional e
 * `openedAt` opcional, os dois só valendo com `link` (com `code`, ignorados).
 */
export function parseClaimBody(body: unknown, now: number): Parsed<ClaimInput> {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const code = parseCode(body.code);
  if (!code) return { ok: false, field: 'code' };
  const { via } = body;
  if (via !== 'link' && via !== 'code') return { ok: false, field: 'via' };
  if (via === 'code') {
    if (body.link !== undefined && body.link !== null) return { ok: false, field: 'link' };
    return { ok: true, value: { code, via, link: null, utm: { ...NO_UTM }, openedAt: null } };
  }
  const link = parseLinkPath(body.link);
  if (!link) return { ok: false, field: 'link' };
  const utm = parseUtm(body.utm);
  if (!utm.ok) return utm;
  const openedAt = parseOpenedAt(body.openedAt, now);
  if (!openedAt.ok) return openedAt;
  return { ok: true, value: { code, via, link, utm: utm.value, openedAt: openedAt.value } };
}

/** Corpo da visita: como o do claim, sem `via` e com `link` obrigatório. */
export function parseVisitBody(body: unknown, now: number): Parsed<VisitInput> {
  if (!isRecord(body)) return { ok: false, field: 'body' };
  const code = parseCode(body.code);
  if (!code) return { ok: false, field: 'code' };
  const link = parseLinkPath(body.link);
  if (!link) return { ok: false, field: 'link' };
  const utm = parseUtm(body.utm);
  if (!utm.ok) return utm;
  const openedAt = parseOpenedAt(body.openedAt, now);
  if (!openedAt.ok) return openedAt;
  return { ok: true, value: { code, link, utm: utm.value, openedAt: openedAt.value } };
}

/**
 * Onde a pessoa chegou pelo link, para o alvo das missões de link (bloco 7,
 * 22.4): o link de post leva o post e, quando lida, a central dele (o link de
 * um post do Netto anda a missão de link da central do Netto); o de central,
 * a central; os outros, nada.
 */
export function linkOn(link: InviteLinkOrigin, postArtistId: string | null): MissionTick['on'] {
  if (link.kind === 'post' && link.targetId) {
    return { postId: link.targetId, artistIds: postArtistId ? [postArtistId] : [] };
  }
  if (link.kind === 'artist' && link.targetId) return { artistIds: [link.targetId] };
  return { artistIds: [] };
}

/** O tipo de origem nos shards: o do link, ou `code` para o código digitado. */
export function originKind(input: { via: ClaimVia; link: InviteLinkOrigin | null }): OriginKind {
  return input.via === 'code' || !input.link ? 'code' : input.link.kind;
}

// --- Links compartilhados --------------------------------------------------------

export type SharedLinkKind = 'invite' | 'agenda' | 'post' | 'artist';

/** Um link que o fã compartilhou: um por destino. */
export type SharedLink = { linkId: string; kind: SharedLinkKind; targetId: string | null };

const LINK_ID = /^(invite|agenda|post:[A-Za-z0-9_-]{1,128}|artist:[a-z0-9_]{3,30})$/;

/**
 * O `linkId` da rota: `invite` (o atalho Convidar), `agenda`, `post:<id>` ou
 * `artist:<@>` (fora dos ids `__.*__`). Fora disso, null (400).
 */
export function parseLinkId(raw: unknown): SharedLink | null {
  if (typeof raw !== 'string' || !LINK_ID.test(raw)) return null;
  if (raw === 'invite' || raw === 'agenda') return { linkId: raw, kind: raw, targetId: null };
  const [kind, targetId] = raw.split(':', 2) as ['post' | 'artist', string];
  if (kind === 'artist' && !isHandleFormat(targetId)) return null;
  return { linkId: raw, kind, targetId };
}
