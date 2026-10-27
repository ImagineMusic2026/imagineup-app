import { router, useLocalSearchParams } from 'expo-router';
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
import { FanClubIntro } from '../components/fan-club-intro';
import { ManagerMode } from '../components/manager-mode';
import { fanClubStageOf, type FanClubStage } from '../entry';
import { managerTabOf, postFilterOf, type ManagerTab, type PostFilter } from '../manager';
import { useShownFanClub } from '../queries';

const SKELETON_HEIGHT = 180;

/**
 * O título da tela: "Tenha seu fã-clube" antes do fã-clube e, sem o estado
 * (carregando ou antes da abertura), só "Fã-clube", que não convida. Com o
 * fã-clube aprovado, o modo gestor desenha o próprio cabeçalho.
 */
function titleOf(stage: FanClubStage | null): string {
  if (!stage) return t('fanClub.settings.section');
  return t('fanClub.intro.title');
}

/** Os estágios que mostram um estado só, sem a apresentação e sem o modo gestor. */
type StateStage = Exclude<FanClubStage, { kind: 'intro' } | { kind: 'club' }>;

function StageBody({ stage }: { stage: StateStage }) {
  switch (stage.kind) {
    case 'programClosed':
      return <ProgramClosedState />;
    case 'pending':
      return <PendingState application={stage.application} />;
    case 'rejected':
      return <RejectedState application={stage.application} next={stage.next} />;
    case 'ended':
      return <EndedState next={stage.next} />;
  }
}

/** Troca a aba do modo gestor (e o filtro de Publicações) no endereço da tela. */
function openManagerTab(tab: ManagerTab, filter?: PostFilter): void {
  router.setParams(filter ? { aba: tab, filtro: filter } : { aba: tab });
}

/**
 * "/meu-fa-clube" (seção 34, 34.9, itens 2, 4 e 5): o estado do fã pelo
 * `GET /me/fan-club`, na pilha raiz, sem a tab bar do app. Sem candidatura, a
 * apresentação; em análise ou recusada, o estado com o que vem depois;
 * aprovada, o modo gestor (34.24), com a barra própria, também com o
 * fã-clube encerrado. Abrir a tela com o fã-clube marca o último prêmio como
 * visto no aparelho (decisão 51), em qualquer aba.
 *
 * Inerte antes da abertura: com a `api` de antes da publicação (o 404), sem
 * resposta ou com o programa fechado para quem nunca se candidatou, a tela diz
 * que o fã-clube não está disponível e não chama mais nada (o link a frio
 * cai aqui também).
 */
export function MyFanClubScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ aba?: string; filtro?: string }>();
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

  if (mine && stage?.kind === 'intro') {
    return (
      <Screen padded={false} contentStyle={styles.edgeToEdge}>
        <FanClubIntro mine={mine} />
      </Screen>
    );
  }

  if (mine && stage?.kind === 'club') {
    return (
      <ManagerMode
        mine={mine}
        club={stage.club}
        next={stage.next}
        tab={managerTabOf(params.aba)}
        filter={postFilterOf(params.filtro)}
        onOpen={openManagerTab}
      />
    );
  }

  let body;
  if (stage && stage.kind !== 'intro' && stage.kind !== 'club') {
    body = <StageBody stage={stage} />;
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
  // A apresentação vai de ponta a ponta, e o rodapé dela já tem a área segura.
  edgeToEdge: {
    paddingBottom: 0,
  },
});
