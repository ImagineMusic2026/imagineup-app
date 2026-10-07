import { FlashList } from '@shopify/flash-list';
import { router, useIsFocused } from 'expo-router';
import { AccessibilityInfo, RefreshControl, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { PointsPill } from '@/components/points-pill';
import { Screen } from '@/components/screen';
import { SectionLabel } from '@/components/section-label';
import { useWalletQuery } from '@/domains/profile';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';
import { colors, spacing } from '@/theme';

import { FeaturedRewardCard } from '../components/featured-reward-card';
import { RewardCard } from '../components/reward-card';
import { RewardsLegal } from '../components/rewards-legal';
import { RewardsSkeleton } from '../components/rewards-skeleton';
import { buildRewardGrid, rewardAvailability, type RewardRow } from '../describe-reward';
import { useRewardsRefresh } from '../hooks/use-rewards-refresh';
import { useRewardsQuery } from '../queries';
import type { Reward } from '../types';

function openReward(reward: Reward): void {
  router.push({ pathname: '/recompensa/[recompensaId]', params: { recompensaId: reward.id } });
}

interface RewardsHeaderProps {
  balance: number | null;
  /** A carteira não carregou: sem a pílula, que diria "carregando" para sempre. */
  balanceFailed: boolean;
  featured: Reward | null;
  /** Há cards na grade: a sobrelinha "Ao seu alcance" abre a seção. */
  hasGrid: boolean;
}

/**
 * Título com o voltar na mesma linha (aprovado em 2026-09-29) e o saldo à
 * direita (o mesmo "SEUS PONTOS" do perfil), o destaque e a sobrelinha.
 */
function RewardsHeader({ balance, balanceFailed, featured, hasGrid }: RewardsHeaderProps) {
  return (
    <View>
      <LargeTitleHeader
        title={t('rewards.title')}
        showBack
        accessory={balanceFailed ? undefined : <PointsPill value={balance} />}
      />
      {featured ? (
        <FeaturedRewardCard
          reward={featured}
          availability={rewardAvailability(featured, balance)}
          onPress={openReward}
        />
      ) : null}
      {hasGrid ? <SectionLabel>{t('rewards.sections.reachable')}</SectionLabel> : null}
    </View>
  );
}

function RowGap() {
  return <View style={styles.gap} />;
}

type ListState = 'loading' | 'error' | 'empty' | 'none';

function ListPlaceholder({
  state,
  retrying,
  onRetry,
}: {
  state: ListState;
  retrying: boolean;
  onRetry: () => void;
}) {
  switch (state) {
    case 'loading':
      return <RewardsSkeleton />;
    case 'error':
      return (
        <EmptyState
          tone="error"
          message={t('rewards.loadError')}
          onAction={onRetry}
          actionLoading={retrying}
        />
      );
    case 'empty':
      return <EmptyState message={t('rewards.empty')} />;
    default:
      return null;
  }
}

/**
 * 1h. A loja de recompensas: o saldo (o contador que o resgate gasta; o nível
 * não cai), o destaque e a grade "Ao seu alcance", do menor custo para o
 * maior, com o que falta em cada uma que o saldo não cobre. Tocar abre o
 * detalhe do resgate numa sheet. Recompensas, custos e estoque vêm da API e do
 * painel; o "faltam N" é só para mostrar, quem decide é o servidor. No pé, o
 * aviso da regra 5.3 da Apple e o link do regulamento, quando a loja manda o
 * endereço (bloco 10).
 */
export function RewardsScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const query = useRewardsQuery();
  const wallet = useWalletQuery();
  const { refreshing, refresh } = useRewardsRefresh();
  const balance = wallet.data?.balance ?? null;
  // A carteira falhou (depois das novas tentativas) sem saldo nenhum em cache.
  // Continua assim enquanto busca de novo: sem dado, a busca tira a consulta
  // do erro, e o "Tentar de novo" (com o foco do leitor de tela) sumiria.
  const balanceFailed = wallet.data === undefined && wallet.errorUpdateCount > 0;
  const { featured, rows } = buildRewardGrid(query.data?.rewards ?? []);
  const loaded = query.data !== undefined;
  // O saldo que ainda está chegando segura o esqueleto, para o preço não
  // trocar de lima para "faltam" na frente do fã. Pausado (sem rede e sem
  // cache), a loja aparece com os preços sem o saldo.
  const waitingBalance = wallet.isPending && wallet.fetchStatus === 'fetching' && !balanceFailed;
  const listState: ListState =
    query.isPending || (loaded && waitingBalance)
      ? 'loading'
      : !loaded
        ? 'error'
        : featured
          ? 'none'
          : 'empty';
  const items = listState === 'loading' ? [] : rows;

  // Só com a 1h à vista: ela segue montada embaixo da sheet do resgate, e a
  // busca de fundo que falha ali não fala por ela.
  const settled = focused && query.isError && !query.isFetching;
  useAnnounceWhen(settled && !loaded, t('rewards.loadError'));
  useAnnounceWhen(settled && loaded, t('rewards.updateError'));
  // A loja aparece sem o saldo (os preços em contorno neutro): o fã sabe por quê.
  const balanceSettled = focused && loaded && balanceFailed && !wallet.isFetching;
  useAnnounceWhen(balanceSettled && !query.isError, t('rewards.balanceError'));
  const footerError = !loaded
    ? null
    : query.isError
      ? t('rewards.updateError')
      : balanceFailed
        ? t('rewards.balanceError')
        : null;

  // O "Tentar de novo" some junto com o erro quando a loja chega, e o foco do
  // leitor de tela iria com ele: o fã ouve que ela chegou. Busca a loja e o
  // saldo juntos, porque um sem o outro deixaria o "faltam N" errado.
  const retry = async (): Promise<void> => {
    const [store, saldo] = await Promise.all([
      query.refetch(),
      balanceFailed ? wallet.refetch() : null,
    ]);
    if (store.isSuccess && (saldo === null || saldo.isSuccess)) {
      AccessibilityInfo.announceForAccessibilityWithOptions(t('rewards.loaded'), { queue: true });
    }
  };

  const renderItem = ({ item }: { item: RewardRow }) => (
    <View style={styles.row}>
      {item.rewards.map((reward) => (
        <RewardCard
          key={reward.id}
          reward={reward}
          availability={rewardAvailability(reward, balance)}
          onPress={openReward}
        />
      ))}
      {/* Sozinho na última linha, o card fica com a largura de uma coluna. */}
      {item.rewards.length === 1 ? <View style={styles.emptyCell} /> : null}
    </View>
  );

  return (
    <Screen contentStyle={styles.screen}>
      <FlashList<RewardRow>
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        extraData={balance}
        ItemSeparatorComponent={RowGap}
        ListHeaderComponent={
          <RewardsHeader
            balance={balance}
            balanceFailed={balanceFailed}
            featured={listState === 'loading' ? null : featured}
            hasGrid={items.length > 0}
          />
        }
        ListEmptyComponent={
          <ListPlaceholder
            state={listState}
            retrying={query.isFetching}
            onRetry={() => void retry()}
          />
        }
        ListFooterComponent={
          listState === 'loading' ? null : (
            <View>
              {footerError ? (
                <EmptyState
                  tone="error"
                  message={footerError}
                  onAction={() => void retry()}
                  actionLoading={query.isFetching || wallet.isFetching}
                />
              ) : null}
              <RewardsLegal rulesUrl={query.data?.rulesUrl ?? null} style={styles.legal} />
            </View>
          )
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.points}
            colors={[colors.onPoints]}
            progressBackgroundColor={colors.points}
          />
        }
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela, por baixo da tab bar; o espaço dela fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.gridGap,
  },
  emptyCell: {
    flex: 1,
  },
  gap: {
    height: spacing.gridGap,
  },
  legal: {
    marginTop: spacing.blockGap,
    paddingHorizontal: spacing.lg,
  },
});
