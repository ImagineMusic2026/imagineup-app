import { FlashList } from '@shopify/flash-list';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { LargeTitleHeader } from '@/components/header';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import {
  useBlockedFansInfiniteQuery,
  useUnblockFanMutation,
  type BlockedFan,
} from '@/domains/posts';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useIsOnline } from '@/hooks/use-is-online';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, radii, spacing } from '@/theme';
import { nameBeforePeriod } from '@/utils/text';

// Linhas do esqueleto: a altura de uma linha com o avatar e o botão.
const SKELETON_ROWS = 4;
const SKELETON_ROW_HEIGHT = 64;

function ItemGap() {
  return <View style={styles.gap} />;
}

function BlockedFansSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('blockedFans.loading')} style={styles.skeleton}>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <Skeleton key={index} height={SKELETON_ROW_HEIGHT} radius={radii.lg} />
      ))}
    </SkeletonGroup>
  );
}

/**
 * Um fã bloqueado: o avatar, o nome ("Fã" sem nome) e o @, lidos como um
 * elemento só, e o botão irmão "Desbloquear" (nada tocável dentro de outro
 * pressável; a linha não abre o perfil). Desbloquear: o botão "carregando";
 * no sucesso, a linha sai (o hook tira o fã das páginas carregadas) e o fã
 * ouve que desbloqueou, com o toque de sucesso; no erro, a frase embaixo da
 * linha, anunciada, com o toque de erro (o ritmo, o 404 ou a genérica).
 */
function BlockedFanRow({ fan }: { fan: BlockedFan }) {
  const online = useIsOnline();
  const name = fan.displayName ?? t('profile.fallbackName');
  const [failure, setFailure] = useState<TranslationKey | null>(null);
  const unblock = useUnblockFanMutation(fan.uid, {
    onDone: () => {
      haptics.trigger('success');
      AccessibilityInfo.announceForAccessibility(
        t('blockedFans.unblocked', { name: nameBeforePeriod(name) }),
      );
    },
    onError: (error) => {
      const key = actionRefusal(error, 'unblock').key;
      setFailure(key);
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(key));
    },
  });

  return (
    <View>
      <ListRow
        leading={<Avatar name={fan.displayName} id={fan.uid} photoUrl={fan.photoURL} size="md" />}
        title={name}
        meta={fan.username ? `@${fan.username}` : undefined}
        trailing={
          <Button
            label={t('blockedFans.unblock')}
            variant="secondary"
            size="sm"
            onPress={() => {
              setFailure(null);
              unblock.unblock();
            }}
            loading={unblock.isPending}
            disabled={!online || unblock.isPending}
            haptic="confirm"
            accessibilityLabel={t('blockedFans.unblockLabel', { name })}
            testID={`blocked-fan-unblock-${fan.uid}`}
          />
        }
        accessibilityGroup="content"
        accessibilityLabel={
          fan.username ? t('blockedFans.rowLabel', { name, username: fan.username }) : name
        }
        testID={`blocked-fan-${fan.uid}`}
      />
      {failure ? (
        <Text variant="caption" color={colors.danger} style={styles.rowError}>
          {t(failure)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * "Fãs bloqueados" (`/fas-bloqueados`, seção 29, frente B), na pilha do
 * Perfil, aberta pela linha da seção "Segurança" dos Ajustes. Sem desenho, no
 * visual do extrato: o título com o voltar, o que o bloqueio faz, e a lista do
 * mais novo ao mais antigo (`GET /me/blocks`), uma página por vez pelo fim da
 * lista. A lista fica fora do disco (o hook), e os anúncios de falha só saem
 * com a tela em foco.
 *
 * Desbloquear tira a linha sem buscar a lista de novo. Quando as linhas
 * carregadas acabam e ainda há página, a tela pede a seguinte sozinha, em vez
 * de dizer que a lista está vazia. A página seguinte que falha tem aviso
 * próprio no pé, e o "Tentar de novo" busca só ela.
 */
export function BlockedFansScreen() {
  const bottomInset = useTabBarInset();
  const focused = useIsFocused();
  const query = useBlockedFansInfiniteQuery();
  const fans = query.data?.pages.flatMap((page) => page.items) ?? [];
  const loaded = query.data !== undefined;
  // Tudo o que estava na tela foi desbloqueado, ou a página veio sem ninguém
  // (o perfil que sumiu sai da página no servidor), e ainda há a seguinte.
  const wantsMore =
    loaded &&
    fans.length === 0 &&
    query.hasNextPage &&
    !query.isFetchingNextPage &&
    !query.isFetchNextPageError;

  useEffect(() => {
    if (wantsMore) void query.fetchNextPage({ cancelRefetch: false });
  }, [wantsMore, query]);

  const settled = focused && query.isError && !query.isFetching;
  useAnnounceWhen(settled && !loaded, t('blockedFans.loadError'));
  useAnnounceWhen(settled && query.isFetchNextPageError, t('blockedFans.moreError'));

  let empty;
  if (query.isPending || wantsMore || (loaded && fans.length === 0 && query.isFetchingNextPage)) {
    empty = <BlockedFansSkeleton />;
  } else if (!loaded) {
    empty = (
      <EmptyState
        tone="error"
        message={t('blockedFans.loadError')}
        onAction={() => void query.refetch()}
        actionLoading={query.isFetching}
      />
    );
  } else if (query.isFetchNextPageError) {
    empty = null;
  } else {
    empty = <EmptyState title={t('blockedFans.empty')} message={t('blockedFans.emptyText')} />;
  }

  return (
    <Screen contentStyle={styles.screen}>
      <FlashList<BlockedFan>
        data={fans}
        keyExtractor={(fan) => fan.uid}
        // A chave pelo uid: a linha guarda o pedido e o erro dela, e a célula
        // reciclada para outro fã não pode herdar os dois.
        renderItem={({ item }) => <BlockedFanRow key={item.uid} fan={item} />}
        ItemSeparatorComponent={ItemGap}
        ListHeaderComponent={
          <LargeTitleHeader
            title={t('blockedFans.title')}
            subtitle={t('blockedFans.intro')}
            showBack
          />
        }
        ListEmptyComponent={empty}
        ListFooterComponent={
          query.isFetchNextPageError ? (
            <EmptyState
              tone="error"
              message={t('blockedFans.moreError')}
              onAction={() => void query.fetchNextPage({ cancelRefetch: false })}
              actionLoading={query.isFetchingNextPage}
            />
          ) : null
        }
        onEndReached={() => {
          // Depois de uma falha, a página seguinte espera o "Tentar de novo" do pé.
          if (query.hasNextPage && !query.isFetchingNextPage && !query.isFetchNextPageError) {
            void query.fetchNextPage({ cancelRefetch: false });
          }
        }}
        contentContainerStyle={{ paddingBottom: bottomInset + spacing.xl }}
        showsVerticalScrollIndicator={false}
        testID="blocked-fans-list"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A lista vai até o pé da tela, por baixo da tab bar; o espaço dela fica no conteúdo.
  screen: {
    paddingBottom: 0,
  },
  gap: {
    height: spacing.listGap,
  },
  skeleton: {
    gap: spacing.listGap,
    marginTop: spacing.lg,
  },
  rowError: {
    paddingTop: spacing.xs,
    textAlign: 'center',
  },
});
