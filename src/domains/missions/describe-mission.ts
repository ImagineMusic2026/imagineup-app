import type { Href } from 'expo-router';

import { t } from '@/i18n';
import { formatDayMonth, formatLongDate, formatTime } from '@/utils/date';
import { formatNumber, formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import type { Mission } from './types';

/**
 * A missão cujo prazo passou (ou que o servidor já expirou) sai da tela na
 * hora, sem esperar a próxima busca. A aberta vence no `endsAt`; a concluída
 * fica até o período virar, que é o `endsAt` dela (o servidor manda o fim do
 * período, 22.2): passado ele, a de ontem não fica na home nem em "Hoje",
 * também com o app aberto na virada ou aberto do cache sem rede. A bloqueada
 * fica até o servidor dizer.
 */
export function isMissionOver(mission: Mission, now: Date): boolean {
  if (mission.status === 'expired') return true;
  if (mission.status === 'locked') return false;
  return new Date(mission.endsAt).getTime() <= now.getTime();
}

function progressCounts(mission: Mission) {
  const { current, target } = mission.progress;
  return { current: formatNumber(Math.min(current, target)), target: formatNumber(target) };
}

/**
 * Linha de baixo do título, na tela: a régua do link ("+2 por visita · +10 por
 * cadastro"), o show ("São João de Irará · 21 out"), os cadastrados, o
 * progresso, a hora em que concluiu ou a dica de quando abre.
 */
export function missionMeta(mission: Mission): string {
  if (mission.status === 'completed') {
    return mission.completedAt
      ? t('missions.meta.completedAt', { time: formatTime(mission.completedAt) })
      : t('missions.meta.completed');
  }
  if (mission.status === 'locked') return mission.unlockHint ?? t('missions.meta.locked');
  if (mission.pointsBreakdown) {
    return t('missions.meta.breakdown', {
      visit: formatPointsDelta(mission.pointsBreakdown.perVisit),
      signup: formatPointsDelta(mission.pointsBreakdown.perSignup),
    });
  }
  if (mission.action === 'rsvp' && mission.event) {
    return t('missions.meta.event', {
      name: mission.event.name,
      date: formatDayMonth(mission.event.startsAt),
    });
  }
  if (mission.action === 'invite') return t('missions.meta.invites', progressCounts(mission));
  return t('missions.meta.progress', progressCounts(mission));
}

/** A meta dita pelo leitor de tela: data por extenso, sem sinais e sem "·". */
function spokenMeta(mission: Mission): string {
  if (mission.action === 'rsvp' && mission.event) {
    return t('missions.spoken.event', {
      name: mission.event.name,
      date: formatLongDate(mission.event.startsAt),
    });
  }
  return missionMeta(mission);
}

/**
 * O card ou a linha inteira num rótulo só, com o que o leitor precisa para
 * decidir: título, andamento, pontos e, na bloqueada, quando ela abre.
 * "Leve 5 pessoas para o clipe novo do Netto. 3 de 5. Vale 20 pontos, 2 por
 * visita e 10 por cadastro."
 */
export function missionLabel(mission: Mission): string {
  const { title } = mission;
  const points = formatPointsSpoken(mission.rewardPoints);
  if (mission.status === 'completed') {
    return t('missions.label.completed', { title, meta: missionMeta(mission), points });
  }
  if (mission.status === 'locked') {
    const hint = mission.unlockHint ?? t('missions.meta.locked');
    return t('missions.label.locked', { title, hint, points });
  }
  if (mission.pointsBreakdown) {
    const { current, target } = progressCounts(mission);
    return t('missions.label.withBreakdown', {
      title,
      progress: t('missions.spoken.progress', { current, target }),
      points,
      breakdown: t('missions.spoken.breakdown', {
        visit: formatNumber(mission.pointsBreakdown.perVisit),
        signup: formatNumber(mission.pointsBreakdown.perSignup),
      }),
    });
  }
  return t('missions.label.active', { title, meta: spokenMeta(mission), points });
}

/**
 * A sheet "Gerar meu link" com a missão e, se houver, o post alvo: o link sai
 * com o código do fã (atribuição). É o destino do "Gerar meu link" da 1b e do
 * card lima da 1g, para a mesma missão levar ao mesmo lugar nas duas. A
 * missão de link com alvo de central (sem post) leva a central: a sheet monta
 * o link dela, o mesmo do compartilhar da 1d (bloco 7).
 */
export function inviteHref(mission: Mission): Href {
  const postId = mission.target?.postId;
  const artistId = mission.target?.artistId;
  if (postId) return { pathname: '/convidar', params: { missionId: mission.id, postId } };
  if (mission.action === 'share' && artistId) {
    return { pathname: '/convidar', params: { missionId: mission.id, artistId } };
  }
  return { pathname: '/convidar', params: { missionId: mission.id } };
}

/**
 * Para onde a missão leva, pelo tipo e pelo alvo que a API manda (o painel
 * cria missões novas, então nada disso é fixo por missão):
 * - convidar e compartilhar: a sheet do link de convite (com o post, quando há);
 * - presença em show: a agenda;
 * - curtir e comentar: o post, a central do artista ou o início;
 * - entrar numa central: a central do alvo, que o servidor sempre manda.
 * Concluída e bloqueada não levam a lugar nenhum.
 *
 * Agenda e artista são rotas compartilhadas com a aba Ranking e vão sem o
 * grupo: abrem na aba de onde a missão foi tocada (na 1g, por cima dela), e o
 * voltar devolve o fã às missões.
 */
export function missionHref(mission: Mission): Href | null {
  if (mission.status !== 'active') return null;
  const postId = mission.target?.postId;
  const artistId = mission.target?.artistId;

  switch (mission.action) {
    case 'invite':
    case 'share':
      return inviteHref(mission);
    case 'rsvp':
      return '/agenda';
    case 'like':
    case 'comment':
      if (postId) return { pathname: '/post/[postId]', params: { postId } };
      if (artistId) return { pathname: '/artista/[artistaId]', params: { artistaId: artistId } };
      return '/';
    case 'join':
      return artistId
        ? { pathname: '/artista/[artistaId]', params: { artistaId: artistId } }
        : null;
  }
}

/** O que o toque faz, para o leitor de tela (`accessibilityHint`). */
export function missionHint(mission: Mission): string | undefined {
  if (mission.status !== 'active') return undefined;
  const postId = mission.target?.postId;
  switch (mission.action) {
    case 'invite':
    case 'share':
      return t('missions.hint.invite');
    case 'rsvp':
      return t('missions.hint.agenda');
    case 'like':
    case 'comment':
      if (postId) return t('missions.hint.post');
      return mission.target?.artistId ? t('missions.hint.artist') : t('missions.hint.home');
    case 'join':
      return mission.target?.artistId ? t('missions.hint.artist') : undefined;
  }
}
