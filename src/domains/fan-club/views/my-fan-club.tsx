import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { Screen } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { t } from '@/i18n';
import { useFanClubPrizeStore } from '@/stores/fan-club-prize';
import { useSessionStore } from '@/stores/session';
import { spacing } from '@/theme';

import {
  EndedState,
  PendingState,
  ProgramClosedState,
  RejectedState,
} from '../components/application-state';
import { ClubDashboard } from '../components/club-dashboard';
import { IntroSteps } from '../components/intro-steps';
import { fanClubStageOf, type FanClubStage } from '../entry';
import { useShownFanClub } from '../queries';
import type { MyFanClub } from '../types';

const SKELETON_HEIGHT = 180;

/**
 * O título da tela: "Meu fã-clube" com o fã-clube aprovado, "Tenha seu
 * fã-clube" antes e, sem o estado (carregando ou antes da abertura), só
 * "Fã-clube", que não convida.
 */
function titleOf(stage: FanClubStage | null): string {
  if (!stage) return t('fanClub.settings.section');
  if (stage.kind === 'club') return t('fanClub.mine.title');
  return t('fanClub.intro.title');
}

function StageBody({ mine, stage }: { mine: MyFanClub; stage: FanClubStage }) {
  switch (stage.kind) {
    case 'intro':
      return <IntroSteps notice={mine.notice} />;
    case 'programClosed':
      return <ProgramClosedState />;
    case 'pending':
      return <PendingState application={stage.application} />;
    case 'rejected':
      return <RejectedState application={stage.application} next={stage.next} />;
    case 'club':
      return <ClubDashboard mine={mine} club={stage.club} next={stage.next} />;
    case 'ended':
      return <EndedState next={stage.next} />;
  }
}

/**
 * "/meu-fa-clube" (seção 34, 34.9, itens 2, 4 e 5): o estado do fã pelo
 * `GET /me/fan-club`, na pilha raiz, sem a tab bar. Sem candidatura, a
 * apresentação; em análise ou recusada, o estado com o que vem depois;
 * aprovada, o "Meu fã-clube", também com o fã-clube encerrado. Abrir a tela com o fã-clube marca o
 * último prêmio como visto no aparelho (decisão 51).
 *
 * Inerte antes da abertura: com a `api` de antes da publicação (o 404), sem
 * resposta ou com o programa fechado para quem nunca se candidatou, a tela diz
 * que o fã-clube não está disponível e não chama mais nada (o link a frio
 * cai aqui também).
 */
export function MyFanClubScreen() {
  const insets = useSafeAreaInsets();
  const { query, mine } = useShownFanClub();
  const stage = mine ? fanClubStageOf(mine) : null;
  const uid = useSessionStore((state) => state.user?.uid ?? null);
  const markSeen = useFanClubPrizeStore((state) => state.markSeen);
  const hydrated = useFanClubPrizeStore((state) => state.hydrated);
  const seenAt = stage?.kind === 'club' ? stage.club.lastReward?.at : undefined;

  // Só depois de o disco responder: a marca feita antes seria trocada pela
  // guardada quando ele responde (o `merge` do `persist`).
  useEffect(() => {
    if (hydrated && uid && seenAt) markSeen(uid, seenAt);
  }, [hydrated, uid, seenAt, markSeen]);

  let body;
  if (mine && stage) {
    body = <StageBody mine={mine} stage={stage} />;
  } else if (query.isPending) {
    body = (
      <SkeletonGroup>
        <Skeleton height={SKELETON_HEIGHT} tone="surface" />
      </SkeletonGroup>
    );
  } else if (query.isError && (query.error.isRetryable || query.error.isRateLimited)) {
    body = (
      <EmptyState
        tone="error"
        message={t('fanClub.loadError')}
        actionLabel={t('common.retry')}
        onAction={() => void query.refetch()}
        actionLoading={query.isFetching}
      />
    );
  } else {
    body = (
      <View testID="fan-club-not-available">
        <EmptyState message={t('fanClub.notAvailable')} />
      </View>
    );
  }

  return (
    <Screen scroll bottomInset={insets.bottom}>
      <LargeTitleHeader title={titleOf(stage)} showBack />
      <View style={styles.body}>{body}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
});
