/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado.
 * Missões, valores e prazos são decididos no servidor e ajustáveis pelo painel
 * admin: o app só mostra.
 */

/**
 * O que a missão pede. Decide o ícone e para onde o toque leva. Não existe
 * missão de playlist (montador de playlist fora do contrato) nem de clipe no
 * YouTube: "levar gente ao clipe" é o link de um post do app com o código do fã.
 */
export type MissionAction = 'share' | 'invite' | 'like' | 'comment' | 'rsvp';

/**
 * - `active`: aberta (disponível ou em andamento, pelo progresso);
 * - `completed`: concluída; fica na lista até o período virar;
 * - `expired`: o prazo acabou e ela some na próxima busca;
 * - `locked`: ainda não abriu, como a relâmpago do show, que o painel abre na
 *   hora (sem push, que está fora do contrato: o fã vê abrindo o app).
 */
export type MissionStatus = 'active' | 'completed' | 'expired' | 'locked';

/** Em que seção da 1g ela aparece: "Hoje" ou "Esta semana". */
export type MissionPeriod = 'daily' | 'weekly';

export interface MissionProgress {
  current: number;
  target: number;
}

/** A que a missão se refere: o clipe do Netto, a central de um artista, um show. */
export interface MissionTarget {
  postId?: string;
  artistId?: string;
  eventId?: string;
}

/** Régua do link compartilhado ("+2 por visita · +10 por cadastro"), vinda do painel. */
export interface MissionPointsBreakdown {
  perVisit: number;
  perSignup: number;
}

/** O show sugerido na missão de presença ("São João de Irará · 21 out"). */
export interface MissionEvent {
  name: string;
  /** ISO. */
  startsAt: string;
}

/**
 * Uma missão da 1g. A missão do dia da home (1b) é a destacada de "Hoje": o
 * mesmo objeto, da mesma fonte.
 */
export interface Mission {
  id: string;
  /** "Leve 5 pessoas para o clipe novo do Netto". */
  title: string;
  /** Quanto vale ao concluir ("+20"). */
  rewardPoints: number;
  progress: MissionProgress;
  /** ISO: "termina em 4 h" na home; depois dele a missão aberta some. */
  endsAt: string;
  status: MissionStatus;
  action: MissionAction;
  target: MissionTarget | null;
  period: MissionPeriod;
  /** Card lima no topo da seção (1g) e missão do dia (1b). */
  featured: boolean;
  /** Só nas missões de link: quanto vale cada visita e cada cadastro. */
  pointsBreakdown: MissionPointsBreakdown | null;
  /** ISO, nas concluídas: "Concluída às 14:02". */
  completedAt: string | null;
  /** Nas bloqueadas, o texto do painel: "Abre quando o Netto subir no palco". */
  unlockHint: string | null;
  /** Nas de presença em show. */
  event: MissionEvent | null;
}

/** A missão do dia é uma missão como as outras (a destacada de "Hoje"). */
export type DailyMission = Mission;

/** Sem missão hoje, a API devolve `mission: null`. */
export interface DailyMissionResponse {
  mission: DailyMission | null;
}

/** Meta da temporada, o card com o anel no topo da 1g ("12/20"). */
export interface SeasonGoal {
  id: string;
  /** "Semana do arrocha". */
  title: string;
  /** Texto do painel; com a meta cumprida, diz o prêmio garantido. */
  description: string;
  completedCount: number;
  targetCount: number;
  /** ISO. */
  endsAt: string;
}

/** O painel decide se há meta: sem temporada ativa, `season: null` e o card some. */
export interface MissionsResponse {
  season: SeasonGoal | null;
  /** Na ordem do painel. */
  missions: Mission[];
}
