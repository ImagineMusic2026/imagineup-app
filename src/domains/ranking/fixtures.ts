import { fixtureWallet, type FixtureWalletState } from '@/services/fixtures';
import { stableHash } from '@/utils/pick-stable';

import type { LeaderboardEntry, LeaderboardPage, MyRank, RankingScope, Season } from './types';

/**
 * Ranking de exemplo da 1f enquanto a API (M2) não existe.
 *
 * - Geral: o pódio e as linhas 4 a 8 do protótipo (`renderVals()`), mais
 *   gente de exemplo. Os pontos do fã são os da temporada na carteira das
 *   fixtures (`fixtureWallet`, 4.120 no começo), e a posição sai da conta:
 *   12º, a 840 do 10º (4.960), como o card "Você" do protótipo. Ganhou
 *   pontos (a missão de presença da agenda), sobe junto.
 * - Centrais: a mesma gente em outra ordem, com menos pontos. O fã é 12º no
 *   Netto e 41º no Nenho, como o "você é #12" da home e o perfil (1e); nas
 *   outras centrais ele ainda não pontuou. `__tests__/fixtures.test.ts`
 *   trava as duas coisas.
 *
 * Nomes, cidades e pontos são exemplo; os de verdade vêm da API.
 */

export const LEADERBOARD_PAGE_SIZE = 10;

// A meta de quem está fora dele: "840 pts para entrar no top 10" (vem do painel).
const TOP_TARGET = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
// A temporada termina com a meta das missões (1g): daqui a 12 dias.
const SEASON_ENDS_IN_MS = 12 * DAY_MS;
const SEASON_STARTED_MS_AGO = 18 * DAY_MS;

/** O fã que pede. O nome e a foto da linha dele vêm do perfil, no app. */
const ME_ID = 'me';

interface Person {
  userId: string;
  displayName: string;
  city: string | null;
}

interface Scored extends Person {
  points: number;
  change: number;
}

/** O pódio e a lista do protótipo, e os três seguintes até o fã (exemplo). */
const PROTOTYPE_TOP: readonly Scored[] = [
  {
    userId: 'fa-thalita',
    displayName: 'Thalita Santos',
    city: 'Irará, BA',
    points: 9_140,
    change: 1,
  },
  { userId: 'fa-davi', displayName: 'Davi Lima', city: 'Salvador, BA', points: 7_902, change: -1 },
  { userId: 'fa-jean', displayName: 'Jean Pereira', city: 'Aracaju, SE', points: 7_318, change: 0 },
  {
    userId: 'fa-maria-clara',
    displayName: 'Maria Clara Souza',
    city: 'Salvador, BA',
    points: 6_844,
    change: 3,
  },
  { userId: 'fa-alan', displayName: 'Alan Ferreira', city: 'Irará, BA', points: 6_201, change: 1 },
  {
    userId: 'fa-bruna',
    displayName: 'Bruna Andrade',
    city: 'Recife, PE',
    points: 5_930,
    change: 7,
  },
  {
    userId: 'fa-igor',
    displayName: 'Igor Nascimento',
    city: 'Aracaju, SE',
    points: 5_412,
    change: 2,
  },
  {
    userId: 'fa-leila',
    displayName: 'Leila Matos',
    city: 'Feira de Santana, BA',
    points: 5_106,
    change: 4,
  },
  {
    userId: 'fa-rafael',
    displayName: 'Rafael Costa',
    city: 'Alagoinhas, BA',
    points: 5_038,
    change: -2,
  },
  // Sem cidade no perfil: a linha mostra só o nome.
  { userId: 'fa-julia', displayName: 'Júlia Ramos', city: null, points: 4_960, change: 0 },
  {
    userId: 'fa-pedro',
    displayName: 'Pedro Henrique Alves',
    city: 'Serrinha, BA',
    points: 4_402,
    change: -3,
  },
];

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

const GENERIC_COUNT = 40;

/** Gente de exemplo, sem nome repetido: cada nome com dois sobrenomes diferentes. */
const GENERIC_PEOPLE: readonly Person[] = Array.from({ length: GENERIC_COUNT }, (_, index) => {
  const first = FIRST_NAMES[index % FIRST_NAMES.length] ?? FIRST_NAMES[0];
  const round = Math.floor(index / FIRST_NAMES.length);
  const last = LAST_NAMES[(index + round * 5) % LAST_NAMES.length] ?? LAST_NAMES[0];
  return {
    userId: `fa-exemplo-${index + 1}`,
    displayName: `${first} ${last}`,
    city: CITIES[index % CITIES.length] ?? null,
  };
});

const EVERYONE: readonly Person[] = [...PROTOTYPE_TOP, ...GENERIC_PEOPLE];

// Abaixo do fã no geral: 22 pessoas, de 4.061 para baixo.
const GLOBAL_BELOW = 22;
const GLOBAL_BELOW_FROM = 4_061;
// Passo entre duas posições abaixo do fã e o tremor, que nunca inverte a ordem.
const STEP_BELOW = 83;
const JITTER = 29;
// O de cima do fã fica pelo menos isto acima dele.
const MIN_LEAD = 37;

/** Uma central de exemplo: quantos ficam acima e abaixo do fã e os pontos do 1º. */
interface CentralSample {
  myPoints: number;
  myChange: number;
  above: number;
  below: number;
  top: number;
}

/** O fã no Netto (12º) e no Nenho (41º), como a home e o perfil mostram. */
const FAN_CENTRALS: Readonly<Record<string, CentralSample>> = {
  'netto-brito': { myPoints: 4_120, myChange: 1, above: 11, below: 18, top: 7_480 },
  nenho: { myPoints: 2_980, myChange: -2, above: 40, below: 8, top: 5_860 },
};

/** Central em que o fã ainda não pontuou ("novo" na home). */
const OTHER_CENTRAL = { count: 24, top: 3_150, step: 110 } as const;

const MY_GLOBAL_CHANGE = 2;

/** De -3 a +5, estável por pessoa e recorte; 0 é "não mudou". */
function sampleChange(seed: string): number {
  return (stableHash(seed) % 9) - 3;
}

function jitter(seed: string): number {
  return stableHash(`tremor:${seed}`) % JITTER;
}

/** A gente da central em outra ordem, estável pelo id do artista. */
function peopleFor(artistId: string, count: number): Person[] {
  return [...EVERYONE]
    .sort((a, b) => stableHash(`${artistId}:${a.userId}`) - stableHash(`${artistId}:${b.userId}`))
    .slice(0, count);
}

function descending(from: number, to: number, count: number, index: number): number {
  if (count <= 1) return from;
  return Math.round(from - (index * (from - to)) / (count - 1));
}

function globalOthers(): Scored[] {
  const below = GENERIC_PEOPLE.slice(0, GLOBAL_BELOW).map((person, index) => ({
    ...person,
    points: GLOBAL_BELOW_FROM - index * STEP_BELOW - jitter(person.userId),
    change: sampleChange(`global:${person.userId}`),
  }));
  return [...PROTOTYPE_TOP, ...below];
}

function centralOthers(artistId: string): Scored[] {
  const sample = FAN_CENTRALS[artistId];
  if (!sample) {
    return peopleFor(artistId, OTHER_CENTRAL.count).map((person, index) => {
      const seed = `${artistId}:${person.userId}`;
      return {
        ...person,
        points: OTHER_CENTRAL.top - index * OTHER_CENTRAL.step - jitter(seed),
        change: sampleChange(seed),
      };
    });
  }
  const lowestAbove = sample.myPoints + MIN_LEAD + JITTER;
  return peopleFor(artistId, sample.above + sample.below).map((person, index) => {
    const seed = `${artistId}:${person.userId}`;
    const points =
      index < sample.above
        ? descending(sample.top, lowestAbove, sample.above, index) - jitter(seed)
        : sample.myPoints - (index - sample.above + 1) * STEP_BELOW - jitter(seed);
    return { ...person, points, change: sampleChange(seed) };
  });
}

interface BoardSample {
  others: Scored[];
  /** Zero quando o fã não pontuou no recorte. */
  myPoints: number;
  myChange: number;
}

function boardSample(scope: RankingScope, wallet: FixtureWalletState): BoardSample {
  if (scope.kind === 'global') {
    return { others: globalOthers(), myPoints: wallet.seasonPoints, myChange: MY_GLOBAL_CHANGE };
  }
  const sample = FAN_CENTRALS[scope.artistId];
  return {
    others: centralOthers(scope.artistId),
    myPoints: sample?.myPoints ?? 0,
    myChange: sample?.myChange ?? 0,
  };
}

/** O ranking inteiro do recorte, em ordem de posição. Objetos novos a cada chamada. */
function buildBoard(scope: RankingScope, wallet: FixtureWalletState): LeaderboardEntry[] {
  const { others, myPoints, myChange } = boardSample(scope, wallet);
  const entries: Omit<LeaderboardEntry, 'position'>[] = others.map((person) => ({
    userId: person.userId,
    displayName: person.displayName,
    photoURL: null,
    city: person.city,
    points: person.points,
    change: person.change,
    isMe: false,
  }));
  // Sem pontos no recorte, o fã ainda não entrou no ranking.
  if (myPoints > 0) {
    entries.push({
      userId: ME_ID,
      displayName: null,
      photoURL: null,
      city: null,
      points: myPoints,
      change: myChange,
      isMe: true,
    });
  }
  // No empate, quem já estava fica na frente.
  return entries
    .map((entry, order) => ({ entry, order }))
    .sort((a, b) => b.entry.points - a.entry.points || a.order - b.order)
    .map(({ entry }, index) => ({ ...entry, position: index + 1 }));
}

/** Uma página do ranking do recorte; o cursor é a posição de onde ela começa. */
export function buildLeaderboardPageFixture(
  scope: RankingScope,
  cursor: string | null,
  wallet: FixtureWalletState = fixtureWallet.get(),
): LeaderboardPage {
  const board = buildBoard(scope, wallet);
  const start = cursor ? Number(cursor) : 0;
  const end = start + LEADERBOARD_PAGE_SIZE;
  return {
    items: board.slice(start, end),
    nextCursor: end < board.length ? String(end) : null,
  } satisfies LeaderboardPage;
}

/**
 * O fã no recorte: posição, pontos e a próxima meta, que é entrar no top 10
 * e, dentro dele, passar a posição de cima.
 */
export function buildMyRankFixture(
  scope: RankingScope,
  wallet: FixtureWalletState = fixtureWallet.get(),
): MyRank {
  const board = buildBoard(scope, wallet);
  const index = board.findIndex((entry) => entry.isMe);
  const me = board[index];
  if (!me) return { position: null, points: 0, target: null } satisfies MyRank;

  const topEntry = board[TOP_TARGET - 1];
  const above = board[index - 1];
  const target =
    me.position > TOP_TARGET && topEntry
      ? { kind: 'top' as const, position: TOP_TARGET, pointsLeft: topEntry.points - me.points }
      : above
        ? {
            kind: 'position' as const,
            position: above.position,
            pointsLeft: above.points - me.points,
          }
        : null;
  return { position: me.position, points: me.points, target } satisfies MyRank;
}

/** A temporada de São João, em andamento: encerra em 12 dias, como a meta das missões. */
export function buildSeasonFixture(now: Date): Season {
  return {
    id: 'temporada-sao-joao',
    name: 'São João',
    startsAt: new Date(now.getTime() - SEASON_STARTED_MS_AGO).toISOString(),
    endsAt: new Date(now.getTime() + SEASON_ENDS_IN_MS).toISOString(),
    status: 'active',
    leaderTitle: null,
  } satisfies Season;
}
