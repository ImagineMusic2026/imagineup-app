import { t } from '@/i18n';
import { formatSeasonCountdown } from '@/utils/date';
import { formatNumber, formatPointsSpoken } from '@/utils/number';

import type { LeaderboardEntry, MyRank, RankTarget, Season } from './types';

/**
 * Textos do ranking (1f), visíveis e lidos, fora dos componentes para os
 * testes em tabela. Os números e as metas vêm do servidor; aqui só se escreve.
 */

/** A temporada acabou: pelo servidor (resultado congelado) ou porque o prazo passou. */
export function isSeasonOver(season: Season, now: Date): boolean {
  return season.status === 'ended' || Date.parse(season.endsAt) <= now.getTime();
}

/**
 * "Temporada de São João · encerra em 12 dias", "... encerra amanhã", "...
 * encerra hoje", "Temporada de São João encerrada" e, sem temporada,
 * "Nenhuma temporada em andamento".
 */
export function describeSeason(season: Season | null, now: Date): string {
  if (!season) return t('ranking.season.none');
  if (isSeasonOver(season, now)) return t('ranking.season.ended', { name: season.name });
  return t('ranking.season.active', {
    name: season.name,
    countdown: formatSeasonCountdown(season.endsAt, now),
  });
}

/** Nome da linha: o do perfil ou, sem nome visível, "Fã". */
export function entryName(entry: Pick<LeaderboardEntry, 'displayName'>): string {
  return entry.displayName ?? t('ranking.fallbackName');
}

/** "subiu 3 posições", "caiu 1 posição"; vazio quando não mudou. */
export function describeChange(change: number): string {
  if (change === 0) return '';
  const count = Math.abs(change);
  if (change > 0)
    return count === 1 ? t('ranking.change.upOne') : t('ranking.change.up', { count });
  return count === 1 ? t('ranking.change.downOne') : t('ranking.change.down', { count });
}

/**
 * A linha da lista num rótulo só: "4º, Maria Clara Souza, Salvador, BA, 6.844
 * pontos, subiu 3 posições". Sem cidade e sem mudança, as partes somem.
 */
export function describeRow(entry: LeaderboardEntry, name: string): string {
  return [
    t('ranking.position', { position: entry.position }),
    name,
    entry.city,
    formatPointsSpoken(entry.points),
    describeChange(entry.change),
  ]
    .filter(Boolean)
    .join(', ');
}

/** Uma coluna do pódio: "1º lugar, Thalita S., 9.140 pontos, líder da temporada". */
export function describePodium(
  position: number,
  entry: LeaderboardEntry | null,
  name: string,
  title: string | null,
): string {
  const place = t('ranking.a11y.place', { position });
  if (!entry) return t('ranking.a11y.vacant', { place });
  return [place, name, formatPointsSpoken(entry.points), title].filter(Boolean).join(', ');
}

/** O que o card "Você" diz, em cada situação, na tela e para o leitor. */
export interface MyRankStatus {
  /** Subtítulo do card. */
  text: string;
  /** O mesmo por extenso ("Faltam 840 pontos..."), para o rótulo. */
  spoken: string;
}

function same(text: string): MyRankStatus {
  return { text, spoken: text };
}

/** "840 pts para entrar no top 10" ou "312 pts para o 6º lugar", e 1 ponto no singular. */
function describeTarget({ kind, position, pointsLeft }: RankTarget): MyRankStatus {
  if (pointsLeft === 1) {
    return kind === 'top'
      ? {
          text: t('ranking.me.toTopOne', { top: position }),
          spoken: t('ranking.me.spoken.toTopOne', { top: position }),
        }
      : {
          text: t('ranking.me.toPositionOne', { position }),
          spoken: t('ranking.me.spoken.toPositionOne', { position }),
        };
  }
  const shown = formatNumber(pointsLeft);
  const spoken = formatPointsSpoken(pointsLeft);
  return kind === 'top'
    ? {
        text: t('ranking.me.toTop', { points: shown, top: position }),
        spoken: t('ranking.me.spoken.toTop', { points: spoken, top: position }),
      }
    : {
        text: t('ranking.me.toPosition', { points: shown, position }),
        spoken: t('ranking.me.spoken.toPosition', { points: spoken, position }),
      };
}

/**
 * - temporada encerrada: "Terminou em 12º" (ou não pontuou), antes de tudo: a
 *   temporada fechada nunca chama o fã para um resultado que já acabou,
 *   também com um `member` velho no cache;
 * - numa central de que o fã não é membro: "Entre na central para aparecer
 *   no ranking" (o ranking da central é só dos membros, bloco 8);
 * - sem pontos no recorte: "Ganhe pontos para entrar no ranking";
 * - no pódio: "No pódio da temporada";
 * - fora do top: "840 pts para entrar no top 10";
 * - dentro do top: "312 pts para o 6º lugar".
 */
export function describeMyRankStatus(myRank: MyRank, seasonOver: boolean): MyRankStatus {
  const { position, target } = myRank;
  if (seasonOver) {
    return same(
      position === null ? t('ranking.me.finishedUnranked') : t('ranking.me.finished', { position }),
    );
  }
  if (myRank.member === false) return same(t('ranking.me.notMember'));
  if (position === null) return same(t('ranking.me.unranked'));
  if (position <= 3) return same(t('ranking.me.podium'));
  if (!target) return same(t('ranking.me.ranked'));
  return describeTarget(target);
}

/**
 * O card "Você" num rótulo só: "Você, 12º lugar, 4.120 pontos. Faltam 840
 * pontos para entrar no top 10." Sem posição (sem pontos, ou fora dos
 * membros da central), só o que o card diz: "Você. Entre na central para
 * aparecer no ranking."
 */
export function describeMyRank(myRank: MyRank, seasonOver: boolean): string {
  const status = describeMyRankStatus(myRank, seasonOver).spoken;
  if (myRank.position === null) return t('ranking.me.labelUnranked', { status });
  return t('ranking.me.label', {
    position: myRank.position,
    points: formatPointsSpoken(myRank.points),
    status,
  });
}
