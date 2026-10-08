import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';

import {
  lastClosedOf,
  readLastClosedDay,
  STATS_FIRST_DAY,
  startStatsClose,
  statsCloseRef,
  type StatsCloseStart,
} from './close';
import { dayKey } from './model';

// Carga única dos cadastros de antes do bloco 5 nos agregados do painel
// (signups.total), para a retenção por coorte e a parte dos cadastros que veio
// de convite. O gatilho de cadastro soma os novos e marca o perfil
// (signupCounted); esta carga soma só os perfis sem a marca e marca cada um na
// mesma transação, então nada conta duas vezes, nada fica de fora na troca de
// versão do deploy e rodar de novo nunca desconta (a conta excluída entre duas
// rodadas continua somada, como em todo agregado). Roda pelo
// scripts/backfill-signups.mjs, que carrega este build. docs/arquitetura-api.md,
// 20.7.
//
// Desde o bloco 11 (26.3 e 26.9), a carga abre o fechamento do dia: no fim,
// cria statsMeta/close (startStatsClose), e o closeStatsDays só começa depois
// dela. Um dia fechado nunca muda, então cada transação lê o statsMeta/close e
// deixa de fora (sem marcar nem somar) o perfil de um dia que já fechou.

/** O documento da carga em cada dia: statsDaily/{dia}/statsShards/backfill. */
export const BACKFILL_SHARD_ID = 'backfill';

/** Perfis lidos por página. */
const PAGE = 500;

/**
 * Perfis marcados por transação: cada um é uma gravação, e cada dia diferente
 * da página mais uma, abaixo das 500 de uma transação.
 */
const MARK_CHUNK = 200;

export type SignupBackfill = {
  /** Cadastros sem a marca que a carga somaria, por dia de São Paulo do `createdAt`, em ordem. */
  days: Record<string, number>;
  /** Cadastros sem a marca de dias já fechados (ficam de fora, sem marca), por dia. */
  closedDays: Record<string, number>;
  /** Perfis com a marca (o gatilho, ou uma carga anterior, já contou). */
  counted: number;
  /** Perfis sem `createdAt` (não acontece; ficam de fora, sem marca). */
  undated: number;
  /** Até onde o fechamento chegou, ou null antes da primeira carga. */
  lastClosedDay: string | null;
};

/** O que a carga gravou. */
export type SignupBackfillResult = {
  /** Cadastros somados, por dia, em ordem. */
  added: Record<string, number>;
  /** Cadastros de dias já fechados, que ficaram de fora, por dia. */
  skipped: Record<string, number>;
  /** O statsMeta/close: criado agora, ou o que já existia. */
  close: StatsCloseStart;
};

/** O dia já fechou: o perfil fica de fora (o dia fechado nunca muda). */
const isClosed = (day: string, lastClosedDay: string | null) =>
  lastClosedDay !== null && day <= lastClosedDay;

const addTo = (map: Map<string, number>, day: string, count = 1) =>
  map.set(day, (map.get(day) ?? 0) + count);

const sortedDays = (days: Map<string, number>): Record<string, number> =>
  Object.fromEntries([...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Um perfil diante da carga: já contado, sem data, ou sem a marca, com o dia de São Paulo do `createdAt`. */
type ProfileMark = { state: 'counted' } | { state: 'undated' } | { state: 'unmarked'; day: string };

function profileMark(doc: DocumentSnapshot): ProfileMark {
  if (doc.get('signupCounted') === true) return { state: 'counted' };
  const createdAt = doc.get('createdAt');
  return createdAt instanceof Timestamp
    ? { state: 'unmarked', day: dayKey(createdAt.toMillis()) }
    : { state: 'undated' };
}

/** Cada página de `users` (só `createdAt` e a marca), em ordem de id. */
async function* userPages(db: Firestore): AsyncGenerator<DocumentSnapshot[]> {
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let query = db
      .collection('users')
      .orderBy(FieldPath.documentId())
      .select('createdAt', 'signupCounted')
      .limit(PAGE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    yield page.docs;
    if (page.size < PAGE) return;
    last = page.docs.at(-1)!;
  }
}

/**
 * Lê todo `users` em páginas e conta, por dia de São Paulo do `createdAt`, os
 * perfis sem `signupCounted`, separando os de dias já fechados. Só lê: é o
 * que o `--dry-run` mostra.
 */
export async function countUnmarkedSignups(db: Firestore): Promise<SignupBackfill> {
  const lastClosedDay = await readLastClosedDay(db);
  const days = new Map<string, number>();
  const closedDays = new Map<string, number>();
  let counted = 0;
  let undated = 0;
  for await (const docs of userPages(db)) {
    for (const doc of docs) {
      const mark = profileMark(doc);
      if (mark.state === 'counted') counted += 1;
      else if (mark.state === 'undated') undated += 1;
      else addTo(isClosed(mark.day, lastClosedDay) ? closedDays : days, mark.day);
    }
  }
  return {
    days: sortedDays(days),
    closedDays: sortedDays(closedDays),
    counted,
    undated,
    lastClosedDay,
  };
}

/**
 * Soma os perfis sem a marca nos agregados e marca cada um, em transações de
 * até 200 perfis: cada transação relê os perfis (a conta pode ter sido
 * excluída no meio, e um perfil que sumiu não é recriado nem somado) e o
 * statsMeta/close, grava `signupCounted: true` nos que ainda estão sem a marca
 * e são de um dia aberto e soma, com `increment`, no
 * statsDaily/{dia}/statsShards/backfill de cada dia. O perfil de um dia já
 * fechado fica de fora, sem marca, e volta no resumo como pulado. Rodar de
 * novo só soma os perfis que nasceram sem a marca desde a rodada anterior e
 * nunca desconta. Quem lê os shards lista a subcoleção, então o documento
 * entra na soma sem mudança. No fim, abre o fechamento (`startStatsClose`)
 * com o menor entre o primeiro dia somado e `STATS_FIRST_DAY`; o documento
 * que já existe fica como está.
 */
export async function writeSignupBackfill(
  db: Firestore,
  now: number = Date.now(),
): Promise<SignupBackfillResult> {
  const added = new Map<string, number>();
  const skipped = new Map<string, number>();
  const at = Timestamp.fromMillis(now);
  for await (const docs of userPages(db)) {
    const unmarked = docs
      .filter((doc) => profileMark(doc).state === 'unmarked')
      .map((doc) => doc.ref);
    for (let start = 0; start < unmarked.length; start += MARK_CHUNK) {
      const chunk = unmarked.slice(start, start + MARK_CHUNK);
      const result = await markChunk(db, chunk, at);
      for (const [day, count] of result.added) addTo(added, day, count);
      for (const [day, count] of result.skipped) addTo(skipped, day, count);
    }
  }
  const sorted = sortedDays(added);
  const firstDay = Object.keys(sorted)[0];
  const close = await startStatsClose(
    db,
    firstDay !== undefined && firstDay < STATS_FIRST_DAY ? firstDay : STATS_FIRST_DAY,
    'backfill',
    now,
  );
  return { added: sorted, skipped: sortedDays(skipped), close };
}

type ChunkResult = { added: Map<string, number>; skipped: Map<string, number> };

/**
 * Uma transação: relê o statsMeta/close e os perfis, marca os que seguem sem a
 * marca e são de um dia aberto, e soma por dia.
 */
function markChunk(
  db: Firestore,
  refs: readonly DocumentReference[],
  at: Timestamp,
): Promise<ChunkResult> {
  return db.runTransaction(async (tx) => {
    const [control, ...snaps] = await tx.getAll(statsCloseRef(db), ...refs);
    const lastClosedDay = control?.exists ? lastClosedOf(control.get('lastClosedDay')) : null;
    const added = new Map<string, number>();
    const skipped = new Map<string, number>();
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const mark = profileMark(snap);
      if (mark.state !== 'unmarked') continue;
      if (isClosed(mark.day, lastClosedDay)) {
        addTo(skipped, mark.day);
        continue;
      }
      tx.update(snap.ref, { signupCounted: true });
      addTo(added, mark.day);
    }
    for (const [day, total] of added) {
      tx.set(
        db.collection('statsDaily').doc(day).collection('statsShards').doc(BACKFILL_SHARD_ID),
        { day, signups: { total: FieldValue.increment(total) }, backfill: true, updatedAt: at },
        { merge: true },
      );
    }
    return { added, skipped };
  });
}
