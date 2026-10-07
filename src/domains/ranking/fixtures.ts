import { fixtureMembership, fixtureWallet, type FixtureWalletState } from '@/services/fixtures';

import type { LeaderboardEntry, LeaderboardPage, MyRank, RankingScope, Season } from './types';

/**
 * Ranking de exemplo das builds sem API (a 1f, os top fãs e a aba Ranking da
 * 1d, o card "Você" e as posições de "Suas centrais"). Com a API, tudo vem do
 * servidor (bloco 8); a regra de coerência pede que as fixtures mostrem o que
 * o seed dos emuladores mostra, então elas montam o ranking pela mesma tabela
 * do seed (`RANKING_SEED`, copiada de functions/src/ranking/seed.ts, 23.15):
 *
 * - Geral: o pódio Thalita, Davi e Jean e as linhas 4 a 11 do protótipo, com
 *   os nomes, as cidades, os pontos e as setas do seed, e os 37 genéricos. O
 *   fã tem os pontos da temporada da carteira das fixtures (`fixtureWallet`,
 *   4.120 no começo): 12º, a 840 do top 10, com a seta +2. Ganhou pontos (a
 *   missão de presença da agenda), sobe junto.
 * - Centrais: o Netto (30, o fã em 12º com 4.120), o Nenho (49, o fã em 41º
 *   com 2.980) e o Juninho (6, o fã membro sem pontos). As outras ficam vazias.
 *   Só membros: numa central de onde o fã saiu (`fixtureMembership`, que o
 *   `followFixture` das centrais atualiza), ele sai do ranking dela.
 * - A seta compara a posição de agora com a do retrato da semana (os pontos
 *   da base do seed), como o servidor (23.5).
 *
 * As centrais da home e do perfil (`buildFanCentralsFixture`, em artists) leem
 * a posição e os pontos daqui, de `buildMyRankFixture`.
 * `__tests__/fixtures.test.ts` trava os números-âncora. Mudou a tabela do seed,
 * mude aqui.
 */

/** Linhas por página, como o servidor (`RANKING_PAGE_SIZE`). */
export const LEADERBOARD_PAGE_SIZE = 20;

// A meta de quem está fora dele: "840 pts para entrar no top 10" (vem do painel).
const TOP_TARGET = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
// A temporada termina com a meta das missões (1g): daqui a 12 dias.
const SEASON_ENDS_IN_MS = 12 * DAY_MS;
const SEASON_STARTED_MS_AGO = 18 * DAY_MS;

/** O fã que pede. O nome e a foto da linha dele vêm do perfil, no app. */
const ME_ID = 'me';

type SeedCentralId = 'nettobrito' | 'nenho' | 'juninhomoraes';

/** Os pontos do retrato da semana (`base`) e de agora (`now`). */
interface Points {
  base: number;
  now: number;
}

interface SeedPerson extends Points {
  userId: string;
  displayName: string;
  city: string | null;
  centrals: Partial<Record<SeedCentralId, Points>>;
}

interface Prototype extends Points {
  displayName: string;
  city: string | null;
  netto: number;
  nenho: number;
}

/** Os 11 do protótipo, como no seed: a 5ª é a Aline, e a Júlia tem 4.959. */
const PROTOTYPE: readonly Prototype[] = [
  {
    displayName: 'Thalita Santos',
    city: 'Irará, BA',
    base: 6_100,
    now: 9_140,
    netto: 4_800,
    nenho: 4_300,
  },
  {
    displayName: 'Davi Lima',
    city: 'Salvador, BA',
    base: 6_500,
    now: 7_902,
    netto: 4_500,
    nenho: 3_360,
  },
  {
    displayName: 'Jean Pereira',
    city: 'Aracaju, SE',
    base: 5_200,
    now: 7_318,
    netto: 4_200,
    nenho: 3_050,
  },
  {
    displayName: 'Maria Clara Souza',
    city: 'Salvador, BA',
    base: 3_810,
    now: 6_844,
    netto: 6_500,
    nenho: 300,
  },
  {
    displayName: 'Aline Ferreira',
    city: 'Irará, BA',
    base: 3_890,
    now: 6_201,
    netto: 6_050,
    nenho: 120,
  },
  {
    displayName: 'Bruna Andrade',
    city: 'Recife, PE',
    base: 3_340,
    now: 5_930,
    netto: 5_700,
    nenho: 200,
  },
  {
    displayName: 'Igor Nascimento',
    city: 'Aracaju, SE',
    base: 3_640,
    now: 5_412,
    netto: 5_250,
    nenho: 140,
  },
  {
    displayName: 'Leila Matos',
    city: 'Feira de Santana, BA',
    base: 3_410,
    now: 5_106,
    netto: 4_950,
    nenho: 130,
  },
  {
    displayName: 'Rafael Costa',
    city: 'Alagoinhas, BA',
    base: 3_720,
    now: 5_038,
    netto: 4_880,
    nenho: 150,
  },
  // Sem cidade no perfil: a linha mostra só o nome.
  { displayName: 'Júlia Ramos', city: null, base: 3_560, now: 4_959, netto: 4_700, nenho: 250 },
  {
    displayName: 'Pedro Henrique Alves',
    city: 'Serrinha, BA',
    base: 3_480,
    now: 4_402,
    netto: 4_300,
    nenho: 90,
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

/** Os genéricos, abaixo do fã no geral (i de 1 a 37). */
const GENERIC_COUNT = 37;

const isOddFrom3 = (i: number) => i >= 3 && i % 2 === 1;

/** O genérico i, pelas fórmulas do seed (23.15). */
function generic(i: number): SeedPerson {
  const index = i - 1;
  const first = FIRST_NAMES[index % FIRST_NAMES.length] ?? FIRST_NAMES[0];
  const round = Math.floor(index / FIRST_NAMES.length);
  const last = LAST_NAMES[(index + round * 5) % LAST_NAMES.length] ?? LAST_NAMES[0];
  const now = 4_061 - 27 * index;
  const centrals: SeedPerson['centrals'] = {
    nenho: { now: now - 90, base: now - 90 - (isOddFrom3(i) ? 30 : 0) },
  };
  if (i <= 18) centrals.nettobrito = { now: 80 - i, base: 80 - i - (isOddFrom3(i) ? 2 : 0) };
  if (i >= 19 && i <= 24) {
    const points = 90 - 10 * (i - 19);
    centrals.juninhomoraes = { now: points, base: points };
  }
  return {
    userId: `fa-rank-${String(PROTOTYPE.length + i).padStart(2, '0')}`,
    displayName: `${first} ${last}`,
    city: CITIES[index % CITIES.length] ?? null,
    base: i === 1 ? 4_050 : i === 2 ? 3_970 : now - 800,
    now,
    centrals,
  };
}

/** A tabela do seed: as 48 contas de ranking, na ordem (`rank-01` a `rank-48`). */
export const RANKING_SEED: readonly SeedPerson[] = [
  ...PROTOTYPE.map((person, index): SeedPerson => ({
    userId: `fa-rank-${String(index + 1).padStart(2, '0')}`,
    displayName: person.displayName,
    city: person.city,
    base: person.base,
    now: person.now,
    centrals: {
      nettobrito: { base: person.netto, now: person.netto },
      nenho: { base: person.nenho, now: person.nenho },
    },
  })),
  ...Array.from({ length: GENERIC_COUNT }, (_, index) => generic(index + 1)),
];

/**
 * O fã (a Camila do seed): no retrato, 3.280 no geral (agora, os da carteira),
 * e nas centrais o retrato e agora. No Juninho, membro sem pontos.
 */
const ME_BASE = 3_280;
const ME_CENTRALS: Partial<Record<string, Points>> = {
  nettobrito: { base: 3_620, now: 4_120 },
  nenho: { base: 2_640, now: 2_980 },
};

interface Row {
  userId: string;
  displayName: string | null;
  city: string | null;
  points: number;
  isMe: boolean;
}

/** As posições na ordem do ranking: mais pontos na frente; no empate, quem já estava. */
function ranked(rows: Row[]): Row[] {
  return rows
    .map((row, order) => ({ row, order }))
    .sort((a, b) => b.row.points - a.row.points || a.order - b.order)
    .map(({ row }) => row);
}

/** Os pontos do fã no recorte, no retrato e agora; null fora dele. */
function myPoints(scope: RankingScope, wallet: FixtureWalletState): Points | null {
  if (scope.kind === 'global') return { base: ME_BASE, now: wallet.seasonPoints };
  if (!fixtureMembership.isMember(scope.artistId)) return null;
  return ME_CENTRALS[scope.artistId] ?? null;
}

/** As linhas de um momento (o retrato ou agora), só com quem tem pontos nele. */
function rowsAt(scope: RankingScope, wallet: FixtureWalletState, moment: keyof Points): Row[] {
  const people = RANKING_SEED.flatMap((person): Row[] => {
    const points =
      scope.kind === 'global'
        ? person[moment]
        : (person.centrals[scope.artistId as SeedCentralId]?.[moment] ?? 0);
    return points > 0
      ? [
          {
            userId: person.userId,
            displayName: person.displayName,
            city: person.city,
            points,
            isMe: false,
          },
        ]
      : [];
  });
  const mine = myPoints(scope, wallet)?.[moment] ?? 0;
  // O fã entra depois de quem já estava: no empate, chegou por último.
  if (mine > 0)
    people.push({ userId: ME_ID, displayName: null, city: null, points: mine, isMe: true });
  return ranked(people);
}

/** O ranking inteiro do recorte, em ordem de posição, com a seta da semana. */
function buildBoard(scope: RankingScope, wallet: FixtureWalletState): LeaderboardEntry[] {
  const before = new Map(
    rowsAt(scope, wallet, 'base').map((row, index) => [row.userId, index + 1]),
  );
  return rowsAt(scope, wallet, 'now').map((row, index) => {
    const position = index + 1;
    const was = before.get(row.userId);
    return {
      position,
      userId: row.userId,
      displayName: row.displayName,
      photoURL: null,
      city: row.city,
      points: row.points,
      change: was === undefined ? 0 : was - position,
      isMe: row.isMe,
    } satisfies LeaderboardEntry;
  });
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
 * O fã no recorte: posição, pontos e a próxima meta, que é entrar no top 10 e,
 * dentro dele, passar a posição de cima, com a diferença mais 1 (o empate fica
 * com quem chegou primeiro, decisão 11 de 23.1). Na central, o `member`, como
 * o servidor: fora dela, sem posição e com os pontos que ele fez lá.
 */
export function buildMyRankFixture(
  scope: RankingScope,
  wallet: FixtureWalletState = fixtureWallet.get(),
): MyRank {
  const member =
    scope.kind === 'artist' ? { member: fixtureMembership.isMember(scope.artistId) } : {};
  if (scope.kind === 'artist' && !member.member) {
    return {
      position: null,
      points: ME_CENTRALS[scope.artistId]?.now ?? 0,
      target: null,
      member: false,
    } satisfies MyRank;
  }
  const board = buildBoard(scope, wallet);
  const index = board.findIndex((entry) => entry.isMe);
  const me = board[index];
  if (!me) return { position: null, points: 0, target: null, ...member } satisfies MyRank;

  const topEntry = board[TOP_TARGET - 1];
  const above = board[index - 1];
  const target =
    me.position > TOP_TARGET && topEntry
      ? {
          kind: 'top' as const,
          position: TOP_TARGET,
          pointsLeft: Math.max(1, topEntry.points - me.points + 1),
        }
      : above
        ? {
            kind: 'position' as const,
            position: above.position,
            pointsLeft: Math.max(1, above.points - me.points + 1),
          }
        : null;
  return { position: me.position, points: me.points, target, ...member } satisfies MyRank;
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
