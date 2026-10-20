import type { TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api/errors';

import { FAN_CLUB_ROUNDS_MAX } from './consts';
import type { FanClubApplication, MyFanClub, MyFanClubClub } from './types';

// O que o fã vê do fã-clube a partir do `GET /me/fan-club` (seção 34, 34.9,
// itens 1 a 5), sem React: se a linha dos Ajustes aparece, o que ela diz e o
// estado da tela "/meu-fa-clube". Puro, para o teste em tabela.

/**
 * Uma recusa definitiva do `GET /me/fan-club`: o 404 de rota que não existe,
 * que a `api` de antes da publicação dá, ou outra que não muda tentando de
 * novo. A falha incerta (rede, servidor) e o ritmo não contam.
 */
export function isDefinitiveRefusal(error: unknown): boolean {
  return error instanceof ApiError && !error.isRetryable && !error.isRateLimited;
}

/**
 * A trava do que os fãs veem (a página, o card da 1d, a Início, os seguidos e
 * o link do fã-clube): a resposta do servidor novo ao `GET /me/fan-club` nesta
 * abertura do app (34.15, passo 9). Sem resposta, com a `api` de antes da
 * publicação ou com outra recusa definitiva, nada aparece, mesmo com uma
 * resposta antiga no cache; a falha incerta e o ritmo deixam a resposta que
 * já estava. Não olha o `open`: com o programa fechado, os fã-clubes que
 * existem continuam (decisão 9).
 */
export function liveFanClub(data: MyFanClub | undefined, error: unknown): MyFanClub | null {
  if (!data || isDefinitiveRefusal(error)) return null;
  return data;
}

/**
 * A linha "Tenha seu fã-clube" e as telas do gestor só existem com a resposta
 * do servidor novo (`liveFanClub`) e, nela, o programa aberto
 * (`FAN_CLUB_OPEN`) ou uma candidatura (decisão 9).
 */
export function shownFanClub(data: MyFanClub | undefined, error: unknown): MyFanClub | null {
  const live = liveFanClub(data, error);
  return live && (live.open || live.application !== null) ? live : null;
}

/**
 * As frases do fã-clube na sheet "Sair da central" (34.9, item 11, e decisão
 * 27), pela resposta da trava (`liveFanClub`): sem ela, nenhuma (nada novo
 * antes da abertura). Com ela, quem sai deixa de seguir os fã-clubes do
 * artista; e o gestor de um fã-clube ativo ou pausado desse artista fica sem
 * publicar até voltar. O texto não diz o nome do artista: a sheet só recebe o
 * id (decisão 27).
 */
export function leaveCentralNotes(live: MyFanClub | null, artistId: string): TranslationKey[] {
  if (!live) return [];
  const notes: TranslationKey[] = ['fanClub.leave.follows'];
  const club = live.club;
  if (
    live.application?.status === 'approved' &&
    club?.artistId === artistId &&
    club.status !== 'closed'
  ) {
    notes.push('fanClub.leave.manager');
  }
  return notes;
}

/** Quando a próxima candidatura pode ir, para a recusa e o fã-clube encerrado. */
export type NextRound =
  /** Já pode (o `canApply`). */
  | { kind: 'now' }
  /** Depois do prazo: o `canReapplyAt` (30 dias da recusa ou do encerramento a pedido). */
  | { kind: 'date'; date: string }
  /** A 3ª rodada já foi recusada: não há outra. */
  | { kind: 'roundsOver' }
  /** O programa fechado agora (`FAN_CLUB_OPEN` desligado). */
  | { kind: 'programClosed' }
  /** Encerrado pela equipe (o `closedByStaff`): nunca mais (decisão 13). */
  | { kind: 'never' };

/**
 * A próxima rodada, pelo que a resposta diz. O servidor dá só o `canApply`
 * (o programa aberto e a vez do fã, `applicationTurn`) e o `canReapplyAt`; o
 * resto sai deles. Os fins vêm antes do programa fechado, que vale para todos:
 * a recusa da 3ª rodada não tem prazo nem outra rodada, e o fã-clube encerrado
 * sem prazo é o encerramento pela equipe (o encerrado a pedido tem os 30
 * dias). O prazo vem depois do programa fechado: com ele desligado, a data
 * não diria nada de verdade.
 */
export function nextRoundOf(mine: MyFanClub, application: FanClubApplication): NextRound {
  if (application.canApply) return { kind: 'now' };
  const noDate = application.canReapplyAt === null;
  if (application.status === 'rejected' && application.round >= FAN_CLUB_ROUNDS_MAX && noDate) {
    return { kind: 'roundsOver' };
  }
  if (application.status === 'approved' && mine.club?.status === 'closed' && noDate) {
    return { kind: 'never' };
  }
  if (!mine.open) return { kind: 'programClosed' };
  if (application.canReapplyAt) return { kind: 'date', date: application.canReapplyAt };
  return { kind: 'never' };
}

/** O que a tela "/meu-fa-clube" mostra (34.9, itens 2, 4 e 5). */
export type FanClubStage =
  /** A apresentação, que leva à candidatura: sem candidatura, ou depois de desistir. */
  | { kind: 'intro' }
  /** O programa fechado, sem nada de antes para mostrar. */
  | { kind: 'programClosed' }
  | { kind: 'pending'; application: FanClubApplication }
  | { kind: 'rejected'; application: FanClubApplication; next: NextRound }
  /**
   * O "Meu fã-clube", em qualquer status: o encerrado (pela equipe ou a
   * pedido) continua com os números e o aviso de que acabou (34.22, etapas 1 e
   * 3), e com a próxima rodada (`next`, só nele).
   */
  | {
      kind: 'club';
      application: FanClubApplication;
      club: MyFanClubClub;
      next: NextRound | null;
    }
  /** Sem fã-clube para mostrar e sem a vez do fã: só a próxima rodada. */
  | { kind: 'ended'; application: FanClubApplication; next: NextRound };

export function fanClubStageOf(mine: MyFanClub): FanClubStage {
  const { application, club } = mine;
  if (application === null) return mine.open ? { kind: 'intro' } : { kind: 'programClosed' };
  if (application.status === 'pending') return { kind: 'pending', application };
  const next = nextRoundOf(mine, application);
  if (application.status === 'approved' && club) {
    return { kind: 'club', application, club, next: club.status === 'closed' ? next : null };
  }
  if (application.status === 'rejected') return { kind: 'rejected', application, next };
  // Desistiu: volta à apresentação quando pode mandar de novo.
  if (application.status === 'withdrawn' && next.kind === 'now') return { kind: 'intro' };
  return next.kind === 'programClosed'
    ? { kind: 'programClosed' }
    : { kind: 'ended', application, next };
}

/** O fã pode abrir a candidatura agora (a apresentação, a recusa ou o encerrado com a vez dele). */
export function canApplyNow(mine: MyFanClub): boolean {
  if (mine.application === null) return mine.open;
  return mine.application.canApply;
}

/** O último reconhecimento ainda não visto neste aparelho (decisão 51). */
export function hasNewPrize(club: MyFanClubClub | null, seenAt: string | undefined): boolean {
  const at = club?.lastReward?.at;
  if (!at) return false;
  if (!seenAt) return true;
  return Date.parse(at) > Date.parse(seenAt);
}

/** A linha do bloco "Fã-clube" dos Ajustes: o título, a meta e o que o leitor ouve. */
export interface FanClubSettingsRow {
  titleKey: TranslationKey;
  metaKey: TranslationKey;
  /** O artista da meta "Seu fã-clube de {{artist}}". */
  artist?: string;
}

/**
 * O título e a meta da linha, pelo estado (34.9, item 1): "Divulgue um artista
 * e traga fãs", "Candidatura em análise", "Não aprovada, toque para ver", "Seu
 * fã-clube de {{artist}}", "Fora do ar, toque para ver" e "Novo prêmio". Quem
 * já teve o fã-clube aprovado vê "Meu fã-clube", o nome da tela que abre.
 */
export function settingsRowOf(mine: MyFanClub, newPrize: boolean): FanClubSettingsRow {
  const stage = fanClubStageOf(mine);
  switch (stage.kind) {
    case 'intro':
      return { titleKey: 'fanClub.settings.title', metaKey: 'fanClub.settings.metaIntro' };
    case 'programClosed':
      return { titleKey: 'fanClub.settings.title', metaKey: 'fanClub.settings.metaClosed' };
    case 'pending':
      return { titleKey: 'fanClub.settings.title', metaKey: 'fanClub.settings.metaPending' };
    case 'rejected':
      return { titleKey: 'fanClub.settings.title', metaKey: 'fanClub.settings.metaRejected' };
    case 'club':
      if (newPrize)
        return { titleKey: 'fanClub.settings.titleMine', metaKey: 'fanClub.settings.metaPrize' };
      return stage.club.available
        ? {
            titleKey: 'fanClub.settings.titleMine',
            metaKey: 'fanClub.settings.metaClub',
            artist: stage.club.artistName,
          }
        : { titleKey: 'fanClub.settings.titleMine', metaKey: 'fanClub.settings.metaOff' };
    case 'ended':
      return { titleKey: 'fanClub.settings.title', metaKey: 'fanClub.settings.metaEnded' };
  }
}
