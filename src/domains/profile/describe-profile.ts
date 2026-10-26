import type { FanCentral } from '@/domains/artists';
import { t } from '@/i18n';
import { formatCompact, formatNumber, formatPointsSpoken } from '@/utils/number';

import type { Achievement, FanStats, Level, MyProgress } from './types';

/**
 * Quanto do caminho até o próximo nível o fã já andou, de 0 a 1: o anel do
 * avatar e a barra do nível. Conta o XP de nível, que nunca cai. No nível
 * máximo, a barra fica cheia.
 */
export function levelFraction({ xp, level, nextLevel }: MyProgress): number {
  if (!nextLevel) return 1;
  const span = nextLevel.minXp - level.minXp;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (xp - level.minXp) / span));
}

/** Pontos de XP que faltam para o próximo nível; `null` no nível máximo. */
export function pointsToNextLevel({ xp, nextLevel }: MyProgress): number | null {
  return nextLevel ? Math.max(0, nextLevel.minXp - xp) : null;
}

/** "Nível 7 · Purainha" (o selo põe em caixa alta). */
export function levelBadgeText(level: Level): string {
  return t('profile.level.badge', { number: level.number, name: level.name });
}

/** "nível 7, Purainha", para o leitor de tela. */
export function levelSpoken(level: Level): string {
  return t('profile.level.spoken', { number: level.number, name: level.name });
}

/** "@camilarib · Feira de Santana, BA", só com o que o perfil tiver. */
export function profileMeta(username: string | null, city: string | null): string | null {
  const parts = [username ? `@${username}` : null, city].filter((part) => !!part);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * O hero num elemento só para o leitor: "Camila Ribeiro, @camilarib, Feira de
 * Santana, BA. Nível 7, Purainha." O progresso fica com a barra do nível.
 */
export function heroLabel({
  name,
  username,
  city,
  level,
}: {
  name: string;
  username: string | null;
  city: string | null;
  level: Level | null;
}): string {
  const who = [name, username ? `@${username}` : null, city].filter((part) => !!part).join(', ');
  return level ? `${who}. ${capitalize(levelSpoken(level))}.` : `${who}.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

/**
 * A legenda da barra do nível em três pedaços, para o do meio ("2.520 pts")
 * sair em negrito: "Faltam ", "2.520 pts", " para o nível 8 · Xodó". No
 * nível máximo, uma frase só.
 */
export function nextLevelCaption(
  progress: MyProgress,
): { before: string; amount: string; after: string } | { text: string } {
  const left = pointsToNextLevel(progress);
  const next = progress.nextLevel;
  if (left === null || !next) return { text: t('profile.points.maxLevel') };
  const template = t(left === 1 ? 'profile.points.toNextOne' : 'profile.points.toNext', {
    number: next.number,
    name: next.name,
  });
  const [before = '', after = ''] = template.split('{{points}}');
  const amount = t(left === 1 ? 'profile.points.amountOne' : 'profile.points.amount', {
    points: formatNumber(left),
  });
  return { before, amount, after };
}

/** "Faltam 2.520 pontos para o nível 8, Xodó", para o leitor de tela. */
export function nextLevelSpoken(progress: MyProgress): string {
  const left = pointsToNextLevel(progress);
  const next = progress.nextLevel;
  if (left === null || !next) return t('profile.points.maxLevel');
  return t(left === 1 ? 'profile.points.spoken.toNextOne' : 'profile.points.spoken.toNext', {
    points: formatNumber(left),
    number: next.number,
    name: next.name,
  });
}

/**
 * Os três números do topo da 1e: o saldo (o mesmo da pílula da loja) e dois
 * dos números do fã, as pessoas trazidas pelo convite ("convidados", pedido do
 * dono) e as temporadas. Os links criados e os ganhos da semana ficam fora da 1e.
 */
export type StatKind = 'points' | Exclude<keyof FanStats, 'linksCreated'>;

const STAT_LABELS = {
  points: { one: 'profile.stats.pointsOne', other: 'profile.stats.points' },
  peopleBrought: { one: 'profile.stats.peopleOne', other: 'profile.stats.people' },
  seasons: { one: 'profile.stats.seasonsOne', other: 'profile.stats.seasons' },
} as const satisfies Record<StatKind, { one: string; other: string }>;

/** "pontos", "convidado": o rótulo embaixo do número. */
export function statLabel(kind: StatKind, value: number): string {
  const keys = STAT_LABELS[kind];
  return t(value === 1 ? keys.one : keys.other);
}

/** "12.480 pontos", "1 temporada": o número e o rótulo num foco só. */
export function statSpoken(kind: StatKind, value: number): string {
  return t('profile.stats.label', { value: formatNumber(value), label: statLabel(kind, value) });
}

/** "Boca a boca, conquistada" ou "Backstage, bloqueada". */
export function achievementLabel(achievement: Achievement): string {
  return t(
    achievement.unlockedAt ? 'profile.achievements.unlocked' : 'profile.achievements.locked',
    {
      title: achievement.title,
    },
  );
}

/**
 * "#12 entre 412 mil fãs" ou, sem posição (sem pontos na central nesta
 * temporada), "Sem posição ainda · 141 mil fãs", com "1 fã" no singular
 * ("#1 entre 1 fã").
 */
export function centralMeta({ fanRank, fanCount }: FanCentral): string {
  const fans = formatCompact(fanCount);
  if (fanRank !== null) {
    return fanCount === 1
      ? t('profile.centrals.metaOne', { rank: formatNumber(fanRank) })
      : t('profile.centrals.meta', { rank: formatNumber(fanRank), fans });
  }
  return fanCount === 1
    ? t('profile.centrals.metaUnrankedOne')
    : t('profile.centrals.metaUnranked', { fans });
}

/**
 * "Netto Brito, 12º lugar entre 412 mil fãs, 4.120 pontos na temporada." Sem
 * posição, diz os pontos quando o fã já pontuou na central.
 */
export function centralLabel({ name, fanRank, fanCount, seasonPoints }: FanCentral): string {
  const fans = formatCompact(fanCount);
  const points = formatPointsSpoken(seasonPoints);
  if (fanRank !== null) {
    return fanCount === 1
      ? t('profile.centrals.labelOne', { name, rank: formatNumber(fanRank), points })
      : t('profile.centrals.label', { name, rank: formatNumber(fanRank), fans, points });
  }
  const one = fanCount === 1;
  if (seasonPoints > 0) {
    return one
      ? t('profile.centrals.labelUnrankedPointsOne', { name, points })
      : t('profile.centrals.labelUnrankedPoints', { name, fans, points });
  }
  return one
    ? t('profile.centrals.labelUnrankedOne', { name })
    : t('profile.centrals.labelUnranked', { name, fans });
}
