/**
 * Contrato provisório com a API. Muda quando o backend (M2) for desenhado.
 * Missões, valores e prazos são decididos no servidor e ajustáveis pelo painel
 * admin: o app só mostra.
 */

/** O que a missão pede. Decide o botão principal e o ícone. */
export type MissionAction = 'share' | 'invite' | 'like' | 'comment' | 'rsvp';

/** A missão do dia expirada some da home na próxima busca. */
export type MissionStatus = 'active' | 'completed' | 'expired';

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

/** Missão do dia, em destaque na home (1b). É a mesma que a 1g destaca em "Hoje". */
export interface DailyMission {
  id: string;
  /** "Leve 5 pessoas para o clipe novo do Netto". */
  title: string;
  /** Quanto vale ao concluir ("+20"). */
  rewardPoints: number;
  progress: MissionProgress;
  /** ISO: "termina em 4 h". */
  endsAt: string;
  status: MissionStatus;
  action: MissionAction;
  target: MissionTarget | null;
}

/** Sem missão hoje, a API devolve `mission: null`. */
export interface DailyMissionResponse {
  mission: DailyMission | null;
}
