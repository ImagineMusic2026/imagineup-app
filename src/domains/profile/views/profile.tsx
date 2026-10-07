import { router, useIsFocused } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { AccessibilityInfo, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { PageGlow } from '@/components/page-glow';
import { PressableScale } from '@/components/pressable-scale';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { useFanCentralsQuery } from '@/domains/artists';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t, type TranslationKey } from '@/i18n';
import { colors, layout, motion, spacing } from '@/theme';
import { formatNumber } from '@/utils/number';

import { AchievementsRow, AchievementsSkeleton } from '../components/achievement-tile';
import { CentralRow, CentralRowsSkeleton } from '../components/central-row';
import { PointsCard, PointsCardSkeleton } from '../components/points-card';
import { ProfileHero } from '../components/profile-hero';
import { FanStatsRow, FanStatsSkeleton } from '../components/stat-tile';
import { levelFraction } from '../describe-profile';
import { useFanIdentity } from '../hooks/use-fan-identity';
import { useLevelUp } from '../hooks/use-level-up';
import { useProfileRefresh } from '../hooks/use-profile-refresh';
import {
  useMyAchievementsQuery,
  useMyProfileQuery,
  useMyProgressQuery,
  useWalletQuery,
  useWatchMyProfile,
} from '../queries';

// O engrenagem de 21 com o traço do protótipo (.7, 1,7), num alvo de 44.
const SETTINGS_ICON_SIZE = 21;
const SETTINGS_ICON_STROKE = 1.7;

/** Consulta que já parou de tentar: erro na tela e um anúncio só. */
function settled(query: { isError: boolean; isFetching: boolean }): boolean {
  return query.isError && !query.isFetching;
}

type Refetch = () => Promise<{ isSuccess: boolean }>;

/**
 * "Tentar de novo" de uma seção. O botão some junto com o erro quando a seção
 * chega, e o foco do leitor de tela iria com ele: o fã ouve que ela chegou
 * (como na 1g). Com uma busca que falhou de novo, o erro volta e é anunciado.
 */
async function retrySection(refetches: readonly Refetch[], loaded: TranslationKey): Promise<void> {
  const results = await Promise.all(refetches.map((refetch) => refetch()));
  if (results.every((result) => result.isSuccess)) {
    AccessibilityInfo.announceForAccessibilityWithOptions(t(loaded), { queue: true });
  }
}

/** O conteúdo que chega no lugar do esqueleto entra em fade (sem animação com reduzir movimento). */
const CONTENT_ENTERING = FadeIn.duration(motion.duration.base);

/**
 * "Meu perfil" com o Ajustes à direita (engrenagem, e não o sol do protótipo,
 * que seria lido como troca de tema num app só escuro).
 */
function ProfileHeader() {
  return (
    <View style={styles.header}>
      <Text variant="titleHeader" accessibilityRole="header">
        {t('profile.title')}
      </Text>
      <PressableScale
        onPress={() => router.push('/ajustes')}
        accessibilityLabel={t('profile.settings')}
        accessibilityHint={t('profile.settingsHint')}
        testID="profile-settings"
        style={styles.settings}
      >
        <Icon
          icon={Settings}
          size={SETTINGS_ICON_SIZE}
          color={colors.textSecondary}
          strokeWidth={SETTINGS_ICON_STROKE}
        />
      </PressableScale>
    </View>
  );
}

/**
 * Card de pontos e os três números. Saldo (carteira) e nível (progresso)
 * chegam juntos: um sem o outro deixaria o card pela metade.
 */
function PointsSection() {
  const wallet = useWalletQuery();
  const progress = useMyProgressQuery();

  if (wallet.data && progress.data) {
    return (
      <Animated.View entering={CONTENT_ENTERING}>
        <PointsCard
          balance={wallet.data.balance}
          progress={progress.data}
          onPress={() => router.push('/extrato')}
          testID="profile-points"
          style={styles.points}
        />
        <FanStatsRow stats={progress.data.stats} style={styles.stats} />
      </Animated.View>
    );
  }

  const failed =
    (wallet.data === undefined && wallet.isError) ||
    (progress.data === undefined && progress.isError);
  if (failed) {
    // Só o que faltou vai de novo; o card volta quando os dois estiverem aqui.
    const missing: Refetch[] = [];
    if (!wallet.data) missing.push(() => wallet.refetch());
    if (!progress.data) missing.push(() => progress.refetch());
    return (
      <EmptyState
        tone="error"
        message={t('profile.points.loadError')}
        onAction={() => void retrySection(missing, 'profile.points.loaded')}
        actionLoading={wallet.isFetching || progress.isFetching}
        style={styles.points}
      />
    );
  }

  return (
    <SkeletonGroup accessibilityLabel={t('profile.points.loading')}>
      <PointsCardSkeleton style={styles.points} />
      <FanStatsSkeleton style={styles.stats} />
    </SkeletonGroup>
  );
}

/**
 * Conquistas: "14 de 32" é contagem, sem toque e em cor neutra (não há tela de
 * conquistas desenhada), e as peças também não são tocáveis por enquanto.
 */
function AchievementsSection() {
  const achievements = useMyAchievementsQuery();
  const data = achievements.data;

  let content;
  if (data) {
    content = (
      <Animated.View entering={CONTENT_ENTERING}>
        {data.highlights.length > 0 ? (
          <AchievementsRow achievements={data.highlights} />
        ) : (
          <EmptyState message={t('profile.achievements.empty')} />
        )}
      </Animated.View>
    );
  } else if (achievements.isPending) {
    content = (
      <SkeletonGroup accessibilityLabel={t('profile.achievements.loading')}>
        <AchievementsSkeleton />
      </SkeletonGroup>
    );
  } else {
    content = (
      <EmptyState
        tone="error"
        message={t('profile.achievements.loadError')}
        onAction={() =>
          void retrySection([() => achievements.refetch()], 'profile.achievements.loaded')
        }
        actionLoading={achievements.isFetching}
      />
    );
  }

  const counts = data
    ? { unlocked: formatNumber(data.unlockedCount), total: formatNumber(data.totalCount) }
    : null;

  return (
    <View>
      <SectionHeader
        title={t('profile.achievements.title')}
        count={counts ? t('profile.achievements.count', counts) : undefined}
        countPlacement="end"
        accessibilityLabel={counts ? t('profile.achievements.countLabel', counts) : undefined}
        testID="profile-achievements-header"
      />
      {content}
    </View>
  );
}

/**
 * "Suas centrais": todas as centrais do fã, no próprio perfil (lista curta,
 * sem "Ver todas"). Cada linha abre o artista na pilha do Perfil.
 */
function CentralsSection() {
  const centrals = useFanCentralsQuery();

  let content;
  if (centrals.data) {
    content = (
      <Animated.View entering={CONTENT_ENTERING}>
        {centrals.data.length > 0 ? (
          <View style={styles.centrals}>
            {centrals.data.map((central) => (
              <CentralRow
                key={central.artistId}
                central={central}
                testID={`profile-central-${central.artistId}`}
              />
            ))}
          </View>
        ) : (
          <EmptyState
            message={t('profile.centrals.empty')}
            actionLabel={t('profile.centrals.explore')}
            onAction={() => router.navigate('/explorar')}
          />
        )}
      </Animated.View>
    );
  } else if (centrals.isPending) {
    content = (
      <SkeletonGroup accessibilityLabel={t('profile.centrals.loading')}>
        <CentralRowsSkeleton />
      </SkeletonGroup>
    );
  } else {
    content = (
      <EmptyState
        tone="error"
        message={t('profile.centrals.loadError')}
        onAction={() => void retrySection([() => centrals.refetch()], 'profile.centrals.loaded')}
        actionLoading={centrals.isFetching}
      />
    );
  }

  return (
    <View>
      <SectionHeader title={t('profile.centrals.title')} spacing="tight" />
      {content}
    </View>
  );
}

/**
 * As falhas do perfil anunciadas num lugar só, cada uma quando passa a
 * aparecer, e só com a 1e em foco (ela segue montada quando o fã troca de
 * aba). Com os dados na tela, a busca que falhou (o puxar para atualizar)
 * vira um aviso só.
 */
function useAnnounceProfileFailures(focused: boolean): void {
  const wallet = useWalletQuery();
  const progress = useMyProgressQuery();
  const achievements = useMyAchievementsQuery();
  const centrals = useFanCentralsQuery();

  const pointsMissing = wallet.data === undefined || progress.data === undefined;
  useAnnounceWhen(
    focused && pointsMissing && (settled(wallet) || settled(progress)),
    t('profile.points.loadError'),
  );
  useAnnounceWhen(
    focused && achievements.data === undefined && settled(achievements),
    t('profile.achievements.loadError'),
  );
  useAnnounceWhen(
    focused && centrals.data === undefined && settled(centrals),
    t('profile.centrals.loadError'),
  );
  const updateFailed = [wallet, progress, achievements, centrals].some(
    (query) => query.data !== undefined && settled(query),
  );
  useAnnounceWhen(focused && updateFailed, t('profile.updateError'));
}

/**
 * 1e. Meu perfil: o hero com o nome, o @ e a cidade do Firestore (a escuta o
 * mantém em dia) e o nível no anel e no selo; o card de pontos (saldo para
 * resgatar, ganhos da semana e o caminho até o próximo nível); os números;
 * as conquistas e as centrais do fã. Tudo o que é ponto vem do servidor
 * (fixtures até a API do M2). O brilho rosa com as listras fica parado no
 * topo e o conteúdo rola por cima; puxar para baixo atualiza.
 */
export function ProfileScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  useWatchMyProfile();
  const identity = useFanIdentity();
  const profile = useMyProfileQuery();
  const progress = useMyProgressQuery();
  const { refreshing, refresh } = useProfileRefresh();
  const celebration = useLevelUp(progress.data?.level, focused);
  useAnnounceProfileFailures(focused);

  return (
    <Screen padded={false} contentStyle={styles.screen} backdrop={<PageGlow preset="profile" />}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceRaised}
          />
        }
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <ProfileHeader />
        <ProfileHero
          uid={identity.uid}
          name={identity.name}
          photoURL={identity.photoURL}
          username={profile.data?.username ?? null}
          city={profile.data?.city ?? null}
          loading={identity.loading && !identity.name}
          level={progress.data?.level ?? null}
          levelFraction={progress.data ? levelFraction(progress.data) : 0}
          celebration={celebration}
          testID="profile-hero"
          style={styles.hero}
        />
        <PointsSection />
        <AchievementsSection />
        <CentralsSection />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // O conteúdo vai até o pé da tela, por baixo da tab bar; o espaço dela fica na rolagem.
  screen: {
    paddingBottom: 0,
  },
  content: {
    paddingHorizontal: spacing.gutter,
  },
  // O título fica a 12 da área segura, no meio da linha de 44 do Ajustes.
  header: {
    minHeight: layout.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // O ícone encosta na margem da tela, como no protótipo; a sobra do alvo fica para dentro.
  settings: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  // 18 do título ao anel no protótipo, descontada a sobra da linha de 44.
  hero: {
    paddingTop: spacing.sm,
  },
  points: {
    marginTop: spacing.sectionTopTight,
  },
  stats: {
    marginTop: spacing.cardPadding,
  },
  centrals: {
    gap: spacing.tileGap,
  },
});
