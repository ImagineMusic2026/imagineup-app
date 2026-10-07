import { set, subDays } from 'date-fns';

import { fixtureWallet } from '@/services/fixtures';

import type {
  Achievement,
  LedgerEntry,
  LedgerPage,
  Level,
  MyAchievements,
  MyInvite,
  MyProgress,
  Wallet,
} from './types';

/**
 * Carteira de exemplo, lida da carteira das fixtures (`fixtureWallet`), que o
 * resgate desconta e as ações que valem ponto somam. Objeto novo a cada chamada.
 */
export function buildWalletFixture(): Wallet {
  const { balance, xp, seasonPoints } = fixtureWallet.get();
  return { balance, xp, seasonPoints } satisfies Wallet;
}

/**
 * Convite de exemplo da Camila do protótipo. Código e pontos são exemplo: os
 * de verdade vêm da API e do painel.
 */
export function buildMyInviteFixture(): MyInvite {
  return { code: 'CAMILA12', pointsPerVisit: 2, pointsPerSignup: 10 } satisfies MyInvite;
}

/**
 * Régua de níveis de exemplo. Só o 7 ("Purainha", a partir de 7.000) e o 8
 * ("Xodó", a partir de 15.000) vêm do protótipo: com os 12.480 de XP da
 * Camila, o anel e a barra ficam em 68,5% e faltam 2.520. Os outros nomes e
 * degraus são exemplo; a régua de verdade é do painel admin.
 */
export const FIXTURE_LEVELS: readonly Level[] = [
  { number: 1, name: 'Primeiro passo', minXp: 0 },
  { number: 2, name: 'Na roda', minXp: 600 },
  { number: 3, name: 'Pé de serra', minXp: 1_500 },
  { number: 4, name: 'Arrastapé', minXp: 2_800 },
  { number: 5, name: 'Sanfona', minXp: 4_200 },
  { number: 6, name: 'Fogueira', minXp: 5_600 },
  { number: 7, name: 'Purainha', minXp: 7_000 },
  { number: 8, name: 'Xodó', minXp: 15_000 },
  { number: 9, name: 'Coração do palco', minXp: 25_000 },
  { number: 10, name: 'Lenda', minXp: 40_000 },
];

/** O degrau do XP e o seguinte (`null` no último), como o servidor calcularia. */
export function levelForXp(
  xp: number,
  levels: readonly Level[] = FIXTURE_LEVELS,
): { level: Level; nextLevel: Level | null } {
  const index = levels.reduce((found, level, at) => (xp >= level.minXp ? at : found), 0);
  const level = levels[index] ?? levels[0];
  if (!level) throw new RangeError('Régua de níveis vazia.');
  const next = levels[index + 1];
  return { level: { ...level }, nextLevel: next ? { ...next } : null };
}

// Ganhos de exemplo dos últimos 7 dias, antes de o app abrir ("+840" do protótipo).
const WEEK_EARNED_BEFORE = 840;

/**
 * Nível e números do fã. O XP é o da carteira das fixtures (cresce com as
 * ações que valem ponto e não cai no resgate), e o "Esta semana" soma aos
 * ganhos de exemplo o que o fã ganhou desde a abertura do app, sem descontar
 * resgates. Os números são os do protótipo, com "3 temporadas" no lugar das
 * playlists (fora do contrato).
 */
export function buildMyProgressFixture(): MyProgress {
  const { xp } = fixtureWallet.get();
  const { level, nextLevel } = levelForXp(xp);
  return {
    xp,
    level,
    nextLevel,
    weekEarned: WEEK_EARNED_BEFORE + fixtureWallet.earned(),
    stats: { linksCreated: 63, peopleBrought: 418, seasons: 3 },
  } satisfies MyProgress;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * As conquistas do protótipo: 14 de 32, as três últimas desbloqueadas e a
 * próxima. "Fã de show" em ciano entra no lugar de "DJ da vez", que era de
 * playlist (fora do contrato; pergunta 7.3.3). A lista e as regras vêm do
 * painel. Datas relativas a `now`.
 */
export function buildMyAchievementsFixture(now: Date): MyAchievements {
  const daysAgo = (days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();
  const highlights: Achievement[] = [
    {
      id: 'boca-a-boca',
      title: 'Boca a boca',
      icon: 'share',
      tone: 'action',
      unlockedAt: daysAgo(2),
    },
    { id: 'top-20', title: 'Top 20', icon: 'trophy', tone: 'points', unlockedAt: daysAgo(5) },
    {
      id: 'fa-de-show',
      title: 'Fã de show',
      icon: 'ticket',
      tone: 'events',
      unlockedAt: daysAgo(9),
    },
    { id: 'backstage', title: 'Backstage', icon: 'star', tone: 'points', unlockedAt: null },
  ];
  return { unlockedCount: 14, totalCount: 32, highlights } satisfies MyAchievements;
}

/** Linhas por página no extrato de exemplo (o padrão da API). */
export const LEDGER_PAGE_SIZE = 20;

const CLIPE = 'Leve 5 pessoas para o clipe novo do Netto';
const COMENTAR = 'Comente em 3 posts da central';
const CURTIR = 'Curta 5 posts do Nenho';

type LedgerSample = {
  id: string;
  daysAgo: number;
  /** A hora do lançamento no dia (12 h; a loja, 18 h, como no seed). */
  hour: number;
  kind: LedgerEntry['kind'];
  source: LedgerEntry['source'];
  points: number;
  /** O XP: o mesmo dos pontos no ganho e na base; 0 no resgate, na devolução e no ajuste da loja. */
  xp: number;
  season: number;
  artistId: string | null;
  artistName: string | null;
  central: number;
  subject: LedgerEntry['subject'];
  title: string | null;
};

const NOON = 12;
const EVENING = 18;

/** Uma missão concluída do seed (o título no extrato), ao meio-dia. */
const missionSample = (
  n: number,
  daysAgo: number,
  points: number,
  artistId: string,
  title: string,
): LedgerSample => ({
  id: `mission:seed-camila-${n}`,
  daysAgo,
  hour: NOON,
  kind: 'earn',
  source: 'mission',
  points,
  xp: points,
  season: points,
  artistId,
  artistName: artistId === 'nenho' ? 'Nenho' : 'Netto Brito',
  central: points,
  subject: null,
  title,
});

/** Um lançamento da loja da Camila (bloco 10, 25.13): só o saldo, às 18 h, com a recompensa. */
const shopSample = (
  id: string,
  daysAgo: number,
  points: number,
  rewardId: string,
  title: string,
): LedgerSample => ({
  id,
  daysAgo,
  hour: EVENING,
  kind: points < 0 ? 'spend' : 'refund',
  source: points < 0 ? 'redeem' : 'redeem_refund',
  points,
  xp: 0,
  season: 0,
  artistId: null,
  artistName: null,
  central: 0,
  subject: { type: 'reward', id: rewardId },
  title,
});

/**
 * O extrato da Camila do seed dos emuladores (22.13, com as temporadas
 * passadas, 23.15, e com a loja, 25.13): os mesmos 23 ids, valores, títulos e
 * dias, do mais novo ao mais antigo. Os dois ajustes só de central (o Netto e
 * o Nenho) vêm com saldo, XP e temporada em 0: a tela os esconde. Os das
 * temporadas passadas só mexem na temporada e aparecem. Os da loja (os
 * resgates, a devolução da videochamada recusada e o ajuste que paga os
 * pedidos antigos) só mexem no saldo, às 18 h.
 */
const LEDGER_SAMPLES: readonly LedgerSample[] = [
  missionSample(4, 1, 100, 'nenho', CURTIR),
  shopSample('redeem:UP-C3NWPB', 2, -15_000, 'camisa', 'Camisa oficial'),
  missionSample(3, 2, 300, 'nettobrito', COMENTAR),
  shopSample('redeem:UP-7QXH2R', 4, -3_000, 'passagem-de-som', 'Passagem de som'),
  missionSample(2, 4, 240, 'nenho', CURTIR),
  shopSample('redeem_refund:UP-9FJT6V', 5, 8_500, 'videochamada', 'Videochamada'),
  shopSample('redeem:UP-9FJT6V', 6, -8_500, 'videochamada', 'Videochamada'),
  missionSample(1, 6, 200, 'nettobrito', COMENTAR),
  shopSample('redeem:UP-4KD9TM', 7, -6_000, 'ingressos', 'Par de ingressos'),
  {
    // O ajuste que paga os pedidos antigos da loja (só o saldo, 25.13).
    id: 'seed:camila-loja',
    daysAgo: 8,
    hour: EVENING,
    kind: 'adjust',
    source: 'seed',
    points: 24_000,
    xp: 0,
    season: 0,
    artistId: null,
    artistName: null,
    central: 0,
    subject: null,
    title: null,
  },
  {
    id: 'seed:camila-base-netto',
    daysAgo: 8,
    hour: NOON,
    kind: 'adjust',
    source: 'seed',
    points: 0,
    xp: 0,
    season: 0,
    artistId: 'nettobrito',
    artistName: 'Netto Brito',
    central: 3_620,
    subject: null,
    title: null,
  },
  {
    id: 'seed:camila-base-nenho',
    daysAgo: 8,
    hour: NOON,
    kind: 'adjust',
    source: 'seed',
    points: 0,
    xp: 0,
    season: 0,
    artistId: 'nenho',
    artistName: 'Nenho',
    central: 2_640,
    subject: null,
    title: null,
  },
  {
    id: 'seed:camila-base',
    daysAgo: 8,
    hour: NOON,
    kind: 'adjust',
    source: 'seed',
    points: 11_240,
    xp: 11_240,
    season: 2_880,
    artistId: null,
    artistName: null,
    central: 0,
    subject: null,
    title: null,
  },
  ...Array.from({ length: 8 }, (_, index): LedgerSample => ({
    id: `mission:seed-camila-${12 - index}`,
    daysAgo: 10 + index,
    hour: NOON,
    kind: 'earn',
    source: 'mission',
    points: 50,
    xp: 50,
    season: 50,
    artistId: null,
    artistName: null,
    central: 0,
    subject: null,
    title: CLIPE,
  })),
  // As temporadas passadas do seed (bloco 8, 23.15): ajustes só de temporada,
  // fechados pela virada (o saldo, o XP e a central ficam em 0).
  ...[
    { id: 'seed:camila-carnaval', daysAgo: 55, season: 290 },
    { id: 'seed:camila-verao', daysAgo: 95, season: 510 },
  ].map(({ id, daysAgo, season }): LedgerSample => ({
    id,
    daysAgo,
    hour: NOON,
    kind: 'adjust',
    source: 'seed',
    points: 0,
    xp: 0,
    season,
    artistId: null,
    artistName: null,
    central: 0,
    subject: null,
    title: null,
  })),
];

/**
 * Uma página do extrato de exemplo, com as datas relativas a `now` (meio-dia
 * de cada dia; a loja, 18 h). O que o fã ganha na sessão das fixtures não
 * entra: é exemplo. O cursor é a posição da primeira linha da página.
 */
export function buildLedgerPageFixture(now: Date, cursor: string | null): LedgerPage {
  const start = cursor ? Number(cursor) : 0;
  const items = LEDGER_SAMPLES.slice(start, start + LEDGER_PAGE_SIZE).map(
    (sample): LedgerEntry => ({
      id: sample.id,
      kind: sample.kind,
      source: sample.source,
      points: sample.points,
      xpDelta: sample.xp,
      seasonDelta: sample.season,
      artistId: sample.artistId,
      centralSeasonDelta: sample.central,
      centralTotalDelta: sample.central,
      subject: sample.subject,
      createdAt: set(subDays(now, sample.daysAgo), {
        hours: sample.hour,
        minutes: 0,
        seconds: 0,
        milliseconds: 0,
      }).toISOString(),
      artistName: sample.artistName,
      subjectTitle: sample.title,
    }),
  );
  const next = start + LEDGER_PAGE_SIZE;
  return { items, nextCursor: next < LEDGER_SAMPLES.length ? String(next) : null };
}
