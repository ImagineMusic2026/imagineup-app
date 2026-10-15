import {
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { dayKey } from '../day';
import { isFanId } from '../moderation/model';

// O orçamento do dia de cada pessoa da equipe (bloco 11,
// docs/arquitetura-api.md, 26.4): staffLimits/{uid}_{dia}, com o dia de São
// Paulo. Guarda o que a pessoa já ajustou em cada contador de pontos (o
// adjustFanPoints do editor tem teto por dia) e quantas buscas por e-mail fez
// (o findFanByEmail tem teto por dia para todos). Só o servidor lê e grava (a
// regra final do firestore.rules fecha a coleção); o TTL de `expiresAt` apaga
// o documento 30 dias depois. Quem usa lê o documento na transação, confere
// com `checkStaffLimit` e grava a soma nova na mesma transação, com
// `addStaffLimit`; a recusa não grava nada. Desde os pedidos de dados (seção
// 32, decisão 13), também as exportações de dados do dia (`dataExports`) e os
// uids excluídos no dia (`deletedUids`). O `addStaffLimit` grava todos os
// campos a cada vez, com um `set` sem `merge`: campo novo que não entra nele
// some na próxima gravação de quem usa o documento (32.17).

/** Buscas por e-mail por pessoa e dia (decisão 9 de 26.1), para admin também. */
export const EMAIL_LOOKUPS_DAILY_MAX = 50;

/** Exportações de dados de fã por pessoa e dia (seção 32, decisão 13). */
export const DATA_EXPORTS_DAILY_MAX = 20;

/** Exclusões de conta de fã por pessoa e dia (seção 32, decisão 13): o tamanho de `deletedUids`. */
export const ACCOUNT_DELETIONS_DAILY_MAX = 5;

/** O documento sai pelo TTL 30 dias depois do dia dele. */
export const STAFF_LIMIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Os contadores do ajuste de pontos: saldo, XP, temporada e os dois da central. */
export const ADJUST_COUNTERS = [
  'balance',
  'xp',
  'season',
  'centralSeason',
  'centralTotal',
] as const;

export type AdjustCounter = (typeof ADJUST_COUNTERS)[number];

/** O que a pessoa já usou no dia. */
export type StaffLimitState = {
  /** A soma do valor absoluto dos ajustes do dia, por contador. */
  adjusted: Record<AdjustCounter, number>;
  emailLookups: number;
  /** As exportações de dados de fã do dia (as primeiras chamadas; as páginas não contam). */
  dataExports: number;
  /** Os uids de fã excluídos no dia, sem repetir; a contagem é o tamanho da lista. */
  deletedUids: string[];
};

export type StaffLimitRequest =
  | {
      kind: 'adjust';
      /** Os deltas do ajuste (o sinal não importa: o orçamento soma o valor absoluto). */
      deltas: Partial<Record<AdjustCounter, number>>;
      /** O teto por contador no dia; null é sem orçamento (admin). */
      dailyMax: number | null;
    }
  | { kind: 'email-lookup' }
  | { kind: 'data-export' }
  | {
      kind: 'account-deletion';
      /** O fã excluído: o mesmo uid de novo no dia passa sem somar. */
      uid: string;
    };

export type StaffLimitCheck =
  | {
      ok: true;
      next: StaffLimitState;
      /**
       * Só na exclusão do uid que já está na lista do dia: passa sem somar, e
       * quem chama não grava outra auditoria (seção 32, decisão 12).
       */
      repeat?: true;
    }
  | { ok: false; reason: 'adjust-daily-limit'; counter: AdjustCounter; remaining: number }
  | { ok: false; reason: 'lookup-daily-limit'; max: number }
  | { ok: false; reason: 'export-daily-limit'; max: number }
  | { ok: false; reason: 'deletion-daily-limit'; max: number };

export function emptyStaffLimit(): StaffLimitState {
  return {
    adjusted: { balance: 0, xp: 0, season: 0, centralSeason: 0, centralTotal: 0 },
    emailLookups: 0,
    dataExports: 0,
    deletedUids: [],
  };
}

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** A lista de uids lida com tolerância: só textos no formato do uid do fã, sem repetir. */
const uidList = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter(isFanId))] : [];

/**
 * O que a pessoa já usou no dia `day`, lido do documento (leitura tolerante:
 * campo estranho vale 0). Documento de outro dia (não acontece pelo id) conta
 * como dia novo, do zero.
 */
export function parseStaffLimit(data: unknown, day: string): StaffLimitState {
  const state = emptyStaffLimit();
  if (typeof data !== 'object' || data === null) return state;
  const record = data as Record<string, unknown>;
  if (record.day !== day) return state;
  const adjusted =
    typeof record.adjusted === 'object' && record.adjusted !== null
      ? (record.adjusted as Record<string, unknown>)
      : {};
  for (const counter of ADJUST_COUNTERS) state.adjusted[counter] = count(adjusted[counter]);
  state.emailLookups = count(record.emailLookups);
  state.dataExports = count(record.dataExports);
  state.deletedUids = uidList(record.deletedUids);
  return state;
}

/**
 * Confere um pedido contra o que a pessoa já usou no dia e devolve a soma
 * nova, sem gravar. Ajuste: cada contador à parte, com o valor absoluto do
 * delta somado ao do dia; passou do `dailyMax` em algum, recusa com o
 * primeiro contador (na ordem de `ADJUST_COUNTERS`) e quanto ainda cabe nele.
 * Sem `dailyMax` (admin), sempre passa, e a soma fica registrada. Busca por
 * e-mail: a 51ª do dia recusa. Exportação de dados: a 21ª do dia recusa.
 * Exclusão de conta: o uid que já está na lista passa sem somar (`repeat`);
 * outro uid, com 5 na lista, recusa.
 */
export function checkStaffLimit(
  state: StaffLimitState,
  request: StaffLimitRequest,
): StaffLimitCheck {
  if (request.kind === 'email-lookup') {
    if (state.emailLookups >= EMAIL_LOOKUPS_DAILY_MAX) {
      return { ok: false, reason: 'lookup-daily-limit', max: EMAIL_LOOKUPS_DAILY_MAX };
    }
    return { ok: true, next: { ...state, emailLookups: state.emailLookups + 1 } };
  }
  if (request.kind === 'data-export') {
    if (state.dataExports >= DATA_EXPORTS_DAILY_MAX) {
      return { ok: false, reason: 'export-daily-limit', max: DATA_EXPORTS_DAILY_MAX };
    }
    return { ok: true, next: { ...state, dataExports: state.dataExports + 1 } };
  }
  if (request.kind === 'account-deletion') {
    if (state.deletedUids.includes(request.uid)) {
      return { ok: true, next: { ...state, deletedUids: [...state.deletedUids] }, repeat: true };
    }
    if (state.deletedUids.length >= ACCOUNT_DELETIONS_DAILY_MAX) {
      return { ok: false, reason: 'deletion-daily-limit', max: ACCOUNT_DELETIONS_DAILY_MAX };
    }
    return { ok: true, next: { ...state, deletedUids: [...state.deletedUids, request.uid] } };
  }
  const adjusted = { ...state.adjusted };
  for (const counter of ADJUST_COUNTERS) {
    const delta = request.deltas[counter];
    if (delta === undefined || delta === 0) continue;
    const used = state.adjusted[counter];
    const next = used + Math.abs(delta);
    if (request.dailyMax !== null && next > request.dailyMax) {
      return {
        ok: false,
        reason: 'adjust-daily-limit',
        counter,
        remaining: Math.max(0, request.dailyMax - used),
      };
    }
    adjusted[counter] = next;
  }
  return { ok: true, next: { ...state, adjusted } };
}

export const staffLimitId = (uid: string, day: string) => `${uid}_${day}`;

/** O documento do dia de São Paulo de `now` de uma pessoa da equipe. */
export function staffLimitRef(db: Firestore, uid: string, now: number): DocumentReference {
  return db.collection('staffLimits').doc(staffLimitId(uid, dayKey(now)));
}

/** Lê o orçamento do dia na transação de quem usa. */
export async function readStaffLimit(
  tx: Transaction,
  db: Firestore,
  uid: string,
  now: number,
): Promise<StaffLimitState> {
  const snap: DocumentSnapshot = await tx.get(staffLimitRef(db, uid, now));
  return parseStaffLimit(snap.data(), dayKey(now));
}

/**
 * O documento do dia com a soma nova, com todos os campos (puro): o
 * `addStaffLimit` grava com um `set` sem `merge`, e o campo que faltar aqui
 * some do documento (uma busca por e-mail zeraria as exportações do dia).
 */
export function staffLimitDoc(
  uid: string,
  now: number,
  next: StaffLimitState,
): Record<string, unknown> {
  return {
    uid,
    day: dayKey(now),
    adjusted: next.adjusted,
    emailLookups: next.emailLookups,
    dataExports: next.dataExports,
    deletedUids: next.deletedUids,
    updatedAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + STAFF_LIMIT_TTL_MS),
  };
}

/**
 * Grava a soma nova na transação de quem usa (depois de todas as leituras),
 * com o `expiresAt` do TTL.
 */
export function addStaffLimit(
  tx: Transaction,
  db: Firestore,
  uid: string,
  now: number,
  next: StaffLimitState,
): void {
  tx.set(staffLimitRef(db, uid, now), staffLimitDoc(uid, now, next));
}
