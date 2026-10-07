import { buildFanCentralsFixture, followFixture } from '@/domains/artists/fixtures';
import { buildMissionsFixture } from '@/domains/missions/fixtures';
import { fixtureWallet } from '@/services/fixtures';

import {
  buildLeaderboardPageFixture,
  buildMyRankFixture,
  buildSeasonFixture,
  LEADERBOARD_PAGE_SIZE,
} from '../fixtures';
import { GLOBAL_SCOPE } from '../scope';
import type { LeaderboardEntry, RankingScope } from '../types';

// O build do Firebase que o Jest resolve é ESM; o ranking não fala com ele.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));

// As builds sem API: tudo nas fixtures (as três rotas pela API em api.test.ts).
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

// Terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);

const NETTO: RankingScope = { kind: 'artist', artistId: 'nettobrito' };
const NENHO: RankingScope = { kind: 'artist', artistId: 'nenho' };
const JUNINHO: RankingScope = { kind: 'artist', artistId: 'juninhomoraes' };

/** O ranking inteiro do recorte, página por página. */
function wholeBoard(scope: RankingScope): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  let cursor: string | null = null;
  do {
    const page = buildLeaderboardPageFixture(scope, cursor);
    entries.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return entries;
}

beforeEach(() => {
  fixtureWallet.reset();
  followFixture.reset();
});

describe('ranking de exemplo (a tabela do seed, 23.15)', () => {
  it('a primeira página do geral: o pódio e as linhas 4 a 11 do protótipo, com as setas do seed', () => {
    const page = buildLeaderboardPageFixture(GLOBAL_SCOPE, null);
    expect(page.items).toHaveLength(LEADERBOARD_PAGE_SIZE);
    expect(LEADERBOARD_PAGE_SIZE).toBe(20);
    expect(page.nextCursor).toBe('20');
    expect(page).not.toHaveProperty('example');
    expect(
      page.items
        .slice(0, 11)
        .map(({ position, displayName, city, points, change }) => [
          position,
          displayName,
          city,
          points,
          change,
        ]),
    ).toEqual([
      [1, 'Thalita Santos', 'Irará, BA', 9_140, 1],
      [2, 'Davi Lima', 'Salvador, BA', 7_902, -1],
      [3, 'Jean Pereira', 'Aracaju, SE', 7_318, 0],
      [4, 'Maria Clara Souza', 'Salvador, BA', 6_844, 3],
      [5, 'Aline Ferreira', 'Irará, BA', 6_201, 1],
      [6, 'Bruna Andrade', 'Recife, PE', 5_930, 7],
      [7, 'Igor Nascimento', 'Aracaju, SE', 5_412, 2],
      [8, 'Leila Matos', 'Feira de Santana, BA', 5_106, 4],
      [9, 'Rafael Costa', 'Alagoinhas, BA', 5_038, -1],
      // Sem cidade no perfil. O 10º tem 4.959: a meta do fã, 840 acima dos 4.120 dele.
      [10, 'Júlia Ramos', null, 4_959, 0],
      [11, 'Pedro Henrique Alves', 'Serrinha, BA', 4_402, 0],
    ]);
    // Os dois genéricos que eram 4º e 5º no retrato caem 9.
    expect(page.items.slice(12, 14).map(({ change }) => change)).toEqual([-9, -9]);
  });

  it('o fã é o 12º do geral com os pontos da temporada da carteira, a 840 do top 10, e subiu 2', () => {
    const { seasonPoints } = fixtureWallet.get();
    expect(seasonPoints).toBe(4_120);

    const me = wholeBoard(GLOBAL_SCOPE).filter((entry) => entry.isMe);
    expect(me).toEqual([
      expect.objectContaining({ position: 12, points: seasonPoints, change: 2 }),
    ]);
    expect(buildMyRankFixture(GLOBAL_SCOPE)).toEqual({
      position: 12,
      points: 4_120,
      target: { kind: 'top', position: 10, pointsLeft: 840 },
    });
    expect(wholeBoard(GLOBAL_SCOPE)).toHaveLength(49);
  });

  it('ganhar pontos da temporada muda a posição do fã, como a API faria (a meta é a diferença mais 1)', () => {
    fixtureWallet.earn(15);
    expect(buildMyRankFixture(GLOBAL_SCOPE)).toMatchObject({ position: 12, points: 4_135 });

    fixtureWallet.earn(900);
    expect(buildMyRankFixture(GLOBAL_SCOPE)).toEqual({
      position: 10,
      points: 5_035,
      target: { kind: 'position', position: 9, pointsLeft: 4 },
    });
  });

  it('nas centrais, a posição do fã é a da home: 12º no Netto, 41º no Nenho, membro sem posição no Juninho', () => {
    const centrals = buildFanCentralsFixture();
    expect(centrals.map(({ artistId, fanRank }) => [artistId, fanRank])).toEqual([
      ['nettobrito', 12],
      ['nenho', 41],
      ['juninhomoraes', null],
    ]);
    for (const { artistId, fanRank, seasonPoints } of centrals) {
      const scope: RankingScope = { kind: 'artist', artistId };
      // A home e o perfil (1e) mostram a mesma posição e os mesmos pontos do ranking.
      expect(buildMyRankFixture(scope).position).toBe(fanRank);
      expect(buildMyRankFixture(scope).points).toBe(seasonPoints);
      expect(wholeBoard(scope).find((entry) => entry.isMe)?.position ?? null).toBe(fanRank);
    }
    expect(buildMyRankFixture(NETTO)).toEqual({
      position: 12,
      points: 4_120,
      target: { kind: 'top', position: 10, pointsLeft: 181 },
      member: true,
    });
    expect(wholeBoard(NETTO).find((entry) => entry.isMe)).toMatchObject({ change: 0 });
    expect(wholeBoard(NENHO).find((entry) => entry.isMe)).toMatchObject({ change: 0 });
    expect(buildMyRankFixture(JUNINHO)).toEqual({
      position: null,
      points: 0,
      target: null,
      member: true,
    });
    // Os top fãs da 1d no Netto: Maria Clara, Aline e Bruna.
    expect(
      wholeBoard(NETTO)
        .slice(0, 3)
        .map(({ displayName }) => displayName),
    ).toEqual(['Maria Clara Souza', 'Aline Ferreira', 'Bruna Andrade']);
    expect([NETTO, NENHO, JUNINHO].map((scope) => wholeBoard(scope).length)).toEqual([30, 49, 6]);
    // As outras centrais ficam vazias.
    expect(wholeBoard({ kind: 'artist', artistId: 'rocksalles' })).toEqual([]);
  });

  it('o fã que sai de uma central sai do ranking dela (member: false), com os pontos que fez lá', () => {
    followFixture.leave('nenho', 'chave-sair-nenho');
    expect(wholeBoard(NENHO).some((entry) => entry.isMe)).toBe(false);
    expect(wholeBoard(NENHO).map(({ position }) => position)).toEqual(
      wholeBoard(NENHO).map((_, index) => index + 1),
    );
    expect(buildMyRankFixture(NENHO)).toEqual({
      position: null,
      points: 2_980,
      target: null,
      member: false,
    });
    // Entrar de novo devolve a posição.
    followFixture.join('nenho', 'chave-entrar-nenho');
    expect(buildMyRankFixture(NENHO)).toMatchObject({ position: 41, member: true });
  });

  it('as posições seguem os pontos, sem repetir gente, de página em página', () => {
    for (const scope of [GLOBAL_SCOPE, NETTO, NENHO, JUNINHO]) {
      const board = wholeBoard(scope);
      expect(board.map(({ position }) => position)).toEqual(board.map((_, index) => index + 1));
      for (let index = 1; index < board.length; index += 1) {
        expect(board[index]?.points).toBeLessThanOrEqual(board[index - 1]?.points ?? 0);
      }
      expect(new Set(board.map(({ userId }) => userId)).size).toBe(board.length);
      expect(new Set(board.map(({ displayName }) => displayName)).size).toBe(board.length);
    }
    // 41º no Nenho: a terceira página.
    expect(buildLeaderboardPageFixture(NENHO, '40').items[0]).toMatchObject({
      position: 41,
      isMe: true,
    });
  });

  it('a temporada é a de São João e acaba junto com a meta das missões', () => {
    const season = buildSeasonFixture(NOW);
    expect(season).toMatchObject({
      id: 'temporada-sao-joao',
      name: 'São João',
      status: 'active',
      leaderTitle: null,
    });
    expect(season.endsAt).toBe(buildMissionsFixture(NOW).season?.endsAt);
    expect(Date.parse(season.startsAt)).toBeLessThan(NOW.getTime());
  });
});
