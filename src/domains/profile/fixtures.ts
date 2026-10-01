import { fixtureWallet } from '@/services/fixtures';

import type { Achievement, Level, MyAchievements, MyInvite, MyProgress, Wallet } from './types';

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
