import type { Firestore } from 'firebase-admin/firestore';

import { runJoinCentrals } from '../centrals/service';
import { weekStart } from '../day';
import { runAward } from '../points/award';
import {
  DEFAULT_POINTS_CONFIG,
  parseSeasonConfig,
  seasonConfigRef,
  TOP_TARGET_DEFAULT,
  writeSeasonConfig,
} from '../points/config';
import type { AwardEntry, SeasonInfo } from '../points/model';
import { noonDaysAgo, SEED_ACTOR, SEED_SEASON } from '../points/seed';
import { runRankSnapshot, runSeasonClose } from './jobs';

// O ranking do seed dos emuladores (scripts/seed-emulators.mjs, que carrega
// este build; docs/arquitetura-api.md, 23.15): 48 contas de ranking com os
// pontos lançados pelo núcleo (ajustes do seed, ator do sistema), duas
// temporadas passadas fechadas pela própria virada (as 3 temporadas da 1e) e
// o retrato da semana tirado pela própria função (a seta). Nunca roda em
// produção: o script fixa o emulador. As fixtures do app copiam esta tabela
// (src/domains/ranking/fixtures.ts): mudou aqui, mude lá.

const DAY_MS = 24 * 60 * 60 * 1000;

/** As centrais em que o ranking do seed pontua (as do protótipo e a do Juninho). */
type SeedCentralId = 'nettobrito' | 'nenho' | 'juninhomoraes';

/** Uma conta de ranking: os pontos da temporada no retrato (`base`) e agora (`now`). */
export type RankingSeedAccount = {
  email: string;
  name: string;
  city: string | null;
  base: number;
  now: number;
  /** Os pontos de cada central no retrato e agora (só onde a conta pontua). */
  centrals: Partial<Record<SeedCentralId, { base: number; now: number }>>;
  /** Os pontos nas temporadas passadas (ajustes só de temporada). */
  verao: number;
  carnaval: number;
};

type Prototype = {
  name: string;
  city: string | null;
  base: number;
  now: number;
  netto: number;
  nenho: number;
};

/**
 * Os 11 do protótipo (23.15): o pódio Thalita, Davi e Jean e as linhas 4 a 11
 * da 1f. A 5ª é a Aline (o Alan do seed é o fã novo, sem carteira), e a Júlia
 * tem 4.959, para o "840 pts para entrar no top 10" da Camila (decisão 11).
 * As centrais deles não mudam na semana.
 */
const PROTOTYPE: readonly Prototype[] = [
  {
    name: 'Thalita Santos',
    city: 'Irará, BA',
    base: 6_100,
    now: 9_140,
    netto: 4_800,
    nenho: 4_300,
  },
  { name: 'Davi Lima', city: 'Salvador, BA', base: 6_500, now: 7_902, netto: 4_500, nenho: 3_360 },
  {
    name: 'Jean Pereira',
    city: 'Aracaju, SE',
    base: 5_200,
    now: 7_318,
    netto: 4_200,
    nenho: 3_050,
  },
  {
    name: 'Maria Clara Souza',
    city: 'Salvador, BA',
    base: 3_810,
    now: 6_844,
    netto: 6_500,
    nenho: 300,
  },
  { name: 'Aline Ferreira', city: 'Irará, BA', base: 3_890, now: 6_201, netto: 6_050, nenho: 120 },
  { name: 'Bruna Andrade', city: 'Recife, PE', base: 3_340, now: 5_930, netto: 5_700, nenho: 200 },
  {
    name: 'Igor Nascimento',
    city: 'Aracaju, SE',
    base: 3_640,
    now: 5_412,
    netto: 5_250,
    nenho: 140,
  },
  {
    name: 'Leila Matos',
    city: 'Feira de Santana, BA',
    base: 3_410,
    now: 5_106,
    netto: 4_950,
    nenho: 130,
  },
  {
    name: 'Rafael Costa',
    city: 'Alagoinhas, BA',
    base: 3_720,
    now: 5_038,
    netto: 4_880,
    nenho: 150,
  },
  { name: 'Júlia Ramos', city: null, base: 3_560, now: 4_959, netto: 4_700, nenho: 250 },
  {
    name: 'Pedro Henrique Alves',
    city: 'Serrinha, BA',
    base: 3_480,
    now: 4_402,
    netto: 4_300,
    nenho: 90,
  },
];

// A gente de exemplo das fixtures do ranking do app (GENERIC_PEOPLE), pela
// mesma regra: cada nome com dois sobrenomes diferentes.
const FIRST_NAMES = [
  'Ana',
  'Bruno',
  'Carla',
  'Diego',
  'Eduarda',
  'Felipe',
  'Gabriela',
  'Henrique',
  'Isabela',
  'João',
  'Karina',
  'Lucas',
  'Mariana',
  'Nathan',
  'Olívia',
  'Paulo',
  'Renata',
  'Samuel',
  'Tainá',
  'Vitor',
] as const;

const LAST_NAMES = [
  'Oliveira',
  'Santana',
  'Carvalho',
  'Barbosa',
  'Moreira',
  'Teixeira',
  'Rocha',
  'Cardoso',
  'Nunes',
  'Mendes',
  'Freitas',
  'Batista',
] as const;

const CITIES = [
  'Salvador, BA',
  'Feira de Santana, BA',
  'Irará, BA',
  'Aracaju, SE',
  null,
  'Recife, PE',
  'Alagoinhas, BA',
  'Serrinha, BA',
  'Maceió, AL',
  'Vitória da Conquista, BA',
  'Juazeiro, BA',
] as const;

/** Os genéricos, abaixo da Camila no geral (i de 1 a 37). */
export const GENERIC_COUNT = 37;

function genericPerson(index: number): { name: string; city: string | null } {
  const first = FIRST_NAMES[index % FIRST_NAMES.length]!;
  const round = Math.floor(index / FIRST_NAMES.length);
  const last = LAST_NAMES[(index + round * 5) % LAST_NAMES.length]!;
  return { name: `${first} ${last}`, city: CITIES[index % CITIES.length] ?? null };
}

const isOddFrom3 = (i: number) => i >= 3 && i % 2 === 1;

/**
 * O genérico i (de 1 a 37), pelas fórmulas de 23.15: agora, 4.061 menos 27 a
 * cada um; no retrato, o 1 e o 2 eram 4º e 5º (caem 9) e os outros tinham 800
 * a menos. Nenho com 90 a menos que o geral (os ímpares a partir do 3 sobem
 * 30 na semana); Netto do 1 ao 18 (os ímpares a partir do 3 sobem 2);
 * Juninho do 19 ao 24, sem mudar.
 */
function generic(i: number): Omit<RankingSeedAccount, 'email' | 'verao' | 'carnaval'> {
  const now = 4_061 - 27 * (i - 1);
  const base = i === 1 ? 4_050 : i === 2 ? 3_970 : now - 800;
  const centrals: RankingSeedAccount['centrals'] = {
    nenho: { now: now - 90, base: now - 90 - (isOddFrom3(i) ? 30 : 0) },
  };
  if (i <= 18) centrals.nettobrito = { now: 80 - i, base: 80 - i - (isOddFrom3(i) ? 2 : 0) };
  if (i >= 19 && i <= 24) {
    const points = 90 - 10 * (i - 19);
    centrals.juninhomoraes = { now: points, base: points };
  }
  return { ...genericPerson(i - 1), base, now, centrals };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A conta `rank-NN` do seed (e-mail e ids dos lançamentos). */
export const rankingAccountKey = (n: number) => `rank-${pad(n)}`;

/** As 48 contas de ranking, na ordem (`rank-01` a `rank-48`). */
export const RANKING_SEED: readonly RankingSeedAccount[] = [
  ...PROTOTYPE.map((person) => ({
    name: person.name,
    city: person.city,
    base: person.base,
    now: person.now,
    centrals: {
      nettobrito: { base: person.netto, now: person.netto },
      nenho: { base: person.nenho, now: person.nenho },
    },
  })),
  ...Array.from({ length: GENERIC_COUNT }, (_, index) => generic(index + 1)),
].map((account, index) => ({
  ...account,
  email: `${rankingAccountKey(index + 1)}@teste.imagineup`,
  verao: 1_000 - 20 * (index + 1),
  carnaval: 20 * (index + 1) + 20,
}));

/** As temporadas passadas do seed, ao meio-dia de São Paulo dos dias indicados (23.15). */
export const SEED_PAST_SEASONS = [
  {
    id: 'temporada-verao',
    name: 'Verão',
    startedDaysAgo: 110,
    endedDaysAgo: 80,
    launchDaysAgo: 95,
    camila: 510,
  },
  {
    id: 'temporada-carnaval',
    name: 'Carnaval',
    startedDaysAgo: 70,
    endedDaysAgo: 40,
    launchDaysAgo: 55,
    camila: 290,
  },
] as const;

/** A virada do seed roda 2 min depois do fim (depois da folga de 1 min). */
const CLOSE_AFTER_MS = 2 * 60_000;

function pastSeason(now: number, index: 0 | 1): SeasonInfo {
  const season = SEED_PAST_SEASONS[index];
  return {
    id: season.id,
    name: season.name,
    startsAt: noonDaysAgo(now, season.startedDaysAgo),
    endsAt: noonDaysAgo(now, season.endedDaysAgo),
    leaderTitle: null,
    topTarget: TOP_TARGET_DEFAULT,
    endedEarly: null,
  };
}

/** A temporada de agora do seed (São João), nas datas do `SEED_SEASON` (seção 14). */
function currentSeason(now: number): SeasonInfo {
  return {
    id: SEED_SEASON.id,
    name: SEED_SEASON.name,
    startsAt: now - SEED_SEASON.startedDaysAgo * DAY_MS,
    endsAt: now + SEED_SEASON.endsInDays * DAY_MS,
    leaderTitle: null,
    topTarget: TOP_TARGET_DEFAULT,
    endedEarly: null,
  };
}

/** Roda a virada pelo handler até ela fechar. */
async function closeUntilDone(db: Firestore, at: number): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    const result = await runSeasonClose(db, { now: at, budgetMs: 60_000 });
    if (result.status !== 'running') return;
  }
  throw new Error('A virada do seed não terminou.');
}

/** Os uids das contas, pelo e-mail (as que o script criou). */
export type SeedUids = ReadonlyMap<string, string>;

const seedOptions = (at: number) => ({
  now: at,
  config: DEFAULT_POINTS_CONFIG,
  actor: SEED_ACTOR,
});

/** Roda `work` em levas de `size` em paralelo. */
async function inBatches<T>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<unknown>,
) {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(work));
  }
}

/**
 * As temporadas passadas (23.15), antes de qualquer ponto do São João: só
 * roda sem config/season (a primeira vez). Grava o Verão com o Carnaval como
 * próxima, lança os pontos do Verão (ajustes só de temporada: o saldo, o XP e
 * os níveis não mudam), fecha pela virada (o Verão vai para o arquivo, as
 * temporadas de quem pontuou somam 1, o Top 20 vai aos 20 primeiros e o
 * Carnaval é promovido), cadastra o São João como próxima, lança o Carnaval e
 * fecha de novo (o São João é promovido). Devolve se rodou.
 */
export async function seedPastSeasons(
  db: Firestore,
  uids: SeedUids,
  camilaUid: string | null,
  options: { now?: number } = {},
): Promise<boolean> {
  const now = options.now ?? Date.now();
  const verao = pastSeason(now, 0);
  const carnaval = pastSeason(now, 1);
  const created = await db.runTransaction(async (tx) => {
    if ((await tx.get(seasonConfigRef(db))).exists) return false;
    writeSeasonConfig(
      tx,
      db,
      { version: 1, season: verao, next: carnaval, lastClosed: null },
      { now: verao.startsAt, updatedBy: null },
    );
    return true;
  });
  if (!created) return false;

  const launch = async (key: 'verao' | 'carnaval', daysAgo: number, camila: number) => {
    const at = noonDaysAgo(now, daysAgo);
    await inBatches(RANKING_SEED, 8, async (account) => {
      const uid = uids.get(account.email);
      if (!uid) return;
      const n = RANKING_SEED.indexOf(account) + 1;
      await runAward(
        db,
        uid,
        [
          {
            kind: 'adjust',
            source: 'seed',
            eventId: `${rankingAccountKey(n)}-${key}`,
            season: account[key],
          },
        ],
        seedOptions(at),
      );
    });
    if (camilaUid) {
      await runAward(
        db,
        camilaUid,
        [{ kind: 'adjust', source: 'seed', eventId: `camila-${key}`, season: camila }],
        seedOptions(at),
      );
    }
  };

  await launch('verao', SEED_PAST_SEASONS[0].launchDaysAgo, SEED_PAST_SEASONS[0].camila);
  await closeUntilDone(db, verao.endsAt + CLOSE_AFTER_MS);

  await db.runTransaction(async (tx) => {
    const config = parseSeasonConfig((await tx.get(seasonConfigRef(db))).data());
    writeSeasonConfig(
      tx,
      db,
      { ...config, version: config.version + 1, next: currentSeason(now) },
      { now: carnaval.startsAt, updatedBy: null },
    );
  });
  await launch('carnaval', SEED_PAST_SEASONS[1].launchDaysAgo, SEED_PAST_SEASONS[1].camila);
  await closeUntilDone(db, carnaval.endsAt + CLOSE_AFTER_MS);
  return true;
}

/** Os lançamentos de uma conta num momento do São João: a temporada e cada central. */
function seasonEntries(
  n: number,
  step: 'base' | 'week',
  season: number,
  centrals: readonly [string, number][],
): AwardEntry[] {
  const key = `${rankingAccountKey(n)}-${step}`;
  const entries: AwardEntry[] = [];
  if (season !== 0) {
    entries.push({
      kind: 'adjust',
      source: 'seed',
      eventId: key,
      balance: season,
      xp: season,
      season,
    });
  }
  for (const [artistId, points] of centrals) {
    if (points === 0) continue;
    entries.push({
      kind: 'adjust',
      source: 'seed',
      eventId: `${key}-${artistId}`,
      central: { artistId, season: points, total: points },
    });
  }
  return entries;
}

/**
 * A base do São João (23.15), ao meio-dia de 8 dias atrás: a temporada e as
 * centrais do retrato de cada conta, e a entrada em cada central em que ela
 * tem pontos, pelo mesmo caminho das rotas (a entrada valendo 0): vira membro
 * e entra no `fanCount`.
 */
export async function seedRankingBase(
  db: Firestore,
  uids: SeedUids,
  options: { now?: number } = {},
): Promise<void> {
  const at = noonDaysAgo(options.now ?? Date.now(), 8);
  await inBatches(RANKING_SEED, 8, async (account) => {
    const uid = uids.get(account.email);
    if (!uid) return;
    const n = RANKING_SEED.indexOf(account) + 1;
    const centrals = Object.entries(account.centrals).map(
      ([id, points]) => [id, points.base] as [string, number],
    );
    await runAward(db, uid, seasonEntries(n, 'base', account.base, centrals), seedOptions(at));
    await runJoinCentrals(
      db,
      uid,
      centrals.map(([id]) => id),
      {
        ...seedOptions(at),
        config: {
          ...DEFAULT_POINTS_CONFIG,
          values: { ...DEFAULT_POINTS_CONFIG.values, central_join: 0 },
        },
        via: 'seed',
      },
    );
  });
}

/**
 * O retrato da semana (23.15) pela própria função, com o "agora" na
 * segunda-feira desta semana: sai com o estado da base (8 dias atrás) e a
 * marca desta semana, e dá o Top 20 a quem está até o 20º nele.
 */
export async function seedRankingSnapshot(
  db: Firestore,
  options: { now?: number } = {},
): Promise<void> {
  const at = weekStart(options.now ?? Date.now());
  for (let round = 0; round < 50; round += 1) {
    const result = await runRankSnapshot(db, { now: at, budgetMs: 60_000 });
    if (result.status !== 'running') return;
  }
  throw new Error('O retrato do seed não terminou.');
}

/** A semana do São João (23.15), ao meio-dia de ontem: o que cada conta subiu desde a base. */
export async function seedRankingWeek(
  db: Firestore,
  uids: SeedUids,
  options: { now?: number } = {},
): Promise<void> {
  const at = noonDaysAgo(options.now ?? Date.now(), 1);
  await inBatches(RANKING_SEED, 8, async (account) => {
    const uid = uids.get(account.email);
    if (!uid) return;
    const n = RANKING_SEED.indexOf(account) + 1;
    const centrals = Object.entries(account.centrals).map(
      ([id, points]) => [id, points.now - points.base] as [string, number],
    );
    const entries = seasonEntries(n, 'week', account.now - account.base, centrals);
    if (entries.length > 0) await runAward(db, uid, entries, seedOptions(at));
  });
}
